import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// =============================================================================
// USAGE TRACKING (payments removed)
// =============================================================================
// The former subscription/payment machinery (SafePay + manual verification)
// has been removed. What remains here is plain monthly-usage accounting:
// every successful AI generation records one `usageRecords` row, and the
// Next.js generation routes enforce each plan's monthly limit from that.
// =============================================================================

/**
 * Get the user's AI-generation usage for the CURRENT calendar month.
 *
 * Used by the Next.js /api/artifacts/agent-generate route to enforce the
 * plan's monthly limit BEFORE doing expensive AI work.
 */
export const getMonthlyAiUsage = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();

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

    return {
      used: usageRecords.reduce((sum, record) => sum + record.amount, 0),
      periodStart: startOfMonth,
      periodEnd: endOfMonth,
    };
  },
});

/**
 * Check if user can perform AI generation.
 * Enforces the user's plan limit (default 500/month) based on usageRecords
 * and account status only — no subscription lookups anymore.
 */
export const canGenerateAI = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return {
        allowed: false,
        remaining: 0,
        limit: 0,
        used: 0,
        resetsAt: null,
        reason: "account_not_found" as const,
      };
    }

    // Suspended accounts cannot generate. Everyone else can (signups are
    // activated instantly since payments were removed).
    if (user.status === "suspended") {
      return {
        allowed: false,
        remaining: 0,
        limit: 0,
        used: 0,
        resetsAt: null,
        reason: "account_suspended" as const,
      };
    }

    // Plan limit from the user's assigned plan; sensible default otherwise.
    let maxGenerations = 500;
    if (user.planId) {
      const plan = await ctx.db.get(user.planId);
      if (plan?.maxAiGenerations !== undefined && plan.maxAiGenerations !== null) {
        maxGenerations = plan.maxAiGenerations;
      }
    }

    // If unlimited (-1), allow generation
    if (maxGenerations === -1) {
      return {
        allowed: true,
        remaining: -1,
        limit: -1,
        used: 0,
        resetsAt: null,
        reason: "unlimited" as const,
      };
    }

    // Count this month's usage
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();

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
      resetsAt: endOfMonth,
      reason: remaining > 0 ? ("within_limit" as const) : ("limit_exceeded" as const),
    };
  },
});

/**
 * Record an AI generation usage event
 * Call this after successful AI generation
 */
/**
 * Record an AI generation usage event (one unit of monthly quota).
 *
 * SECURITY: requires the shared server token. Usage counters drive quota
 * enforcement, so the browser can never call this directly — only the
 * Next.js server (or other Convex functions presenting the token) may
 * record usage after a SUCCESSFUL generation.
 */
export const recordAIGeneration = mutation({
  args: { serverToken: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    const secret = process.env.FILO_SERVER_SECRET;
    if (!secret || args.serverToken !== secret) {
      throw new Error("Unauthorized: invalid server token");
    }
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();

    await ctx.db.insert("usageRecords", {
      userId: args.userId,
      type: "ai_generation",
      amount: 1,
      periodStart: startOfMonth,
      periodEnd: endOfMonth,
      createdAt: now.getTime(),
    });

    return { success: true, recordedAt: now.getTime() };
  },
});
