// =============================================================================
// GET /api/subscription/status
// =============================================================================
// Get current user's activation status and plan details.
//
// In the manual admin-verified payment model, access is gated by the
// `users.status` field. The values:
//   - "pending_activation" -> user signed up but admin hasn't verified payment
//   - "active"             -> admin verified payment; AI generation allowed
//   - "suspended"          -> admin revoked access
//
// We also surface the latest paymentVerification so the client can show
// "your payment is being reviewed" or "your payment was rejected: <reason>".
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
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

    // ---- PRODUCTION: Use Convex ----
    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()

    const session = await convex.query(api.auth.validateSession, { token })
    if (!session.valid || !session.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    const userId = session.user.id
    const status = (session.user as any).status ?? 'pending_activation'
    const userPlanId = (session.user as any).planId ?? null

    // Fetch real plan details if user has a plan assigned
    let planData: any = null
    if (userPlanId) {
      try {
        planData = await convex.query(api.plans.getPlanById, { planId: userPlanId })
      } catch (planErr) {
        console.warn('[API /subscription/status] Could not load plan:', planErr)
      }
    }

    // Determine plan name and limits from real data
    const planName = planData?.name ?? (status === 'active' ? 'Verified' : 'Pending Activation')
    const maxGenerations = planData?.maxAiGenerations ?? (status === 'active' ? 500 : 0)
    const maxStorageMb = planData?.maxStorageMb ?? (status === 'active' ? 5120 : 0)
    const hasActive = status === 'active'

    // Try to fetch the latest payment verification for this user so the UI
    // can show a richer status ("pending review", "rejected: <reason>").
    let latestVerification: any = null
    try {
      latestVerification = await convex.query(api.paymentVerifications.getLatestVerification, {
        userId,
      })
    } catch (verifErr) {
      console.warn('[API /subscription/status] Could not load latest verification:', verifErr)
    }

    return NextResponse.json({
      success: true,
      data: {
        hasActiveSubscription: hasActive,
        accountStatus: status,
        remainingGenerations: hasActive ? maxGenerations : 0,
        planLimit: maxGenerations,
        planName,
        planStorageMb: maxStorageMb,
        latestVerification: latestVerification
          ? {
              id: latestVerification._id,
              status: latestVerification.status,
              amount: latestVerification.amount,
              currency: latestVerification.currency,
              paymentMethod: latestVerification.paymentMethod,
              transactionId: latestVerification.transactionId,
              adminNote: latestVerification.adminNote ?? null,
              createdAt: latestVerification.createdAt,
              reviewedAt: latestVerification.reviewedAt ?? null,
            }
          : null,
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
