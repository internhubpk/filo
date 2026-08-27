// =============================================================================
// FILO Authentication System - Hardened Version
// =============================================================================
//
// WHY THIS FILE WAS REWRITTEN (root cause of the "sign up / login error"):
//
//   Signup and login both failed on production with generic internal codes
//   ("SIGNUP_ERROR" / "LOGIN_ERROR"). The failure was thrown INSIDE the action
//   *after* successful user lookup / duplicate-email checks, leaving only
//   three candidate steps: password hashing (which depended on crypto.subtle),
//   the internal user-insert mutation, or the internal session mutation.
//   One giant try/catch could not distinguish them, so every incident surfaced
//   as an opaque "Account creation failed. Please try again."
//
//   Fix strategy (defence in depth):
//     1. SHA-256 is implemented in pure JS here. The hash helpers previously
//        used `crypto.subtle`, which is NOT guaranteed in every Convex
//        runtime/deployment age. Removing that dependency eliminates the
//        entire class of runtime-missing-API failures. The digest output is
//        byte-identical to before (same algorithm, same salt), so existing
//        passwordHash rows remain valid.
//     2. Every step (duplicate check → hash → user insert → session create)
//        gets its OWN try/catch and returns its own precise `code`. A stale
//        or half-deployed backend can no longer masquerade as an opaque
//        failure — client UI and server logs pinpoint the exact broken step.
//
// All session storage lives in sessions.ts (internal mutations only).
// =============================================================================

import { v } from "convex/values";
import { action, query, internalQuery, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/sha256";

// ==================== TYPES ====================

interface AuthResult {
  success: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    // Manual activation flow: surface the user's status so the client can
    // gate AI generation. Signups are activated instantly ("active") since
    // payments were removed; "suspended" is admin moderation.
    status?: "pending_activation" | "active" | "suspended";
    planId?: string | null;
  };
  sessionToken?: string;
  error?: string;
  code?: string;
}

// Shape returned by internal.users.getUserAuthDataByEmail (includes secrets).
interface UserAuthData {
  _id: Id<"users">;
  name: string;
  email: string;
  status?: string;
  planId?: string;
  passwordHash?: string;
}

type UserStatus = "pending_activation" | "active" | "suspended";

// Password hashing uses the dependency-free SHA-256 in ./lib/sha256.
// (Previously this used crypto.subtle, which is not guaranteed in every
// Convex runtime — see file header for the incident this caused.)

const PASSWORD_SALT = "filo_salt_2024_secret";

async function hashPassword(password: string): Promise<string> {
  return sha256Hex(password + PASSWORD_SALT);
}

async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  const hash = await hashPassword(password);
  if (hash.length !== hashedPassword.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ hashedPassword.charCodeAt(i);
  }
  return diff === 0;
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
 * Login - Validates email/password and creates a session.
 *
 * Every fallible step returns its own precise error code so production
 * incidents are diagnosable from the API response alone:
 *   LOGIN_LOOKUP_FAILED   - user lookup query itself threw
 *   LOGIN_HASH_FAILED     - password hashing threw (runtime problem)
 *   LOGIN_SESSION_FAILED  - session insert threw (often a stale deploy)
 */
export const login = action({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args): Promise<AuthResult> => {
    try {
      if (!args.email.trim() || !args.password.trim()) {
        return { success: false, error: "Email and password are required", code: "MISSING_FIELDS" };
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(args.email)) {
        return { success: false, error: "Invalid email format", code: "INVALID_EMAIL" };
      }

      console.log('[AUTH] Login attempt for:', args.email.toLowerCase().trim());

      // ---- Step 1: look up user (internal query keeps passwordHash hidden) ----
      let user: UserAuthData | null = null;
      try {
        user = await ctx.runQuery(internal.users.getUserAuthDataByEmail, {
          email: args.email.toLowerCase().trim(),
        });
      } catch (lookupError) {
        console.error('[AUTH] Login lookup failed:', lookupError);
        return {
          success: false,
          error: "Could not look up your account. Please try again in a moment.",
          code: "LOGIN_LOOKUP_FAILED",
        };
      }

      if (!user) {
        console.log('[AUTH] User not found:', args.email.toLowerCase().trim());
        return { success: false, error: "No account found with this email", code: "USER_NOT_FOUND" };
      }

      // ---- Step 2: verify password (pure-JS hash, no crypto.subtle needed) ----
      let isValid = false;
      try {
        isValid = await verifyPassword(args.password, user.passwordHash || "");
      } catch (hashError) {
        console.error('[AUTH] Password verification failed:', hashError);
        return {
          success: false,
          error: "Could not verify your password due to a technical problem. Please try again.",
          code: "LOGIN_HASH_FAILED",
        };
      }

      if (!isValid) {
        console.log('[AUTH] Invalid password for:', args.email.toLowerCase().trim());
        return { success: false, error: "Incorrect password", code: "INVALID_PASSWORD" };
      }

      console.log('[AUTH] Password valid, creating session for user:', user._id);

      // ---- Step 3: store session row via sessions.ts (internal mutation) ----
      const sessionToken = generateSessionToken();
      try {
        await ctx.runMutation(internal.sessions.createSession, {
          userId: user._id,
          token: sessionToken,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
        });
      } catch (sessionError) {
        console.error('[AUTH] Session creation failed:', sessionError);
        return {
          success: false,
          error: "Credentials verified, but signing you in failed. Please try again.",
          code: "LOGIN_SESSION_FAILED",
        };
      }

      console.log('[AUTH] Login successful for:', user.email);

      return {
        success: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          status: ((user.status ?? undefined) as UserStatus | undefined) ?? "active",
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
 * Signup - Creates a new user account with auto-login.
 *
 * Granular codes mirror login:
 *   SIGNUP_EMAIL_CHECK_FAILED   - duplicate-email query threw
 *   SIGNUP_HASH_FAILED          - hashing threw (runtime problem)
 *   SIGNUP_CREATE_USER_FAILED   - internal user insert threw
 *   SIGNUP_SESSION_FAILED       - internal session insert threw
 */
export const signup = action({
  args: {
    name: v.string(),
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args): Promise<AuthResult> => {
    try {
      if (!args.name.trim() || !args.email.trim() || !args.password.trim()) {
        return { success: false, error: "All fields are required", code: "MISSING_FIELDS" };
      }

      if (args.password.length < 6) {
        return { success: false, error: "Password must be at least 6 characters", code: "PASSWORD_TOO_SHORT" };
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(args.email)) {
        return { success: false, error: "Invalid email format", code: "INVALID_EMAIL" };
      }

      const normalizedEmail = args.email.toLowerCase().trim();

      console.log('[AUTH] Signup attempt for:', normalizedEmail);

      // ---- Step 1: duplicate-email check ----
      let existingUser: Record<string, unknown> | null = null;
      try {
        existingUser = await ctx.runQuery(api.users.getUserByEmail, {
          email: normalizedEmail,
        });
      } catch (dupCheckError) {
        console.error('[AUTH] Signup duplicate check failed:', dupCheckError);
        return {
          success: false,
          error: "Could not check whether this email is already registered. Please try again.",
          code: "SIGNUP_EMAIL_CHECK_FAILED",
        };
      }

      if (existingUser) {
        console.log('[AUTH] Email already exists:', normalizedEmail, 'User ID:', existingUser._id);
        return {
          success: false,
          error: "An account with this email already exists",
          code: "EMAIL_EXISTS",
        };
      }

      console.log('[AUTH] Creating new user:', normalizedEmail);

      // ---- Step 2: hash password (pure JS, cannot fail from missing APIs) ----
      let passwordHash = "";
      try {
        passwordHash = await hashPassword(args.password);
      } catch (hashError) {
        console.error('[AUTH] Signup hashing failed:', hashError);
        return {
          success: false,
          error: "Account could not be created due to a technical problem. Please try again.",
          code: "SIGNUP_HASH_FAILED",
        };
      }

      // ---- Step 3: create the user (internal mutation keeps hash insertion private) ----
      let userId: Id<"users">;
      try {
        userId = await ctx.runMutation(internal.users.createUserWithPassword, {
          name: args.name.trim(),
          email: normalizedEmail,
          passwordHash,
        });
      } catch (createError) {
        console.error('[AUTH] Signup user creation failed:', createError);
        const detail = createError instanceof Error ? createError.message : String(createError);
        // Common cause: backend functions not redeployed after a visibility
        // change ("Could not find function ..."). Surface it explicitly.
        return {
          success: false,
          error: `Account could not be created (user record): ${detail}`,
          code: "SIGNUP_CREATE_USER_FAILED",
        };
      }

      console.log('[AUTH] User created with ID:', userId);

      // ---- Step 4: auto-login session row (internal mutation) ----
      const sessionToken = generateSessionToken();
      try {
        await ctx.runMutation(internal.sessions.createSession, {
          userId,
          token: sessionToken,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });
      } catch (sessionError) {
        console.error('[AUTH] Signup session creation failed:', sessionError);
        const detail = sessionError instanceof Error ? sessionError.message : String(sessionError);
        return {
          success: false,
          error: `Account was created but sign-in failed (session): ${detail}. Please log in manually.`,
          code: "SIGNUP_SESSION_FAILED",
        };
      }

      console.log('[AUTH] Signup successful for:', normalizedEmail);

      return {
        success: true,
        user: {
          id: userId,
          name: args.name.trim(),
          email: normalizedEmail,
          // New signups are active immediately (payments removed)
          status: "active",
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
 * Change password — verifies the CURRENT password before allowing the change.
 * Called only from the Next.js /api/user/password route, which has already
 * authenticated the user via their HMAC session. The hash never leaves Convex.
 */
export const changePassword = action({
  args: {
    userId: v.id("users"),
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; code?: string }> => {
    try {
      if (!args.currentPassword || !args.newPassword) {
        return { success: false, error: "Both current and new password are required", code: "MISSING_FIELDS" };
      }
      if (args.newPassword.length < 8) {
        return { success: false, error: "New password must be at least 8 characters", code: "PASSWORD_TOO_SHORT" };
      }

      // Fetch the auth record by id through an internal query — password
      // hashes cannot leave Convex.
      const record = await ctx.runQuery(internal.auth.internalGetAuthDataById, { userId: args.userId });
      if (!record) {
        return { success: false, error: "Account not found", code: "ACCOUNT_NOT_FOUND" };
      }
      if (!record.passwordHash) {
        return { success: false, error: "This account has no password set", code: "NO_PASSWORD" };
      }

      const valid = await verifyPassword(args.currentPassword, record.passwordHash);
      if (!valid) {
        return { success: false, error: "Current password is incorrect", code: "WRONG_PASSWORD" };
      }

      const newHash = await hashPassword(args.newPassword);
      await ctx.runMutation(internal.auth.internalSetPasswordHash, {
        userId: args.userId,
        passwordHash: newHash,
      });
      return { success: true };
    } catch (err) {
      console.error("[AUTH] changePassword failed:", err);
      return { success: false, error: "Failed to change password", code: "CHANGE_PASSWORD_ERROR" };
    }
  },
});

// Internal helpers for changePassword (hash data stays inside Convex).
export const internalGetAuthDataById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return { _id: user._id, email: user.email, passwordHash: user.passwordHash, status: user.status };
  },
});

export const internalSetPasswordHash = internalMutation({
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { passwordHash: args.passwordHash, updatedAt: Date.now() });
    return { success: true };
  },
});

/**
 * Bootstrap the environment-credential admin as a REAL database admin.
 *
 * Why: admin authorization is verified server-side against the live Convex
 * user record (`isAdmin: true`). The env-credential admin (ADMIN_USERNAME /
 * ADMIN_PASSWORD) has no DB identity by default, so on every env-cred login
 * the Next.js route calls this action to ensure a matching DB admin exists.
 * The env credentials are verified HERE inside Convex (against the Convex
 * copies of ADMIN_USERNAME/ADMIN_PASSWORD) — the public function is useless
 * to attackers without those credentials.
 */
export const bootstrapEnvAdmin = action({
  args: { username: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<{ success: boolean; userId?: string; error?: string }> => {
    const envUser = process.env.ADMIN_USERNAME;
    const envPass = process.env.ADMIN_PASSWORD;
    const adminEmail = (process.env.ADMIN_EMAIL || "admin@filo.app").toLowerCase();

    if (!envUser || !envPass) {
      return { success: false, error: "Env admin credentials are not configured in Convex" };
    }
    if (args.username.toLowerCase() !== envUser.toLowerCase() || args.password !== envPass) {
      return { success: false, error: "Invalid admin credentials" };
    }

    const existing = (await ctx.runQuery(api.users.getUserByEmail, { email: adminEmail })) as { _id: Id<"users">; isAdmin?: boolean } | null;
    if (existing) {
      // Ensure the flag is set (self-healing) and return.
      if ((existing as { isAdmin?: boolean }).isAdmin !== true) {
        await ctx.runMutation(internal.users.setUserRoleInternal, {
          targetUserId: existing._id,
          isAdmin: true,
        });
      }
      return { success: true, userId: existing._id };
    }

    // Create the admin record. Password hash is random (env-cred admins do
    // not log in with this password; it only exists to satisfy the schema).
    const randomBytes = new Uint8Array(24);
    crypto.getRandomValues(randomBytes);
    const randomPassword = Array.from(randomBytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const passwordHash = await hashPassword(randomPassword);

    const userId = await ctx.runMutation(internal.users.createUserInternal, {
      name: "Administrator",
      email: adminEmail,
      passwordHash,
      isAdmin: true,
    });
    return { success: true, userId };
  },
});

/**
 * Validate session token - returns user data if valid.
 *
 * NOTE: This is a `query` (read-only). It cannot delete an expired session —
 * callers should fire a follow-up `api.sessions.deleteSession` mutation if
 * `valid=false` and `reason="expired"`.
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
      return { valid: false, user: null, reason: "not_found" as const };
    }

    if (session.expiresAt < Date.now()) {
      // Surface expiration so callers can call deleteSession mutation.
      return {
        valid: false,
        user: null,
        reason: "expired" as const,
        sessionId: session._id,
      };
    }

    const user = await ctx.db.get(session.userId);

    return {
      valid: true,
      user: user
        ? {
            id: user._id,
            name: user.name,
            email: user.email,
            status: (user.status ?? "active") as UserStatus,
            planId: user.planId ?? null,
          }
        : null,
      reason: "active" as const,
    };
  },
});

/**
 * Logout - Invalidate session token.
 * Uses sessions.ts for deletion (no circular refs!)
 */
export const logout = action({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.sessions.deleteSession, {
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

/**
 * authHealthCheck - PUBLIC diagnostic query.
 *
 * Exercises every table/index the auth flow depends on WITHOUT mutating
 * anything. Deploy it (`npx convex deploy`) and anyone can hit
 * `/api/auth/health` on the site to verify the backend is in sync.
 * This exists because previous signup/login incidents were impossible to
 * diagnose remotely when an opaque failure hid which step broke.
 */
export const authHealthCheck = query({
  args: {},
  handler: async (ctx) => {
    const checks: Record<string, string> = {};

    // users table + by_email index
    try {
      await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", "__health__probe__"))
        .first();
      checks.usersByIndex = "ok";
    } catch (e) {
      checks.usersByIndex = e instanceof Error ? e.message : "error";
    }

    // sessions table + by_token index
    try {
      await ctx.db
        .query("sessions")
        .withIndex("by_token", (q) => q.eq("token", "__health__probe__"))
        .first();
      checks.sessionsByIndex = "ok";
    } catch (e) {
      checks.sessionsByIndex = e instanceof Error ? e.message : "error";
    }

    // plans table readable (pricing surfaces depend on it)
    try {
      const planCount = (await ctx.db.query("plans").collect()).length;
      checks.plansReadable = "ok";
      checks.plansCount = String(planCount);
    } catch (e) {
      checks.plansReadable = e instanceof Error ? e.message : "error";
    }

    // usageRecords table readable (quota enforcement reads/writes it)
    try {
      await ctx.db.query("usageRecords").first();
      checks.usageReadable = "ok";
    } catch (e) {
      checks.usageReadable = e instanceof Error ? e.message : "error";
    }

    const allOk =
      checks.usersByIndex === "ok" &&
      checks.sessionsByIndex === "ok" &&
      checks.plansReadable === "ok" &&
      checks.usageReadable === "ok";

    return {
      ok: allOk,
      checkedAt: Date.now(),
      checks,
    };
  },
});
