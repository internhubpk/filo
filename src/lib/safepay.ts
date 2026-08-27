// =============================================================================
// FILO × SAFEPAY — Server-side sandbox client (NEVER import from client code)
// =============================================================================
// Responsibilities:
//   1. Create sandbox checkout sessions (returns a hosted payment URL).
//   2. Verify webhook signatures (HMAC-SHA256 over the raw request body).
//   3. Normalize Safepay event payloads into a small typed shape for the
//      billing state machine in convex/billing.ts.
//
// SECURITY:
//   - Runs exclusively on the server (API routes). Secret keys never reach
//     the browser.
//   - Fail-closed: if SAFEPAY_BEACON_SECRET is missing, checkout throws.
//   - Webhook signatures are REQUIRED (SAFEPAY_WEBHOOK_SECRET). Setting
//     SAFEPAY_ALLOW_UNSIGNED_WEBHOOKS=true weakens this for local curl
//     testing ONLY — never enable in production.
//
// ENV:
//   SAFEPAY_MODE=sandbox|production           (default: sandbox)
//   SAFEPAY_BEACON_SECRET=sec_xxx             (merchant secret key)
//   SAFEPAY_WEBHOOK_SECRET=whsec_xxx          (webhook signing secret)
//   SAFEPAY_ALLOW_UNSIGNED_WEBHOOKS=false     (dev escape hatch, default false)
// =============================================================================

import { createHmac, timingSafeEqual } from "crypto";

export type SafepayMode = "sandbox" | "production";

const SANDBOX_API = "https://sandbox.api.getsafepay.com";
const PRODUCTION_API = "https://api.getsafepay.com";
const SANDBOX_CHECKOUT = "https://sandbox.getsafepay.com/payment";
const PRODUCTION_CHECKOUT = "https://getsafepay.com/payment";

export function getSafepayMode(): SafepayMode {
  return (process.env.SAFEPAY_MODE || "sandbox").toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

export function isSafepayConfigured(): boolean {
  return Boolean(process.env.SAFEPAY_BEACON_SECRET);
}

function apiBase(): string {
  return getSafepayMode() === "production" ? PRODUCTION_API : SANDBOX_API;
}

export function checkoutPageBase(): string {
  return getSafepayMode() === "production" ? PRODUCTION_CHECKOUT : SANDBOX_CHECKOUT;
}

// -----------------------------------------------------------------------------
// Checkout session creation
// -----------------------------------------------------------------------------

export interface CheckoutSessionInput {
  amountPkr: number;
  orderId: string;          // Filo subscription id (Convex)
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  /** Safepay subscription plan identifier (for recurring subscription checkouts). */
  subscriptionPlanId?: string;
  /** Opaque state echoed back to our return URL. */
  state?: Record<string, string>;
}

export interface CheckoutSession {
  token: string;
  paymentUrl: string;
  trackingId?: string;
  raw: unknown;
}

/**
 * Create a Safepay checkout session and return the hosted payment URL.
 *
 * Uses the documented /checkout/create flow: authenticate with the merchant
 * beacon secret, receive a one-time payment token, then redirect the user to
 * the hosted payment page. `subscription_plan` links the checkout to a
 * recurring plan configured in the Safepay merchant dashboard.
 */
export async function createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
  const beaconSecret = process.env.SAFEPAY_BEACON_SECRET;
  if (!beaconSecret) {
    throw new Error("SAFEPAY_BEACON_SECRET is not configured — billing is disabled (fail-closed)");
  }

  const body: Record<string, unknown> = {
    beacon_secret: beaconSecret,
    amount: Math.round(input.amountPkr), // PKR, whole rupees
    currency: "PKR",
  };
  if (input.subscriptionPlanId) body.subscription_plan = input.subscriptionPlanId;
  if (input.orderId) body.order_id = input.orderId;

  const res = await fetch(`${apiBase()}/checkout/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Safepay checkout/create failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json().catch(() => null)) as
    | { token?: string; tracking_id?: string; result?: string; error?: unknown }
    | null;

  if (!json?.token) {
    throw new Error("Safepay checkout/create returned no payment token");
  }

  const url = new URL(`${checkoutPageBase()}/${json.token}`);
  if (input.customerEmail) url.searchParams.set("email", input.customerEmail);
  if (input.customerName) url.searchParams.set("name", input.customerName);
  if (input.customerPhone) url.searchParams.set("phone", input.customerPhone);
  if (input.state) {
    for (const [k, v] of Object.entries(input.state)) url.searchParams.set(k, v);
  }

  return {
    token: json.token,
    paymentUrl: url.toString(),
    trackingId: json.tracking_id,
    raw: json,
  };
}

// -----------------------------------------------------------------------------
// Webhook verification
// -----------------------------------------------------------------------------

const SIGNATURE_HEADERS = [
  "x-sfpay-signature",
  "x-safepay-signature",
  "x-sfpay-hmac",
  "x-signature",
];

function extractSignature(headers: Headers): string | null {
  for (const name of SIGNATURE_HEADERS) {
    const value = headers.get(name);
    if (value) return value.trim();
  }
  return null;
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Verify a Safepay webhook request. Signatures are HMAC-SHA256 over the raw
 * body bytes, compared against every known Safepay signature header. Accepts
 * hex or base64 encodings, with or without a `v1=`/`sha256=` prefix.
 *
 * Returns { verified: true } or { verified: false, reason }.
 */
export function verifyWebhookSignature(rawBody: string, headers: Headers): { verified: boolean; reason?: string } {
  const secret = process.env.SAFEPAY_WEBHOOK_SECRET;

  if (!secret) {
    if (process.env.SAFEPAY_ALLOW_UNSIGNED_WEBHOOKS === "true") {
      console.warn("[SAFEPAY WEBHOOK] signature check SKIPPED (SAFEPAY_ALLOW_UNSIGNED_WEBHOOKS=true)");
      return { verified: true };
    }
    return { verified: false, reason: "SAFEPAY_WEBHOOK_SECRET is not configured (fail-closed)" };
  }

  const provided = extractSignature(headers);
  if (!provided) {
    return { verified: false, reason: "missing signature header" };
  }

  const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedB64 = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  const candidates = provided
    .split(",")
    .map((part) => part.trim())
    .flatMap((part) => {
      const stripped = part.replace(/^(v1|sha256|hmac-sha256)\s*=\s*/i, "");
      return [part, stripped];
    });

  for (const candidate of candidates) {
    if (safeCompare(candidate.toLowerCase(), expectedHex) || safeCompare(candidate, expectedB64)) {
      return { verified: true };
    }
  }
  return { verified: false, reason: "signature mismatch" };
}

// -----------------------------------------------------------------------------
// Event normalization
// -----------------------------------------------------------------------------

export interface NormalizedEvent {
  /** Normalized dotted event type, e.g. "payment.succeeded". */
  eventType: string;
  /** Stable unique event id for idempotency. */
  eventId: string;
  trackingId?: string;
  paymentToken?: string;
  safepaySubscriptionId?: string;
  customerId?: string;
  customerEmail?: string;
  amountPkr?: number;
  currency?: string;
  paymentMethod?: string;
  failureReason?: string;
  /** Everything else (sanitized of secret-looking keys) for the audit trail. */
  meta: Record<string, unknown>;
}

const SECRET_KEY_PATTERN = /(secret|password|token_key|beacon|api_key|apikey|signature)/i;

export function sanitizePayload(payload: unknown, depth = 0): Record<string, unknown> {
  if (depth > 4 || payload === null || typeof payload !== "object") {
    return typeof payload === "object" && payload !== null ? {} : { value: payload as never };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitizePayload(v, depth + 1);
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 20);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function pick(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

/**
 * Normalize any of Safepay's event shapes (colon or dot notation, flat or
 * nested data payloads) into one typed structure. Unknown events are passed
 * through with their normalized type so the state machine can ignore them
 * explicitly (recorded, status "ignored").
 */
export function normalizeWebhookEvent(payload: Record<string, unknown>): NormalizedEvent {
  const rawType =
    (pick(payload, "event_type", "type", "event", "name") || "unknown").replace(/:/g, ".").toLowerCase();

  const data = (payload.data ?? payload.body ?? payload.object ?? payload) as Record<string, unknown>;
  const payment = (data.payment ?? data) as Record<string, unknown>;
  const subscription = (data.subscription ?? payment.subscription ?? {}) as Record<string, unknown>;
  const customer = (data.customer ?? payment.customer ?? {}) as Record<string, unknown>;

  // Event id: prefer Safepay's, else derive a stable id from type+tracking.
  const trackingId = pick(payment, "tracking_id", "track_id", "trackingId");
  const derivedId = `${rawType}:${trackingId ?? pick(payment, "token") ?? JSON.stringify(payload).slice(0, 64)}`;
  const eventId = pick(payload, "id", "event_id", "eventId", "uuid") ?? derivedId;

  const amountRaw = payment.amount ?? data.amount ?? payload.amount;
  const amountPkr = typeof amountRaw === "number" ? amountRaw : typeof amountRaw === "string" ? parseFloat(amountRaw) || undefined : undefined;

  return {
    eventType: rawType,
    eventId,
    trackingId,
    paymentToken: pick(payment, "token", "payment_token"),
    safepaySubscriptionId: pick(subscription, "id", "subscription_id", "plan") || pick(data, "subscription_id"),
    customerId: pick(customer, "id", "customer_id") || pick(data, "customer_id"),
    customerEmail: (pick(customer, "email") || pick(data, "email") || pick(payload, "email"))?.toLowerCase(),
    amountPkr,
    currency: pick(payment, "currency", "currency_iso") || pick(data, "currency") || "PKR",
    paymentMethod: pick(payment, "payment_method", "instrument", "source") || pick(data, "payment_method"),
    failureReason: pick(payment, "failure_reason", "error_message", "decline_reason") || pick(data, "reason"),
    meta: sanitizePayload(payload),
  };
}
