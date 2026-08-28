// =============================================================================
// FILO × SAFEPAY — SERVER-ONLY CONFIGURATION (the single source of truth)
// =============================================================================
// One module owns every Safepay environment read. No other file in the
// codebase may read `process.env.SAFEPAY_*` directly (enforced by review and
// by the unit test that greps for stray reads).
//
// CREDENTIALS — exactly the keys the CURRENT Safepay merchant dashboard shows
// (verified Aug 2026 against safepay-docs.netlify.app → Developers → API keys,
// and the official @sfpy/node-core SDK README):
//
//   • Public API Key        — "the first item on dashboard/developers/api and
//     (sec_…)                  it STARTS WITH sec_" (per the current docs).
//                              It identifies the account; it is NOT a secret.
//                              Filo does not use it server-side today; it is
//                              configured here so the mapping is explicit.
//                             → SAFEPAY_PUBLIC_KEY
//
//   • Private API Secret    — "the SECOND item on dashboard/developers/api".
//     Key                      Authenticates every server-to-server API call
//                              (header `x-sfpy-merchant-secret`, sent by the
//                              official SDK when authType === "secret") for
//                              /client/passport/v1/token (subscriptions),
//                              /client/plans/v1/ (plan creation) and
//                              /reporter/api/v1/payments/{tracker} (Fetch
//                              Tracker verification).
//                             → SAFEPAY_SECRET_KEY
//
//   • Private Webhook       — dashboard → Developers → Endpoints → "View
//     Secret Key               shared secret". Verifies webhook signatures
//                              (header `X-SFPY-SIGNATURE`, HMAC-SHA512 hex over
//                              the JSON payload) and the signed browser return
//                              (HMAC-SHA256 hex over the tracker — the exact
//                              scheme the official Safepay WooCommerce plugin
//                              uses as proof of payment).
//                             → SAFEPAY_WEBHOOK_SECRET
//
//   ⚠ DO NOT paste the Public API Key (sec_…) into SAFEPAY_SECRET_KEY.
//     Safepay's auth middleware resolves the header value against PRIVATE
//     secrets only; a public key yields exactly
//     `strategies/secret: could not fetch client … Resource with this
//     identifier not found` (HTTP 401) — see diagnoseAuthRejection().
//
//   LEGACY NAMES — there is NO "beacon secret" and NO "v1 secret" in the
//   current dashboard. SAFEPAY_BEACON_SECRET / SAFEPAY_V1_SECRET /
//   SAFEPAY_MODE are no longer read AT ALL (removed after they silently sent
//   an invalid value to Safepay and masked a misconfiguration); a startup
//   warning fires if they are still present so operators clean them up.
//
// ENVIRONMENT MODE:
//   SAFEPAY_SANDBOX=true|false (canonical). Sandbox and production use
//   DIFFERENT endpoints AND DIFFERENT credentials (sandbox keys come from
//   sandbox.api.getsafepay.com/dashboard/developers/api, production keys from
//   getsafepay.com/dashboard/developers/api) — never mix them.
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

/** Env vars that no longer do anything — surfaced so operators delete them. */
const IGNORED_LEGACY_VARS = [
  "SAFEPAY_BEACON_SECRET",
  "SAFEPAY_V1_SECRET",
  "SAFEPAY_MODE",
] as const;

let warnedLegacyVars = false;

function resolveMode(): SafepayMode {
  const canonical = process.env.SAFEPAY_SANDBOX?.trim();
  if (canonical !== undefined && canonical !== "") {
    // Default is sandbox: only the exact string "false" (case-insensitive)
    // enables production, so a typo can never point live money at us.
    return canonical.toLowerCase() === "false" ? "production" : "sandbox";
  }
  // SAFEPAY_MODE is no longer honoured — absence of SAFEPAY_SANDBOX defaults
  // to sandbox (never point money at production by accident).
  return "sandbox";
}

/** Warn once when ignored legacy variables are still set on the deployment. */
function warnIgnoredLegacyVars(): void {
  if (warnedLegacyVars) return;
  const present = IGNORED_LEGACY_VARS.filter((name) => process.env[name]?.trim());
  if (present.length > 0) {
    warnedLegacyVars = true;
    console.warn(
      `[SAFEPAY] Ignored legacy env vars still set on this deployment: ${present.join(", ")}. ` +
        `They do nothing — delete them from Vercel and set SAFEPAY_SECRET_KEY to the dashboard's ` +
        `Private API Secret Key (the SECOND item on dashboard/developers/api).`
    );
  }
}

export interface SafepayConfig {
  mode: SafepayMode;
  apiBase: string;
  checkoutBase: string;
  /** Dashboard "Public API Key" (sec_…) — public identifier, not a secret. */
  publicKey?: string;
  /** Dashboard "Private API Secret Key" — required for every server flow. */
  secretKey?: string;
  /** Dashboard "Private Webhook Secret Key" — required for webhook verification. */
  webhookSecret?: string;
  /** True when a Secret Key is configured (checkout/verify possible). */
  configured: boolean;
}

let cachedForMode: { sandbox: boolean; config: SafepayConfig } | null = null;

/** Build (and memoise per-mode) the effective Safepay configuration. */
export function getSafepayConfig(): SafepayConfig {
  const sandbox = resolveMode() === "sandbox";
  if (cachedForMode && cachedForMode.sandbox === sandbox) return cachedForMode.config;
  warnIgnoredLegacyVars();

  const config: SafepayConfig = {
    mode: sandbox ? "sandbox" : "production",
    apiBase: sandbox ? SANDBOX_API : PRODUCTION_API,
    checkoutBase: sandbox ? SANDBOX_CHECKOUT : PRODUCTION_CHECKOUT,
    publicKey: process.env.SAFEPAY_PUBLIC_KEY?.trim() || undefined,
    secretKey: process.env.SAFEPAY_SECRET_KEY?.trim() || undefined,
    webhookSecret: process.env.SAFEPAY_WEBHOOK_SECRET?.trim() || undefined,
    configured: Boolean(process.env.SAFEPAY_SECRET_KEY?.trim()),
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
 * Key (x-sfpy-merchant-secret — verified against the official @sfpy/node-core
 * SDK) — no separate "v1 secret" exists. Plans must still exist on Safepay
 * (create via API or dashboard) and be mapped in the plans table; see
 * /api/admin/billing/sync-safepay-plans.
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

// -----------------------------------------------------------------------------
// Operator diagnostics (no secret values ever leave the server)
// -----------------------------------------------------------------------------

export interface CredentialDiag {
  /** The env var the value must be pasted into. */
  envVar: string;
  /** Dashboard label, so the operator copies the right one. */
  label: string;
  configured: boolean;
  /** First 4 chars + length — enough to recognise a wrong paste, never enough to leak. */
  preview?: string;
  /** Per current docs only the PUBLIC API Key starts with "sec_". */
  looksLikePublicKey: boolean;
  /** Whitespace/quotes around the pasted value (common Vercel paste issue). */
  looksMalformed: boolean;
}

export interface SafepayAuthDiagnostics {
  mode: SafepayMode;
  apiBase: string;
  checkoutBase: string;
  paymentModel: "subscription" | "one_time";
  secretKey: CredentialDiag;
  webhookSecret: CredentialDiag;
  publicKey: CredentialDiag;
  /** Legacy vars still present on the deployment (they are ignored). */
  ignoredLegacyVarsDetected: string[];
  /** Non-empty problems an operator can act on immediately. */
  warnings: string[];
}

function maskValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const head = value.slice(0, 4);
  return `${head}…(len=${value.length})`;
}

function credentialDiag(
  envVar: string,
  label: string,
  value: string | undefined,
  isPublicByDesign = false
): CredentialDiag {
  const configured = Boolean(value);
  return {
    envVar,
    label,
    configured,
    preview: maskValue(value),
    // The PUBLIC key legitimately starts with sec_ — flag it only where a
    // SECRET belongs.
    looksLikePublicKey: !isPublicByDesign && Boolean(value?.toLowerCase().startsWith("sec_")),
    looksMalformed: Boolean(value && /[\s"']/.test(value)),
  };
}

/**
 * Everything an operator needs to confirm the Safepay wiring WITHOUT exposing
 * secret values: which vars are set, a recognisable (masked) preview, and
 * machine-checkable warnings for the two mistakes we have actually seen —
 * pasting the Public API Key into SAFEPAY_SECRET_KEY, and the deprecated
 * beacon secret still being sent via the old alias.
 */
export function getSafepayAuthDiagnostics(): SafepayAuthDiagnostics {
  const config = getSafepayConfig();
  const secretKey = credentialDiag(
    "SAFEPAY_SECRET_KEY",
    "Private API Secret Key (dashboard → Developers → API, the SECOND item)",
    config.secretKey
  );
  const webhookSecret = credentialDiag(
    "SAFEPAY_WEBHOOK_SECRET",
    "Private Webhook Secret Key (dashboard → Developers → Endpoints → View shared secret)",
    config.webhookSecret
  );
  const publicKey = credentialDiag(
    "SAFEPAY_PUBLIC_KEY",
    "Public API Key (dashboard → Developers → API, the FIRST item — starts with sec_)",
    config.publicKey,
    true
  );
  const ignoredLegacyVarsDetected = IGNORED_LEGACY_VARS.filter((name) => process.env[name]?.trim());

  const warnings: string[] = [];
  if (!config.secretKey) {
    warnings.push(
      `${secretKey.envVar} is not set on this deployment — checkout is fail-closed (503).`
    );
  } else {
    if (secretKey.looksLikePublicKey) {
      warnings.push(
        `${secretKey.envVar} starts with "sec_" — that is the PUBLIC API Key prefix per Safepay's ` +
          `current docs. The Private API Secret Key is the SECOND item on dashboard/developers/api. ` +
          `Safepay will reject this value with "could not fetch client".`
      );
    }
    if (secretKey.looksMalformed) {
      warnings.push(
        `${secretKey.envVar} contains whitespace or quotes — re-copy the value cleanly (Vercel env vars must hold ONLY the key).`
      );
    }
  }
  if (!config.webhookSecret) {
    warnings.push(
      `${webhookSecret.envVar} is not set — webhook signatures cannot be verified (webhooks fail-closed) and the signed return cannot be validated.`
    );
  }
  if (ignoredLegacyVarsDetected.length > 0) {
    warnings.push(
      `Ignored legacy vars still present: ${ignoredLegacyVarsDetected.join(", ")} — delete them to avoid confusion.`
    );
  }

  return {
    mode: config.mode,
    apiBase: config.apiBase,
    checkoutBase: config.checkoutBase,
    paymentModel: getPaymentModel(),
    secretKey,
    webhookSecret,
    publicKey,
    ignoredLegacyVarsDetected,
    warnings,
  };
}
