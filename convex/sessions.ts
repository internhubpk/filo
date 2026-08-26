// =============================================================================
// FILO Session Management
// =============================================================================
// Separated from auth.ts to avoid circular resolution errors
// Auth.ts calls api.sessions.* instead of self-referencing
// =============================================================================

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Create a new session for a user
 * Called by auth.ts login/signup functions via ctx.runMutation(api.sessions.createSession)
 */
export const createSession = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    console.log('[SESSIONS] Creating session for user:', args.userId);
    
    const sessionId = await ctx.db.insert("sessions", {
      userId: args.userId,
      token: args.token,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });

    console.log('[SESSIONS] Session created:', sessionId);
    return sessionId;
  },
});

/**
 * Create a session by email (avoids Convex ID serialization issues).
 * 
 * The Next.js server passes a plain email string; Convex looks up the
 * user internally and creates the session. This avoids the bug where
 * ConvexHttpClient fails to serialize user._id (from a query result)
 * back into a v.id("users") for a mutation call.
 */
export const createSessionByEmail = mutation({
  args: {
    email: v.string(),
    token: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    console.log('[SESSIONS] createSessionByEmail for:', args.email);

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (!user) {
      console.error('[SESSIONS] User not found:', args.email);
      throw new Error("User not found");
    }

    const sessionId = await ctx.db.insert("sessions", {
      userId: user._id,
      token: args.token,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });

    console.log('[SESSIONS] Session created by email:', sessionId);
    return sessionId;
  },
});

/**
 * Delete a session (logout)
 * Called by auth.ts logout function via ctx.runMutation(api.sessions.deleteSession)
 */
export const deleteSession = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    console.log('[SESSIONS] Deleting session with token');
    
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
      console.log('[SESSIONS] Session deleted:', session._id);
      return true;
    }

    console.log('[SESSIONS] Session not found for deletion');
    return false;
  },
});

/**
 * Validate session token and return full data.
 *
 * NOTE: This is a `query` (read-only). It cannot delete an expired session
 * directly — it surfaces `reason: "expired"` so callers can fire a
 * `deleteSession` mutation to clean up.
 */
export const validateSessionToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session) {
      return { valid: false, user: null, session: null, reason: "not_found" as const };
    }

    // Check expiration
    // NOTE: queries are read-only in Convex — we cannot delete the session
    // here. We surface `reason: "expired"` so callers can fire a
    // `deleteSession` mutation to clean up.
    if (session.expiresAt < Date.now()) {
      return {
        valid: false,
        user: null,
        session: { id: session._id, expiresAt: session.expiresAt, createdAt: session.createdAt },
        reason: "expired" as const,
        sessionId: session._id,
      };
    }

    const user = await ctx.db.get(session.userId);

    return {
      valid: true,
      user: user ? { id: user._id, name: user.name, email: user.email } : null,
      session: {
        id: session._id,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
      },
      reason: "active" as const,
    };
  },
});
