// =============================================================================
// FILO × SAFEPAY — Server-side client (NEVER import from client code)
// =============================================================================
// All environment access lives in ./config.ts — this file uses the config
// object only. Responsibilities:
//   1. Create checkout sessions (recurring subscription by default).
//   2. Verify the signed browser return (HMAC-SHA256 over the tracker).
//   3. Ask Safepay — server-to-server — for live tracker state (Fetch
//      Tracker API) and classify the answer.
//   4. Verify webhook signatures (HMAC-SHA512 over the payload, the CURRENT
//      documented scheme) and normalize event payloads.
//
// OFFICIAL API CONTRACT (verified Aug 2026 against safepay-docs.netlify.app,
// the official @sfpy/node-core SDK and the official WooCommerce plugin — NOT
// against this repository's old comments):
//
//   Credentials (dashboard → Developers): Public Key, Secret Key (sec_…),
//   Webhook Shared Secret. Mapping lives in ./config.ts.
//
//   Recurring subscription checkout (the model Filo sells):
//     POST {api}/client/passport/v1/token   (header X-SFPY-MERCHANT-SECRET:
//                                            Secret Key)
//       → { data: <auth token> }
//     Hosted page: {checkout}/subscribe?plan_id=…&auth_token=…&env=…
//                  &redirect_url=…&cancel_url=…
//     The plan MUST exist on Safepay (create via POST /client/plans/v1/ —
//     see /api/admin/billing/sync-safepay-plans — or the dashboard) and be
//     mapped on the Filo plan row (safepayPlanIdMonthly/Yearly).
//
//   One-time checkout (explicit operator opt-in via SAFEPAY_PAYMENT_MODEL):
//     POST {api}/order/v1/init  { client: <Secret Key>, amount, currency,
//                                 environment }
//       → { data: { token: "track_…" } }
//     Hosted page: {checkout}/pay?beacon={token}&env=…&order_id=…
//
//   IMPORTANT: pass a CLEAN redirect_url (no query string). Safepay appends
//   its fields as `?tracker=…&sig=…` and does NOT respect an existing query
//   string — extra state must ride on `order_id` (echoed back on the return
//   POST and in webhook payloads as data.metadata.order_id), not on the
//   redirect_url. (This exact bug previously produced
//   `…&interval=monthly?order_id=…` URLs.)
//
//   Signed return (proof of payment, per the official WooCommerce plugin):
//     sig = hex(HMAC-SHA256(WebhookSharedSecret, tracker)) POSTed with
//     tracker/order_id/reference to the redirect_url.
//
//   Fetch Tracker API (payment verification):
//     GET {api}/reporter/api/v1/payments/{tracker}
//     header: X-SFPY-MERCHANT-SECRET: <Secret Key>   (required — anonymous
//     calls 401; the docs' unauthenticated curl example is stale)
//     → { ok: true, data: { state: "TRACKER_ENDED" | … } }
//
//   Webhooks:
//     Header `X-SFPY-SIGNATURE` = hex(HMAC-SHA512(WebhookSharedSecret,
//     JSON payload)). Events: payment.succeeded | payment.failed |
//     payment.refunded | authorization.succeeded | authorization.reversed |
//     void.succeeded | subscription.created | subscription.canceled(led) |
//     subscription.ended | subscription.paused | subscription.resumed |
//     subscription.payment.succeeded | subscription.payment.failed.
//     Payload: { token: "evt_…", version, merchant_api_key, type, endpoint,
//                data: { tracker, state, metadata: { order_id }, … } }.
// =============================================================================

import { createHmac, timingSafeEqual } from "crypto";
import {
  getSafepayConfig,
  isSafepayConfigured as configIsConfigured,
  isSubscriptionFlowConfigured as configIsSubscriptionFlow,
  allowUnsignedWebhooks,
  getPaymentModel,
  getSafepayAuthDiagnostics,
  type SafepayMode,
} from "@/lib/safepay/config";
import {
  SafepayApiError,
  diagnoseSafepayFailure,
  suspectedPublicKeyError,
} from "@/lib/safepay/errors";

export { SafepayApiError, diagnosisPayload, diagnoseSafepayFailure, suspectedPublicKeyError } from "@/lib/safepay/errors";
export type { SafepayFailureDiagnosis, SafepayFailureKind } from "@/lib/safepay/errors";
export { getSafepayAuthDiagnostics, type SafepayAuthDiagnostics } from "@/lib/safepay/config";

export type { SafepayMode };

export function getSafepayMode(): SafepayMode {
  return getSafepayConfig().mode;
}

export function isSafepayConfigured(): boolean {
  return configIsConfigured();
}

/** True when the true recurring-subscription flow can be used. */
export function isSubscriptionFlowConfigured(): boolean {
  return configIsSubscriptionFlow();
}

export { getPaymentModel, getSafepayConfig };

// -----------------------------------------------------------------------------
// Checkout session creation
// -----------------------------------------------------------------------------

export interface CheckoutSessionInput {
  amountPkr: number;
  orderId: string;          // Filo subscription id (Convex) — echoed back as
                            // order_id on the return POST and in webhook
                            // metadata; carries our state SAFELY.
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  /** Safepay subscription plan identifier (for recurring subscription checkouts). */
  subscriptionPlanId?: string;
  /** Full URL Safepay redirects to after payment. MUST be query-free. */
  redirectUrl?: string;
  /** Full URL Safepay redirects to when the payer cancels. */
  cancelUrl?: string;
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
 * Model selection (explicit, never a silent downgrade):
 *   - SAFEPAY_PAYMENT_MODEL=one_time  → one-time order flow (tracker-backed
 *     verification), regardless of plan mapping.
 *   - otherwise (default)             → true recurring subscription flow;
 *     requires a mapped Safepay plan id. Errors propagate — if the passport
 *     token or the plan mapping is broken the operator sees the real error
 *     instead of a customer silently being charged once.
 */
export async function createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
  const config = getSafepayConfig();
  if (!config.secretKey) {
    throw new SafepayApiError({
      kind: "auth_secret_missing",
      status: 0,
      endpoint: "pre-flight",
      safepayErrors: [],
      message:
        "SAFEPAY_SECRET_KEY is not set on this deployment — checkout is fail-closed. " +
        "Set it to the dashboard's Private API Secret Key (Developers → API, the SECOND item) on Vercel, then redeploy.",
    });
  }
  // The Public API Key (sec_…) can NEVER authenticate as a merchant secret —
  // per the current docs only the public key carries that prefix. Failing here
  // gives the operator the exact fix instead of Safepay's generic 401.
  if (config.secretKey.toLowerCase().startsWith("sec_")) {
    throw suspectedPublicKeyError(config.mode);
  }

  if (getPaymentModel() === "one_time") {
    return createOneTimeCheckout(input, config.secretKey, config);
  }
  return createSubscriptionCheckout(input, config.secretKey, config);
}

/** Official subscription flow: passport token → /checkout/subscribe URL. */
async function createSubscriptionCheckout(
  input: CheckoutSessionInput,
  secretKey: string,
  config: ReturnType<typeof getSafepayConfig>
): Promise<CheckoutSession> {
  if (!input.subscriptionPlanId) {
    throw new Error(
      "This plan has no Safepay plan id mapped. Create the plans (Admin → Plans → Sync Safepay plans) and map them first."
    );
  }

  const tokenRes = await fetch(`${config.apiBase}/client/passport/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SFPY-MERCHANT-SECRET": secretKey,
    },
    body: JSON.stringify({}),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => "");
    throw new SafepayApiError(
      diagnoseSafepayFailure({
        status: tokenRes.status,
        endpoint: "/client/passport/v1/token",
        bodyText: text,
        mode: config.mode,
        apiBase: config.apiBase,
      })
    );
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

  const url = new URL(`${config.checkoutBase}/subscribe`);
  url.searchParams.set("plan_id", input.subscriptionPlanId);
  url.searchParams.set("auth_token", authToken);
  url.searchParams.set("env", config.mode);
  if (input.orderId) url.searchParams.set("order_id", input.orderId);
  if (input.redirectUrl) url.searchParams.set("redirect_url", input.redirectUrl);
  if (input.cancelUrl) url.searchParams.set("cancel_url", input.cancelUrl);
  if (input.customerEmail) url.searchParams.set("email", input.customerEmail);
  if (input.customerName) url.searchParams.set("name", input.customerName);
  if (input.customerPhone) url.searchParams.set("phone", input.customerPhone);

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
  secretKey: string,
  config: ReturnType<typeof getSafepayConfig>
): Promise<CheckoutSession> {
  const res = await fetch(`${config.apiBase}/order/v1/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client: secretKey,
      amount: input.amountPkr, // PKR in major units (rupees)
      currency: "PKR",
      environment: config.mode,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SafepayApiError(
      diagnoseSafepayFailure({
        status: res.status,
        endpoint: "/order/v1/init",
        bodyText: text,
        mode: config.mode,
        apiBase: config.apiBase,
      })
    );
  }

  const json = (await res.json().catch(() => null)) as
    | { data?: { token?: string; tracking_id?: string }; token?: string; tracking_id?: string; error?: unknown }
    | null;

  const token = json?.data?.token ?? json?.token;
  if (!token) {
    throw new Error("Safepay order/v1/init returned no payment token");
  }
  const trackingId = json?.data?.tracking_id ?? json?.tracking_id;

  const url = new URL(`${config.checkoutBase}/pay`);
  url.searchParams.set("beacon", token);
  url.searchParams.set("env", config.mode);
  url.searchParams.set("source", "custom");
  url.searchParams.set("webhooks", "true");
  if (input.orderId) url.searchParams.set("order_id", input.orderId);
  if (input.redirectUrl) url.searchParams.set("redirect_url", input.redirectUrl);
  if (input.cancelUrl) url.searchParams.set("cancel_url", input.cancelUrl);
  if (input.customerEmail) url.searchParams.set("email", input.customerEmail);
  if (input.customerName) url.searchParams.set("name", input.customerName);
  if (input.customerPhone) url.searchParams.set("phone", input.customerPhone);

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
 * Which secret signs the return differs across official integrations:
 *   - official WooCommerce plugin: the WEBHOOK shared secret
 *   - @sfpy/node-sdk Verify.signature(): the "v1" secret (a legacy credential
 *     the current dashboard no longer exposes; it was historically the same
 *     class of merchant secret)
 * Both are server-only secrets; accepting a match against any CONFIGURED one
 * preserves the security model while staying compatible with how the
 * merchant's dashboard is wired. Never a client-controlled value.
 */
export function verifyReturnSignature(tracker: string, signature: string | null | undefined): boolean {
  if (!tracker || !signature) return false;
  const config = getSafepayConfig();
  const secrets = [config.webhookSecret, config.secretKey].filter((s): s is string => Boolean(s));
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
// GET {api}/reporter/api/v1/payments/{tracker} with the merchant Secret Key
// in the X-SFPY-MERCHANT-SECRET header (verified against the live sandbox
// API: anonymous calls 401, and the endpoint's own error enumerates the
// "strategies/secret" header lookup).

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
 */
export async function fetchTrackerState(tracker: string): Promise<TrackerFetchResult> {
  if (!tracker || !tracker.startsWith("track_")) {
    return { ok: false, outcome: { kind: "unknown" }, error: "invalid tracker token" };
  }
  const config = getSafepayConfig();
  const url = `${config.apiBase}/reporter/api/v1/payments/${encodeURIComponent(tracker)}`;

  if (!config.secretKey) {
    return {
      ok: false,
      outcome: { kind: "unknown" },
      error:
        "SAFEPAY_SECRET_KEY is not configured on this deployment — cannot verify payments server-to-server",
    };
  }

  const attempts: Array<[string, Record<string, string>]> = [
    ["secret-key", { "X-SFPY-MERCHANT-SECRET": config.secretKey }],
    ["anonymous", {}], // kept last: some environments still allow tracker lookup
  ];

  const rejections: string[] = [];
  let authDiagnosis: string | undefined;
  for (const [label, headers] of attempts) {
    try {
      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        rejections.push(`${label}: HTTP ${res.status}`);
        if (label === "secret-key" && res.status === 401) {
          // Turn Safepay's terse 401 into the operator fix (no secret values).
          authDiagnosis = diagnoseSafepayFailure({
            status: res.status,
            endpoint: "/reporter/api/v1/payments/{tracker}",
            bodyText: text,
            mode: config.mode,
            apiBase: config.apiBase,
          }).message;
        }
        continue;
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
  return {
    ok: false,
    outcome: { kind: "unknown" },
    error: authDiagnosis
      ? `Safepay tracker API rejected the configured Secret Key — ${authDiagnosis}`
      : `Safepay tracker API rejected all auth variants — ${rejections.join(" · ").slice(0, 300)}`,
  };
}

// -----------------------------------------------------------------------------
// Payments search — tracker discovery for the subscription flow
// -----------------------------------------------------------------------------
// The official @sfpy/node-core SDK exposes Reporter.Payments.search =
// GET {api}/reporter/api/v1/payments (same X-SFPY-MERCHANT-SECRET auth as the
// single-tracker fetch). The subscription checkout only stores a passport
// auth token — the real track_* id becomes known when Safepay tells us
// (webhook / signed return). When neither arrives, the search endpoint lets
// us DISCOVER the tracker server-side and reconcile the pending checkout.

/** One normalized payment row from the reporter search endpoint. */
export interface SearchedPayment {
  tracker?: string;
  state?: string;
  orderId?: string;
  amount?: number;
  currency?: string;
  createdAt?: number;
  customerEmail?: string;
}

/**
 * Pure, defensive parser for the reporter search response. The exact JSON
 * shape is not publicly documented, so every plausible container is handled
 * ({data:[...]}, {payments:[...]}, bare array, paginated {items:[…]}).
 * Values are extracted from wherever they appear; anything secret-looking is
 * never copied (we only read the whitelisted keys below).
 */
export function parsePaymentsSearchResponse(payload: unknown): SearchedPayment[] {
  const rows: unknown[] =
    Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object"
        ? ((payload as Record<string, unknown>).data as unknown[]) ??
          ((payload as Record<string, unknown>).payments as unknown[]) ??
          ((payload as Record<string, unknown>).items as unknown[]) ??
          ((payload as Record<string, unknown>).results as unknown[]) ??
          []
        : [];
  if (!Array.isArray(rows)) return [];

  const out: SearchedPayment[] = [];
  for (const row of rows.slice(0, 100)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    // Nested data wrapper variant: { data: { tracker, state, ... } }
    const inner =
      r.data && typeof r.data === "object" && !Array.isArray(r.data)
        ? (r.data as Record<string, unknown>)
        : r;
    const tracker =
      pickString(r, "tracker", "tracking_id", "track_id", "token") ??
      pickString(inner, "tracker", "tracking_id", "track_id", "token");
    if (!tracker) continue;
    const metadata =
      (inner.metadata && typeof inner.metadata === "object" ? (inner.metadata as Record<string, unknown>) : {}) ||
      {};
    const amountRaw = inner.amount ?? r.amount;
    out.push({
      tracker,
      state: pickString(inner, "state") ?? pickString(r, "state"),
      orderId:
        pickString(metadata, "order_id", "orderId") ??
        pickString(inner, "order_id", "orderId") ??
        pickString(r, "order_id", "orderId"),
      amount: typeof amountRaw === "number" ? amountRaw : typeof amountRaw === "string" ? parseFloat(amountRaw) || undefined : undefined,
      currency: pickString(inner, "currency", "currency_iso") ?? pickString(r, "currency"),
      createdAt:
        typeof inner.created_at === "number"
          ? (inner.created_at as number)
          : typeof inner.createdAt === "number"
            ? (inner.createdAt as number)
            : typeof inner.created_at === "string" || typeof inner.createdAt === "string"
              ? Date.parse(String(inner.created_at ?? inner.createdAt)) || undefined
              : undefined,
      customerEmail: pickString(inner, "email", "customer_email") ?? pickString(r, "email"),
    });
  }
  return out;
}

function pickString(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

/**
 * Ask Safepay for the most recent payments on THIS merchant account
 * (server-to-server). Used by the verify poller to discover the tracker of a
 * subscription-flow checkout whose webhook/return never surfaced it.
 */
export async function searchSafepayPayments(limit = 20): Promise<
  { ok: boolean; payments: SearchedPayment[]; error?: string }
> {
  const config = getSafepayConfig();
  if (!config.secretKey) {
    return { ok: false, payments: [], error: "SAFEPAY_SECRET_KEY not configured" };
  }
  const url = new URL(`${config.apiBase}/reporter/api/v1/payments`);
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 100)));
  try {
    const res = await fetch(url.toString(), {
      headers: { "X-SFPY-MERCHANT-SECRET": config.secretKey },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        payments: [],
        error: `payments search HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const json = (await res.json().catch(() => null)) as unknown;
    return { ok: true, payments: parsePaymentsSearchResponse(json) };
  } catch (err) {
    return {
      ok: false,
      payments: [],
      error: err instanceof Error ? err.message : "payments search failed",
    };
  }
}

// -----------------------------------------------------------------------------
// Webhook verification
// -----------------------------------------------------------------------------

const SIGNATURE_HEADERS = [
  "x-sfpy-signature", // CURRENT documented header
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
 * Verify a Safepay webhook request.
 *
 * CURRENT DOCUMENTED SCHEME (safepay-docs → Webhooks → Verify HMAC
 * signatures): header `X-SFPY-SIGNATURE` = hex(HMAC-SHA512(sharedSecret,
 * payload)) where payload is the JSON body as sent. Because the exact bytes
 * Safepay signs have varied across integration versions (raw body vs
 * re-stringified object vs the nested `data` object), we verify against the
 * documented candidates in order — all of them are server-side computations
 * over the same body with the same secret, so accepting any of them does not
 * weaken the guarantee that only Safepay could have produced the signature.
 *
 * Order (first match wins):
 *   A1. SHA-512 hex over the RAW body bytes
 *   A2. SHA-512 hex over JSON.stringify(parsedBody)          (docs literal)
 *   A3. SHA-512 hex over JSON.stringify(parsedBody.data)     (@sfpy/node-sdk v3)
 *   B1. SHA-256 hex/base64 over the raw body                  (legacy)
 * Prefixes like `v1=`, `sha256=`, `sha512=` are tolerated, as are comma-
 * separated multi-signature headers (key-rotation window).
 */
export function verifyWebhookSignature(rawBody: string, headers: Headers): { verified: boolean; reason?: string } {
  const config = getSafepayConfig();
  const secret = config.webhookSecret;

  if (!secret) {
    if (allowUnsignedWebhooks()) {
      console.warn("[SAFEPAY WEBHOOK] signature check SKIPPED (SAFEPAY_ALLOW_UNSIGNED_WEBHOOKS=true)");
      return { verified: true };
    }
    return { verified: false, reason: "SAFEPAY_WEBHOOK_SECRET is not configured (fail-closed)" };
  }

  const provided = extractSignature(headers);
  if (!provided) {
    return { verified: false, reason: "missing X-SFPY-SIGNATURE header" };
  }

  const candidates = provided
    .split(",")
    .map((part) => part.trim())
    .flatMap((part) => {
      const stripped = part.replace(/^(v1|sha256|sha512|hmac-sha256|hmac-sha512)\s*=\s*/i, "");
      return [part, stripped];
    });

  // Precompute the payload variants.
  let parsed: unknown;
  let parsedDataJson: string | undefined;
  let parsedJson: string | undefined;
  try {
    parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object") {
      parsedJson = JSON.stringify(parsed);
      const data = (parsed as Record<string, unknown>).data;
      if (data !== undefined) parsedDataJson = JSON.stringify(data);
    }
  } catch {
    // body is not JSON — only the raw-body schemes can apply
  }

  const expectedValues: string[] = [];
  // A1: raw body, SHA-512 (hex)
  expectedValues.push(createHmac("sha512", secret).update(rawBody, "utf8").digest("hex"));
  if (parsedJson) {
    // A2: re-stringified object, SHA-512 (hex)
    expectedValues.push(createHmac("sha512", secret).update(parsedJson, "utf8").digest("hex"));
  }
  if (parsedDataJson) {
    // A3: nested data object, SHA-512 (hex + base64)
    expectedValues.push(createHmac("sha512", secret).update(parsedDataJson, "utf8").digest("hex"));
    expectedValues.push(createHmac("sha512", secret).update(parsedDataJson, "utf8").digest("base64"));
  }
  // B1: raw body, SHA-256 (hex + base64) — legacy integrations
  expectedValues.push(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"));
  expectedValues.push(createHmac("sha256", secret).update(rawBody, "utf8").digest("base64"));

  const expectedLower = new Set(expectedValues.map((v) => v.toLowerCase()));
  for (const candidate of candidates) {
    if (expectedLower.has(candidate.toLowerCase())) {
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
  /** Safepay tracker state string, e.g. TRACKER_ENDED (when present). */
  safepayState?: string;
  /** Our own subscription id (data.metadata.order_id) when Safepay echoes it. */
  filoSubscriptionId?: string;
  /** merchant_api_key from the payload (validated by the webhook route). */
  merchantApiKey?: string;
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

const SECRET_KEY_PATTERN = /(secret|password|token_key|beacon|api_key|apikey|signature|merchant_api_key)/i;

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
 * Normalize Safepay's event payloads into one typed structure.
 *
 * Handles the CURRENT documented shape
 *   { token: "evt_…", type: "payment.succeeded",
 *     data: { tracker, state, metadata: { order_id }, … } }
 * as well as older colon-notation and nested variants. Unknown events are
 * passed through with their normalized type so the state machine can ignore
 * them explicitly (recorded, status "ignored").
 */
export function normalizeWebhookEvent(payload: Record<string, unknown>): NormalizedEvent {
  const rawType =
    (pick(payload, "event_type", "type", "event", "name") || "unknown").replace(/:/g, ".").toLowerCase();

  const data = (payload.data ?? payload.body ?? payload.object ?? payload) as Record<string, unknown>;
  const payment = (data.payment ?? data) as Record<string, unknown>;
  const subscription = (data.subscription ?? payment.subscription ?? {}) as Record<string, unknown>;
  const customer = (data.customer ?? payment.customer ?? {}) as Record<string, unknown>;
  const metadata = (data.metadata ?? payment.metadata ?? {}) as Record<string, unknown>;

  // Event id: prefer Safepay's evt_ token, else derive a stable id.
  const trackingId = pick(payment, "tracking_id", "track_id", "trackingId", "tracker");
  const paymentToken = pick(payment, "token", "payment_token");
  const derivedId = `${rawType}:${trackingId ?? paymentToken ?? JSON.stringify(payload).slice(0, 64)}`;
  const eventId = pick(payload, "token", "id", "event_id", "eventId", "uuid") ?? derivedId;

  const amountRaw = payment.amount ?? data.amount ?? payload.amount;
  const amountPkr = typeof amountRaw === "number" ? amountRaw : typeof amountRaw === "string" ? parseFloat(amountRaw) || undefined : undefined;

  return {
    eventType: rawType,
    eventId,
    trackingId,
    paymentToken,
    safepayState: pick(payment, "state") || pick(data, "state"),
    filoSubscriptionId: pick(metadata, "order_id", "orderId", "subscriptionId") || pick(data, "order_id"),
    merchantApiKey: pick(payload, "merchant_api_key", "merchantApiKey"),
    safepaySubscriptionId: pick(subscription, "id", "subscription_id", "plan") || pick(data, "subscription_id"),
    customerId: pick(customer, "id", "customer_id") || pick(data, "customer_id"),
    customerEmail: (pick(customer, "email") || pick(data, "email") || pick(payload, "email"))?.toLowerCase(),
    amountPkr,
    currency: pick(payment, "currency", "currency_iso") || pick(data, "currency") || "PKR",
    paymentMethod: pick(payment, "payment_method", "instrument", "source") || pick(data, "payment_method"),
    failureReason: pick(payment, "failure_reason", "error_message", "decline_reason", "message") || pick(data, "reason"),
    meta: sanitizePayload(payload),
  };
}
