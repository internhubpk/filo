// =============================================================================
// POST /api/payments/verify
// =============================================================================
// In the new manual admin-verified payment flow there is no automatic
// verification step. This route now returns the user's latest payment
// verification record so the billing page can render the current state
// (pending review / approved / rejected with reason).
//
// Body (optional):
//   { reference?: string }   // if provided, look up a specific verification by id
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { api } from '@convex/_generated/api'

export async function POST(request: NextRequest) {
  try {
    // ---- Auth Check ----
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

    if (!session?.valid || !session?.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // Fetch the user's latest verification so we can surface its state.
    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()
    const latest = await convex.query(api.paymentVerifications.getLatestVerification, {
      userId: userId as any,
    })

    if (!latest) {
      return NextResponse.json({
        success: true,
        data: {
          paymentStatus: 'none',
          subscriptionActivated: false,
          message: 'No payment submission found. Please submit your payment details.',
        },
      })
    }

    const activated = latest.status === 'approved'

    return NextResponse.json({
      success: true,
      data: {
        paymentStatus: latest.status, // pending | approved | rejected
        subscriptionActivated: activated,
        verificationId: latest._id,
        amount: latest.amount,
        currency: latest.currency,
        paymentMethod: latest.paymentMethod,
        transactionId: latest.transactionId,
        adminNote: latest.adminNote ?? null,
        createdAt: latest.createdAt,
        reviewedAt: latest.reviewedAt ?? null,
        message:
          latest.status === 'pending'
            ? 'Your payment is being reviewed by an admin. AI generation will unlock once approved.'
            : latest.status === 'approved'
              ? 'Payment verified. Your account is active.'
              : latest.status === 'rejected'
                ? `Payment rejected: ${latest.adminNote ?? 'Please re-submit with correct details.'}`
                : '',
      },
    })

  } catch (error) {
    console.error('[PAYMENTS-VERIFY] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Verification failed', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
