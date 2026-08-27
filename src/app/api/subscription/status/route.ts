// =============================================================================
// GET /api/subscription/status
// =============================================================================
// Get current user's account status and generation quota.
//
// PAYMENTS REMOVED: there is no payment/subscription gating anymore. Every
// signup is active instantly; the only blocking state is "suspended"
// (admin moderation). This endpoint now simply reports:
//   - accountStatus (from the live DB record, not the 7-day HMAC token)
//   - hasActiveSubscription = status !== "suspended"   (legacy field name
//     kept so existing clients keep working)
//   - plan quota: monthly generation limit + remaining, derived from the
//     user's assigned plan (default 500/month) and current-month usage.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { api } from '@convex/_generated/api'

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.substring(7)

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    // Validate session locally (HMAC, no DB lookup)
    const session = validateSessionToken(token)
    if (!session.valid || !session.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    const userId = session.user.id
    let status = session.user.status ?? 'active'
    let userPlanId = session.user.planId ?? null

    // The HMAC token embeds the status from login time and stays valid for up
    // to 7 days. Re-read the CURRENT status from the database on every call
    // so an admin suspension takes effect immediately, and fall back to the
    // token value only if the lookup infrastructure fails.
    try {
      const { getConvexClient } = await import('@/lib/convex-server')
      const convexUserClient = getConvexClient()
      const dbUser = await convexUserClient.query(api.users.getUser, {
        userId: userId as any,
      })
      if (!dbUser) {
        // Account was deleted — treat as logged out.
        return NextResponse.json(
          { success: false, error: 'Account not found', code: 'ACCOUNT_NOT_FOUND' },
          { status: 401 }
        )
      }
      status = (dbUser as any).status ?? status
      userPlanId = (dbUser as any).planId ?? null
    } catch (userErr) {
      console.warn('[API /subscription/status] Live user lookup failed, using token status:', userErr)
    }

    // Fetch plan details if user has one assigned
    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()
    let planData: any = null
    if (userPlanId) {
      try {
        planData = await convex.query(api.plans.getPlanById, { planId: userPlanId as any })
      } catch (planErr) {
        console.warn('[API /subscription/status] Could not load plan:', planErr)
      }
    }

    const suspended = status === 'suspended'

    // Determine plan name and limits from real data
    const planName = planData?.name ?? 'Free'
    const maxGenerations = suspended ? 0 : (planData?.maxAiGenerations ?? 500)
    const maxStorageMb = suspended ? 0 : (planData?.maxStorageMb ?? 5120)

    // Current-month usage for a truthful "remaining" number. Degrades
    // gracefully if the query is unavailable.
    let used = 0
    try {
      const usage = await convex.query(api.subscriptions.getMonthlyAiUsage, {
        userId: userId as any,
      })
      used = usage?.used ?? 0
    } catch (usageErr) {
      console.warn('[API /subscription/status] Usage lookup failed:', usageErr)
    }
    const remaining = Math.max(0, maxGenerations - used)

    return NextResponse.json({
      success: true,
      data: {
        // Legacy field name kept for client compatibility. "Active" now just
        // means "not suspended" since payments no longer exist.
        hasActiveSubscription: !suspended,
        accountStatus: status,
        remainingGenerations: remaining,
        usedGenerations: used,
        planLimit: maxGenerations,
        planName,
        planStorageMb: maxStorageMb,
      }
    })

  } catch (error) {
    console.error('[API /subscription/status] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get subscription status',
        code: 'FETCH_ERROR'
      },
      { status: 500 }
    )
  }
}
