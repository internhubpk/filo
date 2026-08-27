// =============================================================================
// POST /api/billing/checkout
// =============================================================================
// Start a Safepay sandbox subscription checkout.
//
// FLOW (real payment, no shortcuts):
//   1. Validate session + LIVE account status (server-side).
//   2. Load the requested plan from Convex (plans are DB-driven).
//   3. Refuse checkout for contact-sales plans, free plans, and plans whose
//      Safepay plan identifier is not configured (fail-closed).
//   4. Create a PENDING subscription + PENDING payment row in Convex.
//   5. Create the Safepay checkout session (server-side secret only).
//   6. Return the hosted payment URL. The browser is redirected to it.
//
// The subscription becomes ACTIVE only when Safepay's webhook is verified
// and processed by POST /api/webhooks/safepay. This endpoint NEVER marks a
// payment successful.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser, serverToken, convexQuery, convexMutation, jsonError, appUrl } from "@/lib/billing-server";
import { createCheckoutSession, isSafepayConfigured } from "@/lib/safepay";

interface PlanRow {
  _id: string;
  name: string;
  tier?: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  contactSales?: boolean;
  active?: boolean;
  safepayPlanIdMonthly?: string;
  safepayPlanIdYearly?: string;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (!auth.ok) return auth.response;
    const { user } = auth.data;

    if (!isSafepayConfigured()) {
      return jsonError(503, "Payments are not configured on this deployment", "BILLING_UNCONFIGURED");
    }

    const body = (await request.json().catch(() => null)) as
      | { planId?: string; planTier?: string; interval?: string }
      | null;
    if (!body?.planId && !body?.planTier) {
      return jsonError(400, "planId or planTier is required", "BAD_REQUEST");
    }
    const interval = body.interval === "yearly" ? "yearly" : "monthly";

    // ---- Load the plan from the database (never trust client-side prices) ----
    let plan: PlanRow | null = null;
    if (body.planId) {
      plan = await convexQuery<PlanRow | null>("plans:getPlanById", { planId: body.planId });
    } else {
      const plans = (await convexQuery<PlanRow[]>("plans:getActivePlans", {})) as PlanRow[];
      plan = plans.find((p) => (p.tier ?? "") === body.planTier) ?? null;
    }
    if (!plan || plan.active === false) {
      return jsonError(404, "Plan not found or inactive", "PLAN_NOT_FOUND");
    }
    if (plan.contactSales) {
      return jsonError(400, "This plan requires contacting sales", "PLAN_CONTACT_SALES");
    }
    if ((plan.tier ?? "") === "free" || (plan.priceMonthly === 0 && plan.priceYearly === 0)) {
      return jsonError(400, "The Free plan does not require checkout", "PLAN_FREE");
    }

    const safepayPlanId =
      interval === "yearly" ? plan.safepayPlanIdYearly : plan.safepayPlanIdMonthly;
    if (!safepayPlanId) {
      console.error(
        `[billing/checkout] plan "${plan.name}" is missing its Safepay plan id for interval "${interval}". Configure it in the Safepay dashboard + plans table.`
      );
      return jsonError(
        503,
        "This plan is not yet enabled for online payments. Please contact support.",
        "PLAN_NOT_SAFEPAY_MAPPED"
      );
    }

    const amount = interval === "yearly" ? plan.priceYearly : plan.priceMonthly;
    if (!amount || amount <= 0) {
      return jsonError(400, "Invalid plan amount", "PLAN_INVALID_AMOUNT");
    }

    // ---- Persist pending subscription + payment (audit trail starts here) ----
    const subscriptionId = await convexMutation<string>("billing:createPendingSubscription", {
      serverToken: serverToken(),
      userId: user.id,
      planId: plan._id,
      interval,
      amount,
      currency: plan.currency || "PKR",
    });

    // ---- Create the Safepay checkout session (secret stays server-side) ----
    const returnBase = appUrl();
    const session = await createCheckoutSession({
      amountPkr: amount,
      orderId: String(subscriptionId),
      customerEmail: user.email,
      customerName: user.name,
      subscriptionPlanId: safepayPlanId,
      state: {
        source: "filo-subscription",
        subscriptionId: String(subscriptionId),
        userId: user.id,
        planTier: plan.tier ?? "",
        interval,
      },
    });

    await convexMutation("billing:recordCheckoutStarted", {
      serverToken: serverToken(),
      subscriptionId,
      userId: user.id,
      planId: plan._id,
      amount,
      currency: plan.currency || "PKR",
      trackingId: session.trackingId,
      paymentToken: session.token,
    });

    return NextResponse.json({
      success: true,
      data: {
        checkoutUrl: session.paymentUrl,
        paymentToken: session.token,
        subscriptionId,
        plan: { id: plan._id, name: plan.name, tier: plan.tier },
        interval,
        amount,
        currency: plan.currency || "PKR",
        returnUrl: `${returnBase}/billing?checkout=return`,
      },
    });
  } catch (error) {
    console.error("[API /billing/checkout] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to start checkout";
    return jsonError(500, message, "CHECKOUT_ERROR");
  }
}
