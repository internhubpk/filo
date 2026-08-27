// =============================================================================
// POST /api/billing/verify
// =============================================================================
// Session-authenticated payment-confirmation poller for the billing page.
//
// While a subscription sits in PENDING (webhook delayed or not configured in
// the Safepay dashboard), the page calls this endpoint every few seconds. For
// the user's latest PENDING payment it asks SAFEPAY — server-to-server — for
// the live tracker state (Fetch Tracker API) and reconciles the checkout when
// the answer is conclusive:
//
//   { status: "confirmed" }  — tracker paid → subscription activated
//   { status: "pending"   }  — Safepay still processing (or unreachable)
//   { status: "failed"    }  — tracker cancelled/expired/voided
//   { status: "none"      }  — nothing pending for this account
//
// SECURITY: the browser never supplies a tracker id or outcome — it can only
// ask "is my own latest pending payment done yet?". Every state change flows
// through billing:reconcileCheckoutFromTracker with the server token, keyed
// to a payment row we created ourselves.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { fetchTrackerState, getSafepayMode, isSubscriptionFlowConfigured } from "@/lib/safepay";
import { requireUser, serverToken, convexQuery, convexMutation } from "@/lib/billing-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PendingCheckout {
  paymentId: string;
  tracker: string | null;
  paymentStatus: string;
  subscriptionStatus: string | null;
  createdAt: number;
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    const pending = await convexQuery<PendingCheckout | null>("billing:getPendingCheckoutForUser", {
      serverToken: serverToken(),
      userId: auth.data.user.id,
    });

    // Non-secret deployment diagnostics so the UI can explain WHAT to fix.
    const diagnostics = {
      mode: getSafepayMode(),
      subscriptionFlowConfigured: isSubscriptionFlowConfigured(),
    };

    if (!pending) {
      return NextResponse.json({ success: true, data: { status: "none", ...diagnostics } });
    }

    if (!pending.tracker || !pending.tracker.startsWith("track_")) {
      // Either the row predates tracker storage, or the checkout used the
      // true subscription flow (stores a passport auth token, not a track_*)
      // — Safepay only exposes those via webhook/signed return, never via the
      // Fetch Tracker API, so say so instead of a misleading "unavailable".
      return NextResponse.json({
        success: true,
        data: {
          status: "pending",
          reason: "no_tracker",
          subscriptionStatus: pending.subscriptionStatus,
          ...diagnostics,
        },
      });
    }

    // Poll-rate guard: don't hammer Safepay if the client misbehaves.
    const ageMs = Date.now() - (pending.createdAt ?? 0);
    if (ageMs > 24 * 60 * 60 * 1000) {
      return NextResponse.json({
        success: true,
        data: { status: "pending", reason: "stale", subscriptionStatus: pending.subscriptionStatus, ...diagnostics },
      });
    }

    const result = await fetchTrackerState(pending.tracker);
    if (!result.ok) {
      return NextResponse.json({
        success: true,
        data: {
          status: "pending",
          reason: "tracker_unavailable",
          detail: result.error,
          subscriptionStatus: pending.subscriptionStatus,
          ...diagnostics,
        },
      });
    }

    if (result.outcome.kind === "paid") {
      const applied = await convexMutation<{
        applied: boolean;
        reason?: string;
        paymentStatus?: string;
        subscriptionStatus?: string | null;
      }>("billing:reconcileCheckoutFromTracker", {
        serverToken: serverToken(),
        tracker: pending.tracker,
        outcome: "paid",
        source: "tracker_api",
        safepayState: result.outcome.state,
      });
      const confirmed =
        applied.applied ||
        (applied.reason === "already_processed" && applied.subscriptionStatus === "active");
      return NextResponse.json({
        success: true,
        data: {
          status: confirmed ? "confirmed" : "pending",
          subscriptionStatus: applied.subscriptionStatus ?? pending.subscriptionStatus,
          ...diagnostics,
        },
      });
    }

    if (result.outcome.kind === "failed") {
      await convexMutation("billing:reconcileCheckoutFromTracker", {
        serverToken: serverToken(),
        tracker: pending.tracker,
        outcome: "failed",
        source: "tracker_api",
        safepayState: result.outcome.state,
      }).catch(() => null);
      return NextResponse.json({
        success: true,
        data: { status: "failed", state: result.outcome.state },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        status: "pending",
        state: result.outcome.state,
        subscriptionStatus: pending.subscriptionStatus,
        ...diagnostics,
      },
    });
  } catch (error) {
    console.error("[API /billing/verify] Error:", error);
    return NextResponse.json(
      { success: false, error: "Verification check failed — will retry", code: "VERIFY_ERROR" },
      { status: 500 }
    );
  }
}
