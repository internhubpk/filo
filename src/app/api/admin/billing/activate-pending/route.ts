// =============================================================================
// POST /api/admin/billing/activate-pending
// =============================================================================
// ADMIN MANUAL ACTIVATION for a pending checkout the operator has personally
// verified as "Complete" in the Safepay dashboard.
//
// WHY THIS EXISTS: activation normally flows exclusively through
// server-verified Safepay signals (webhook / signed return / Fetch Tracker
// API). But when ALL of those channels fail — e.g. a payment whose return
// redirect 404'd on a stale domain, the tracker API 401s because the
// merchant secrets aren't configured, and no webhook is registered — a
// payment Safepay itself shows as Complete would strand the customer in
// "Pending" forever. This endpoint lets an ADMIN apply that outcome by hand:
//   - requireAdminAccess (cookie session or bearer, live DB re-verified)
//   - in-Convex admin re-check inside the mutation (defense in depth)
//   - idempotent: only a PENDING payment can transition
//   - plan/amount come from our own payment/subscription rows
//   - audit-logged as billing.manual_activation with the admin's identity
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess, serverToken, convexMutation, jsonError } from "@/lib/billing-server";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const body = (await request.json().catch(() => null)) as
      | { subscriptionId?: string; userId?: string; note?: string }
      | null;
    if (!body?.subscriptionId && !body?.userId) {
      return jsonError(400, "subscriptionId or userId is required", "BAD_REQUEST");
    }

    const result = await convexMutation<{
      applied: boolean;
      reason?: string;
      paymentStatus?: string;
      subscriptionStatus?: string | null;
    }>("billing:adminActivatePendingCheckout", {
      serverToken: serverToken(),
      adminUserId: admin.data.adminUserId,
      ...(body.subscriptionId ? { subscriptionId: body.subscriptionId } : {}),
      ...(body.userId ? { userId: body.userId } : {}),
      ...(body.note ? { note: body.note } : {}),
    });

    if (!result.applied) {
      const messages: Record<string, string> = {
        no_pending_payment: "No pending payment found for that subscription/user.",
        subscription_mismatch: "The pending payment does not belong to that subscription.",
      };
      return NextResponse.json(
        {
          success: false,
          error: messages[result.reason ?? ""] ?? `Could not activate (${result.reason})`,
          code: "NOT_APPLIED",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        paymentStatus: result.paymentStatus,
        subscriptionStatus: result.subscriptionStatus,
        message: "Payment marked succeeded and the subscription activated (audited).",
      },
    });
  } catch (error) {
    console.error("[API /admin/billing/activate-pending] Error:", error);
    const message = error instanceof Error ? error.message : "Activation failed";
    return jsonError(500, message, "ACTIVATE_ERROR");
  }
}
