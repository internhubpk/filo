import { query } from "./_generated/server";
import { v } from "convex/values";

// Get all active plans (public)
export const getActivePlans = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("plans")
      .withIndex("by_active", (q) => q.eq("active", true))
      .order("asc")
      .collect();
  },
});

// Get ALL plans (admin only - includes inactive)
export const getAllPlans = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("plans")
      .order("desc") // newest first for admin view
      .collect();
  },
});

// Get plan by ID
export const getPlanById = query({
  args: { planId: v.id("plans") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.planId);
  },
});

// Get user's current subscription with plan details
export const getUserSubscription = query({
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

    if (!subscription) return null;

    const plan = await ctx.db.get(subscription.planId);
    
    return {
      ...subscription,
      plan,
    };
  },
});

// Get usage stats for a user
export const getUserUsage = query({
  args: { 
    userId: v.id("users"),
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("usageRecords")
      .withIndex("by_userId_period", (q) =>
        q
          .eq("userId", args.userId)
          .gte("periodStart", args.periodStart)
      )
      .filter((q) => q.lte(q.field("periodEnd"), args.periodEnd))
      .collect();

    // Aggregate by type
    const stats = {
      aiGenerations: 0,
      fileUploads: 0,
      storageUsed: 0,
    };

    for (const record of records) {
      switch (record.type) {
        case "ai_generation":
          stats.aiGenerations += record.amount;
          break;
        case "file_upload":
          stats.fileUploads += record.amount;
          break;
        case "storage_used":
          stats.storageUsed += record.amount;
          break;
      }
    }

    return stats;
  },
});
