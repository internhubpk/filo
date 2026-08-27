// =============================================================================
// FILO Session Management
// =============================================================================
// Separated from auth.ts to avoid circular resolution errors
// Auth.ts calls internal.sessions.* instead of self-referencing
//
// SECURITY: session rows authenticate holders of their token. Creation and
// deletion are therefore INTERNAL — they can only be invoked from inside the
// Convex deployment (the login/signup/logout actions), never by an anonymous
// caller holding the public deployment URL. Previously `createSession` was a
// public mutation accepting arbitrary tokens + expiry, which allowed anyone
// to mint database-backed sessions for any user.
// =============================================================================

import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/**
 * Create a new session for a user.
 * Called by auth.ts login/signup actions via internal reference.
 */
export const createSession = internalMutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Defensive clamps even though only trusted code calls this now.
    const token = /^[a-f0-9]{32,128}$/.test(args.token) ? args.token : null;
    if (!token) {
      throw new Error("Invalid session token format");
    }
    const maxExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days max
    const expiresAt = Math.min(Math.max(args.expiresAt, Date.now()), maxExpiry);

    console.log('[SESSIONS] Creating session for user:', args.userId);

    const sessionId = await ctx.db.insert("sessions", {
      userId: args.userId,
      token,
      expiresAt,
      createdAt: Date.now(),
    });

    console.log('[SESSIONS] Session created:', sessionId);
    return sessionId;
  },
});

/**
 * Delete a session (logout)
 */
export const deleteSession = internalMutation({
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
