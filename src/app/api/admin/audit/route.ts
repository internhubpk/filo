// =============================================================================
// GET /api/admin/audit — audit log (login, role changes, billing, admin ops)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess, serverToken, convexQuery, jsonError } from "@/lib/billing-server";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || undefined;

    const rows = await convexQuery<Array<Record<string, unknown>>>("billing:adminListAuditLogs", {
      serverToken: serverToken(),
      adminUserId: admin.data.adminUserId,
      action,
      limit: 300,
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error("[API /admin/audit] Error:", error);
    return jsonError(500, "Failed to load audit log", "FETCH_ERROR");
  }
}
