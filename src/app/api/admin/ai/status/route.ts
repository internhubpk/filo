// =============================================================================
// GET/POST /api/admin/ai/status
// =============================================================================
// ADMIN AI PROVIDER DIAGNOSTICS — AI-repair spec §2/§3/§17/§18.
//
// GET  → configuration snapshot from the CONVEX runtime (where generation
//        actually runs): which providers have keys, router health state.
// POST → runs LIVE probes from the Convex runtime:
//          - AgentRouter: one chat call per configured model id (auth/model)
//          - Gemini: one 1-token generateContent call per configured model
//          - OpenAI: reported as disabled when unconfigured (§10)
//
// Never returns API keys, secrets, tokens, or authorization headers.
// ===============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminAccess,
  serverToken,
  convexAction,
  jsonError,
} from "@/lib/billing-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const result = await convexAction<Record<string, unknown>>(
      "aiDiagnostics:probeAiProviders",
      { serverToken: serverToken(), probe: false }
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(502, `AI diagnostics failed: ${message}`, "AI_STATUS_FAILED");
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const result = await convexAction<Record<string, unknown>>(
      "aiDiagnostics:probeAiProviders",
      { serverToken: serverToken(), probe: true }
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(502, `AI probe failed: ${message}`, "AI_PROBE_FAILED");
  }
}
