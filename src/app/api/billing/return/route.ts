// =============================================================================
// GET|POST /api/billing/return
// =============================================================================
// Safepay's hosted checkout POSTs the payer back here after payment (and
// redirects for cancellations). A page route cannot accept the form POST, so
// this API route is the registered redirect_url:
//
//   1. GET  (cancel link / plain navigation) → bounce to /billing.
//   2. POST  — form-encoded fields from Safepay:
//        tracker / beacon   : the payment tracker token
//        signature          : HMAC-SHA256(tracker, merchant secret)
//        order_id / ref?    : optional reference fields
//      We verify the signature (when present), log the outcome, and 303 the
//      browser back to /billing?checkout=return.
//
// SECURITY / STATE: this route NEVER changes subscription state — that only
// happens through the verified webhook. Even a forged return POST can do no
// more than bounce the attacker's own browser to /billing.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { verifyReturnSignature } from "@/lib/safepay";
import { appUrl } from "@/lib/billing-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bounce(status: "return" | "cancelled" | "invalid_signature", extra: Record<string, string> = {}) {
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

  if (tracker && signature) {
    const valid = verifyReturnSignature(tracker, signature);
    if (!valid) {
      console.warn(
        `[billing/return] signature verification FAILED for tracker=${tracker.slice(0, 12)}… order_id=${orderId ?? "n/a"} — bouncing without state change`
      );
      return bounce("invalid_signature", { tracker });
    }
    console.info(`[billing/return] verified return for tracker=${tracker.slice(0, 12)}… order_id=${orderId ?? "n/a"}`);
  } else if (tracker) {
    // Some Safepay modes redirect with the tracker but no signature — allow
    // the bounce (UX only) and rely on the webhook for state.
    console.info(`[billing/return] unsigned return (tracker only), relying on webhook`);
  }

  return bounce("return", { tracker: tracker ?? "", order_id: orderId ?? "" });
}
