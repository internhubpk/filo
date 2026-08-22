import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ==================== SUBSCRIPTION QUERIES ====================

/**
 * Get user's active subscription (if any)
 * Returns null if user has no active subscription
 */
export const getActiveSubscription = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "active"),
          q.eq(q.field("status"), "trialing")
        )
      )
      .first();
  },
});

/**
 * Check if user has Pro/active subscription
 * Used to gate AI features and premium content
 */
export const hasActiveSubscription = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "active"),
          q.eq(q.field("status"), "trialing")
        )
      )
      .first();

    if (!subscription) {
      return { 
        hasActive: false, 
        reason: "no_subscription" as const,
        subscription: null,
        plan: null,
      };
    }

    // Check if subscription is expired (read-only check - no mutation in query)
    const now = Date.now();
    if (subscription.currentPeriodEnd < now) {
      return { 
        hasActive: false, 
        reason: "expired" as const,
        subscription: null,
        plan: null,
      };
    }

    // Get plan details
    const plan = await ctx.db.get(subscription.planId);

    return {
      hasActive: true,
      reason: "active" as const,
      subscription,
      plan,
    };
  },
});

/**
 * Get all user subscriptions (for billing history)
 */
export const getUserSubscriptions = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);
  },
});

/**
 * Get subscription by ID (for webhook processing)
 */
export const getSubscriptionById = query({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.subscriptionId);
  },
});

/**
 * Get subscription by provider ID (for webhooks)
 */
export const getSubscriptionByProviderId = query({
  args: { providerSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_providerSubscriptionId", (q) =>
        q.eq("providerSubscriptionId", args.providerSubscriptionId)
      )
      .first();
  },
});

// ==================== SUBSCRIPTION MUTATIONS ====================

/**
 * Create a new subscription record
 * Called after successful payment or when starting trial
 */
export const createSubscription = mutation({
  args: {
    userId: v.id("users"),
    planId: v.id("plans"),
    provider: v.literal("safepay"),
    providerSubscriptionId: v.optional(v.string()),
    providerCustomerId: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("canceled"),
      v.literal("past_due"),
      v.literal("trialing"),
      v.literal("expired")
    ),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Check for existing active subscription
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "active"),
          q.eq(q.field("status"), "trialing")
        )
      )
      .first();

    if (existing && (args.status === "active" || args.status === "trialing")) {
      // Cancel existing subscription if activating new one
      await ctx.db.patch(existing._id, {
        status: "canceled",
        updatedAt: Date.now(),
      });
    }

    const subscriptionId = await ctx.db.insert("subscriptions", {
      ...args,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Update user's plan reference
    await ctx.db.patch(args.userId, {
      planId: args.planId,
      updatedAt: Date.now(),
    });

    return await ctx.db.get(subscriptionId);
  },
});

/**
 * Update subscription status (called from webhooks)
 */
export const updateSubscriptionStatus = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    status: v.union(
      v.literal("active"),
      v.literal("canceled"),
      v.literal("past_due"),
      v.literal("trialing"),
      v.literal("expired")
    ),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    providerSubscriptionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.currentPeriodStart !== undefined) {
      updates.currentPeriodStart = args.currentPeriodStart;
    }
    if (args.currentPeriodEnd !== undefined) {
      updates.currentPeriodEnd = args.currentPeriodEnd;
    }
    if (args.providerSubscriptionId !== undefined) {
      updates.providerSubscriptionId = args.providerSubscriptionId;
    }

    await ctx.db.patch(args.subscriptionId, updates);

    const subscription = await ctx.db.get(args.subscriptionId);

    // If canceled or expired, clear user's plan reference
    if (args.status === "canceled" || args.status === "expired") {
      if (subscription) {
        await ctx.db.patch(subscription.userId, {
          planId: undefined,
          updatedAt: Date.now(),
        });
      }
    }

    return await ctx.db.get(args.subscriptionId);
  },
});

/**
 * Cancel subscription at period end
 * User keeps access until current period ends
 */
export const cancelSubscription = mutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    const subscription = await ctx.db.get(args.subscriptionId);

    if (!subscription) {
      throw new Error("Subscription not found");
    }

    // Note: In production, add proper authorization check here
    // For now, we allow cancellation if subscription exists

    await ctx.db.patch(args.subscriptionId, {
      cancelAtPeriodEnd: true,
      updatedAt: Date.now(),
    });

    return await ctx.db.get(args.subscriptionId);
  },
});

/**
 * Reactivate a cancelled subscription (before period ends)
 */
export const reactivateSubscription = mutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    const subscription = await ctx.db.get(args.subscriptionId);

    if (!subscription) {
      throw new Error("Subscription not found");
    }

    if (!subscription.cancelAtPeriodEnd) {
      throw new Error("Subscription is not scheduled for cancellation");
    }

    await ctx.db.patch(args.subscriptionId, {
      cancelAtPeriodEnd: false,
      status: "active",
      updatedAt: Date.now(),
    });

    return await ctx.db.get(args.subscriptionId);
  },
});

// ==================== USAGE TRACKING ====================

/**
 * Check if user can perform AI generation
 * Enforces rate limits based on plan
 */
export const canGenerateAI = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // First check subscription status
    const subStatus = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "active"),
          q.eq(q.field("status"), "trialing")
        )
      )
      .first();

    let maxGenerations = 0; // Free tier default
    
    if (subStatus) {
      // Get plan limits
      const plan = await ctx.db.get(subStatus.planId);
      if (plan) {
        maxGenerations = plan.maxAiGenerations;
      }
    }

    // If unlimited (-1), allow generation
    if (maxGenerations === -1) {
      return {
        allowed: true,
        remaining: -1,
        limit: -1,
        resetsAt: subStatus?.currentPeriodEnd || null,
        reason: "unlimited" as const,
      };
    }

    // Count this month's usage
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const usageRecords = await ctx.db
      .query("usageRecords")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("type"), "ai_generation"),
          q.gte(q.field("periodStart"), startOfMonth)
        )
      )
      .collect();

    const totalUsed = usageRecords.reduce((sum, record) => sum + record.amount, 0);
    const remaining = Math.max(0, maxGenerations - totalUsed);

    return {
      allowed: remaining > 0,
      remaining,
      limit: maxGenerations,
      used: totalUsed,
      resetsAt: subStatus?.currentPeriodEnd || null,
      reason: remaining > 0 ? "within_limit" : "limit_exceeded" as const,
    };
  },
});

/**
 * Record an AI generation usage event
 * Call this after successful AI generation
 */
export const recordAIGeneration = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();

    await ctx.db.insert("usageRecords", {
      userId: args.userId,
      type: "ai_generation",
      amount: 1,
      periodStart: startOfMonth,
      periodEnd: endOfMonth,
      createdAt: now,
    });

    return { success: true, recordedAt: now };
  },
});
