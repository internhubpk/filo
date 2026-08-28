// =============================================================================
// POST /api/admin/billing/webhook-self-test
// =============================================================================
// END-TO-END WEBHOOK VERIFICATION (admin-gated) — answers "is the webhook
// pipeline actually working?" in one click, without making a real payment.
//
// What it does:
//   1. Builds a SYNTHETIC payment.succeeded event (unique evt_/track_ ids —
//      matches no real payment, recorded as ignored, zero state changes).
//   2. Signs it with the REAL webhook secret using the documented scheme
//      (HMAC-SHA512 hex over the exact raw body, header X-SFPY-SIGNATURE) —
//      exactly how Safepay signs production deliveries.
//   3. POSTs it to THIS deployment's /api/webhooks/safepay over HTTP.
//   4. Reports the verdict:
//        reachable            — did the request complete?
//        signature_accepted   — did the scheme + secret verify?
//        ledger_recorded      — did the event land in Convex (idempotency)?
//
// PASS means: endpoint reachable + SAFEPAY_WEBHOOK_SECRET matches the secret
// used for signing + the Convex webhook ledger works. If a REAL Safepay
// delivery still fails after this passes, the sandbox dashboard's endpoint
// URL or ITS shared secret is wrong (different environment's secret).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { requireAdminAccess, serverToken, convexQuery, convexMutation, jsonError, appUrl } from "@/lib/billing-server";
import { getSafepayConfig } from "@/lib/safepay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const config = getSafepayConfig();
    if (!config.webhookSecret) {
      return jsonError(
        503,
        "SAFEPAY_WEBHOOK_SECRET is not configured on this deployment — the webhook route rejects every delivery (fail-closed). Set it to the dashboard's Webhook Shared Secret (Developers → Endpoints) and redeploy.",
        "WEBHOOK_SECRET_MISSING"
      );
    }

    const stamp = Date.now();
    const eventId = `evt_selftest_${stamp}`;
    const tracker = `track_selftest_${stamp}`;
    // Mirrors the documented real payload: token/type/data with tracker,
    // state, metadata.order_id — but for a tracker that cannot match any
    // payment, so the webhook route records it and ignores it safely.
    const payload = {
      token: eventId,
      type: "payment.succeeded",
      created_at: new Date().toISOString(),
      data: {
        tracker,
        state: "TRACKER_ENDED",
        metadata: { order_id: "selftest" },
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac("sha512", config.webhookSecret).update(rawBody, "utf8").digest("hex");

    const target = `${appUrl()}/api/webhooks/safepay`;
    let httpStatus: number | null = null;
    let responseBody: Record<string, unknown> | null = null;
    let reached = false;
    let requestError: string | undefined;

    try {
      const res = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-SFPY-SIGNATURE": signature,
        },
        body: rawBody,
        cache: "no-store",
      });
      httpStatus = res.status;
      reached = true;
      responseBody = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    } catch (err) {
      requestError = err instanceof Error ? err.message : "request failed";
    }

    // The pipeline is healthy when the route answered 200 AND the ledger has
    // our self-test event recorded (idempotency row created by beginWebhookEvent).
    let ledgerRecorded = false;
    if (reached && httpStatus === 200) {
      try {
        const rows = await convexQuery<Array<{ eventId: string }>>("billing:adminListWebhookEvents", {
          serverToken: serverToken(),
          limit: 10,
        });
        ledgerRecorded = (rows ?? []).some((e) => e.eventId === eventId);
      } catch {
        ledgerRecorded = false;
      }
    }

    const pass = reached && httpStatus === 200 && ledgerRecorded;

    await convexMutation("billing:writeAuditLog", {
      serverToken: serverToken(),
      actorId: admin.data.adminUserId,
      actorType: "admin",
      action: "billing.webhook_self_test",
      targetType: "webhook",
      targetId: eventId,
      metadata: {
        target,
        pass,
        httpStatus,
        ledgerRecorded,
      },
    }).catch(() => null);

    return NextResponse.json({
      success: pass,
      data: {
        pass,
        target,
        reachable: reached,
        httpStatus,
        signatureScheme: "HMAC-SHA512 hex over raw body (X-SFPY-SIGNATURE)",
        signature_accepted: reached && httpStatus === 200,
        ledgerRecorded,
        routeResponse: responseBody,
        requestError,
        message: pass
          ? "PASS — the webhook route is reachable, the signature scheme + SAFEPAY_WEBHOOK_SECRET verify, and the Convex ledger records deliveries. If a REAL Safepay payment still doesn't sync, the SANDBOX dashboard's endpoint URL or its shared secret is misconfigured (they are separate from production)."
          : reached
            ? `FAIL — the route answered HTTP ${httpStatus}: ${JSON.stringify(responseBody ?? requestError)}. If 401: the signature check rejected the self-test, which means SAFEPAY_WEBHOOK_SECRET on Vercel doesn't match the secret this deployment signed with (impossible unless env changed mid-flight) — check Vercel env + redeploy.`
            : `FAIL — could not reach ${target}: ${requestError}. Check the deployment domain (NEXT_PUBLIC_APP_URL) and that the route is deployed.`,
      },
    });
  } catch (error) {
    console.error("[API /admin/billing/webhook-self-test] Error:", error);
    const message = error instanceof Error ? error.message : "Self-test failed";
    return jsonError(500, message, "SELF_TEST_ERROR");
  }
}
