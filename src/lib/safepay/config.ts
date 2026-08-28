// =============================================================================
// FILO × SAFEPAY — SERVER-ONLY CONFIGURATION (the single source of truth)
// =============================================================================
// One module owns every Safepay environment read. No other file in the
// codebase may read `process.env.SAFEPAY_*` directly (enforced by review and
// by the unit test that greps for stray reads).
//
// CREDENTIALS — these are EXACTLY the three keys the Safepay merchant
// dashboard shows (Developers section). There is NO "beacon secret" and NO
// "v1 secret" in the current dashboard; those were legacy names used by old
// integrations and are only read as deprecated aliases, never required:
//
//   Public Key           → SAFEPAY_PUBLIC_KEY
//                          Reserved for Safepay's client-side / JWT-flavoured
//                          checkout components. Filo's server flow does not
//                          use it today; it is configured and surfaced here so
//                          the mapping is explicit and auditable.
//
//   Secret Key (sec_…)   → SAFEPAY_SECRET_KEY
//                          The merchant server credential. Used for:
//                            • the `client` field of POST /order/v1/init
//                              (one-time checkout session creation)
//                            • the `X-SFPY-MERCHANT-SECRET` header that the
//                              official @sfpy/node-core SDK sends on EVERY
//                              API call when authType === "secret" — this is
//                              how /reporter/api/v1/payments/{tracker} (Fetch
//                              Tracker) and /client/passport/v1/token
//                              (subscription flow) authenticate.
//
//   Webhook Shared Secret→ SAFEPAY_WEBHOOK_SECRET
//                          Signs and verifies Safepay's server-to-server
//                          webhook events (header `X-SFPY-SIGNATURE`,
//                          HMAC-SHA512 hex over the JSON payload — see
//                          verifyWebhookSignature) AND the signed browser
//                          return (HMAC-SHA256 hex over the tracker token —
//                          the exact scheme the official Safepay WooCommerce
//                          plugin uses to mark orders paid).
//
// ENVIRONMENT MODE:
//   SAFEPAY_SANDBOX=true|false (canonical; mirrors the Convex deployment's
//   variable). Legacy SAFEPAY_MODE=sandbox|production is still honoured as a
//   deprecated alias. Sandbox and production use different endpoints AND
//   different credentials — never mix them.
//
// SECURITY:
//   - Import ONLY from server code (API routes / server components). This
//     module reads process.env directly and MUST NOT be imported by any
//     "use client" module.
//   - Fail-closed: checkout throws without a Secret Key; webhooks are
//     rejected without the shared secret unless SAFEPAY_ALLOW_UNSIGNED_
//     WEBHOOKS=true is explicitly set (local development only).
// =============================================================================

export type SafepayMode = "sandbox" | "production";

const SANDBOX_API = "https://sandbox.api.getsafepay.com";
const PRODUCTION_API = "https://api.getsafepay.com";
// Official hosted checkout bases (@sfpy/node-core CHECKOUT_SANDBOX/_PRODUCTION
// and the official WooCommerce plugin's constants).
const SANDBOX_CHECKOUT = "https://sandbox.api.getsafepay.com/checkout";
const PRODUCTION_CHECKOUT = "https://getsafepay.com/checkout";

let warnedLegacyMode = false;
let warnedLegacySecret = false;

function resolveMode(): SafepayMode {
  const canonical = process.env.SAFEPAY_SANDBOX?.trim();
  if (canonical !== undefined && canonical !== "") {
    // Default is sandbox: only the exact string "false" (case-insensitive)
    // enables production, so a typo can never point live money at us.
    return canonical.toLowerCase() === "false" ? "production" : "sandbox";
  }
  const legacy = process.env.SAFEPAY_MODE?.trim();
  if (legacy && !warnedLegacyMode) {
    warnedLegacyMode = true;
    console.warn(
      "[SAFEPAY] SAFEPAY_MODE is DEPRECATED — set SAFEPAY_SANDBOX=true|false instead."
    );
  }
  return (legacy || "sandbox").toLowerCase() === "production" ? "production" : "sandbox";
}

function resolveSecretKey(): string | undefined {
  const canonical = process.env.SAFEPAY_SECRET_KEY?.trim();
  if (canonical) return canonical;
  const legacy = process.env.SAFEPAY_BEACON_SECRET?.trim();
  if (legacy && !warnedLegacySecret) {
    warnedLegacySecret = true;
    console.warn(
      "[SAFEPAY] SAFEPAY_BEACON_SECRET is DEPRECATED — rename it to SAFEPAY_SECRET_KEY (the dashboard's Secret Key)."
    );
  }
  return legacy || undefined;
}

export interface SafepayConfig {
  mode: SafepayMode;
  apiBase: string;
  checkoutBase: string;
  /** Dashboard "Public Key" — reserved for client-side flows; see header. */
  publicKey?: string;
  /** Dashboard "Secret Key" (sec_…) — required for every server flow. */
  secretKey?: string;
  /** Dashboard "Webhook Shared Secret" — required for webhook verification. */
  webhookSecret?: string;
  /** True when a Secret Key is configured (checkout/verify possible). */
  configured: boolean;
}

let cachedForMode: { sandbox: boolean; config: SafepayConfig } | null = null;

/** Build (and memoise per-mode) the effective Safepay configuration. */
export function getSafepayConfig(): SafepayConfig {
  const sandbox = resolveMode() === "sandbox";
  if (cachedForMode && cachedForMode.sandbox === sandbox) return cachedForMode.config;

  const config: SafepayConfig = {
    mode: sandbox ? "sandbox" : "production",
    apiBase: sandbox ? SANDBOX_API : PRODUCTION_API,
    checkoutBase: sandbox ? SANDBOX_CHECKOUT : PRODUCTION_CHECKOUT,
    publicKey: process.env.SAFEPAY_PUBLIC_KEY?.trim() || undefined,
    secretKey: resolveSecretKey(),
    webhookSecret: process.env.SAFEPAY_WEBHOOK_SECRET?.trim() || undefined,
    configured: Boolean(resolveSecretKey()),
  };
  cachedForMode = { sandbox, config };
  return config;
}

/** True when checkout / tracker verification can run (Secret Key present). */
export function isSafepayConfigured(): boolean {
  return getSafepayConfig().configured;
}

/**
 * True when the recurring-subscription flow can be used. With the CURRENT
 * Safepay API the passport token endpoint authenticates with the SAME Secret
 * Key (X-SFPY-MERCHANT-SECRET) — no separate "v1 secret" exists. Plans must
 * still exist on Safepay (create via API or dashboard) and be mapped in the
 * plans table; see /api/admin/billing/sync-safepay-plans.
 */
export function isSubscriptionFlowConfigured(): boolean {
  return Boolean(getSafepayConfig().secretKey);
}

/** Dev-only escape hatch for webhook signature checks. Never enable in prod. */
export function allowUnsignedWebhooks(): boolean {
  return process.env.SAFEPAY_ALLOW_UNSIGNED_WEBHOOKS === "true";
}

/**
 * Which payment model this deployment sells. "subscription" (default) uses
 * Safepay-managed recurring plans; "one_time" is an explicit operator
 * opt-in (SAFEPAY_PAYMENT_MODEL=one_time) that charges each period manually
 * — never a silent fallback.
 */
export function getPaymentModel(): "subscription" | "one_time" {
  return (process.env.SAFEPAY_PAYMENT_MODEL || "subscription").trim().toLowerCase() === "one_time"
    ? "one_time"
    : "subscription";
}
