import { action } from "./_generated/server";
import { v } from "convex/values";

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
 * Create a Safepay checkout session for subscription payment
 * This is an ACTION (not mutation) because it calls external API
 * 
 * IMPORTANT: Safepay API keys are accessed via process.env in actions only!
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
    const isSandbox = process.env.SAFEPAY_SANDBOX === 'true' || process.env.NODE_ENV !== 'production';
    
    if (!apiKey) {
      throw new Error("SAFEPAY_SECRET_KEY not configured");
    }

    // Get plan details from database
    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new Error("Plan not found");
    }

    // Calculate amount based on billing period
    const amount = args.isYearly ? plan.priceYearly : plan.priceMonthly;
    
    if (amount <= 0) {
      throw new Error("Free plans do not require payment");
    }

    // Generate unique reference
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    const reference = `FLO-${timestamp}-${random}`.toUpperCase();

    // Determine base URL (sandbox vs production)
    const baseUrl = isSandbox 
      ? 'https://sandbox.api.getsafepay.com' 
      : 'https://api.getsafepay.com';

    try {
      // Call Safepay API to create checkout
      const response = await fetch(`${baseUrl}/v1/checkouts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          amount: amount,
          currency: 'PKR',
          reference: reference,
          description: `Filo ${plan.name} - ${args.isYearly ? 'Yearly' : 'Monthly'}`,
          metadata: {
            userId: args.userId,
            planId: args.planId,
            email: args.userEmail,
            isYearly: args.isYearly,
            reference: reference,
          },
          redirect_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://filo-ai-ashen.vercel.app'}/billing?payment=success`,
          cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://filo-ai-ashen.vercel.app'}/billing?payment=cancelled`,
          webhooks: [
            {
              url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://filo-ai-ashen.vercel.app'}/api/webhooks/safepay`,
              events: ['payment.captured', 'payment.failed', 'payment.cancelled'],
            }
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[SAFEPAY] Checkout creation failed:', errorData);
        
        return {
          success: false,
          error: {
            code: 'SAFEPAY_API_ERROR',
            message: errorData.message || 'Failed to create checkout session',
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
            code: 'SAFEPAY_CHECKOUT_FAILED',
            message: data.error?.message || 'Safepay returned unsuccessful response',
            details: data.error,
          },
          reference,
        };
      }

      // Create pending payment record in Convex
      await ctx.db.insert("payments", {
        userId: args.userId,
        amount: amount,
        currency: "PKR",
        status: "pending",
        provider: "safepay",
        providerPaymentId: data.data.id,
        description: `Filo ${plan.name} - ${args.isYearly ? 'Yearly' : 'Monthly'} (${reference})`,
        metadata: {
          reference,
          planId: args.planId,
          isYearly: args.isYearly,
          checkoutToken: data.data.token,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return {
        success: true,
        data: {
          checkoutUrl: data.data.url,
          checkoutToken: data.data.token,
          paymentId: data.data.id,
          reference,
          amount,
          currency: 'PKR',
          planName: plan.name,
          isYearly: args.isYearly,
        },
      };

    } catch (error) {
      console.error('[SAFEPAY] Network error:', error);
      
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Failed to connect to Safepay',
        },
        reference,
      };
    }
  },
});

/**
 * Verify a Safepay payment after redirect
 * Called when user returns from Safepay checkout
 */
export const verifySafepayPayment = action({
  args: {
    paymentId: v.string(),
    reference: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.SAFEPAY_SECRET_KEY;
    const isSandbox = process.env.SAFEPAY_SANDBOX === 'true' || process.env.NODE_ENV !== 'production';

    if (!apiKey) {
      throw new Error("SAFEPAY_SECRET_KEY not configured");
    }

    const baseUrl = isSandbox 
      ? 'https://sandbox.api.getsafepay.com' 
      : 'https://api.getsafepay.com';

    try {
      // Query Safepay for payment status
      const response = await fetch(`${baseUrl}/v1/payments/${args.paymentId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Safepay API error: ${response.status}`);
      }

      const paymentData = await response.json();

      // Find our payment record
      const payment = await ctx.db
        .query("payments")
        .withIndex("by_providerPaymentId", (q) =>
          q.eq("providerPaymentId", args.paymentId)
        )
        .first();

      if (!payment) {
        return {
          verified: false,
          error: {
            code: 'PAYMENT_NOT_FOUND',
            message: 'Payment record not found in our system',
          },
        };
      }

      // Update payment status based on Safepay response
      let newStatus: "completed" | "failed" | "cancelled" | "refunded" = payment.status;

      if (paymentData.status === 'CAPTURED' || paymentData.status === 'captured') {
        newStatus = 'completed';
        
        // Activate subscription if this was a subscription payment
        if (payment.metadata?.planId && payment.metadata?.isYearly !== undefined) {
          const now = Date.now();
          const periodEnd = payment.metadata.isYearly 
            ? now + 365 * 24 * 60 * 60 * 1000  // 1 year
            : now + 30 * 24 * 60 * 60 * 1000;   // 1 month

          // Check if subscription already exists
          const existingSub = await ctx.db
            .query("subscriptions")
            .withIndex("by_userId", (q) => q.eq("userId", payment.userId))
            .filter((q) =>
              q.or(
                q.eq(q.field("status"), "active"),
                q.eq(q.field("status"), "trialing")
              )
            )
            .first();

          if (existingSub) {
            // Extend existing subscription
            await ctx.db.patch(existingSub._id, {
              currentPeriodEnd: periodEnd,
              status: "active",
              updatedAt: now,
            });
          } else {
            // Create new subscription
            await ctx.db.insert("subscriptions", {
              userId: payment.userId,
              planId: payment.metadata.planId,
              provider: "safepay",
              providerSubscriptionId: args.paymentId,
              status: "active",
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              cancelAtPeriodEnd: false,
              createdAt: now,
              updatedAt: now,
            });
          }

          // Update user's plan reference
          await ctx.db.patch(payment.userId, {
            planId: payment.metadata.planId,
            updatedAt: now,
          });
        }
      } else if (paymentData.status === 'FAILED' || paymentData.status === 'failed') {
        newStatus = 'failed';
      } else if (paymentData.status === 'CANCELLED' || paymentData.status === 'cancelled') {
        newStatus = 'cancelled';
      }

      // Update payment record
      if (newStatus !== payment.status) {
        await ctx.db.patch(payment._id, {
          status: newStatus,
          updatedAt: Date.now(),
        });
      }

      return {
        verified: true,
        paymentStatus: newStatus,
        safepayStatus: paymentData.status,
        paymentId: payment._id,
        subscriptionActivated: newStatus === 'completed',
      };

    } catch (error) {
      console.error('[SAFEPAY] Verification error:', error);
      
      return {
        verified: false,
        error: {
          code: 'VERIFICATION_ERROR',
          message: error instanceof Error ? error.message : 'Failed to verify payment',
        },
      };
    }
  },
});

/**
 * Process refund through Safepay (admin only)
 */
export const processRefund = action({
  args: {
    paymentId: v.id("payments"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.SAFEPAY_SECRET_KEY;
    const isSandbox = process.env.SAFEPAY_SANDBOX === 'true' || process.env.NODE_ENV !== 'production';

    if (!apiKey) {
      throw new Error("SAFEPAY_SECRET_KEY not configured");
    }

    // Get payment record
    const payment = await ctx.db.get(args.paymentId);
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
      ? 'https://sandbox.api.getsafepay.com' 
      : 'https://api.getsafepay.com';

    try {
      const response = await fetch(`${baseUrl}/v1/payments/${payment.providerPaymentId}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          reason: args.reason || 'Customer request',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: {
            code: 'REFUND_FAILED',
            message: errorData.message || 'Refund processing failed',
          },
        };
      }

      const refundData = await response.json();

      // Update payment status
      await ctx.db.patch(args.paymentId, {
        status: "refunded",
        updatedAt: Date.now(),
        metadata: {
          ...payment.metadata,
          refundId: refundData.id,
          refundReason: args.reason,
          refundedAt: Date.now(),
        },
      });

      // Cancel associated subscription if exists
      if (payment.subscriptionId) {
        await ctx.db.patch(payment.subscriptionId, {
          status: "canceled",
          updatedAt: Date.now(),
        });
      }

      return {
        success: true,
        refundId: refundData.id,
        refundedAt: Date.now(),
      };

    } catch (error) {
      console.error('[SAFEPAY] Refund error:', error);
      
      return {
        success: false,
        error: {
          code: 'REFUND_ERROR',
          message: error instanceof Error ? error.message : 'Failed to process refund',
        },
      };
    }
  },
});
