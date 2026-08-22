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
 * Validate session token and return full data
 * Alternative to auth.validateSession if needed
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
      return { valid: false, user: null, session: null };
    }

    // Check expiration
    if (session.expiresAt < Date.now()) {
      await ctx.db.delete(session._id);
      return { valid: false, user: null, session: null };
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
      session: {
        id: session._id,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
      },
    };
  },
});
