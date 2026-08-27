// =============================================================================
// POST /api/user/password — change password (authenticated)
// =============================================================================
// Verifies the CURRENT password inside Convex before setting the new hash.
// Never returns hash material. Audited.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser, serverToken, convexMutation, jsonError } from "@/lib/billing-server";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (!auth.ok) return auth.response;
    const { user } = auth.data;

    const body = (await request.json().catch(() => null)) as
      | { currentPassword?: string; newPassword?: string }
      | null;
    if (!body?.currentPassword || !body?.newPassword) {
      return jsonError(400, "Both current and new password are required", "MISSING_FIELDS");
    }
    if (body.newPassword.length < 8) {
      return jsonError(400, "New password must be at least 8 characters", "PASSWORD_TOO_SHORT");
    }

    const result = await convexMutation<{
      success: boolean;
      error?: string;
      code?: string;
    }>("auth:changePassword", {
      userId: user.id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });

    if (!result.success) {
      const status = result.code === "WRONG_PASSWORD" ? 403 : 400;
      return jsonError(status, result.error || "Failed to change password", result.code || "CHANGE_FAILED");
    }

    // Audit (best-effort).
    try {
      await convexMutation("billing:writeAuditLog", {
        serverToken: serverToken(),
        actorId: user.id,
        actorEmail: user.email,
        actorType: "user",
        action: "user.password.changed",
        targetType: "user",
        targetId: user.id,
      });
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({ success: true, data: { message: "Password updated" } });
  } catch (error) {
    console.error("[API /user/password] Error:", error);
    return jsonError(500, "Failed to change password", "CHANGE_FAILED");
  }
}
