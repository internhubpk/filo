// =============================================================================
// POST /api/payments/submit
// =============================================================================
// Manual payment submission endpoint. Replaces the SafePay automatic
// checkout flow.
//
// Session validation uses self-contained HMAC tokens (no Convex DB lookup),
// which eliminates the "Invalid or expired session" bug caused by silent
// session-creation failures in the Convex sessions table.
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
import { api } from '@convex/_generated/api'
import { validateSessionToken } from '@/lib/session'

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

    // ---- Validate Session (self-contained HMAC token, no DB lookup) ----
    const session = validateSessionToken(token)

    if (!session.valid || !session.user) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid or expired session. Please log out and log in again.',
          code: 'INVALID_SESSION',
          reason: session.reason, // 'expired' | 'tampered' | 'malformed'
        },
        { status: 401 }
      )
    }

    const userId = session.user.id

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
    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()

    // NOTE: planId from the frontend is a slug like "pro" (string),
    // but Convex expects v.id("plans"). We store the plan slug in notes
    // and omit planId from the Convex mutation. The admin assigns the
    // correct plan when approving.
    const planNote = plan ? `Plan: ${plan.name} (${isYearly ? 'Yearly' : 'Monthly'})` : undefined
    const combinedNotes = [planNote, notes?.trim()].filter(Boolean).join(' | ') || undefined

    const verificationId = await convex.mutation(api.paymentVerifications.createVerification, {
      userId: userId as any,
      amount,
      currency: 'PKR',
      paymentMethod,
      transactionId: transactionId.trim(),
      proofUrl: proofUrl?.trim() || undefined,
      notes: combinedNotes,
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
