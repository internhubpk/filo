// =============================================================================
// GET /api/admin/users — enriched user table data (plan, sub, usage, storage)
// PATCH /api/admin/users — role management (body: { userId, isAdmin })
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess, serverToken, convexQuery, convexMutation, jsonError } from "@/lib/billing-server";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const rows = await convexQuery<Array<Record<string, unknown>>>("admin:adminUsersWithStats", {
      serverToken: serverToken(),
      adminUserId: admin.data.adminUserId,
      limit: 500,
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error("[API /admin/users GET] Error:", error);
    return jsonError(500, "Failed to load users", "FETCH_ERROR");
  }
}

/** Grant or revoke admin role. Self-demotion is blocked (lockout protection). */
export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const body = (await request.json().catch(() => null)) as
      | { userId?: string; isAdmin?: boolean }
      | null;
    if (!body?.userId || typeof body.isAdmin !== "boolean") {
      return jsonError(400, "userId and isAdmin are required", "BAD_REQUEST");
    }
    if (body.userId === admin.data.adminUserId && body.isAdmin === false) {
      return jsonError(400, "You cannot revoke your own admin role", "SELF_DEMOTION");
    }

    await convexMutation("users:setUserRole", {
      serverToken: serverToken(),
      adminUserId: admin.data.adminUserId,
      targetUserId: body.userId,
      isAdmin: body.isAdmin,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API /admin/users PATCH] Error:", error);
    return jsonError(500, "Failed to update role", "UPDATE_FAILED");
  }
}
