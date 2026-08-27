// =============================================================================
// GET /api/admin/stats — admin overview KPIs (real Convex aggregates)
// =============================================================================
// Auth: unified admin guard (cookie OR DB-admin session), re-verified inside
// Convex via adminUserId. Returns user/subscription/payment/usage KPIs.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess, serverToken, convexQuery, jsonError } from "@/lib/billing-server";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;
    const { adminUserId } = admin.data;

    const [analytics, billing] = await Promise.all([
      convexQuery<{
        totals: { users: number; activeUsers: number; suspendedUsers: number; artifacts: number };
        planDistribution: Array<{ name: string; tier: string; count: number }>;
        artifactTypes: Array<{ type: string; count: number }>;
      }>("billing:adminAnalytics", {
        serverToken: serverToken(),
        adminUserId,
        days: 30,
      }),
      convexQuery<{
        activeSubscriptions: number;
        canceledSubscriptions: number;
        pendingSubscriptions: number;
        pastDueSubscriptions: number;
        mrrPkr: number;
        revenuePkr: number;
        totalPayments: number;
        failedPayments: number;
        refundedPayments: number;
        paidUserIds: number;
      }>("billing:adminBillingStats", {
        serverToken: serverToken(),
        adminUserId,
      }),
    ]);

    // Storage total (sum of file sizes) computed in Convex.
    const storage = await convexQuery<number>("admin:adminStorageTotal", {
      serverToken: serverToken(),
      adminUserId,
    }).catch(() => 0);

    return NextResponse.json({
      success: true,
      data: {
        totals: {
          ...analytics.totals,
          paidUsers: billing.paidUserIds,
          freeUsers: Math.max(0, analytics.totals.users - billing.paidUserIds),
          storageBytes: storage,
        },
        billing,
        planDistribution: analytics.planDistribution,
        artifactTypes: analytics.artifactTypes,
        generatedAt: Date.now(),
      },
    });
  } catch (error) {
    console.error("[API /admin/stats] Error:", error);
    return jsonError(500, "Failed to load admin stats", "FETCH_ERROR");
  }
}
