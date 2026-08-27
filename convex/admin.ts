import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Create plan (admin only)
export const createPlan = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    priceMonthly: v.number(), // PKR
    priceYearly: v.number(),  // PKR
    currency: v.string(),     // "PKR"
    features: v.array(v.string()),
    limitations: v.array(v.string()),
    popular: v.boolean(),
    active: v.boolean(),
    maxAiGenerations: v.number(),
    maxStorageMb: v.number(),
    maxTeamMembers: v.optional(v.number()),
    icon: v.string(),
    order: v.number(),
    contactSales: v.optional(v.boolean()),
    tier: v.optional(v.string()),
    aiChatEnabled: v.optional(v.boolean()),
    safepayPlanIdMonthly: v.optional(v.string()),
    safepayPlanIdYearly: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const planId = await ctx.db.insert("plans", {
      ...args,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return planId;
  },
});

// Update plan (admin only)
export const updatePlan = mutation({
  args: {
    planId: v.id("plans"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    priceMonthly: v.optional(v.number()),
    priceYearly: v.optional(v.number()),
    currency: v.optional(v.string()),
    features: v.optional(v.array(v.string())),
    limitations: v.optional(v.array(v.string())),
    popular: v.optional(v.boolean()),
    active: v.optional(v.boolean()),
    maxAiGenerations: v.optional(v.number()),
    maxStorageMb: v.optional(v.number()),
    maxTeamMembers: v.optional(v.number()),
    icon: v.optional(v.string()),
    order: v.optional(v.number()),
    contactSales: v.optional(v.boolean()),
    tier: v.optional(v.string()),
    aiChatEnabled: v.optional(v.boolean()),
    safepayPlanIdMonthly: v.optional(v.string()),
    safepayPlanIdYearly: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { planId, ...updates } = args;
    // Strip undefined optional values so patch() doesn't write them.
    const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
    await ctx.db.patch(planId, {
      ...clean,
      updatedAt: Date.now(),
    });

    return await ctx.db.get(planId);
  },
});

// Delete plan (admin only)
export const deletePlan = mutation({
  args: { planId: v.id("plans") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.planId);
    return { success: true };
  },
});

// =============================================================================
// SERVER-SIDE VERIFIED ADMIN ANALYTICS HELPERS
// =============================================================================
// Called only from the Next.js admin API layer (requireAdminAccess → live DB
// admin check) with a second in-Convex admin verification below.
// =============================================================================

function assertServerAndAdmin(token: unknown, adminUserId: unknown) {
  const secret = process.env.FILO_SERVER_SECRET;
  if (!secret || typeof token !== "string" || token !== secret) {
    throw new Error("Unauthorized: invalid server token");
  }
  return adminUserId;
}

export const adminStorageTotal = query({
  args: { serverToken: v.string(), adminUserId: v.id("users") },
  handler: async (ctx, args) => {
    assertServerAndAdmin(args.serverToken, args.adminUserId);
    const admin = await ctx.db.get(args.adminUserId);
    if (!admin || admin.isAdmin !== true) throw new Error("Forbidden: admin required");
    const files = await ctx.db.query("files").collect();
    return files.reduce((sum, f) => sum + (f.size || 0), 0);
  },
});

export const adminLargestFiles = query({
  args: {
    serverToken: v.string(),
    adminUserId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServerAndAdmin(args.serverToken, args.adminUserId);
    const admin = await ctx.db.get(args.adminUserId);
    if (!admin || admin.isAdmin !== true) throw new Error("Forbidden: admin required");
    const files = await ctx.db.query("files").collect();
    const sorted = files.sort((a, b) => b.size - a.size).slice(0, args.limit ?? 10);
    return await Promise.all(
      sorted.map(async (f) => {
        const owner = await ctx.db.get(f.userId);
        return {
          fileId: f._id,
          name: f.originalName,
          size: f.size,
          mimeType: f.mimeType,
          createdAt: f.createdAt,
          ownerEmail: owner?.email ?? "unknown",
        };
      })
    );
  },
});

export const adminUsersWithStats = query({
  args: {
    serverToken: v.string(),
    adminUserId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServerAndAdmin(args.serverToken, args.adminUserId);
    const admin = await ctx.db.get(args.adminUserId);
    if (!admin || admin.isAdmin !== true) throw new Error("Forbidden: admin required");

    const users = await ctx.db.query("users").withIndex("by_createdAt").order("desc").take(args.limit ?? 500);
    const plans = await ctx.db.query("plans").collect();
    const planMap = new Map(plans.map((p) => [p._id, p]));
    const subs = await ctx.db.query("subscriptions").collect();
    const latestSubByUser = new Map<string, any>();
    for (const s of subs) {
      const prev = latestSubByUser.get(String(s.userId));
      if (!prev || s.createdAt > prev.createdAt) latestSubByUser.set(String(s.userId), s);
    }
    const files = await ctx.db.query("files").collect();
    const storageByUser = new Map<string, number>();
    for (const f of files) {
      storageByUser.set(String(f.userId), (storageByUser.get(String(f.userId)) ?? 0) + (f.size || 0));
    }
    const artifacts = await ctx.db.query("artifacts").collect();
    const artifactCountByUser = new Map<string, number>();
    for (const a of artifacts) {
      artifactCountByUser.set(String(a.userId), (artifactCountByUser.get(String(a.userId)) ?? 0) + 1);
    }

    return users.map((u) => {
      const sub = latestSubByUser.get(String(u._id));
      const plan = u.planId ? planMap.get(u.planId) : undefined;
      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        status: u.status,
        isAdmin: u.isAdmin === true,
        createdAt: u.createdAt,
        planName: plan?.name ?? (u.planId ? "Unknown" : "Free"),
        planTier: plan?.tier ?? "free",
        subscriptionStatus: sub?.status ?? null,
        subscriptionId: sub?._id ?? null,
        storageBytes: storageByUser.get(String(u._id)) ?? 0,
        artifactCount: artifactCountByUser.get(String(u._id)) ?? 0,
      };
    });
  },
});
