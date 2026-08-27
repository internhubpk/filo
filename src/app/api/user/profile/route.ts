// =============================================================================
// PATCH /api/user/profile — update the signed-in user's profile
// =============================================================================
// Real Convex mutation (users.updateUser). The caller may only change their
// OWN profile — userId always comes from the verified session, never the
// request body. Name changes are audited.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser, serverToken, convexMutation, jsonError } from "@/lib/billing-server";

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (!auth.ok) return auth.response;
    const { user } = auth.data;

    const body = (await request.json().catch(() => null)) as { name?: string; image?: string } | null;
    if (!body) return jsonError(400, "Invalid request body", "BAD_REQUEST");

    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2 || name.length > 80) {
        return jsonError(400, "Name must be between 2 and 80 characters", "INVALID_NAME");
      }
      updates.name = name;
    }
    if (body.image !== undefined) {
      updates.image = typeof body.image === "string" ? body.image.slice(0, 2048) : undefined;
    }

    if (Object.keys(updates).length === 0) {
      return jsonError(400, "Nothing to update", "NO_CHANGES");
    }

    // users:updateUser validates {userId, name?, image?, planId?} — only pass
    // supported fields (updatedAt is set inside the mutation).
    const convexUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) convexUpdates.name = updates.name;
    if (updates.image !== undefined) convexUpdates.image = updates.image;

    const updated = await convexMutation<Record<string, unknown>>("users:updateUser", {
      userId: user.id,
      ...convexUpdates,
    });

    // Audit the change (best-effort).
    try {
      await convexMutation("billing:writeAuditLog", {
        serverToken: serverToken(),
        actorId: user.id,
        actorEmail: user.email,
        actorType: "user",
        action: "user.profile.updated",
        targetType: "user",
        targetId: user.id,
        metadata: { fields: Object.keys(updates).filter((k) => k !== "updatedAt") },
      });
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: (updated as { name?: string }).name ?? updates.name,
          email: user.email,
          image: (updated as { image?: string }).image ?? null,
        },
      },
    });
  } catch (error) {
    console.error("[API /user/profile] Error:", error);
    return jsonError(500, "Failed to update profile", "UPDATE_FAILED");
  }
}
