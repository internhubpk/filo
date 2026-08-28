// =============================================================================
// POST /api/admin/billing/sync-safepay-plans
// =============================================================================
// Creates the recurring subscription plans on Safepay (POST
// {api}/client/plans/v1/ — the CURRENT documented plans API) for every paid,
// active Filo plan, and stores the returned Safepay plan ids on the plan rows
// (safepayPlanIdMonthly / safepayPlanIdYearly).
//
// This establishes the ONE authoritative mapping:
//
//   Filo Plan (plans table)  →  Safepay Plan ID (safepayPlanId{Monthly,Yearly})
//
// …and answers "do I have to create plans on Safepay first?" with NO — Filo
// creates them via the API. Checkout refuses to start a recurring
// subscription for any plan without this mapping (fail-closed), so run this
// once after seeding (and after adding new paid plans).
//
// IDEMPOTENCE: by default, plans that ALREADY have a mapped Safepay id are
// skipped (no duplicate plans on Safepay). Pass { force: true } to recreate
// (only needed if the Safepay account's plans were deleted/rebuilt).
//
// SECURITY: admin-only (requireAdminAccess + in-Convex admin re-check). The
// Secret Key stays server-side and is sent only to Safepay.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess, serverToken, convexQuery, convexMutation } from "@/lib/billing-server";
import { getSafepayConfig } from "@/lib/safepay";

interface PlanRow {
  _id: string;
  name: string;
  tier?: string;
  priceMonthly: number;
  priceYearly: number;
  currency?: string;
  contactSales?: boolean;
  active?: boolean;
  safepayPlanIdMonthly?: string;
  safepayPlanIdYearly?: string;
}

/** Placeholder ids the old seed shipped — never valid Safepay plan ids. */
const LEGACY_PLACEHOLDER_IDS = new Set([
  "pro-monthly",
  "pro-yearly",
  "team-monthly",
  "team-yearly",
]);

/** Extract the Safepay plan identifier from the plans API response. */
function extractPlanId(json: unknown): string | undefined {
  const j = json as
    | { data?: { id?: string; token?: string; plan_id?: string }; id?: string; token?: string; plan_id?: string }
    | null;
  return (
    j?.data?.id ??
    j?.data?.token ??
    j?.data?.plan_id ??
    j?.id ??
    j?.token ??
    j?.plan_id ??
    undefined
  );
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const body = (await request.json().catch(() => null)) as { force?: boolean } | null;
    const force = body?.force === true;

    const config = getSafepayConfig();
    if (!config.secretKey) {
      return NextResponse.json(
        { success: false, error: "SAFEPAY_SECRET_KEY is not configured on this deployment", code: "SAFEPAY_UNCONFIGURED" },
        { status: 503 }
      );
    }

    const plans = (await convexQuery<PlanRow[]>("plans:getAllPlans", {})) as PlanRow[];
    const results: Array<{
      plan: string;
      interval: "monthly" | "yearly";
      status: "created" | "skipped" | "failed";
      safepayPlanId?: string;
      detail?: string;
    }> = [];

    for (const plan of plans) {
      if (plan.contactSales || plan.active === false) continue;
      const intervals: Array<"monthly" | "yearly"> = [];
      if ((plan.priceMonthly ?? 0) > 0) intervals.push("monthly");
      if ((plan.priceYearly ?? 0) > 0) intervals.push("yearly");

      for (const interval of intervals) {
        const existing = interval === "yearly" ? plan.safepayPlanIdYearly : plan.safepayPlanIdMonthly;
        // Known seed placeholders ("pro-monthly" etc.) were never real Safepay
        // plan ids — always replace them even without force.
        const isPlaceholder = LEGACY_PLACEHOLDER_IDS.has(existing ?? "");
        if (existing && !force && !isPlaceholder) {
          results.push({ plan: plan.name, interval, status: "skipped", safepayPlanId: existing, detail: "already mapped" });
          continue;
        }

        const deterministicName = `filo-${(plan.tier ?? plan.name).toLowerCase()}-${interval}`;
        const amount = interval === "yearly" ? plan.priceYearly : plan.priceMonthly;
        const safepayInterval = interval === "yearly" ? "YEAR" : "MONTH";

        try {
          // POST {api}/client/plans/v1/ — documented subscriptions API
          // (safepay-docs → Developers → Subscriptions → Create a Plan).
          const res = await fetch(`${config.apiBase}/client/plans/v1/`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-SFPY-MERCHANT-SECRET": config.secretKey,
            },
            body: JSON.stringify({
              amount: String(amount),
              currency: plan.currency || "PKR",
              interval: safepayInterval,
              type: "RECURRING",
              interval_count: 1,
              product: deterministicName,
              active: true,
            }),
            cache: "no-store",
          });

          const text = await res.text().catch(() => "");
          if (!res.ok) {
            results.push({
              plan: plan.name,
              interval,
              status: "failed",
              detail: `Safepay plans API returned ${res.status}: ${text.slice(0, 200)}`,
            });
            continue;
          }

          const json = (await (async () => {
            try { return JSON.parse(text); } catch { return null; }
          })()) as unknown;

          const planId = extractPlanId(json);
          if (!planId) {
            results.push({
              plan: plan.name,
              interval,
              status: "failed",
              detail: `Safepay plans API returned no plan id: ${text.slice(0, 200)}`,
            });
            continue;
          }

          await convexMutation("plans:setSafepayPlanId", {
            serverToken: serverToken(),
            adminUserId: admin.data.adminUserId,
            planId: plan._id,
            interval,
            safepayPlanId: planId,
          });
          results.push({ plan: plan.name, interval, status: "created", safepayPlanId: planId });
        } catch (err) {
          results.push({
            plan: plan.name,
            interval,
            status: "failed",
            detail: err instanceof Error ? err.message : "request failed",
          });
        }
      }
    }

    const created = results.filter((r) => r.status === "created").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return NextResponse.json({
      success: failed === 0,
      data: {
        summary: `${created} created, ${results.filter((r) => r.status === "skipped").length} already mapped, ${failed} failed`,
        results,
      },
    });
  } catch (error) {
    console.error("[API /admin/billing/sync-safepay-plans] Error:", error);
    const message = error instanceof Error ? error.message : "Plan sync failed";
    return NextResponse.json({ success: false, error: message, code: "SYNC_ERROR" }, { status: 500 });
  }
}
