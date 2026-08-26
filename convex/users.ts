import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ==================== QUERIES ====================

// Get user by ID
export const getUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

// Get user by email
export const getUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
  },
});

// Get just the user's activation status (lightweight check for client gating)
export const getUserStatus = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return { exists: false, status: null as null | string };
    }
    return {
      exists: true,
      status: user.status ?? "pending_activation",
      name: user.name,
      email: user.email,
      planId: user.planId ?? null,
    };
  },
});

// Admin: list all users (newest first)
export const getAllUsers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("users")
      .order("desc")
      .take(200);
  },
});

// Admin: list users pending activation
export const getPendingUsers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_status", (q) => q.eq("status", "pending_activation"))
      .order("desc")
      .take(200);
  },
});

// Admin: list active users
export const getActiveUsers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc")
      .take(200);
  },
});

// Create new user
export const createUser = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    image: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if user already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existing) {
      return existing;
    }

    // Create new user. New signups default to "pending_activation" - admin
    // must verify payment before the user can perform AI generation.
    const userId = await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      image: args.image,
      status: "pending_activation",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return await ctx.db.get(userId);
  },
});

// Update user profile
export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    planId: v.optional(v.id("plans")),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) updates.name = args.name;
    if (args.image !== undefined) updates.image = args.image;
    if (args.planId !== undefined) updates.planId = args.planId;

    await ctx.db.patch(args.userId, updates);

    return await ctx.db.get(args.userId);
  },
});

// Delete user account
export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Delete all user's files
    const files = await ctx.db
      .query("files")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    
    for (const file of files) {
      // TODO: Delete from R2
      await ctx.db.delete(file._id);
    }

    // Delete all artifacts
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    for (const artifact of artifacts) {
      await ctx.db.delete(artifact._id);
    }

    // Delete subscriptions
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    for (const subscription of subscriptions) {
      await ctx.db.delete(subscription._id);
    }

    // Delete sessions
    const sessions = await ctx.db
      .query("sessions")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .collect();

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    // Finally delete user
    await ctx.db.delete(args.userId);

    return { success: true };
  },
});

// Create user with password hash (for real auth)
// New signups always start with status="pending_activation" so admin can
// verify payment before unlocking AI generation.
export const createUserWithPassword = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    image: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if user already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existing) {
      return existing._id;
    }

    // Create new user with password hash and pending_activation status
    const userId = await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      image: args.image,
      passwordHash: args.passwordHash,
      status: "pending_activation",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return userId;
  },
});

// ==================== ADMIN MUTATIONS ====================

// Admin: activate a user account (after verifying their payment)
export const activateUser = mutation({
  args: {
    userId: v.id("users"),
    planId: v.optional(v.id("plans")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const updates: Record<string, unknown> = {
      status: "active",
      activatedAt: Date.now(),
      activationNote: args.note,
      updatedAt: Date.now(),
    };

    if (args.planId) {
      updates.planId = args.planId;
    }

    await ctx.db.patch(args.userId, updates);
    return await ctx.db.get(args.userId);
  },
});

// Admin: suspend a user account (revoke AI generation access)
export const suspendUser = mutation({
  args: {
    userId: v.id("users"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(args.userId, {
      status: "suspended",
      activationNote: args.note,
      updatedAt: Date.now(),
    });

    return await ctx.db.get(args.userId);
  },
});

// Admin: reset a user back to pending_activation (e.g. after a refund)
export const resetUserToPending = mutation({
  args: {
    userId: v.id("users"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(args.userId, {
      status: "pending_activation",
      activationNote: args.note,
      updatedAt: Date.now(),
    });

    return await ctx.db.get(args.userId);
  },
});
