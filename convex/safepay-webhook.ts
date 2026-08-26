// =============================================================================
// SAFEPAY WEBHOOK PROCESSING — Convex Action
// =============================================================================
// Called by the Next.js webhook endpoint (/api/webhooks/safepay) via
// ConvexHttpClient to process payment events in the Convex backend.
//
// This is the SINGLE SOURCE OF TRUTH for all payment state changes.
// Webhooks from Safepay hit Next.js, which then calls this action.
//
// IMPORTANT: This is an `action` (not a `mutation`) because it must call the
// external SafePay API for verification. Per Convex rules, actions CANNOT
// use `ctx.db` directly — every database operation is dispatched via
// `ctx.runQuery(api.safepayInternal.*)` or `ctx.runMutation(api.safepayInternal.*)`.
// =============================================================================

import { action } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { api } from "./_generated/api";

// ==================== TYPES ====================

interface WebhookProcessResult {
  success: boolean;
  action: string;
  paymentUpdated: boolean;
  subscriptionActivated: boolean;
  subscriptionId?: Id<"subscriptions">;
  error?: string;
  [key: string]: unknown;
}

interface PaymentHandlerArgs {
  eventId: string;
  eventType: string;
  data: {
    id: string;
    status?: string;
    amount?: number;
    currency?: string;
    reason?: string;
    error_code?: string;
    error_message?: string;
    dispute_reason?: string;
    customer?: { id: string; email?: string; name?: string };
    metadata?: Record<string, unknown>;
    plan_id?: string;
    subscription_id?: string;
    billing_period?: { start: number; end: number };
  };
}

// ==================== MAIN WEBHOOK PROCESSOR ====================

/**
 * Process a Safepay webhook event — the main entry point from Next.js.
 * Handles: payment.succeeded, payment.failed, payment.refunded,
 *          subscription.canceled, subscription.ended, subscription.payment.succeeded
 */
export const processSafepayWebhook = action({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    data: v.object({
      id: v.string(),
      status: v.optional(v.string()),
      amount: v.optional(v.number()),
      currency: v.optional(v.string()),
      reason: v.optional(v.string()),
      error_code: v.optional(v.string()),
      error_message: v.optional(v.string()),
      dispute_reason: v.optional(v.string()),
      customer: v.optional(
        v.object({
          id: v.string(),
          email: v.optional(v.string()),
          name: v.optional(v.string()),
        })
      ),
      metadata: v.optional(v.record(v.string(), v.any())),
      plan_id: v.optional(v.string()),
      subscription_id: v.optional(v.string()),
      billing_period: v.optional(
        v.object({ start: v.number(), end: v.number() })
      ),
    }),
  },
  handler: async (ctx, args): Promise<WebhookProcessResult> => {
    console.log(
      `[SAFEPAY-WEBHOOK] Processing event: ${args.eventType} (id: ${args.eventId})`
    );

    // Step 1: Record webhook event for idempotency (atomic — checks + inserts in one mutation).
    const record = await ctx.runMutation(api.safepayInternal.recordWebhookEvent, {
      provider: "safepay",
      eventId: args.eventId,
      type: args.eventType,
      data: args.data as Record<string, unknown>,
    });

    if (record.exists) {
      console.log(
        `[SAFEPAY-WEBHOOK] Duplicate event ${args.eventId} — skipping`
      );
      return {
        success: true,
        action: "duplicate_ignored",
        paymentUpdated: false,
        subscriptionActivated: false,
      };
    }

    try {
      let result: WebhookProcessResult;
      switch (args.eventType) {
        case "payment.succeeded":
        case "payment.captured":
          result = await handlePaymentSucceeded(ctx, args as PaymentHandlerArgs);
          break;
        case "payment.failed":
          result = await handlePaymentFailed(ctx, args as PaymentHandlerArgs);
          break;
        case "payment.refunded":
          result = await handlePaymentRefunded(ctx, args as PaymentHandlerArgs);
          break;
        case "payment.cancelled":
        case "void.succeeded":
          result = await handlePaymentCancelled(ctx, args as PaymentHandlerArgs);
          break;
        case "subscription.canceled":
          result = await handleSubscriptionCanceled(ctx, args as PaymentHandlerArgs);
          break;
        case "subscription.ended":
          result = await handleSubscriptionEnded(ctx, args as PaymentHandlerArgs);
          break;
        case "subscription.unpaid":
          result = await handleSubscriptionUnpaid(ctx, args as PaymentHandlerArgs);
          break;
        case "subscription.payment.succeeded":
          result = await handleSubscriptionRenewalSucceeded(
            ctx,
            args as PaymentHandlerArgs
          );
          break;
        case "subscription.payment.failed":
          result = await handleSubscriptionRenewalFailed(
            ctx,
            args as PaymentHandlerArgs
          );
          break;
        default:
          console.log(
            `[SAFEPAY-WEBHOOK] Unhandled event type: ${args.eventType}`
          );
          result = {
            success: true,
            action: "event_acknowledged_no_action",
            paymentUpdated: false,
            subscriptionActivated: false,
          };
      }

      // Mark webhook as processed (no error)
      await ctx.runMutation(api.safepayInternal.markWebhookProcessed, {
        webhookEventId: record.id,
      });

      return result;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[SAFEPAY-WEBHOOK] Error processing ${args.eventType}:`,
        errorMsg
      );

      await ctx.runMutation(api.safepayInternal.markWebhookProcessed, {
        webhookEventId: record.id,
        processingError: errorMsg,
      });

      return {
        success: false,
        action: "processing_error",
        paymentUpdated: false,
        subscriptionActivated: false,
        error: errorMsg,
      };
    }
  },
});

// ==================== PAYMENT HANDLERS ====================

async function handlePaymentSucceeded(
  ctx: any,
  args: PaymentHandlerArgs
): Promise<WebhookProcessResult> {
  const { data, eventType } = args;
  const metadata = (data.metadata || {}) as Record<string, unknown>;
  const userIdRaw = metadata.userId;
  const planIdRaw = metadata.planId || data.plan_id;
  const isYearly =
    metadata.isYearly === true || metadata.isYearly === "true";
  const safepayPaymentId = data.id;

  console.log(
    `[SAFEPAY-WEBHOOK] Payment succeeded: ${safepayPaymentId}, userId: ${userIdRaw}, planId: ${planIdRaw}`
  );

  // Step 1: Find + update payment record
  let paymentUpdated = false;
  if (safepayPaymentId) {
    const payments = await ctx.runQuery(
      api.safepayInternal.getPaymentsByProviderId,
      { providerPaymentId: safepayPaymentId }
    );
    const pending = payments.find(
      (p: { status: string }) => p.status === "pending"
    );
    if (pending) {
      await ctx.runMutation(api.safepayInternal.updatePaymentStatus, {
        paymentId: pending._id,
        status: "completed",
        metadata: {
          ...(pending.metadata as Record<string, unknown>),
          verifiedAt: Date.now(),
          verifiedVia: "webhook",
          webhookEvent: eventType,
          safepayStatus: data.status,
        },
      });
      paymentUpdated = true;
      console.log(
        `[SAFEPAY-WEBHOOK] Payment ${pending._id} updated to completed`
      );
    }
  }

  // Step 2: Activate / extend subscription
  let subscriptionActivated = false;
  let subscriptionId: Id<"subscriptions"> | undefined;

  if (userIdRaw && planIdRaw) {
    const userId = userIdRaw as Id<"users">;
    const planId = planIdRaw as Id<"plans">;
    const now = Date.now();
    const periodEnd = isYearly
      ? now + 365 * 24 * 60 * 60 * 1000
      : now + 30 * 24 * 60 * 60 * 1000;

    const activeSub = await ctx.runQuery(
      api.safepayInternal.getActiveSubscriptionByUser,
      { userId }
    );

    if (activeSub) {
      const newPeriodEnd =
        Math.max(activeSub.currentPeriodEnd, now) +
        (isYearly ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000);
      await ctx.runMutation(api.safepayInternal.updateSubscription, {
        subscriptionId: activeSub._id,
        patch: {
          status: "active",
          currentPeriodEnd: newPeriodEnd,
          cancelAtPeriodEnd: false,
        },
      });
      subscriptionId = activeSub._id;
      subscriptionActivated = true;
      console.log(
        `[SAFEPAY-WEBHOOK] Extended subscription ${activeSub._id} until ${new Date(
          newPeriodEnd
        ).toISOString()}`
      );
    } else {
      subscriptionId = await ctx.runMutation(
        api.safepayInternal.createSubscription,
        {
          userId,
          planId,
          provider: "safepay",
          providerSubscriptionId: data.subscription_id || safepayPaymentId,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
        }
      );
      subscriptionActivated = true;
      console.log(
        `[SAFEPAY-WEBHOOK] Created new subscription ${subscriptionId}`
      );
    }

    // Step 3: Update user's plan reference
    try {
      await ctx.runMutation(api.safepayInternal.updateUserPlan, {
        userId,
        planId,
      });
      console.log(
        `[SAFEPAY-WEBHOOK] Updated user ${userId} plan to ${planId}`
      );
    } catch (userErr) {
      console.error(
        `[SAFEPAY-WEBHOOK] Failed to update user plan:`,
        userErr
      );
      // Non-critical — subscription is still active
    }
  } else {
    console.warn(
      `[SAFEPAY-WEBHOOK] No userId or planId in metadata — cannot activate subscription`
    );
    console.warn(
      `[SAFEPAY-WEBHOOK] Metadata:`,
      JSON.stringify(metadata)
    );
  }

  return {
    success: true,
    action: "payment_completed_subscription_activated",
    paymentUpdated,
    subscriptionActivated,
    subscriptionId,
    safepayPaymentId,
    userId: userIdRaw,
    planId: planIdRaw,
  };
}

async function handlePaymentFailed(
  ctx: any,
  args: PaymentHandlerArgs
): Promise<WebhookProcessResult> {
  const { data } = args;
  const safepayPaymentId = data.id;
  let paymentUpdated = false;

  if (safepayPaymentId) {
    const payments = await ctx.runQuery(
      api.safepayInternal.getPaymentsByProviderId,
      { providerPaymentId: safepayPaymentId }
    );
    const pending = payments.find(
      (p: { status: string }) => p.status === "pending"
    );
    if (pending) {
      await ctx.runMutation(api.safepayInternal.updatePaymentStatus, {
        paymentId: pending._id,
        status: "failed",
        metadata: {
          ...(pending.metadata as Record<string, unknown>),
          failureReason: data.reason || data.error_message || "Payment failed",
          failureCode: data.error_code,
          failedAt: Date.now(),
          failedVia: "webhook",
        },
      });
      paymentUpdated = true;
    }
  }

  return {
    success: true,
    action: "payment_failed_recorded",
    paymentUpdated,
    subscriptionActivated: false,
    safepayPaymentId,
    reason: data.reason,
  };
}

async function handlePaymentRefunded(
  ctx: any,
  args: PaymentHandlerArgs
): Promise<WebhookProcessResult> {
  const { data } = args;
  const safepayPaymentId = data.id;
  let paymentUpdated = false;

  if (safepayPaymentId) {
    const payments = await ctx.runQuery(
      api.safepayInternal.getPaymentsByProviderId,
      { providerPaymentId: safepayPaymentId }
    );
    const completed = payments.find(
      (p: { status: string }) => p.status === "completed"
    );
    if (completed) {
      await ctx.runMutation(api.safepayInternal.patchPayment, {
        paymentId: completed._id,
        status: "refunded",
        metadata: {
          ...(completed.metadata as Record<string, unknown>),
          refundReason: data.reason || "Refund processed",
          refundedAt: Date.now(),
          refundedVia: "webhook",
        },
      });
      paymentUpdated = true;

      // Cancel associated subscription on full refund
      if (completed.subscriptionId) {
        try {
          await ctx.runMutation(api.safepayInternal.updateSubscription, {
            subscriptionId: completed.subscriptionId,
            patch: { status: "canceled" },
          });
          console.log(
            `[SAFEPAY-WEBHOOK] Cancelled subscription ${completed.subscriptionId} due to refund`
          );
        } catch (subErr) {
          console.error(
            `[SAFEPAY-WEBHOOK] Failed to cancel subscription on refund:`,
            subErr
          );
        }
      }
    }
  }

  return {
    success: true,
    action: "payment_refunded_processed",
    paymentUpdated,
    subscriptionActivated: false,
    safepayPaymentId,
    reason: data.reason,
  };
}

async function handlePaymentCancelled(
  ctx: any,
  args: PaymentHandlerArgs
): Promise<WebhookProcessResult> {
  const { data } = args;
  const safepayPaymentId = data.id;
  let paymentUpdated = false;

  if (safepayPaymentId) {
    const payments = await ctx.runQuery(
      api.safepayInternal.getPaymentsByProviderId,
      { providerPaymentId: safepayPaymentId }
    );
    const pending = payments.find(
      (p: { status: string }) => p.status === "pending"
    );
    if (pending) {
      await ctx.runMutation(api.safepayInternal.patchPayment, {
        paymentId: pending._id,
        status: "cancelled",
      });
      paymentUpdated = true;
    }
  }

  return {
    success: true,
    action: "payment_cancelled_recorded",
    paymentUpdated,
    subscriptionActivated: false,
    safepayPaymentId,
  };
}

// ==================== SUBSCRIPTION HANDLERS ====================

async function handleSubscriptionCanceled(
  ctx: any,
  args: PaymentHandlerArgs
): Promise<WebhookProcessResult> {
  const { data } = args;
  const providerSubId = data.id || data.subscription_id;
  if (!providerSubId) {
    return {
      success: true,
      action: "no_subscription_id",
      paymentUpdated: false,
      subscriptionActivated: false,
    };
  }

  const subscription = await ctx.runQuery(
    api.safepayInternal.getSubscriptionByProviderId,
    { providerSubscriptionId: providerSubId }
  );
  if (!subscription) {
    console.warn(
      `[SAFEPAY-WEBHOOK] Subscription not found for provider ID: ${providerSubId}`
    );
    return {
      success: true,
      action: "subscription_not_found",
      paymentUpdated: false,
      subscriptionActivated: false,
    };
  }

  // Mark as cancel-at-period-end (access continues until currentPeriodEnd)
  await ctx.runMutation(api.safepayInternal.updateSubscription, {
    subscriptionId: subscription._id,
    patch: { cancelAtPeriodEnd: true },
  });

  return {
    success: true,
    action: "subscription_cancelled_access_until_period_end",
    paymentUpdated: false,
    subscriptionActivated: false,
    subscriptionId: subscription._id,
    accessUntil: subscription.currentPeriodEnd,
  };
}

async function handleSubscriptionEnded(
  ctx: any,
  args: PaymentHandlerArgs
): Promise<WebhookProcessResult> {
  const { data } = args;
  const providerSubId = data.id || data.subscription_id;
  if (!providerSubId) {
    return {
      success: true,
      action: "no_subscription_id",
      paymentUpdated: false,
      subscriptionActivated: false,
    };
  }

  const subscription = await ctx.runQuery(
    api.safepayInternal.getSubscriptionByProviderId,
    { providerSubscriptionId: providerSubId }
  );
  if (!subscription) {
    return {
      success: true,
      action: "subscription_not_found",
      paymentUpdated: false,
      subscriptionActivated: false,
    };
  }

  // Fully expire the subscription and revoke access
  await ctx.runMutation(api.safepayInternal.updateSubscription, {
    subscriptionId: subscription._id,
    patch: { status: "expired" },
  });

  return {
    success: true,
    action: "subscription_ended_access_revoked",
    paymentUpdated: false,
    subscriptionActivated: false,
    subscriptionId: subscription._id,
    accessRevoked: true,
  };
}

async function handleSubscriptionUnpaid(
  ctx: any,
  args: PaymentHandlerArgs
): Promise<WebhookProcessResult> {
  const { data } = args;
  const providerSubId = data.id || data.subscription_id;
  if (!providerSubId) {
    return {
      success: true,
      action: "no_subscription_id",
      paymentUpdated: false,
      subscriptionActivated: false,
    };
  }

  const subscription = await ctx.runQuery(
    api.safepayInternal.getSubscriptionByProviderId,
    { providerSubscriptionId: providerSubId }
  );
  if (!subscription) {
    return {
      success: true,
      action: "subscription_not_found",
      paymentUpdated: false,
      subscriptionActivated: false,
    };
  }

  await ctx.runMutation(api.safepayInternal.updateSubscription, {
    subscriptionId: subscription._id,
    patch: { status: "past_due" },
  });

  return {
    success: true,
    action: "subscription_marked_past_due",
    paymentUpdated: false,
    subscriptionActivated: false,
    subscriptionId: subscription._id,
    gracePeriodDays: 14,
  };
}

async function handleSubscriptionRenewalSucceeded(
  ctx: any,
  args: PaymentHandlerArgs
): Promise<WebhookProcessResult> {
  const { data } = args;
  const providerSubId = data.subscription_id;
  const metadata = (data.metadata || {}) as Record<string, unknown>;
  const isYearly =
    metadata.isYearly === true || metadata.isYearly === "true";

  if (!providerSubId) {
    return {
      success: true,
      action: "no_subscription_id",
      paymentUpdated: false,
      subscriptionActivated: false,
    };
  }

  const subscription = await ctx.runQuery(
    api.safepayInternal.getSubscriptionByProviderId,
    { providerSubscriptionId: providerSubId }
  );
  if (!subscription) {
    return {
      success: true,
      action: "subscription_not_found",
      paymentUpdated: false,
      subscriptionActivated: false,
    };
  }

  const now = Date.now();
  const extensionMs = isYearly
    ? 365 * 24 * 60 * 60 * 1000
    : 30 * 24 * 60 * 60 * 1000;
  const newPeriodEnd =
    Math.max(subscription.currentPeriodEnd, now) + extensionMs;

  await ctx.runMutation(api.safepayInternal.updateSubscription, {
    subscriptionId: subscription._id,
    patch: {
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: newPeriodEnd,
      cancelAtPeriodEnd: false,
    },
  });

  try {
    await ctx.runMutation(api.safepayInternal.insertRenewalPayment, {
      userId: subscription.userId,
      subscriptionId: subscription._id,
      amount: data.amount || 0,
      currency: data.currency || "PKR",
      status: "completed",
      providerPaymentId: data.id,
      description: `Filo subscription renewal - ${new Date(now).toLocaleDateString(
        "en-PK"
      )}`,
      metadata: {
        type: "renewal",
        isYearly,
        renewedAt: now,
        renewedVia: "webhook",
      },
    });
  } catch (payErr) {
    console.error(
      `[SAFEPAY-WEBHOOK] Failed to record renewal payment:`,
      payErr
    );
  }

  return {
    success: true,
    action: "subscription_renewed_extended",
    paymentUpdated: true,
    subscriptionActivated: true,
    subscriptionId: subscription._id,
    newPeriodEnd,
    amount: data.amount,
  };
}

async function handleSubscriptionRenewalFailed(
  ctx: any,
  args: PaymentHandlerArgs
): Promise<WebhookProcessResult> {
  const { data } = args;
  const providerSubId = data.subscription_id;
  if (!providerSubId) {
    return {
      success: true,
      action: "no_subscription_id",
      paymentUpdated: false,
      subscriptionActivated: false,
    };
  }

  const subscription = await ctx.runQuery(
    api.safepayInternal.getSubscriptionByProviderId,
    { providerSubscriptionId: providerSubId }
  );
  if (!subscription) {
    return {
      success: true,
      action: "subscription_not_found",
      paymentUpdated: false,
      subscriptionActivated: false,
    };
  }

  try {
    await ctx.runMutation(api.safepayInternal.insertRenewalPayment, {
      userId: subscription.userId,
      subscriptionId: subscription._id,
      amount: data.amount || 0,
      currency: data.currency || "PKR",
      status: "failed",
      providerPaymentId: data.id,
      description: `Filo subscription renewal FAILED - ${new Date().toLocaleDateString(
        "en-PK"
      )}`,
      metadata: {
        type: "renewal_failed",
        failureReason: data.reason || data.error_message,
        failureCode: data.error_code,
        failedAt: Date.now(),
      },
    });
  } catch (payErr) {
    console.error(
      `[SAFEPAY-WEBHOOK] Failed to record failed renewal:`,
      payErr
    );
  }

  // Mark subscription as past_due (grace period before full cancel)
  await ctx.runMutation(api.safepayInternal.updateSubscription, {
    subscriptionId: subscription._id,
    patch: { status: "past_due" },
  });

  return {
    success: true,
    action: "renewal_failed_subscription_past_due",
    paymentUpdated: true,
    subscriptionActivated: false,
    subscriptionId: subscription._id,
    reason: data.reason,
    gracePeriodActive: true,
  };
}
