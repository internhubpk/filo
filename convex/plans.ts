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

// Get the Free plan (public). Used by quota enforcement as the fallback for
// accounts without an explicit plan assignment, so "no plan" never means
// "unlimited".
export const getFreePlan = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("plans")
      .withIndex("by_tier", (q) => q.eq("tier", "free"))
      .first();
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

// -----------------------------------------------------------------------------
// ADMIN — Safepay plan id mapping (one authoritative Filo plan → Safepay plan)
// -----------------------------------------------------------------------------
// Called by POST /api/admin/billing/sync-safepay-plans after the server has
// created/looked up the matching recurring plans on Safepay. Admin-verified
// in-Convex (same guarantee as every admin surface).

import { mutation } from "./_generated/server";

async function assertAdminInternal(ctx: any, adminUserId: unknown) {
  const user = await ctx.db.get(adminUserId as any);
  if (!user || user.isAdmin !== true || user.status !== "active") {
    throw new Error("Admin access required");
  }
}

export const setSafepayPlanId = mutation({
  args: {
    serverToken: v.string(),
    adminUserId: v.id("users"),
    planId: v.id("plans"),
    interval: v.union(v.literal("monthly"), v.literal("yearly")),
    safepayPlanId: v.string(),
  },
  handler: async (ctx, args) => {
    const secret = process.env.FILO_SERVER_SECRET;
    if (!secret || args.serverToken !== secret) {
      throw new Error("Unauthorized");
    }
    await assertAdminInternal(ctx, args.adminUserId);
    const plan: any = await ctx.db.get(args.planId);
    if (!plan) throw new Error("Plan not found");
    const patch =
      args.interval === "yearly"
        ? { safepayPlanIdYearly: args.safepayPlanId }
        : { safepayPlanIdMonthly: args.safepayPlanId };
    await ctx.db.patch(args.planId, { ...patch, updatedAt: Date.now() });
    return { success: true as const };
  },
});
