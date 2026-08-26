import { action } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { api } from "./_generated/api";

// Types for Safepay API
interface SafepayCheckoutRequest {
  amount: number;
  currency: string; // PKR
  metadata: {
    userId: string;
    planId: string;
    email: string;
    reference: string;
  };
}

interface SafepayCheckoutResponse {
  success: boolean;
  data?: {
    token: string;
    url: string;
    id: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

// ==================== SAFEPAY ACTIONS ====================

/**
 * Create a Safepay checkout session for subscription payment.
 * This is an ACTION (not mutation) because it calls the external SafePay API.
 *
 * ARCHITECTURE:
 *   - Actions cannot use `ctx.db` directly — they call internal mutations and
 *     queries via `ctx.runQuery` / `ctx.runMutation`. All DB operations are
 *     dispatched to `convex/safepay_internal.ts`.
 *   - SafePay secret key is read from process.env inside the action (never
 *     shipped to the client).
 */
export const createSafepayCheckout = action({
  args: {
    userId: v.id("users"),
    planId: v.id("plans"),
    userEmail: v.string(),
    isYearly: v.boolean(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.SAFEPAY_SECRET_KEY;
    const isSandbox =
      process.env.SAFEPAY_SANDBOX === "true" ||
      process.env.NODE_ENV !== "production";

    if (!apiKey) {
      throw new Error("SAFEPAY_SECRET_KEY not configured");
    }

    // Get plan details via internal query
    const plan = await ctx.runQuery(api.safepayInternal.getPlanById, {
      planId: args.planId,
    });
    if (!plan) {
      throw new Error("Plan not found");
    }

    const amount = args.isYearly ? plan.priceYearly : plan.priceMonthly;
    if (amount <= 0) {
      throw new Error("Free plans do not require payment");
    }

    // Generate unique reference
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    const reference = `FLO-${timestamp}-${random}`.toUpperCase();

    const baseUrl = isSandbox
      ? "https://sandbox.api.getsafepay.com"
      : "https://api.getsafepay.com";

    try {
      const response = await fetch(`${baseUrl}/v1/checkouts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          amount,
          currency: "PKR",
          reference,
          description: `Filo ${plan.name} - ${
            args.isYearly ? "Yearly" : "Monthly"
          }`,
          metadata: {
            userId: args.userId,
            planId: args.planId,
            email: args.userEmail,
            isYearly: args.isYearly,
            reference,
          },
          redirect_url: `${
            process.env.NEXT_PUBLIC_APP_URL || "https://filo-ai-ashen.vercel.app"
          }/billing?payment=success`,
          cancel_url: `${
            process.env.NEXT_PUBLIC_APP_URL || "https://filo-ai-ashen.vercel.app"
          }/billing?payment=cancelled`,
          webhooks: [
            {
              url: `${
                process.env.NEXT_PUBLIC_APP_URL ||
                "https://filo-ai-ashen.vercel.app"
              }/api/webhooks/safepay`,
              events: ["payment.captured", "payment.failed", "payment.cancelled"],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("[SAFEPAY] Checkout creation failed:", errorData);
        return {
          success: false,
          error: {
            code: "SAFEPAY_API_ERROR",
            message:
              (errorData && errorData.message) ||
              "Failed to create checkout session",
            details: errorData,
          },
          reference,
        };
      }

      const data: SafepayCheckoutResponse = await response.json();
      if (!data.success || !data.data) {
        return {
          success: false,
          error: {
            code: "SAFEPAY_CHECKOUT_FAILED",
            message: data.error?.message || "Safepay returned unsuccessful response",
            details: data.error,
          },
          reference,
        };
      }

      // Persist pending payment via internal mutation
      await ctx.runMutation(api.safepayInternal.insertPendingPayment, {
        userId: args.userId,
        amount,
        currency: "PKR",
        providerPaymentId: data.data.id,
        description: `Filo ${plan.name} - ${
          args.isYearly ? "Yearly" : "Monthly"
        } (${reference})`,
        metadata: {
          reference,
          planId: args.planId,
          isYearly: args.isYearly,
          checkoutToken: data.data.token,
        },
      });

      return {
        success: true,
        data: {
          checkoutUrl: data.data.url,
          checkoutToken: data.data.token,
          paymentId: data.data.id,
          reference,
          amount,
          currency: "PKR",
          planName: plan.name,
          isYearly: args.isYearly,
        },
      };
    } catch (error) {
      console.error("[SAFEPAY] Network error:", error);
      return {
        success: false,
        error: {
          code: "NETWORK_ERROR",
          message:
            error instanceof Error ? error.message : "Failed to connect to Safepay",
        },
        reference,
      };
    }
  },
});

/**
 * Verify a Safepay payment after redirect (called when user returns from checkout).
 * Action because it calls the SafePay REST API.
 */
export const verifySafepayPayment = action({
  args: {
    paymentId: v.string(),
    reference: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.SAFEPAY_SECRET_KEY;
    const isSandbox =
      process.env.SAFEPAY_SANDBOX === "true" ||
      process.env.NODE_ENV !== "production";

    if (!apiKey) {
      throw new Error("SAFEPAY_SECRET_KEY not configured");
    }

    const baseUrl = isSandbox
      ? "https://sandbox.api.getsafepay.com"
      : "https://api.getsafepay.com";

    try {
      const response = await fetch(`${baseUrl}/v1/payments/${args.paymentId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        throw new Error(`Safepay API error: ${response.status}`);
      }

      const paymentData: { status?: string } = await response.json();

      // Find our payment record via internal query
      const payment = await ctx.runQuery(
        api.safepayInternal.getPaymentByProviderId,
        { providerPaymentId: args.paymentId }
      );

      if (!payment) {
        return {
          verified: false,
          error: {
            code: "PAYMENT_NOT_FOUND",
            message: "Payment record not found in our system",
          },
        };
      }

      // Map SafePay status → our status
      let newStatus: "completed" | "failed" | "cancelled" | "refunded" =
        payment.status as "completed" | "failed" | "cancelled" | "refunded";

      const safepayStatus = paymentData.status?.toLowerCase();
      if (safepayStatus === "captured") {
        newStatus = "completed";

        // Activate / extend subscription if we have plan + billing info in metadata
        const meta = (payment.metadata || {}) as Record<string, unknown>;
        const planIdRaw = meta.planId;
        const isYearly = meta.isYearly === true || meta.isYearly === "true";
        if (planIdRaw) {
          const planId = planIdRaw as Id<"plans">;
          const now = Date.now();
          const periodEnd = isYearly
            ? now + 365 * 24 * 60 * 60 * 1000
            : now + 30 * 24 * 60 * 60 * 1000;

          const existingSub = await ctx.runQuery(
            api.safepayInternal.getActiveSubscriptionByUser,
            { userId: payment.userId }
          );

          if (existingSub) {
            await ctx.runMutation(api.safepayInternal.updateSubscription, {
              subscriptionId: existingSub._id,
              patch: {
                currentPeriodEnd: periodEnd,
                status: "active",
              },
            });
          } else {
            await ctx.runMutation(api.safepayInternal.createSubscription, {
              userId: payment.userId,
              planId,
              provider: "safepay",
              providerSubscriptionId: args.paymentId,
              status: "active",
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              cancelAtPeriodEnd: false,
            });
          }

          await ctx.runMutation(api.safepayInternal.updateUserPlan, {
            userId: payment.userId,
            planId,
          });
        }
      } else if (safepayStatus === "failed") {
        newStatus = "failed";
      } else if (safepayStatus === "cancelled") {
        newStatus = "cancelled";
      }

      // Persist updated status
      if (newStatus !== payment.status) {
        await ctx.runMutation(api.safepayInternal.patchPayment, {
          paymentId: payment._id,
          status: newStatus,
        });
      }

      return {
        verified: true,
        paymentStatus: newStatus,
        safepayStatus: paymentData.status,
        paymentId: payment._id,
        subscriptionActivated: newStatus === "completed",
      };
    } catch (error) {
      console.error("[SAFEPAY] Verification error:", error);
      return {
        verified: false,
        error: {
          code: "VERIFICATION_ERROR",
          message:
            error instanceof Error ? error.message : "Failed to verify payment",
        },
      };
    }
  },
});

/**
 * Process refund through Safepay (admin only).
 */
export const processRefund = action({
  args: {
    paymentId: v.id("payments"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.SAFEPAY_SECRET_KEY;
    const isSandbox =
      process.env.SAFEPAY_SANDBOX === "true" ||
      process.env.NODE_ENV !== "production";

    if (!apiKey) {
      throw new Error("SAFEPAY_SECRET_KEY not configured");
    }

    const payment = await ctx.runQuery(api.safepayInternal.getPaymentById, {
      paymentId: args.paymentId,
    });
    if (!payment) {
      throw new Error("Payment not found");
    }
    if (payment.status !== "completed") {
      throw new Error("Only completed payments can be refunded");
    }
    if (!payment.providerPaymentId) {
      throw new Error("No provider payment ID found");
    }

    const baseUrl = isSandbox
      ? "https://sandbox.api.getsafepay.com"
      : "https://api.getsafepay.com";

    try {
      const response = await fetch(
        `${baseUrl}/v1/payments/${payment.providerPaymentId}/refund`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ reason: args.reason || "Customer request" }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: {
            code: "REFUND_FAILED",
            message: errorData.message || "Refund processing failed",
          },
        };
      }

      const refundData: { id?: string } = await response.json();

      await ctx.runMutation(api.safepayInternal.patchPayment, {
        paymentId: args.paymentId,
        status: "refunded",
        metadata: {
          ...(payment.metadata as Record<string, unknown>),
          refundId: refundData.id,
          refundReason: args.reason,
          refundedAt: Date.now(),
        },
      });

      if (payment.subscriptionId) {
        await ctx.runMutation(api.safepayInternal.updateSubscription, {
          subscriptionId: payment.subscriptionId,
          patch: { status: "canceled" },
        });
      }

      return {
        success: true,
        refundId: refundData.id,
        refundedAt: Date.now(),
      };
    } catch (error) {
      console.error("[SAFEPAY] Refund error:", error);
      return {
        success: false,
        error: {
          code: "REFUND_ERROR",
          message:
            error instanceof Error ? error.message : "Failed to process refund",
        },
      };
    }
  },
});

// Re-export the SafepayCheckoutRequest type for callers who need it
export type { SafepayCheckoutRequest };
