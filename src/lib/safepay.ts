// =============================================================================
// FILO × SAFEPAY — Server-side client (NEVER import from client code)
// =============================================================================
// Responsibilities:
//   1. Create sandbox checkout sessions (returns a hosted payment URL).
//   2. Verify webhook signatures (HMAC-SHA256 over the raw request body).
//   3. Verify the signature Safepay POSTs back to our redirect_url.
//   4. Normalize Safepay event payloads into a small typed shape for the
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
// OFFICIAL API CONTRACT (mirrors @sfpy/node-sdk):
//   One-time payment (default flow):
//     POST {api}/order/v1/init
//       body: { client: <secret key>, amount, currency, environment }
//       → { data: { token: "track_..." } }
//     Hosted page: {checkout}/pay?beacon={token}&env=...&order_id=...
//                  &redirect_url=...&cancel_url=...&source=custom&webhooks=true
//   Subscription checkout (requires SAFEPAY_V1_SECRET + a Safepay plan id):
//     POST {api}/client/passport/v1/token   (header X-SFPY-MERCHANT-SECRET)
//       → { data: <auth token> }
//     Hosted page: {checkout}/subscribe?plan_id=...&auth_token=...&env=...
//                  &redirect_url=...&cancel_url=...
//
// ENV:
//   SAFEPAY_MODE=sandbox|production              (default: sandbox)
//   SAFEPAY_BEACON_SECRET=sec_xxx                (merchant secret key — required)
//   SAFEPAY_V1_SECRET=xxx                        (merchant v1 secret — enables
//                                                the true subscription flow)
//   SAFEPAY_WEBHOOK_SECRET=whsec_xxx             (webhook signing secret)
//   SAFEPAY_ALLOW_UNSIGNED_WEBHOOKS=false        (dev escape hatch, default false)
// =============================================================================

import { createHmac, timingSafeEqual } from "crypto";

export type SafepayMode = "sandbox" | "production";

const SANDBOX_API = "https://sandbox.api.getsafepay.com";
const PRODUCTION_API = "https://api.getsafepay.com";
// Official hosted checkout bases (SDK constants CHECKOUT_SANDBOX / _PRODUCTION).
const SANDBOX_CHECKOUT = "https://sandbox.api.getsafepay.com/checkout";
const PRODUCTION_CHECKOUT = "https://getsafepay.com/checkout";

export function getSafepayMode(): SafepayMode {
  return (process.env.SAFEPAY_MODE || "sandbox").toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

export function isSafepayConfigured(): boolean {
  return Boolean(process.env.SAFEPAY_BEACON_SECRET);
}

/** True when the true recurring-subscription flow can be used. */
export function isSubscriptionFlowConfigured(): boolean {
  return Boolean(process.env.SAFEPAY_V1_SECRET);
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
  /** Full URL Safepay redirects to after payment (POSTs tracker + signature). */
  redirectUrl?: string;
  /** Full URL Safepay redirects to when the payer cancels. */
  cancelUrl?: string;
  /** Opaque state echoed back to our return URL as query params. */
  state?: Record<string, string>;
}

export interface CheckoutSession {
  token: string;
  paymentUrl: string;
  trackingId?: string;
  /** Which Safepay flow was used (diagnostics + admin monitor). */
  flow: "subscription" | "one_time";
  raw: unknown;
}

/**
 * Create a Safepay checkout session and return the hosted payment URL.
 *
 * Flow selection:
 *   1. SUBSCRIPTION — when a Safepay plan id is mapped AND SAFEPAY_V1_SECRET
 *      is configured. Uses the official passport-token + /checkout/subscribe
 *      flow so Safepay handles recurring renewals.
 *   2. ONE-TIME — official /order/v1/init flow (works with just the secret
 *      key). The first period is charged now; the verified webhook activates
 *      the Filo subscription. Renewal reminders/collection are then handled
 *      by switching the plan to the subscription flow once SAFEPAY_V1_SECRET
 *      and dashboard plan ids are configured.
 */
export async function createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
  const beaconSecret = process.env.SAFEPAY_BEACON_SECRET;
  if (!beaconSecret) {
    throw new Error("SAFEPAY_BEACON_SECRET is not configured — billing is disabled (fail-closed)");
  }

  // ---- 1. True subscription flow when fully configured ----
  if (input.subscriptionPlanId && isSubscriptionFlowConfigured()) {
    try {
      const session = await createSubscriptionCheckout(input, beaconSecret);
      return session;
    } catch (err) {
      // Fall through to the one-time flow so the customer is never hard
      // blocked by a transient passport/plan error — but log loudly.
      console.error(
        `[SAFEPAY] subscription checkout failed (plan=${input.subscriptionPlanId}); falling back to one-time payment:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // ---- 2. Official one-time payment flow ----
  return createOneTimeCheckout(input, beaconSecret);
}

/** Official subscription flow: passport token → /checkout/subscribe URL. */
async function createSubscriptionCheckout(
  input: CheckoutSessionInput,
  _beaconSecret: string
): Promise<CheckoutSession> {
  const v1Secret = process.env.SAFEPAY_V1_SECRET;
  if (!v1Secret) throw new Error("SAFEPAY_V1_SECRET is not configured");

  const tokenRes = await fetch(`${apiBase()}/client/passport/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SFPY-MERCHANT-SECRET": v1Secret,
    },
    body: JSON.stringify({}),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => "");
    throw new Error(`Safepay passport token failed (${tokenRes.status}): ${text.slice(0, 300)}`);
  }

  const tokenJson = (await tokenRes.json().catch(() => null)) as { data?: unknown } | null;
  const authToken =
    typeof tokenJson?.data === "string"
      ? tokenJson.data
      : typeof tokenJson?.data === "object" && tokenJson?.data && "token" in (tokenJson.data as Record<string, unknown>)
        ? String((tokenJson.data as Record<string, unknown>).token)
        : undefined;
  if (!authToken) {
    throw new Error("Safepay passport token returned no auth token");
  }

  const url = new URL(`${checkoutPageBase()}/subscribe`);
  url.searchParams.set("plan_id", input.subscriptionPlanId!);
  url.searchParams.set("auth_token", authToken);
  url.searchParams.set("env", getSafepayMode());
  if (input.redirectUrl) url.searchParams.set("redirect_url", input.redirectUrl);
  if (input.cancelUrl) url.searchParams.set("cancel_url", input.cancelUrl);
  if (input.state) {
    for (const [k, v] of Object.entries(input.state)) url.searchParams.set(k, v);
  }

  return {
    token: authToken,
    paymentUrl: url.toString(),
    trackingId: undefined,
    flow: "subscription",
    raw: { authToken: true },
  };
}

/** Official one-time flow: /order/v1/init → /checkout/pay URL. */
async function createOneTimeCheckout(
  input: CheckoutSessionInput,
  beaconSecret: string
): Promise<CheckoutSession> {
  const res = await fetch(`${apiBase()}/order/v1/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client: beaconSecret,
      amount: input.amountPkr, // PKR in major units (rupees)
      currency: "PKR",
      environment: getSafepayMode(),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Safepay order/v1/init failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json().catch(() => null)) as
    | { data?: { token?: string; tracking_id?: string } ; token?: string; tracking_id?: string; error?: unknown }
    | null;

  const token = json?.data?.token ?? json?.token;
  if (!token) {
    throw new Error("Safepay order/v1/init returned no payment token");
  }
  const trackingId = json?.data?.tracking_id ?? json?.tracking_id;

  const url = new URL(`${checkoutPageBase()}/pay`);
  url.searchParams.set("beacon", token);
  url.searchParams.set("env", getSafepayMode());
  url.searchParams.set("source", "custom");
  url.searchParams.set("webhooks", "true");
  if (input.orderId) url.searchParams.set("order_id", input.orderId);
  if (input.redirectUrl) url.searchParams.set("redirect_url", input.redirectUrl);
  if (input.cancelUrl) url.searchParams.set("cancel_url", input.cancelUrl);
  if (input.customerEmail) url.searchParams.set("email", input.customerEmail);
  if (input.customerName) url.searchParams.set("name", input.customerName);
  if (input.customerPhone) url.searchParams.set("phone", input.customerPhone);
  if (input.state) {
    for (const [k, v] of Object.entries(input.state)) url.searchParams.set(k, v);
  }

  return {
    token,
    paymentUrl: url.toString(),
    trackingId,
    flow: "one_time",
    raw: json,
  };
}

// -----------------------------------------------------------------------------
// Return-redirect signature (Safepay POSTs tracker + signature to redirect_url)
// -----------------------------------------------------------------------------

/**
 * Verify the signature Safepay POSTs (form-encoded) to our redirect_url:
 * HMAC-SHA256 over the tracker token.
 *
 * Which secret signs the redirect differs across Safepay integrations:
 *   - official integration gist: the merchant SECRET KEY (beacon secret)
 *   - @sfpy/node-sdk Verify.signature(): the v1 secret
 *   - official WooCommerce plugin: the webhook shared secret
 * All three are server-only secrets, so accepting a match against ANY of the
 * configured ones preserves the security model while staying compatible with
 * however the merchant's dashboard is wired.
 */
export function verifyReturnSignature(tracker: string, signature: string | null | undefined): boolean {
  if (!tracker || !signature) return false;
  const secrets = [
    process.env.SAFEPAY_BEACON_SECRET,
    process.env.SAFEPAY_V1_SECRET,
    process.env.SAFEPAY_WEBHOOK_SECRET,
  ].filter((s): s is string => Boolean(s));
  if (secrets.length === 0) return false;
  const provided = signature.trim().toLowerCase();
  return secrets.some((secret) => {
    const expected = createHmac("sha256", secret).update(tracker, "utf8").digest("hex");
    return safeCompare(provided, expected);
  });
}

// -----------------------------------------------------------------------------
// Tracker state — server-to-server payment verification (Fetch Tracker API)
// -----------------------------------------------------------------------------
// GET {api}/reporter/api/v1/payments/{tracker} returns the live state of a
// payment tracker. This is the reconciliation path that unblocks customers
// when webhook delivery is delayed or misconfigured:
//   https://safepay-docs.netlify.app/concepts/fetch-tracker

export type TrackerOutcome =
  | { kind: "paid"; state: string }
  | { kind: "pending"; state: string }
  | { kind: "failed"; state: string }
  | { kind: "refunded"; state: string }
  | { kind: "disputed"; state: string }
  | { kind: "unknown"; state?: string };

export interface TrackerFetchResult {
  /** True when Safepay answered with a parseable tracker document. */
  ok: boolean;
  outcome: TrackerOutcome;
  error?: string;
}

const PAID_STATES = new Set(["TRACKER_ENDED"]);
const PENDING_STATES = new Set(["TRACKER_STARTED", "TRACKER_AUTHORIZED", "TRACKER_ENROLLED"]);
const FAILED_STATES = new Set([
  "TRACKER_CANCELLED",
  "TRACKER_EXPIRED",
  "TRACKER_VOIDED",
  "TRACKER_REVERSED",
]);

export function classifyTrackerState(state: string | undefined | null): TrackerOutcome {
  const s = (state ?? "").toUpperCase();
  if (PAID_STATES.has(s)) return { kind: "paid", state: s };
  if (PENDING_STATES.has(s)) return { kind: "pending", state: s || "UNKNOWN" };
  if (FAILED_STATES.has(s)) return { kind: "failed", state: s || "UNKNOWN" };
  if (s === "TRACKER_REFUNDED" || s === "TRACKER_PARTIAL_REFUND") return { kind: "refunded", state: s };
  if (s === "TRACKER_DISPUTED") return { kind: "disputed", state: s };
  return { kind: "unknown", state: s || undefined };
}

/**
 * Ask Safepay (server-to-server) for the current state of a payment tracker.
 *
 * AUTH (verified against the live sandbox API): the reporter endpoint rejects
 * anonymous calls with 401 and its error enumerates the accepted strategies —
 * one of them is `strategies/secret`, which reads the **X-SFPY-MERCHANT-SECRET**
 * header (proven: sending that header changes the error from
 * "merchant webhook secret not found in the request header" to
 * "could not fetch client"). The docs' unauthenticated curl example is stale.
 *
 * Which merchant secret value satisfies the lookup isn't documented, so we
 * try each configured secret — the first that resolves the client wins.
 */
export async function fetchTrackerState(tracker: string): Promise<TrackerFetchResult> {
  if (!tracker || !tracker.startsWith("track_")) {
    return { ok: false, outcome: { kind: "unknown" }, error: "invalid tracker token" };
  }
  const url = `${apiBase()}/reporter/api/v1/payments/${encodeURIComponent(tracker)}`;

  const secretCandidates: Array<[string, string | undefined]> = [
    ["merchant-secret:beacon", process.env.SAFEPAY_BEACON_SECRET],
    ["merchant-secret:v1", process.env.SAFEPAY_V1_SECRET],
    ["merchant-secret:webhook", process.env.SAFEPAY_WEBHOOK_SECRET],
    ["anonymous", undefined],
  ];

  const rejections: string[] = [];
  for (const [label, secret] of secretCandidates) {
    if (!secret && label !== "anonymous") {
      rejections.push(`${label}: not configured`);
      continue;
    }
    try {
      const res = await fetch(url, {
        headers: secret ? { "X-SFPY-MERCHANT-SECRET": secret } : {},
        cache: "no-store",
      });
      if (!res.ok) {
        rejections.push(`${label}: HTTP ${res.status}`);
        continue; // try the next auth variant
      }
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; data?: { state?: string }; state?: string; error?: unknown }
        | null;
      const state = json?.data?.state ?? json?.state;
      if (!state) {
        return { ok: false, outcome: { kind: "unknown" }, error: "no state in Safepay response" };
      }
      return { ok: true, outcome: classifyTrackerState(state) };
    } catch (err) {
      rejections.push(`${label}: ${err instanceof Error ? err.message : "fetch failed"}`);
    }
  }
  // Report EVERY variant so the operator can see exactly what was tried —
  // "anonymous rejected" alone hid the fact that the configured secrets were
  // also rejected (or that webhook/v1 secrets were never set at all).
  const error = `Safepay tracker API rejected all auth variants — ${rejections
    .join(" · ")
    .slice(0, 400)}${
    rejections.some((r) => r.includes("not configured"))
      ? " — set SAFEPAY_WEBHOOK_SECRET (and optionally SAFEPAY_V1_SECRET) from your Safepay dashboard on this deployment"
      : ""
  }`;
  return { ok: false, outcome: { kind: "unknown" }, error };
}

// -----------------------------------------------------------------------------
// Webhook verification
// -----------------------------------------------------------------------------

const SIGNATURE_HEADERS = [
  "x-sfpay-signature",
  "x-safepay-signature",
  "x-sfpy-signature",
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
 * Verify a Safepay webhook request.
 *
 * Scheme A (OFFICIAL @sfpy/node-sdk v3 — Verify.webhook()):
 *   hex(HMAC-SHA512(webhookSecret, JSON.stringify(parsedBody.data)))
 *   sent in the `x-sfpy-signature` header.
 *
 * Scheme B (legacy/fallback):
 *   HMAC-SHA256 over the raw body bytes vs any known signature header,
 *   hex or base64, with or without a `v1=`/`sha256=` prefix.
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

  const candidates = provided
    .split(",")
    .map((part) => part.trim())
    .flatMap((part) => {
      const stripped = part.replace(/^(v1|sha256|hmac-sha256|hmac-sha512)\s*=\s*/i, "");
      return [part, stripped];
    });

  // ---- Scheme A: official SDK (SHA-512 over JSON.stringify(body.data)) ----
  try {
    const parsed = JSON.parse(rawBody) as { data?: unknown };
    if (parsed && typeof parsed === "object" && "data" in parsed) {
      const dataJson = JSON.stringify(parsed.data);
      const expectedSha512Hex = createHmac("sha512", secret).update(dataJson, "utf8").digest("hex");
      const expectedSha512B64 = createHmac("sha512", secret).update(dataJson, "utf8").digest("base64");
      for (const candidate of candidates) {
        if (
          safeCompare(candidate.toLowerCase(), expectedSha512Hex.toLowerCase()) ||
          safeCompare(candidate, expectedSha512B64)
        ) {
          return { verified: true };
        }
      }
    }
  } catch {
    // body is not JSON — scheme A cannot apply
  }

  // ---- Scheme B: HMAC-SHA256 over the raw body ----
  const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedB64 = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

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
