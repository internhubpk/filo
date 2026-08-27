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
 */
async function reconcileTracker(
  tracker: string,
  source: "signed_return" | "tracker_api",
  safepayState?: string
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

export async function GET(request: NextRequest) {
  // Cancel path or manual navigation — nothing to verify.
  const tracker = request.nextUrl.searchParams.get("tracker") ?? undefined;
  return bounce(tracker ? "return" : "cancelled", { tracker: tracker ?? "" });
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
  const label = `tracker=${tracker?.slice(0, 12) ?? "n/a"}… order_id=${orderId ?? "n/a"}`;

  if (tracker && signature) {
    if (!verifyReturnSignature(tracker, signature)) {
      console.warn(`[billing/return] signature verification FAILED for ${label} — bouncing without state change`);
      return bounce("invalid_signature", { tracker });
    }
    console.info(`[billing/return] signed return verified for ${label} — reconciling payment`);
    const status = await reconcileTracker(tracker, "signed_return");
    return bounce(status, { tracker });
  }

  if (tracker) {
    // Unsigned return (some Safepay modes / cancelled flows): verify the
    // tracker state server-to-server before touching anything.
    const result = await fetchTrackerState(tracker);
    if (result.ok) {
      console.info(`[billing/return] tracker API state=${result.outcome.state} for ${label}`);
      switch (result.outcome.kind) {
        case "paid":
          return bounce(await reconcileTracker(tracker, "tracker_api", result.outcome.state), { tracker });
        case "failed":
          try {
            await convexMutation("billing:reconcileCheckoutFromTracker", {
              serverToken: serverToken(),
              tracker,
              outcome: "failed",
              source: "tracker_api",
              safepayState: result.outcome.state,
            });
          } catch (err) {
            console.error("[billing/return] failed-state reconciliation error:", err);
          }
          return bounce("failed", { tracker });
        case "refunded":
        case "disputed":
          try {
            await convexMutation("billing:reconcileCheckoutFromTracker", {
              serverToken: serverToken(),
              tracker,
              outcome: result.outcome.kind,
              source: "tracker_api",
              safepayState: result.outcome.state,
            });
          } catch (err) {
            console.error("[billing/return] refunded/disputed reconciliation error:", err);
          }
          return bounce("return", { tracker });
        default:
          // still processing / unknown — let the billing page keep polling
          return bounce("return", { tracker });
      }
    }
    console.warn(`[billing/return] unsigned return, tracker lookup unavailable (${result.error}) for ${label} — relying on webhook`);
    return bounce("return", { tracker });
  }

  return bounce("return");
}
