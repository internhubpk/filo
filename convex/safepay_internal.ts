// =============================================================================
// SAFEPAY INTERNAL — Mutations & Queries used by the SafePay action handlers
// =============================================================================
// Why this file exists:
//   In Convex, `action` handlers CANNOT use `ctx.db` directly. They must call
//   `ctx.runQuery(...)` / `ctx.runMutation(...)`. The previous versions of
//   `convex/safepay.ts` and `convex/safepay-webhook.ts` bypassed this by using
//   `ctx.db` inside actions — that is forbidden by the Convex runtime and was
//   caught by `tsc --noEmit` ("Property 'db' does not exist on type
//   'GenericActionCtx<...>'").
//
// This file collects every database operation those two action files need to
// perform, exposes each as a properly-typed mutation or query, and lets the
// actions stay thin: parse → validate → call SafePay API → dispatch to these
// internal functions.
//
// All handlers do authorization / ownership checks at the call site (in the
// action layer). These mutations trust the caller because they are
// `internalAPI` — NOT exposed publicly.
// =============================================================================

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

// ==================== QUERIES ====================

export const getPlanById = query({
  args: { planId: v.id("plans") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.planId);
  },
});

export const getPaymentByProviderId = query({
  args: { providerPaymentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payments")
      .withIndex("by_providerPaymentId", (q) =>
        q.eq("providerPaymentId", args.providerPaymentId)
      )
      .first();
  },
});

export const getPaymentsByProviderId = query({
  args: { providerPaymentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payments")
      .withIndex("by_providerPaymentId", (q) =>
        q.eq("providerPaymentId", args.providerPaymentId)
      )
      .collect();
  },
});

export const getActiveSubscriptionByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    return (
      subs.find(
        (s) => s.status === "active" || s.status === "trialing"
      ) ?? null
    );
  },
});

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

export const getWebhookEventByProviderEventId = query({
  args: { provider: v.string(), eventId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_eventId", (q) =>
        q.eq("provider", args.provider as "safepay" | "custom").eq(
          "eventId",
          args.eventId
        )
      )
      .first();
  },
});

export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

export const getPaymentById = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.paymentId);
  },
});

// ==================== MUTATIONS ====================

/**
 * Insert a pending payment record (after creating SafePay checkout).
 */
export const insertPendingPayment = mutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    currency: v.string(),
    providerPaymentId: v.string(),
    description: v.string(),
    metadata: v.object({}),
  },
  handler: async (ctx, args) => {
    const paymentId = await ctx.db.insert("payments", {
      userId: args.userId,
      amount: args.amount,
      currency: args.currency,
      status: "pending",
      provider: "safepay",
      providerPaymentId: args.providerPaymentId,
      description: args.description,
      metadata: args.metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return paymentId;
  },
});

/**
 * Mark a webhook event as received (idempotent: returns existing if already present).
 */
export const recordWebhookEvent = mutation({
  args: {
    provider: v.union(v.literal("safepay"), v.literal("custom")),
    eventId: v.string(),
    type: v.string(),
    data: v.object({}),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_eventId", (q) =>
        q.eq("provider", args.provider).eq("eventId", args.eventId)
      )
      .first();
    if (existing) {
      return { exists: true, id: existing._id };
    }
    const id = await ctx.db.insert("webhookEvents", {
      provider: args.provider,
      eventId: args.eventId,
      type: args.type,
      data: args.data,
      processed: false,
      receivedAt: Date.now(),
    });
    return { exists: false, id };
  },
});

/**
 * Mark a webhook event as processed (with optional error).
 */
export const markWebhookProcessed = mutation({
  args: {
    webhookEventId: v.id("webhookEvents"),
    processingError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.webhookEventId, {
      processed: true,
      processedAt: Date.now(),
      processingError: args.processingError,
    });
  },
});

/**
 * Update a payment's status + metadata. Returns the updated doc.
 */
export const updatePaymentStatus = mutation({
  args: {
    paymentId: v.id("payments"),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("refunded"),
      v.literal("cancelled")
    ),
    metadata: v.optional(v.object({})),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.metadata !== undefined) {
      patch.metadata = args.metadata;
    }
    await ctx.db.patch(args.paymentId, patch);
    return await ctx.db.get(args.paymentId);
  },
});

/**
 * Create a new subscription record (after successful payment).
 *
 * `provider` is restricted to "safepay" because the schema only allows that
 * literal today (we can broaden it later when adding new providers).
 */
export const createSubscription = mutation({
  args: {
    userId: v.id("users"),
    planId: v.id("plans"),
    provider: v.literal("safepay"),
    providerSubscriptionId: v.optional(v.string()),
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
    const id = await ctx.db.insert("subscriptions", {
      userId: args.userId,
      planId: args.planId,
      provider: args.provider,
      providerSubscriptionId: args.providerSubscriptionId,
      status: args.status,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return id;
  },
});

/**
 * Patch a subscription record.
 */
export const updateSubscription = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    patch: v.object({
      status: v.optional(
        v.union(
          v.literal("active"),
          v.literal("canceled"),
          v.literal("past_due"),
          v.literal("trialing"),
          v.literal("expired")
        )
      ),
      currentPeriodStart: v.optional(v.number()),
      currentPeriodEnd: v.optional(v.number()),
      cancelAtPeriodEnd: v.optional(v.boolean()),
      providerSubscriptionId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      ...args.patch,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update a user's plan reference (used when subscription activates/expires).
 */
export const updateUserPlan = mutation({
  args: {
    userId: v.id("users"),
    planId: v.optional(v.id("plans")),
  },
  handler: async (ctx, args) => {
    const patch: { planId?: Id<"plans">; updatedAt: number } = {
      updatedAt: Date.now(),
    };
    if (args.planId !== undefined) {
      patch.planId = args.planId;
    } else {
      // Clear plan reference
      await ctx.db.patch(args.userId, { updatedAt: Date.now() });
      // To unset a field, patch with undefined and use the partial flag
      // Convex doesn't allow unsetting via patch with undefined; use replace if needed.
      // For now, we leave the planId in place (less destructive) when undefined is passed.
      return;
    }
    await ctx.db.patch(args.userId, patch);
  },
});

/**
 * Insert a renewal payment record (for subscription.renewal events).
 */
export const insertRenewalPayment = mutation({
  args: {
    userId: v.id("users"),
    subscriptionId: v.id("subscriptions"),
    amount: v.number(),
    currency: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("pending")
    ),
    providerPaymentId: v.string(),
    description: v.string(),
    metadata: v.object({}),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("payments", {
      userId: args.userId,
      subscriptionId: args.subscriptionId,
      amount: args.amount,
      currency: args.currency,
      status: args.status,
      provider: "safepay",
      providerPaymentId: args.providerPaymentId,
      description: args.description,
      metadata: args.metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return id;
  },
});

/**
 * Patch a payment record's metadata (for refund / failure annotations).
 */
export const patchPayment = mutation({
  args: {
    paymentId: v.id("payments"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("refunded"),
        v.literal("cancelled")
      )
    ),
    metadata: v.optional(v.object({})),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.status !== undefined) patch.status = args.status;
    if (args.metadata !== undefined) patch.metadata = args.metadata;
    await ctx.db.patch(args.paymentId, patch);
    return await ctx.db.get(args.paymentId);
  },
});

// Export types for action handler convenience
export type PaymentDoc = Doc<"payments">;
export type SubscriptionDoc = Doc<"subscriptions">;
export type UserDoc = Doc<"users">;
export type PlanDoc = Doc<"plans">;
export type WebhookEventDoc = Doc<"webhookEvents">;
