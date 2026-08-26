// =============================================================================
// GET /api/subscription/status
// =============================================================================
// Get current user's activation status.
//
// In the manual admin-verified payment model, access is gated by the
// `users.status` field rather than a subscription record. The values:
//   - "pending_activation" -> user signed up but admin hasn't verified payment
//   - "active"             -> admin verified payment; AI generation allowed
//   - "suspended"          -> admin revoked access
//
// We also surface the latest paymentVerification so the client can show
// "your payment is being reviewed" or "your payment was rejected: <reason>".
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'

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

    const session = await convex.query('auth:validateSession', { token })
    if (!session.valid || !session.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    const userId = session.user.id
    const status = (session.user as any).status ?? 'pending_activation'

    // Try to fetch the latest payment verification for this user so the UI
    // can show a richer status ("pending review", "rejected: <reason>").
    let latestVerification: any = null
    try {
      latestVerification = await convex.query('paymentVerifications:getLatestVerification', {
        userId,
      })
    } catch (verifErr) {
      // Non-critical - the user simply has no verification history yet
      console.warn('[API /subscription/status] Could not load latest verification:', verifErr)
    }

    // Map the user status to a subscription-style response so the existing
    // dashboard code (which checks `hasActiveSubscription`) keeps working
    // without needing a rewrite of every consumer.
    const hasActive = status === 'active'

    return NextResponse.json({
      success: true,
      data: {
        hasActiveSubscription: hasActive,
        accountStatus: status,
        remainingGenerations: hasActive ? 999 : 0,
        planLimit: hasActive ? 999 : 0,
        planName: hasActive ? 'Pro (Verified)' : 'Pending Activation',
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
