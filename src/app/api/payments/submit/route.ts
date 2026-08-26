// =============================================================================
// POST /api/payments/submit
// =============================================================================
// Manual payment submission endpoint. Replaces the SafePay automatic
// checkout flow.
//
// The user pays externally (bank transfer, EasyPaisa, JazzCash, etc.) and
// submits their transaction details here. A `paymentVerification` record is
// created in Convex with status="pending". An admin reviews it in /admin
// and either approves (which activates the user account) or rejects (with
// a reason that gets surfaced back to the user).
//
// Body:
//   {
//     planId?: "pro" | "team" | "department",     // optional - falls back to amount
//     isYearly?: boolean,
//     amount?: number,                            // optional override (PKR)
//     paymentMethod: "bank_transfer" | "easypaisa" | "jazzcash" | "other",
//     transactionId: string,                     // user-submitted TRX ID
//     proofUrl?: string,                          // optional screenshot URL
//     notes?: string                              // optional user notes
//   }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'

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

    const validMethods = ['bank_transfer', 'easypaisa', 'jazzcash', 'other']
    if (!validMethods.includes(paymentMethod)) {
      return NextResponse.json(
        {
          success: false,
          error: `paymentMethod must be one of: ${validMethods.join(', ')}`,
          code: 'INVALID_PAYMENT_METHOD',
        },
        { status: 400 }
      )
    }

    if (typeof transactionId !== 'string' || transactionId.trim().length < 3) {
      return NextResponse.json(
        {
          success: false,
          error: 'transactionId must be at least 3 characters',
          code: 'INVALID_TRANSACTION_ID',
        },
        { status: 400 }
      )
    }

    // ---- Validate User Session ----
    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()
    const session = await convex.query('auth:validateSession', { token })

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
    const verificationId = await convex.mutation('paymentVerifications:createVerification', {
      userId,
      planId: planId ?? undefined,
      amount,
      currency: 'PKR',
      paymentMethod,
      transactionId: transactionId.trim(),
      proofUrl: proofUrl?.trim() || undefined,
      notes: notes?.trim() || undefined,
    })

    console.log(`[PAYMENTS-SUBMIT] Verification ${verificationId} created for user ${userId}`)

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
    console.error('[PAYMENTS-SUBMIT] Unhandled error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
