// =============================================================================
// GET /api/billing/subscription
// =============================================================================
// Real billing overview for the signed-in user, straight from Convex:
//   - subscription (lifecycle state machine state + period window)
//   - plan (limits + price, DB-driven)
//   - payment history (Safepay-backed)
//   - live usage (generations this month, storage bytes, artifact counts)
//
// Also accepts POST for the legacy /api/subscription/status shape consumed
// by older clients (quota fields).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUser, serverToken, convexQuery, jsonError } from "@/lib/billing-server";
import { isSafepayConfigured } from "@/lib/safepay";

interface BillingOverview {
  user: { name: string; email: string; status: string };
  subscription: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
  payments: Array<Record<string, unknown>>;
  usage: {
    generations: number;
    uploads: number;
    storageBytes: number;
    fileCount: number;
    artifactCount: number;
    periodStart: number;
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (!auth.ok) return auth.response;
    const { user } = auth.data;

    const overview = await convexQuery<BillingOverview | null>("billing:getBillingOverview", {
      serverToken: serverToken(),
      userId: user.id,
    });
    if (!overview) {
      return jsonError(404, "Account not found", "ACCOUNT_NOT_FOUND");
    }

    const plan = overview.plan as
      | { name?: string; maxAiGenerations?: number; maxStorageMb?: number; tier?: string }
      | null;

    const limit = overview.user.status === "suspended" ? 0 : (plan?.maxAiGenerations ?? 25);
    const remaining = Math.max(0, limit - overview.usage.generations);

    return NextResponse.json({
      success: true,
      data: {
        accountStatus: overview.user.status,
        subscription: overview.subscription,
        plan: overview.plan,
        payments: overview.payments,
        usage: overview.usage,
        // Convenience quota fields (real values, computed from DB rows):
        planName: plan?.name ?? "Free",
        planTier: plan?.tier ?? "free",
        planLimit: limit,
        planStorageMb: plan?.maxStorageMb ?? 200,
        usedGenerations: overview.usage.generations,
        remainingGenerations: remaining,
        billingEnabled: isSafepayConfigured(),
      },
    });
  } catch (error) {
    console.error("[API /billing/subscription] Error:", error);
    return jsonError(500, "Failed to load billing overview", "FETCH_ERROR");
  }
}

// Legacy POST shape kept so existing clients (apiClient.getSubscriptionStatus)
// continue to receive the quota fields they expect.
export async function POST(request: NextRequest) {
  return GET(request);
}
