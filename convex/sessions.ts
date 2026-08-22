// =============================================================================
// FILO Session Management
// =============================================================================
// Separated from auth.ts to avoid circular resolution errors
// =============================================================================

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Create a new session for a user
 * Called by auth.ts login/signup functions
 */
export const createSession = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sessions", {
      userId: args.userId,
      token: args.token,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
  },
});

/**
 * Delete a session (logout)
 */
export const deleteSession = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
      return true;
    }

    return false;
  },
});

/**
 * Validate session token and return user data
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
