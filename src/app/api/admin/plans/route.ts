// =============================================================================
// /api/admin/plans — plan CRUD (GET list / POST create / PATCH update)
// =============================================================================
// Plan management with audit logging. Plans stay synchronized with Safepay
// subscription plan identifiers (stored, never generated here). Billing
// data flows ONLY through Safepay — this endpoint cannot bypass it.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess, serverToken, convexMutation, convexQuery, jsonError } from "@/lib/billing-server";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const plans = await convexQuery<Array<Record<string, unknown>>>("plans:getAllPlans", {});
    return NextResponse.json({ success: true, data: plans });
  } catch (error) {
    console.error("[API /admin/plans GET] Error:", error);
    return jsonError(500, "Failed to load plans", "FETCH_ERROR");
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const body = await request.json().catch(() => null);
    if (!body?.name || typeof body.name !== "string") {
      return jsonError(400, "Plan name is required", "BAD_REQUEST");
    }

    const planId = await convexMutation<string>("admin:createPlan", {
      name: String(body.name).slice(0, 60),
      description: String(body.description ?? "").slice(0, 300),
      priceMonthly: Math.max(0, Number(body.priceMonthly) || 0),
      priceYearly: Math.max(0, Number(body.priceYearly) || 0),
      currency: "PKR",
      features: Array.isArray(body.features) ? body.features.map(String).slice(0, 30) : [],
      limitations: Array.isArray(body.limitations) ? body.limitations.map(String).slice(0, 30) : [],
      popular: Boolean(body.popular),
      active: body.active !== false,
      maxAiGenerations: Math.max(-1, Number(body.maxAiGenerations) || 0),
      maxStorageMb: Math.max(1, Number(body.maxStorageMb) || 100),
      maxTeamMembers: body.maxTeamMembers ? Number(body.maxTeamMembers) : undefined,
      icon: String(body.icon ?? "Sparkles").slice(0, 40),
      order: Number(body.order) || 99,
      contactSales: Boolean(body.contactSales),
      tier: String(body.tier ?? String(body.name).toLowerCase()).slice(0, 30),
      aiChatEnabled: body.aiChatEnabled !== false,
      safepayPlanIdMonthly: body.safepayPlanIdMonthly ? String(body.safepayPlanIdMonthly) : undefined,
      safepayPlanIdYearly: body.safepayPlanIdYearly ? String(body.safepayPlanIdYearly) : undefined,
    });

    await convexMutation("billing:writeAuditLog", {
      serverToken: serverToken(),
      actorId: admin.data.adminUserId,
      actorEmail: admin.data.adminEmail,
      actorType: "admin",
      action: "plan.created",
      targetType: "plan",
      targetId: planId,
      metadata: { name: body.name },
    }).catch(() => {});

    return NextResponse.json({ success: true, data: { planId } });
  } catch (error) {
    console.error("[API /admin/plans POST] Error:", error);
    return jsonError(500, "Failed to create plan", "CREATE_FAILED");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const body = await request.json().catch(() => null);
    if (!body?.planId) return jsonError(400, "planId is required", "BAD_REQUEST");

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = String(body.name).slice(0, 60);
    if (body.description !== undefined) updates.description = String(body.description).slice(0, 300);
    if (body.priceMonthly !== undefined) updates.priceMonthly = Math.max(0, Number(body.priceMonthly) || 0);
    if (body.priceYearly !== undefined) updates.priceYearly = Math.max(0, Number(body.priceYearly) || 0);
    if (Array.isArray(body.features)) updates.features = body.features.map(String).slice(0, 30);
    if (Array.isArray(body.limitations)) updates.limitations = body.limitations.map(String).slice(0, 30);
    if (body.popular !== undefined) updates.popular = Boolean(body.popular);
    if (body.active !== undefined) updates.active = Boolean(body.active);
    if (body.maxAiGenerations !== undefined) updates.maxAiGenerations = Math.max(-1, Number(body.maxAiGenerations) || 0);
    if (body.maxStorageMb !== undefined) updates.maxStorageMb = Math.max(1, Number(body.maxStorageMb) || 100);
    if (body.maxTeamMembers !== undefined) updates.maxTeamMembers = body.maxTeamMembers ? Number(body.maxTeamMembers) : undefined;
    if (body.icon !== undefined) updates.icon = String(body.icon).slice(0, 40);
    if (body.order !== undefined) updates.order = Number(body.order) || 99;
    if (body.contactSales !== undefined) updates.contactSales = Boolean(body.contactSales);
    if (body.tier !== undefined) updates.tier = String(body.tier).slice(0, 30);
    if (body.aiChatEnabled !== undefined) updates.aiChatEnabled = Boolean(body.aiChatEnabled);
    if (body.safepayPlanIdMonthly !== undefined)
      updates.safepayPlanIdMonthly = body.safepayPlanIdMonthly ? String(body.safepayPlanIdMonthly) : undefined;
    if (body.safepayPlanIdYearly !== undefined)
      updates.safepayPlanIdYearly = body.safepayPlanIdYearly ? String(body.safepayPlanIdYearly) : undefined;

    await convexMutation("admin:updatePlan", { planId: String(body.planId), ...updates });

    await convexMutation("billing:writeAuditLog", {
      serverToken: serverToken(),
      actorId: admin.data.adminUserId,
      actorEmail: admin.data.adminEmail,
      actorType: "admin",
      action: "plan.updated",
      targetType: "plan",
      targetId: String(body.planId),
      metadata: { fields: Object.keys(updates) },
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API /admin/plans PATCH] Error:", error);
    return jsonError(500, "Failed to update plan", "UPDATE_FAILED");
  }
}
