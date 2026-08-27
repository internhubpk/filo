// =============================================================================
// POST /api/webhooks/safepay
// =============================================================================
// THE ONLY path that can activate a paid subscription.
//
// Processing pipeline (per the billing spec):
//   1. Read the RAW body (signature is computed over exact bytes).
//   2. Verify the Safepay webhook signature (HMAC-SHA256, fail-closed).
//   3. Parse + normalize the event (colon/dot notation, nested payloads).
//   4. Idempotency: beginWebhookEvent returns "duplicate" for replayed event
//      ids — duplicates are recorded, never re-processed.
//   5. Resolve the Filo user (customer id → email → explicit state).
//   6. Map the event through the subscription state machine.
//   7. Upsert the payment record (idempotent by tracking id).
//   8. Record outcome (success/ignored/failed) on the webhook event row.
//
// GUARANTEES:
//   - Never trusts the browser. Only verified webhook payloads change state.
//   - Malformed payloads → 400 with the event recorded as failed (when an id
//     can be derived) so debugging is possible from the admin monitor.
//   - Every state transition is audited (auditLogs + webhookEvents).
//
// Supported events (normalized to dot notation):
//   payment:created | refund:created | error:occurred
//   payment.succeeded | payment.failed | payment.refunded
//   payment.disputed | payment.dispute.won | payment.dispute.lost
//   authorization.succeeded | authorization.reversed | void.succeeded
//   subscription.created | subscription.updated | subscription.canceled
//   subscription.ended | subscription.unpaid | subscription.paused
//   subscription.resumed | subscription.payment.succeeded | subscription.payment.failed
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature, normalizeWebhookEvent, type NormalizedEvent } from "@/lib/safepay";
import { serverToken, convexQuery, convexMutation } from "@/lib/billing-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WebhookUser {
  _id: string;
  email: string;
}

async function recordOutcome(
  eventDbId: string | null,
  status: "success" | "failed" | "ignored",
  extra: {
    error?: string;
    userId?: string;
    subscriptionId?: string;
    paymentId?: string;
  }
) {
  if (!eventDbId) return;
  try {
    await convexMutation("billing:finishWebhookEvent", {
      serverToken: serverToken(),
      eventDbId,
      status,
      error: extra.error,
      relatedUserId: extra.userId,
      relatedSubscriptionId: extra.subscriptionId,
      relatedPaymentId: extra.paymentId,
    });
  } catch (err) {
    console.error("[SAFEPAY WEBHOOK] failed to record outcome:", err);
  }
}

/** Apply subscription transitions with period bookkeeping. */
async function transitionSubscription(
  event: NormalizedEvent,
  sub: Record<string, unknown>,
  nextStatus: string,
  opts: { newPeriod?: boolean; cancelAtPeriodEnd?: boolean } = {}
): Promise<void> {
  const now = Date.now();
  const currentStart = typeof sub.currentPeriodStart === "number" ? sub.currentPeriodStart : undefined;
  const currentEnd = typeof sub.currentPeriodEnd === "number" ? sub.currentPeriodEnd : undefined;

  let periodStart: number | undefined;
  let periodEnd: number | undefined;
  if (opts.newPeriod) {
    periodStart = now;
    periodEnd = sub.interval === "yearly" ? now + 365 * 24 * 60 * 60 * 1000 : now + 30 * 24 * 60 * 60 * 1000;
  } else {
    periodStart = currentStart;
    periodEnd = currentEnd;
  }

  await convexMutation("billing:applySubscriptionTransition", {
    serverToken: serverToken(),
    subscriptionId: sub._id,
    nextStatus,
    eventType: event.eventType,
    safepaySubscriptionId: event.safepaySubscriptionId,
    safepayCustomerId: event.customerId,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: opts.cancelAtPeriodEnd,
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // ---- 1. Signature verification (fail-closed) ----
  const signature = verifyWebhookSignature(rawBody, request.headers);
  if (!signature.verified) {
    console.error("[SAFEPAY WEBHOOK] REJECTED:", signature.reason);
    // 401 so Safepay retries with correct configuration; no state recorded
    // because an unverified payload must not even enter the ledger.
    return NextResponse.json(
      { success: false, error: "Webhook signature verification failed" },
      { status: 401 }
    );
  }

  // ---- 2. Parse ----
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("[SAFEPAY WEBHOOK] malformed JSON body");
    return NextResponse.json({ success: false, error: "Malformed JSON" }, { status: 400 });
  }

  const event = normalizeWebhookEvent(payload);
  console.info(`[SAFEPAY WEBHOOK] received ${event.eventType} (id=${event.eventId})`);

  // ---- 3. Idempotency gate ----
  let eventDbId: string | null = null;
  try {
    const begun = await convexMutation<{ duplicate: boolean; eventDbId: string }>("billing:beginWebhookEvent", {
      serverToken: serverToken(),
      eventId: event.eventId,
      eventType: event.eventType,
      payload: event.meta,
    });
    if (begun.duplicate) {
      console.info(`[SAFEPAY WEBHOOK] duplicate delivery ignored: ${event.eventId}`);
      return NextResponse.json({ success: true, duplicate: true });
    }
    eventDbId = begun.eventDbId;
  } catch (err) {
    console.error("[SAFEPAY WEBHOOK] idempotency check failed:", err);
    // 500 → Safepay will retry; no ledger row means the retry re-processes.
    return NextResponse.json({ success: false, error: "Processing unavailable" }, { status: 500 });
  }

  // ---- 4. Resolve the Filo user ----
  let user: WebhookUser | null = null;
  try {
    user = await convexQuery<WebhookUser | null>("billing:resolveUserForWebhook", {
      serverToken: serverToken(),
      customerId: event.customerId,
      email: event.customerEmail,
    });
  } catch (err) {
    console.error("[SAFEPAY WEBHOOK] user resolution failed:", err);
  }

  if (!user) {
    // Informational events may legitimately have no user (e.g. error:occurred
    // without customer context). Record as ignored so admins see them.
    console.warn(`[SAFEPAY WEBHOOK] no Filo user for event ${event.eventId} (${event.eventType})`);
    await recordOutcome(eventDbId, "ignored", { error: "no matching Filo user" });
    return NextResponse.json({ success: true, ignored: true });
  }

  // ---- 5. State machine ----
  try {
    const type = event.eventType;

    // Resolve the relevant subscription (created earlier at checkout time).
    const resolveSub = () =>
      convexQuery<Record<string, unknown> | null>("billing:resolveSubscriptionForWebhook", {
        serverToken: serverToken(),
        userId: user!._id,
        safepaySubscriptionId: event.safepaySubscriptionId,
      });

    // Convex optional validators accept undefined but NOT null — build the
    // arg object conditionally.
    const upsertPayment = (status: string, sub?: Record<string, unknown> | null) =>
      convexMutation<string>("billing:upsertPaymentFromWebhook", {
        serverToken: serverToken(),
        userId: user!._id,
        ...(sub ? { subscriptionId: String(sub._id), planId: String(sub.planId) } : {}),
        status,
        ...(event.trackingId ? { safepayTrackingId: event.trackingId } : {}),
        ...(event.paymentToken ? { safepayPaymentToken: event.paymentToken } : {}),
        ...(event.safepaySubscriptionId ? { safepaySubscriptionId: event.safepaySubscriptionId } : {}),
        ...(event.amountPkr !== undefined ? { amount: event.amountPkr } : {}),
        currency: event.currency || "PKR",
        ...(event.paymentMethod ? { paymentMethod: event.paymentMethod } : {}),
        ...(event.failureReason ? { failureReason: event.failureReason } : {}),
      });

    switch (type) {
      // ----- Payments -----
      case "payment.created": {
        const paymentId = await upsertPayment("pending");
        await recordOutcome(eventDbId, "success", { userId: user._id, paymentId });
        break;
      }
      case "payment.succeeded":
      case "subscription.payment.succeeded": {
        const sub = await resolveSub();
        if (sub) {
          // First success activates; renewals advance the period window.
          await transitionSubscription(event, sub, "active", { newPeriod: true, cancelAtPeriodEnd: false });
        }
        const paymentId = await upsertPayment("succeeded", sub);
        await recordOutcome(eventDbId, "success", {
          userId: user._id,
          subscriptionId: sub ? String(sub._id) : undefined,
          paymentId,
        });
        break;
      }
      case "payment.failed":
      case "subscription.payment.failed": {
        const sub = await resolveSub();
        if (sub) {
          if (sub.status === "pending") {
            // Initial payment failed → subscription never activated.
            await transitionSubscription(event, sub, "failed");
          } else if (sub.status === "active") {
            // Renewal failed → past_due; entitlement decision is explicit:
            // keep access until period end, but the UI shows past_due.
            await transitionSubscription(event, sub, "past_due");
          }
        }
        const paymentId = await upsertPayment("failed", sub);
        await recordOutcome(eventDbId, "success", {
          userId: user._id,
          subscriptionId: sub ? String(sub._id) : undefined,
          paymentId,
        });
        break;
      }

      // ----- Refunds / disputes -----
      case "payment.refunded":
      case "refund.created": {
        const paymentId = await upsertPayment("refunded");
        await recordOutcome(eventDbId, "success", { userId: user._id, paymentId });
        break;
      }
      case "payment.disputed": {
        const paymentId = await upsertPayment("disputed");
        await recordOutcome(eventDbId, "success", { userId: user._id, paymentId });
        break;
      }
      case "payment.dispute.won": {
        const paymentId = await upsertPayment("dispute_won");
        await recordOutcome(eventDbId, "success", { userId: user._id, paymentId });
        break;
      }
      case "payment.dispute.lost": {
        const paymentId = await upsertPayment("dispute_lost");
        await recordOutcome(eventDbId, "success", { userId: user._id, paymentId });
        break;
      }

      // ----- Subscription lifecycle -----
      case "subscription.created":
      case "subscription.updated": {
        const sub = await resolveSub();
        if (sub) {
          await transitionSubscription(event, sub, sub.status === "pending" ? "pending" : (sub.status as string), {
            cancelAtPeriodEnd: undefined,
          });
        }
        await recordOutcome(eventDbId, "success", {
          userId: user._id,
          subscriptionId: sub ? String(sub._id) : undefined,
        });
        break;
      }
      case "subscription.canceled": {
        const sub = await resolveSub();
        if (sub && ["active", "past_due", "paused"].includes(String(sub.status))) {
          await transitionSubscription(event, sub, "canceled", { cancelAtPeriodEnd: true });
        }
        await recordOutcome(eventDbId, "success", {
          userId: user._id,
          subscriptionId: sub ? String(sub._id) : undefined,
        });
        break;
      }
      case "subscription.ended": {
        const sub = await resolveSub();
        if (sub) {
          await transitionSubscription(event, sub, "ended");
        }
        await recordOutcome(eventDbId, "success", {
          userId: user._id,
          subscriptionId: sub ? String(sub._id) : undefined,
        });
        break;
      }
      case "subscription.paused": {
        const sub = await resolveSub();
        if (sub && String(sub.status) === "active") {
          await transitionSubscription(event, sub, "paused");
        }
        await recordOutcome(eventDbId, "success", {
          userId: user._id,
          subscriptionId: sub ? String(sub._id) : undefined,
        });
        break;
      }
      case "subscription.resumed": {
        const sub = await resolveSub();
        if (sub && ["paused", "past_due"].includes(String(sub.status))) {
          await transitionSubscription(event, sub, "active");
        }
        await recordOutcome(eventDbId, "success", {
          userId: user._id,
          subscriptionId: sub ? String(sub._id) : undefined,
        });
        break;
      }
      case "subscription.unpaid": {
        const sub = await resolveSub();
        if (sub) {
          await transitionSubscription(event, sub, "unpaid");
        }
        await recordOutcome(eventDbId, "success", {
          userId: user._id,
          subscriptionId: sub ? String(sub._id) : undefined,
        });
        break;
      }

      // ----- Authorizations / voids (informational for card flows) -----
      case "authorization.succeeded":
      case "authorization.reversed":
      case "void.succeeded":
      case "error.occurred":
      default: {
        // Known-but-informational and unknown events are recorded and
        // explicitly ignored. No state changes.
        await recordOutcome(eventDbId, "ignored", {});
        break;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    console.error(`[SAFEPAY WEBHOOK] processing failed for ${event.eventId}:`, message);
    await recordOutcome(eventDbId, "failed", { error: message, userId: user._id });
    // 500 → Safepay retries. The ledger row exists, but its status is
    // "failed" (not "duplicate"), so the retry re-processes the event.
    return NextResponse.json({ success: false, error: "Webhook processing failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: "Method not allowed. This endpoint accepts POST webhooks only." },
    { status: 405 }
  );
}
