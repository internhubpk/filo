// =============================================================================
// FILO × SAFEPAY — upstream error parsing & operator diagnosis
// =============================================================================
// Safepay's HTTP APIs answer auth failures with a body like
//
//   {"data":null,"status":{"errors":["unauthorized",
//     "strategies/union: [strategies/jwt_client: missing jwt token,
//      strategies/secret: could not fetch client, error: Resource with this
//      identifier not found]"],"message":"fail"}}
//
// The union middleware tries `strategies/jwt_client` (a session JWT — used by
// browser-ish clients) then `strategies/secret` (the x-sfpy-merchant-secret
// header used by the official @sfpy/node-core SDK when authType === "secret").
//
// LIVE-VERIFIED TAXONOMY (probed against sandbox.api.getsafepay.com, Aug 2026):
//   • header ABSENT            → "strategies/secret: merchant webhook secret
//                                 not found in the request header"
//   • header PRESENT, value is
//     not a known merchant
//     secret on THAT environment → "strategies/secret: could not fetch client,
//                                 error: Resource with this identifier not found"
//
// The second shape is exactly what a wrong/legacy/wrong-environment Secret Key
// produces — it is a CONFIGURATION problem on our side, not a transient Safepay
// outage, so we surface an operator-actionable diagnosis instead of a generic
// 500. No secret values are ever included.
// =============================================================================

import type { SafepayAuthDiagnostics } from "./config";

export type SafepayFailureKind =
  /** A merchant secret was sent but Safepay does not recognise it. */
  | "auth_secret_rejected"
  /** The merchant-secret header never arrived (should not happen from Filo). */
  | "auth_secret_missing"
  /** SAFEPAY_SECRET_KEY holds the Public API Key (sec_…) — wrong credential. */
  | "suspected_public_key"
  /** Safepay had an internal error / the request was malformed upstream. */
  | "upstream_error"
  /** Anything else (network, 5xx, unknown body). */
  | "other";

export interface SafepayFailureDiagnosis {
  kind: SafepayFailureKind;
  /** HTTP status Safepay returned (0 for local pre-flight failures). */
  status: number;
  /** The endpoint that failed, e.g. "/client/passport/v1/token". */
  endpoint: string;
  /** Raw error strings Safepay returned (safe — they never contain secrets). */
  safepayErrors: string[];
  /** Operator-actionable message (safe to show in toasts / admin UI). */
  message: string;
}

export class SafepayApiError extends Error {
  readonly diagnosis: SafepayFailureDiagnosis;

  constructor(diagnosis: SafepayFailureDiagnosis) {
    super(diagnosis.message);
    this.name = "SafepayApiError";
    this.diagnosis = diagnosis;
  }
}

function parseErrors(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as
      | { status?: { errors?: unknown; message?: unknown } }
      | null;
    const errs = parsed?.status?.errors;
    if (Array.isArray(errs) && errs.length > 0) {
      return errs.map((e) => String(e)).slice(0, 6);
    }
    const message = parsed?.status?.message;
    if (typeof message === "string" && message) return [message];
  } catch {
    // not JSON — fall through
  }
  return raw ? [raw.slice(0, 200)] : [];
}

function joined(errors: string[]): string {
  return errors.join(" | ").slice(0, 300);
}

/**
 * Turn a failed Safepay response into a structured, operator-actionable
 * diagnosis. Never include secret values — only var NAMES and the target
 * environment.
 */
export function diagnoseSafepayFailure(params: {
  status: number;
  endpoint: string;
  bodyText: string;
  mode: string;
  apiBase: string;
}): SafepayFailureDiagnosis {
  const { status, endpoint, bodyText, mode, apiBase } = params;
  const errors = parseErrors(bodyText);
  const haystack = errors.join("\n").toLowerCase();
  const modeHint =
    `mode=${mode}, api=${apiBase}, credential var: SAFEPAY_SECRET_KEY`;

  if (status === 401) {
    if (haystack.includes("could not fetch client") || haystack.includes("resource with this identifier not found")) {
      return {
        kind: "auth_secret_rejected",
        status,
        endpoint,
        safepayErrors: errors,
        message:
          `Safepay rejected the configured Secret Key (${modeHint}). The value does NOT match any merchant ` +
          `on that environment. Fix on Vercel: (1) set SAFEPAY_SECRET_KEY to the PRIVATE API Secret Key — ` +
          `the SECOND item on the dashboard's Developers → API page (NOT the Public API Key, which starts with sec_); ` +
          `(2) make sure SAFEPAY_SANDBOX matches the dashboard you copied the key from (sandbox keys and ` +
          `production keys are different); (3) redeploy after saving env vars; (4) verify with Admin → Plans → ` +
          `"Test Safepay connection".`,
      };
    }
    if (haystack.includes("not found in the request header")) {
      return {
        kind: "auth_secret_missing",
        status,
        endpoint,
        safepayErrors: errors,
        message:
          `Safepay did not receive the merchant-secret header (${modeHint}). ` +
          `This is a Filo bug or an empty SAFEPAY_SECRET_KEY — check the deployment env vars and server logs.`,
      };
    }
    return {
      kind: "other",
      status,
      endpoint,
      safepayErrors: errors,
      message: `Safepay rejected authentication for ${endpoint} (${modeHint}): ${joined(errors)}`,
    };
  }

  if (status >= 500) {
    return {
      kind: "upstream_error",
      status,
      endpoint,
      safepayErrors: errors,
      message: `Safepay server error for ${endpoint} (HTTP ${status}) — retry shortly: ${joined(errors)}`,
    };
  }

  return {
    kind: "other",
    status,
    endpoint,
    safepayErrors: errors,
    message: `Safepay request failed for ${endpoint} (HTTP ${status}): ${joined(errors)}`,
  };
}

/**
 * Local pre-flight rejection raised when SAFEPAY_SECRET_KEY looks like the
 * Public API Key (sec_…). Per the current docs only the Public API Key starts
 * with "sec_", so sending it can only end in a 401 — fail fast with the fix
 * in the message instead of a round trip.
 */
export function suspectedPublicKeyError(mode: string): SafepayApiError {
  return new SafepayApiError({
    kind: "suspected_public_key",
    status: 0,
    endpoint: "pre-flight",
    safepayErrors: [],
    message:
      `SAFEPAY_SECRET_KEY starts with "sec_" — that is the PUBLIC API Key prefix per Safepay's current docs ` +
      `(mode=${mode}). The Private API Secret Key is the SECOND item on the dashboard's Developers → API page. ` +
      `Paste that value into SAFEPAY_SECRET_KEY on Vercel, then redeploy. ` +
      `(If Safepay support ever issues a private key that really starts with sec_, contact them to confirm.)`,
  });
}

/** Flatten a diagnosis into the structured payload returned by API routes. */
export function diagnosisPayload(diagnosis: SafepayFailureDiagnosis, auth: SafepayAuthDiagnostics) {
  return {
    kind: diagnosis.kind,
    endpoint: diagnosis.endpoint,
    safepayStatus: diagnosis.status || null,
    safepayErrors: diagnosis.safepayErrors,
    environment: { mode: auth.mode, apiBase: auth.apiBase },
    credentials: {
      secretKey: {
        envVar: auth.secretKey.envVar,
        configured: auth.secretKey.configured,
        preview: auth.secretKey.preview ?? null,
        looksLikePublicKey: auth.secretKey.looksLikePublicKey,
        looksMalformed: auth.secretKey.looksMalformed,
      },
      webhookSecret: {
        envVar: auth.webhookSecret.envVar,
        configured: auth.webhookSecret.configured,
      },
    },
    warnings: auth.warnings,
  };
}
