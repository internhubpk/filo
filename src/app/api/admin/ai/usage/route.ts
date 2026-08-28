// =============================================================================
// GET /api/admin/ai/usage — AI token/context usage (admin only)
// =============================================================================
// Backs the admin dashboard's "AI usage" panel: per-generation input+output
// tokens, model/provider, status, plus per-user rollups and totals.
// Auth: unified admin guard (cookie OR DB-admin session), re-verified inside
// Convex via adminUserId. Never returns prompt content.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess, serverToken, convexQuery } from "@/lib/billing-server";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;
    const { adminUserId } = admin.data;

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);

    const usage = await convexQuery<{
      totals: {
        jobs: number;
        completed: number;
        failed: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
      perUser: Array<{
        email: string;
        jobs: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }>;
      recent: Array<{
        jobId: string;
        userEmail: string;
        userName: string;
        status: string;
        artifactType: string;
        outputFormat: string;
        model: string | null;
        provider: string | null;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        totalUnits: number;
        completedUnits: number;
        failedUnits: number;
        autoRetries: number;
        retryCount: number;
        createdAt: number;
        completedAt: number | null;
      }>;
    }>("admin:adminAiUsage", {
      serverToken: serverToken(),
      adminUserId,
      limit,
    });

    return NextResponse.json({ success: true, data: usage });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
