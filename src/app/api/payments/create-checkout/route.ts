// =============================================================================
// POST /api/payments/create-checkout
// =============================================================================
// Backwards-compatible route name, but the SafePay automatic checkout flow
// has been removed. This now expects the user to have already paid outside
// the app (bank transfer, EasyPaisa, JazzCash, etc.) and to be submitting
// their transaction details for admin review.
//
// The body shape is the same as /api/payments/submit — this route is kept
// so older client code that still POSTs to /create-checkout keeps working.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
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

    // ---- Parse Body ----
    const body = await request.json()
    const {
      planId,
      isYearly = false,
      paymentMethod,
      transactionId,
      amount: amountOverride,
      notes,
      proofUrl,
    } = body

    if (!paymentMethod || !transactionId) {
      return NextResponse.json(
        {
          success: false,
          error: 'paymentMethod and transactionId are required',
          code: 'MISSING_PARAMS',
        },
        { status: 400 }
      )
    }

    // ---- Validate User Session ----
    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()
    const session = await convex.query(api.auth.validateSession, { token })

    if (!session?.valid || !session?.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // ---- Resolve amount based on plan + billing period ----
    const plans: Record<string, { name: string; priceMonthly: number; priceYearly: number }> = {
      pro: { name: 'Pro', priceMonthly: 1900, priceYearly: 19000 },
      team: { name: 'Team', priceMonthly: 4900, priceYearly: 49000 },
    }

    const plan = planId ? plans[planId] : undefined
    const amount =
      typeof amountOverride === 'number' && amountOverride > 0
        ? amountOverride
        : plan
          ? (isYearly ? plan.priceYearly : plan.priceMonthly)
          : 0

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Amount could not be determined. Provide planId or amount.', code: 'MISSING_AMOUNT' },
        { status: 400 }
      )
    }

    // ---- Insert verification record ----
    const verificationId = await convex.mutation(api.paymentVerifications.createVerification, {
      userId,
      planId: planId ?? undefined,
      amount,
      currency: 'PKR',
      paymentMethod,
      transactionId,
      proofUrl: proofUrl ?? undefined,
      notes: notes ?? undefined,
    })

    console.log(`[CREATE-CHECKOUT->SUBMIT] Verification ${verificationId} created for user ${userId}`)

    return NextResponse.json({
      success: true,
      data: {
        verificationId,
        status: 'pending',
        amount,
        currency: 'PKR',
        planName: plan?.name ?? 'Custom',
        isYearly,
        message: 'Payment submission received. An admin will review and activate your account shortly.',
      },
    })

  } catch (error) {
    console.error('[CREATE-CHECKOUT] Unhandled error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
