// =============================================================================
// GET /api/admin/analytics?days=30 — time-series for admin charts
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess, serverToken, convexQuery, jsonError } from "@/lib/billing-server";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30", 10);

    const data = await convexQuery("billing:adminAnalytics", {
      serverToken: serverToken(),
      adminUserId: admin.data.adminUserId,
      days: Number.isFinite(days) ? days : 30,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[API /admin/analytics] Error:", error);
    return jsonError(500, "Failed to load analytics", "FETCH_ERROR");
  }
}
