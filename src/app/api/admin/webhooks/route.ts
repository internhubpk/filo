// =============================================================================
// GET /api/admin/webhooks?status=failed — Safepay webhook event monitor
// =============================================================================
// Payloads were sanitized at ingest time (secrets redacted in
// src/lib/safepay.ts) — safe for admin inspection, never exposes secrets.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess, serverToken, convexQuery, jsonError } from "@/lib/billing-server";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;

    const rows = await convexQuery<Array<Record<string, unknown>>>("billing:adminListWebhookEvents", {
      serverToken: serverToken(),
      adminUserId: admin.data.adminUserId,
      status,
      limit: 200,
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error("[API /admin/webhooks] Error:", error);
    return jsonError(500, "Failed to load webhook events", "FETCH_ERROR");
  }
}
