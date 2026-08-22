import { mutation } from "./_generated/server";
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
  },
  handler: async (ctx, args) => {
    const { planId, ...updates } = args;
    
    await ctx.db.patch(planId, {
      ...updates,
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
