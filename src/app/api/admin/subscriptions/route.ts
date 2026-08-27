// =============================================================================
// GET /api/admin/subscriptions?status=active — subscription management table
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess, serverToken, convexQuery, jsonError } from "@/lib/billing-server";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;

    const rows = await convexQuery<Array<Record<string, unknown>>>("billing:adminListSubscriptions", {
      serverToken: serverToken(),
      adminUserId: admin.data.adminUserId,
      status,
      limit: 200,
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error("[API /admin/subscriptions] Error:", error);
    return jsonError(500, "Failed to load subscriptions", "FETCH_ERROR");
  }
}
