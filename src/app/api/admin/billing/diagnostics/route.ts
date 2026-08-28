// =============================================================================
// GET /api/admin/billing/diagnostics
// =============================================================================
// ADMIN BILLING DIAGNOSTICS — one call that answers "why isn't this payment
// syncing?" without digging through Vercel logs or the Convex dashboard.
//
// Returns (admin-gated, no secret values):
//   - config: Safepay mode, secret/webhook-secret presence, payment model
//   - webhookEvents: the last 10 deliveries (type, processing status, error)
//   - billingAudit: the last 15 billing.* audit-log entries
//   - pendingCheckouts: every pending payment with tracker state
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess, serverToken, convexQuery, jsonError } from "@/lib/billing-server";
import { getSafepayConfig, getPaymentModel, getSafepayMode } from "@/lib/safepay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WebhookEventRow {
  _id: string;
  eventId: string;
  eventType: string;
  processingStatus: string;
  error?: string;
  receivedAt: number;
}

interface AuditRow {
  _id: string;
  action: string;
  actorType: string;
  targetType?: string;
  targetId?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

interface PaymentRow {
  _id: string;
  userId: string;
  subscriptionId?: string;
  planId?: string;
  status: string;
  amount: number;
  currency: string;
  safepayTrackingId?: string;
  safepayPaymentToken?: string;
  createdAt: number;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const config = getSafepayConfig();
    const token = serverToken();

    const [webhookEvents, audit, payments] = await Promise.all([
      convexQuery<WebhookEventRow[]>("billing:adminListWebhookEvents", {
        serverToken: token,
        limit: 10,
      }),
      convexQuery<AuditRow[]>("billing:adminListAuditLogs", {
        serverToken: token,
        limit: 15,
      }),
      convexQuery<PaymentRow[]>("billing:adminListPayments", {
        serverToken: token,
        limit: 25,
      }),
    ]);

    const pending = (payments ?? []).filter((p) => p.status === "pending");

    return NextResponse.json({
      success: true,
      data: {
        config: {
          mode: getSafepayMode(),
          paymentModel: getPaymentModel(),
          secretKeyConfigured: Boolean(config.secretKey),
          webhookSecretConfigured: Boolean(config.webhookSecret),
          publicKeyConfigured: Boolean(config.publicKey),
        },
        webhookEvents: (webhookEvents ?? []).map((e) => ({
          eventId: e.eventId,
          eventType: e.eventType,
          status: e.processingStatus,
          error: e.error ?? null,
          receivedAt: e.receivedAt,
        })),
        billingAudit: (audit ?? [])
          .filter((a) => a.action.startsWith("billing.") || a.action.startsWith("subscription.") || a.action.startsWith("payment."))
          .map((a) => ({
            action: a.action,
            actorType: a.actorType,
            targetId: a.targetId ?? null,
            createdAt: a.createdAt,
            metadata: a.metadata ?? null,
          })),
        pendingCheckouts: pending.map((p) => ({
          paymentId: p._id,
          userId: p.userId,
          subscriptionId: p.subscriptionId ?? null,
          amount: p.amount,
          currency: p.currency,
          hasTracker: Boolean(p.safepayTrackingId && p.safepayTrackingId.startsWith("track_")),
          hasPaymentToken: Boolean(p.safepayPaymentToken),
          createdAt: p.createdAt,
        })),
        summary: {
          pendingPayments: pending.length,
          webhookEventsRecorded: (webhookEvents ?? []).length,
          webhookHint:
            (webhookEvents ?? []).length === 0
              ? "NO webhook events have EVER arrived. Check the SAFEPAY SANDBOX dashboard → Developers → Endpoints: the URL must be exactly {app}/api/webhooks/safepay and the shared secret must match SAFEPAY_WEBHOOK_SECRET on Vercel. Then run the Webhook self-test (Admin → Plans)."
              : undefined,
        },
      },
    });
  } catch (error) {
    console.error("[API /admin/billing/diagnostics] Error:", error);
    const message = error instanceof Error ? error.message : "Diagnostics failed";
    return jsonError(500, message, "DIAGNOSTICS_ERROR");
  }
}
