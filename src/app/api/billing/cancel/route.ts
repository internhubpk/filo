// =============================================================================
// POST /api/billing/cancel
// =============================================================================
// User-initiated cancellation. Sets cancelAtPeriodEnd on the ACTIVE
// subscription; paid access is preserved until the current period ends.
// The definitive lifecycle change still arrives via Safepay webhooks
// (subscription.canceled / subscription.ended).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser, serverToken, convexMutation, convexQuery, jsonError } from "@/lib/billing-server";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (!auth.ok) return auth.response;
    const { user } = auth.data;

    const body = (await request.json().catch(() => ({}))) as { cancel?: boolean };
    const cancel = body.cancel !== false;

    const sub = await convexQuery<Record<string, unknown> | null>("billing:getSubscriptionForUser", {
      serverToken: serverToken(),
      userId: user.id,
    });

    if (!sub) return jsonError(404, "No subscription found", "NO_SUBSCRIPTION");
    if (sub.status !== "active") {
      return jsonError(409, "Only active subscriptions can be canceled", "INVALID_STATE");
    }

    await convexMutation("billing:setSubscriptionCancelAtPeriodEnd", {
      serverToken: serverToken(),
      userId: user.id,
      subscriptionId: String(sub._id),
      cancel,
    });

    return NextResponse.json({
      success: true,
      data: {
        subscriptionId: sub._id,
        cancelAtPeriodEnd: cancel,
        currentPeriodEnd: sub.currentPeriodEnd ?? null,
        message: cancel
          ? "Subscription will end at the close of the current billing period."
          : "Cancellation reverted — your subscription will renew normally.",
      },
    });
  } catch (error) {
    console.error("[API /billing/cancel] Error:", error);
    return jsonError(500, "Failed to update subscription", "CANCEL_ERROR");
  }
}
