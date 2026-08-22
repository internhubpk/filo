// =============================================================================
// FILO Authentication - COMPLETE Implementation
// =============================================================================
// All auth functions in ONE file to avoid resolution issues
// - Password hashing (SHA-256 for MVP)
// - Session tokens stored in database
// - Email validation
// =============================================================================

import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";

// ==================== TYPES ====================

interface AuthResult {
  success: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  sessionToken?: string;
  error?: string;
  code?: string;
}

// ==================== PASSWORD HASHING ====================

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "filo_salt_2024_secret");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  const hash = await hashPassword(password);
  return hash === hashedPassword;
}

function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ==================== SESSION MUTATIONS ====================
// Moved to sessions.ts to avoid circular resolution errors!
// Use api.sessions.createSession and api.sessions.deleteSession

// ==================== AUTH ACTIONS ====================

/**
 * Login - Validates email/password against database
 */
export const login = action({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args): Promise<AuthResult> => {
    try {
      // Validate input
      if (!args.email.trim() || !args.password.trim()) {
        return {
          success: false,
          error: "Email and password are required",
          code: "MISSING_FIELDS",
        };
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(args.email)) {
        return {
          success: false,
          error: "Invalid email format",
          code: "INVALID_EMAIL",
        };
      }

      // Look up user in database
      const user = await ctx.runQuery(api.users.getUserByEmail, {
        email: args.email.toLowerCase().trim(),
      });

      if (!user) {
        return {
          success: false,
          error: "No account found with this email",
          code: "USER_NOT_FOUND",
        };
      }

      // Verify password
      const isValid = await verifyPassword(args.password, user.passwordHash || "");
      
      if (!isValid) {
        return {
          success: false,
          error: "Incorrect password",
          code: "INVALID_PASSWORD",
        };
      }

      // Create session token
      const sessionToken = generateSessionToken();
      
      // Store session in database (from sessions.ts - no circular refs!)
      await ctx.runMutation(api.sessions.createSession, {
        userId: user._id,
        token: sessionToken,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      return {
        success: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
        },
        sessionToken,
      };

    } catch (error) {
      console.error("Login error:", error);
      return {
        success: false,
        error: "Login failed. Please try again.",
        code: "LOGIN_ERROR",
      };
    }
  },
});

/**
 * Signup - Creates actual user in database
 */
export const signup = action({
  args: {
    name: v.string(),
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args): Promise<AuthResult> => {
    try {
      // Validate inputs
      if (!args.name.trim() || !args.email.trim() || !args.password.trim()) {
        return {
          success: false,
          error: "All fields are required",
          code: "MISSING_FIELDS",
        };
      }

      if (args.password.length < 6) {
        return {
          success: false,
          error: "Password must be at least 6 characters",
          code: "PASSWORD_TOO_SHORT",
        };
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(args.email)) {
        return {
          success: false,
          error: "Invalid email format",
          code: "INVALID_EMAIL",
        };
      }

      const normalizedEmail = args.email.toLowerCase().trim();

      // Check if user already exists
      const existingUser = await ctx.runQuery(api.users.getUserByEmail, {
        email: normalizedEmail,
      });

      // DEBUG: Log when user exists (remove in production)
      if (existingUser) {
        console.log(`[SIGNUP DEBUG] Email already registered: ${normalizedEmail}, User ID: ${existingUser._id}, Name: ${existingUser.name}`);
        return {
          success: false,
          error: "An account with this email already exists",
          code: "EMAIL_EXISTS",
        };
      }
      
      console.log(`[SIGNUP DEBUG] Creating new user: ${normalizedEmail}`);

      // Hash the password
      const passwordHash = await hashPassword(args.password);

      // Create the user in database
      const userId = await ctx.runMutation(api.users.createUserWithPassword, {
        name: args.name.trim(),
        email: normalizedEmail,
        passwordHash,
      });

      // Auto-login after signup (using sessions.ts - no circular refs!)
      const sessionToken = generateSessionToken();
      await ctx.runMutation(api.sessions.createSession, {
        userId,
        token: sessionToken,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });

      return {
        success: true,
        user: {
          id: userId,
          name: args.name.trim(),
          email: normalizedEmail,
        },
        sessionToken,
      };

    } catch (error) {
      console.error("Signup error:", error);
      return {
        success: false,
        error: "Account creation failed. Please try again.",
        code: "SIGNUP_ERROR",
      };
    }
  },
});

/**
 * Validate session token
 */
export const validateSession = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session) {
      return { valid: false, user: null };
    }

    // Check expiration
    if (session.expiresAt < Date.now()) {
      await ctx.db.delete(session._id);
      return { valid: false, user: null };
    }

    // Get user data
    const user = await ctx.db.get(session.userId);
    
    return {
      valid: true,
      user: user ? {
        id: user._id,
        name: user.name,
        email: user.email,
      } : null,
    };
  },
});

/**
 * Logout - Invalidate session
 */
export const logout = action({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // Use the deleteSession mutation from sessions.ts (no circular refs!)
    await ctx.runMutation(api.sessions.deleteSession, {
      token: args.token,
    });

    return { success: true };
  },
});
