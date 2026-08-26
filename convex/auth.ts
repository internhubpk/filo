// =============================================================================
// FILO Authentication System - CLEAN VERSION
// =============================================================================
// No self-references! All session operations in separate sessions.ts file
// =============================================================================

import { v } from "convex/values";
import { action, query } from "./_generated/server";
import { api } from "./_generated/api";

// ==================== TYPES ====================

interface AuthResult {
  success: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    // Manual activation flow: surface the user's status so the client
    // can gate AI generation. New signups are "pending_activation" until
    // an admin verifies payment and flips to "active".
    status?: "pending_activation" | "active" | "suspended";
    planId?: string | null;
  };
  sessionToken?: string;
  error?: string;
  code?: string;
}

// ==================== PASSWORD HASHING (SHA-256 for MVP) ====================

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

// ==================== AUTH FUNCTIONS ====================

/**
 * Login - Validates email/password and creates session
 * Uses sessions.ts for session creation (no circular refs!)
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
        return { success: false, error: "Email and password are required", code: "MISSING_FIELDS" };
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(args.email)) {
        return { success: false, error: "Invalid email format", code: "INVALID_EMAIL" };
      }

      console.log('[AUTH] Login attempt for:', args.email.toLowerCase().trim());

      // Look up user in database
      const user = await ctx.runQuery(api.users.getUserByEmail, {
        email: args.email.toLowerCase().trim(),
      });

      if (!user) {
        console.log('[AUTH] User not found:', args.email.toLowerCase().trim());
        return { success: false, error: "No account found with this email", code: "USER_NOT_FOUND" };
      }

      // Verify password
      const isValid = await verifyPassword(args.password, user.passwordHash || "");
      
      if (!isValid) {
        console.log('[AUTH] Invalid password for:', args.email.toLowerCase().trim());
        return { success: false, error: "Incorrect password", code: "INVALID_PASSWORD" };
      }

      console.log('[AUTH] Password valid, creating session for user:', user._id);

      // Create session token
      const sessionToken = generateSessionToken();
      
      // Store session using sessions.ts (SEPARATE FILE - NO CIRCULAR REFS!)
      await ctx.runMutation(api.sessions.createSession, {
        userId: user._id,
        token: sessionToken,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      console.log('[AUTH] Login successful for:', user.email);

      return {
        success: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          // Surface activation status. New signups are "pending_activation";
          // admin flips to "active" after verifying payment. The client uses
          // this to decide whether to allow AI generation.
          status: user.status ?? "pending_activation",
          planId: user.planId ?? null,
        },
        sessionToken,
      };

    } catch (error) {
      console.error("[AUTH] Login error:", error);
      return { success: false, error: "Login failed. Please try again.", code: "LOGIN_ERROR" };
    }
  },
});

/**
 * Signup - Creates new user account and auto-login
 * Uses sessions.ts for session creation (no circular refs!)
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
        return { success: false, error: "All fields are required", code: "MISSING_FIELDS" };
      }

      if (args.password.length < 6) {
        return { success: false, error: "Password must be at least 6 characters", code: "PASSWORD_TOO_SHORT" };
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(args.email)) {
        return { success: false, error: "Invalid email format", code: "INVALID_EMAIL" };
      }

      const normalizedEmail = args.email.toLowerCase().trim();
      
      console.log('[AUTH] Signup attempt for:', normalizedEmail);

      // Check if user already exists
      const existingUser = await ctx.runQuery(api.users.getUserByEmail, {
        email: normalizedEmail,
      });

      if (existingUser) {
        console.log('[AUTH] Email already exists:', normalizedEmail, 'User ID:', existingUser._id);
        return {
          success: false,
          error: "An account with this email already exists",
          code: "EMAIL_EXISTS",
        };
      }

      console.log('[AUTH] Creating new user:', normalizedEmail);

      // Hash the password
      const passwordHash = await hashPassword(args.password);

      // Create the user in database
      const userId = await ctx.runMutation(api.users.createUserWithPassword, {
        name: args.name.trim(),
        email: normalizedEmail,
        passwordHash,
      });

      console.log('[AUTH] User created with ID:', userId);

      // Auto-login after signup using sessions.ts (NO CIRCULAR REFS!)
      const sessionToken = generateSessionToken();
      await ctx.runMutation(api.sessions.createSession, {
        userId,
        token: sessionToken,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });

      console.log('[AUTH] Signup successful for:', normalizedEmail);

      return {
        success: true,
        user: {
          id: userId,
          name: args.name.trim(),
          email: normalizedEmail,
          // New signups are pending_activation until admin verifies payment
          status: "pending_activation",
        },
        sessionToken,
      };

    } catch (error) {
      console.error("[AUTH] Signup error:", error);
      return {
        success: false,
        error: "Account creation failed. Please try again.",
        code: "SIGNUP_ERROR",
      };
    }
  },
});

/**
 * Validate session token - returns user data if valid
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
        // Surface activation status so the client can gate AI generation.
        // New signups default to "pending_activation"; admin flips to
        // "active" after manually verifying the payment.
        status: user.status ?? "pending_activation",
        planId: user.planId ?? null,
      } : null,
    };
  },
});

/**
 * Logout - Invalidate session token
 * Uses sessions.ts for deletion (no circular refs!)
 */
export const logout = action({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      // Delete session using sessions.ts (NO CIRCULAR REFS!)
      await ctx.runMutation(api.sessions.deleteSession, {
        token: args.token,
      });

      console.log('[AUTH] Session invalidated');
      return { success: true };
    } catch (error) {
      console.error("[AUTH] Logout error:", error);
      // Still return success - client should clear local storage anyway
      return { success: true };
    }
  },
});
