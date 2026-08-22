import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Create payment record (Safepay)
export const createPayment = mutation({
  args: {
    userId: v.id("users"),
    subscriptionId: v.optional(v.id("subscriptions")),
    amount: v.number(),
    currency: v.string(), // PKR
    description: v.string(),
    providerPaymentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const paymentId = await ctx.db.insert("payments", {
      userId: args.userId,
      subscriptionId: args.subscriptionId,
      amount: args.amount,
      currency: args.currency,
      status: "pending",
      provider: "safepay",
      providerPaymentId: args.providerPaymentId,
      description: args.description,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return await ctx.db.get(paymentId);
  },
});

// Update payment status (called by Safepay webhook)
export const updatePaymentStatus = mutation({
  args: {
    paymentId: v.id("payments"),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("refunded"),
      v.literal("cancelled")
    ),
    providerPaymentId: v.optional(v.string()),
    metadata: v.optional(v.object({})),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.providerPaymentId) updates.providerPaymentId = args.providerPaymentId;
    if (args.metadata) updates.metadata = args.metadata;

    await ctx.db.patch(args.paymentId, updates);

    // If payment completed, activate subscription
    if (args.status === "completed") {
      const payment = await ctx.db.get(args.paymentId);
      if (payment?.subscriptionId) {
        await ctx.db.patch(payment.subscriptionId, {
          status: "active",
          currentPeriodStart: Date.now(),
          currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days from now
        });
      }
    }

    return await ctx.db.get(args.paymentId);
  },
});

// Get user's payment history
export const getUserPayments = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payments")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
  },
});

// Record Safepay webhook event (for idempotency)
export const recordWebhookEvent = mutation({
  args: {
    provider: v.union(v.literal("safepay"), v.literal("custom")),
    eventId: v.string(),
    type: v.string(),
    data: v.object({}),
  },
  handler: async (ctx, args) => {
    // Check for duplicate (idempotency - critical for payment security)
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_eventId", (q) =>
        q.eq("provider", args.provider).eq("eventId", args.eventId)
      )
      .first();

    if (existing) {
      return { exists: true, eventId: existing._id };
    }

    const eventId = await ctx.db.insert("webhookEvents", {
      ...args,
      processed: false,
      receivedAt: Date.now(),
    });

    return { exists: false, eventId };
  },
});

// Mark webhook as processed
export const markWebhookProcessed = mutation({
  args: { webhookEventId: v.id("webhookEvents"), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.webhookEventId, {
      processed: true,
      processedAt: Date.now(),
      processingError: args.error,
    });
  },
});
