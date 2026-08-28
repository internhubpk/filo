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
import { fetchTrackerState, getSafepayMode, isSubscriptionFlowConfigured, searchSafepayPayments } from "@/lib/safepay";
import { requireUser, serverToken, convexQuery, convexMutation } from "@/lib/billing-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PendingCheckout {
  paymentId: string;
  tracker: string | null;
  paymentStatus: string;
  subscriptionStatus: string | null;
  subscriptionId: string | null;
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
      // single-tracker Fetch Tracker API.
      //
      // TRACKER DISCOVERY: ask Safepay's reporter payments-search for recent
      // payments on THIS merchant account and adopt the tracker whose
      // order_id matches OUR subscription id (order_id is set by us at
      // checkout — the only safely-correlatable key; we never guess from
      // amounts or emails). Once adopted, verification proceeds normally.
      const discovery: Record<string, unknown> = {};
      if (pending.subscriptionId) {
        const search = await searchSafepayPayments(20);
        if (search.ok) {
          discovery.searched = search.payments.length;
          const match = search.payments.find(
            (p) => p.orderId && String(p.orderId) === String(pending.subscriptionId) && p.tracker
          );
          if (match?.tracker) {
            const attached = (await convexMutation("billing:attachTrackerToPayment", {
              serverToken: serverToken(),
              paymentId: pending.paymentId,
              tracker: match.tracker,
              discoveredVia: "verify:payments_search",
            }).catch((e) => ({ applied: false, error: String(e) }))) as { applied?: boolean };
            discovery.attached = Boolean(attached?.applied);
            if (attached?.applied) {
              console.info(
                `[billing/verify] tracker ${match.tracker.slice(0, 14)}… discovered for subscription ${pending.subscriptionId} — retrying with tracker`
              );
              return await verifyWithTracker(match.tracker, pending.subscriptionStatus, diagnostics);
            }
          }
        } else {
          discovery.searchError = search.error?.slice(0, 160);
        }
      }
      return NextResponse.json({
        success: true,
        data: {
          status: "pending",
          reason: "no_tracker",
          subscriptionStatus: pending.subscriptionStatus,
          discovery,
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

    return await verifyWithTracker(pending.tracker, pending.subscriptionStatus, diagnostics);
  } catch (error) {
    console.error("[API /billing/verify] Error:", error);
    return NextResponse.json(
      { success: false, error: "Verification check failed — will retry", code: "VERIFY_ERROR" },
      { status: 500 }
    );
  }
}

/** Shared tail: verify an adopted/known tracker and reconcile conclusively. */
async function verifyWithTracker(
  tracker: string,
  subscriptionStatus: string | null,
  diagnostics: Record<string, unknown>
): Promise<NextResponse> {
  const result = await fetchTrackerState(tracker);
  if (!result.ok) {
    return NextResponse.json({
      success: true,
      data: {
        status: "pending",
        reason: "tracker_unavailable",
        detail: result.error,
        subscriptionStatus,
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
      tracker,
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
        subscriptionStatus: applied.subscriptionStatus ?? subscriptionStatus,
        ...diagnostics,
      },
    });
  }

  if (result.outcome.kind === "failed") {
    await convexMutation("billing:reconcileCheckoutFromTracker", {
      serverToken: serverToken(),
      tracker,
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
      subscriptionStatus,
      ...diagnostics,
    },
  });
}
