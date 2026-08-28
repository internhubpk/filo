// =============================================================================
// GET /api/admin/billing/safepay-status   (also POST = includes a live probe)
// =============================================================================
// OPERATOR DIAGNOSTICS for the Safepay integration — the first stop whenever
// checkout fails, the tracker API 401s, or a payment will not confirm.
//
//   GET  → configuration only: mode, endpoints, which credential vars are
//          set (masked previews, NEVER values), and actionable warnings
//          (e.g. SAFEPAY_SECRET_KEY holds the Public API Key "sec_…").
//   POST → everything GET returns PLUS a LIVE authentication probe against
//          Safepay's /client/passport/v1/token using the configured Secret
//          Key. PASS proves the key, the environment and the header contract
//          are all correct — anything else returns Safepay's own error plus
//          the exact fix. The probe only authenticates; it creates nothing.
//
// SECURITY: admin-only (requireAdminAccess). No secret values are returned —
// only var names, first-4-char previews and booleans.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/billing-server";
import {
  getSafepayAuthDiagnostics,
  getSafepayConfig,
  SafepayApiError,
  diagnoseSafepayFailure,
  type SafepayFailureKind,
} from "@/lib/safepay";

interface ProbeResult {
  ok: boolean;
  httpStatus: number | null;
  message: string;
  kind?: SafepayFailureKind | string;
  safepayErrors?: string[];
}

/** One live auth probe against the passport endpoint (creates nothing). */
async function probePassportAuth(): Promise<ProbeResult> {
  const config = getSafepayConfig();
  if (!config.secretKey) {
    return {
      ok: false,
      httpStatus: null,
      message: "SAFEPAY_SECRET_KEY is not set on this deployment — nothing to probe.",
      kind: "auth_secret_missing",
    };
  }
  if (config.secretKey.toLowerCase().startsWith("sec_")) {
    return {
      ok: false,
      httpStatus: null,
      message:
        'SAFEPAY_SECRET_KEY starts with "sec_" — that is the PUBLIC API Key. Paste the Private API Secret Key ' +
        "(the SECOND item on dashboard/developers/api) instead.",
      kind: "suspected_public_key",
    };
  }
  try {
    const res = await fetch(`${config.apiBase}/client/passport/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SFPY-MERCHANT-SECRET": config.secretKey },
      body: JSON.stringify({}),
      cache: "no-store",
      // Keep the probe snappy — this endpoint powers a UI button.
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      return {
        ok: true,
        httpStatus: res.status,
        message: `PASS — Safepay authenticated this Secret Key for /client/passport/v1/token (mode=${config.mode}). Checkout auth is healthy.`,
      };
    }
    const text = await res.text().catch(() => "");
    const failure = new SafepayApiError(
      diagnoseSafepayFailure({
        status: res.status,
        endpoint: "/client/passport/v1/token",
        bodyText: text,
        mode: config.mode,
        apiBase: config.apiBase,
      })
    );
    return {
      ok: false,
      httpStatus: res.status,
      message: failure.diagnosis.message,
      kind: failure.diagnosis.kind,
      safepayErrors: failure.diagnosis.safepayErrors,
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      message:
        error instanceof Error
          ? `Probe request failed: ${error.message}`
          : "Probe request failed (network error)",
      kind: "other",
    };
  }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminAccess(request);
  if (!admin.ok) return admin.response;

  const auth = getSafepayAuthDiagnostics();
  return NextResponse.json({ success: true, data: { ...auth, probe: null } });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminAccess(request);
  if (!admin.ok) return admin.response;

  const auth = getSafepayAuthDiagnostics();
  const probe = await probePassportAuth();
  return NextResponse.json({ success: true, data: { ...auth, probe } });
}
