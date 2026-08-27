// =============================================================================
// GET|POST /api/billing/return
// =============================================================================
// Safepay's hosted checkout sends the payer back here after payment (POST
// form-encoded; cancels arrive as GET/redirect). This is the route registered
// as `redirect_url` at checkout time.
//
// OFFICIAL CONFIRMATION FLOW (per Safepay's integration gist + WooCommerce
// plugin): the return POST carries `tracker` + `signature` where signature =
// HMAC-SHA256(tracker, shared secret). A VALID signature is Safepay-signed
// proof the tracker was paid, and official plugins mark the order complete
// from it. We additionally confirm against Safepay's Fetch Tracker API when
// the POST arrives without a usable signature.
//
//   1. GET  (cancel link / plain navigation) → bounce to /billing.
//   2. POST tracker+signature (verified)  → reconcile: activate the matching
//      pending subscription (idempotent) → bounce ?checkout=confirmed.
//   3. POST tracker only                  → ask Safepay's reporter API for
//      the tracker state; paid → confirmed, cancelled/expired → failed,
//      otherwise bounce ?checkout=return (webhook may still land).
//   4. POST tracker+signature (INVALID)   → bounce ?checkout=invalid_signature
//      with NO state change (forged requests can at most bounce a browser).
//
// SECURITY: reconciliation only happens for server-verified Safepay signals,
// the tracker must match a payment row WE created at checkout time, and the
// plan/amount applied come from our own database — never from the POST body.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { verifyReturnSignature, fetchTrackerState } from "@/lib/safepay";
import { appUrl, serverToken, convexMutation } from "@/lib/billing-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BounceStatus = "confirmed" | "return" | "cancelled" | "invalid_signature" | "failed";

function bounce(status: BounceStatus, extra: Record<string, string> = {}) {
  const url = new URL(`${appUrl()}/billing`);
  url.searchParams.set("checkout", status);
  for (const [k, v] of Object.entries(extra)) {
    if (v) url.searchParams.set(k, v);
  }
  return NextResponse.redirect(url.toString(), { status: 303 });
}

function pick(fields: Record<string, string | undefined>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Reconcile the pending checkout for a tracker. Applies a state change ONLY
 * when Safepay's answer is conclusive; returns the billing-page bounce status.
 * `subscriptionId` is a fallback lookup key from our own checkout state —
 * needed for true-subscription checkouts whose tracker was never stored.
 */
async function reconcileTracker(
  tracker: string,
  source: "signed_return" | "tracker_api",
  safepayState?: string,
  subscriptionId?: string
): Promise<BounceStatus> {
  try {
    const result = await convexMutation<{
      applied: boolean;
      reason?: string;
      paymentStatus?: string;
      subscriptionStatus?: string | null;
    }>("billing:reconcileCheckoutFromTracker", {
      serverToken: serverToken(),
      tracker,
      outcome: "paid",
      source,
      ...(safepayState ? { safepayState } : {}),
      ...(subscriptionId ? { subscriptionId } : {}),
    });
    if (result.applied) return "confirmed";
    // already_processed + active → the plan is live; treat as confirmed.
    if (
      result.reason === "already_processed" &&
      (result.paymentStatus === "succeeded" || result.subscriptionStatus === "active")
    ) {
      return "confirmed";
    }
    return "return";
  } catch (err) {
    // Never block the user bounce on a reconciliation hiccup — the webhook
    // remains a backup channel and ?checkout=return keeps polling.
    console.error(`[billing/return] reconciliation failed for tracker=${tracker.slice(0, 12)}…:`,
      err instanceof Error ? err.message : err);
    return "return";
  }
}

/**
 * Shared tracker-only reconciliation (GET redirect or unsigned POST):
 * check the tracker state server-to-server and apply conclusive outcomes.
 * Returns the billing-page bounce status.
 */
async function reconcileTrackerOnly(tracker: string, fallbackSubscriptionId?: string): Promise<BounceStatus> {
  const result = await fetchTrackerState(tracker);
  if (!result.ok) {
    console.warn(`[billing/return] tracker lookup unavailable (${result.error}) for tracker=${tracker.slice(0, 12)}… — relying on webhook/verify`);
    return "return";
  }
  console.info(`[billing/return] tracker API state=${result.outcome.state} for tracker=${tracker.slice(0, 12)}…`);
  switch (result.outcome.kind) {
    case "paid":
      return reconcileTracker(tracker, "tracker_api", result.outcome.state, fallbackSubscriptionId);
    case "failed":
      try {
        await convexMutation("billing:reconcileCheckoutFromTracker", {
          serverToken: serverToken(),
          tracker,
          outcome: "failed",
          source: "tracker_api",
          safepayState: result.outcome.state,
          ...(fallbackSubscriptionId ? { subscriptionId: fallbackSubscriptionId } : {}),
        });
      } catch (err) {
        console.error("[billing/return] failed-state reconciliation error:", err);
      }
      return "failed";
    case "refunded":
    case "disputed":
      try {
        await convexMutation("billing:reconcileCheckoutFromTracker", {
          serverToken: serverToken(),
          tracker,
          outcome: result.outcome.kind,
          source: "tracker_api",
          safepayState: result.outcome.state,
          ...(fallbackSubscriptionId ? { subscriptionId: fallbackSubscriptionId } : {}),
        });
      } catch (err) {
        console.error("[billing/return] refunded/disputed reconciliation error:", err);
      }
      return "return";
    default:
      // still processing / unknown — let the billing page keep polling
      return "return";
  }
}

export async function GET(request: NextRequest) {
  // Safepay's browser redirect can land here as a GET (cancels always do;
  // some flows even after payment). When a tracker is present we try the
  // server-to-server check instead of blindly bouncing — this is what
  // recovers payers whose signed return POST never made it (e.g. it went to
  // a stale domain and 404'd).
  const tracker = request.nextUrl.searchParams.get("tracker") ?? undefined;
  if (!tracker) {
    return bounce("cancelled");
  }
  const stateSubscriptionId = request.nextUrl.searchParams.get("subscriptionId") ?? undefined;
  const CONVEX_ID_RE = /^[a-z0-9]{25,40}$/;
  const fallbackSubscriptionId =
    stateSubscriptionId && CONVEX_ID_RE.test(stateSubscriptionId) ? stateSubscriptionId : undefined;
  const status = await reconcileTrackerOnly(tracker, fallbackSubscriptionId);
  return bounce(status, { tracker });
}

export async function POST(request: NextRequest) {
  let fields: Record<string, string | undefined> = {};
  try {
    const form = await request.formData();
    fields = Object.fromEntries(
      Array.from(form.entries()).map(([k, v]) => [k, typeof v === "string" ? v : undefined])
    );
  } catch {
    // Not a form body — treat like a plain return.
    return bounce("return");
  }

  const tracker = pick(fields, "tracker", "beacon", "token");
  const signature = pick(fields, "signature", "sig", "hash");
  const orderId = pick(fields, "order_id", "orderId", "reference");
  // Our own checkout state rides on the redirect_url query string (Safepay
  // POSTs to that exact URL) — it identifies the payment even when the
  // stored token isn't the tracker (subscription flow).
  const stateSubscriptionId =
    request.nextUrl.searchParams.get("subscriptionId") ?? undefined;
  // Convex document ids are ~32 lowercase alphanumeric chars — used only as a
  // fallback when the checkout state param is missing (e.g. order_id echo).
  const CONVEX_ID_RE = /^[a-z0-9]{25,40}$/;
  const fallbackSubscriptionId =
    stateSubscriptionId && CONVEX_ID_RE.test(stateSubscriptionId)
      ? stateSubscriptionId
      : orderId && CONVEX_ID_RE.test(orderId)
        ? orderId
        : undefined;
  const label = `tracker=${tracker?.slice(0, 12) ?? "n/a"}… order_id=${orderId ?? "n/a"}`;

  if (tracker && signature) {
    if (!verifyReturnSignature(tracker, signature)) {
      console.warn(`[billing/return] signature verification FAILED for ${label} — bouncing without state change`);
      return bounce("invalid_signature", { tracker });
    }
    console.info(`[billing/return] signed return verified for ${label} — reconciling payment`);
    const status = await reconcileTracker(tracker, "signed_return", undefined, fallbackSubscriptionId);
    return bounce(status, { tracker });
  }

  if (tracker) {
    // Unsigned return (some Safepay modes / cancelled flows): verify the
    // tracker state server-to-server before touching anything.
    const status = await reconcileTrackerOnly(tracker, fallbackSubscriptionId);
    return bounce(status, { tracker });
  }

  return bounce("return");
}
