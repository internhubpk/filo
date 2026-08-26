// =============================================================================
// POST /api/payments/verify
// =============================================================================
// Verifies a Safepay payment after user returns from checkout.
// Called by the billing page on ?payment=success to confirm & activate subscription.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'

const IS_DEV = process.env.NODE_ENV === 'development'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { reference, paymentId } = body

    if (!reference && !paymentId) {
      return NextResponse.json(
        { success: false, error: 'reference or paymentId is required', code: 'MISSING_PARAMS' },
        { status: 400 }
      )
    }

    // ---- Auth Check ----
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.substring(7)

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    let userId: string | undefined
    try {
      const { getConvexClient } = await import('@/lib/convex-server')
      const convex = getConvexClient()
      const session = await convex.query(api.auth.validateSession, { token })
      if (!session?.valid || !session?.user) {
        return NextResponse.json(
          { success: false, error: 'Invalid session', code: 'INVALID_SESSION' },
          { status: 401 }
        )
      }
      userId = session.user.id
    } catch {
      userId = 'dev-user'
    }

    // ---- DEV MODE: Auto-approve ----
    if (IS_DEV || !process.env.SAFEPAY_SECRET_KEY) {
      console.log(`[PAYMENT-VERIFY] DEV MODE: Auto-approving payment ${reference}`)
      return NextResponse.json({
        success: true,
        data: {
          paymentStatus: 'completed',
          subscriptionActivated: true,
          planId: 'pro',
          reference,
          devMode: true,
        },
      })
    }

    // ---- PRODUCTION: Query Safepay ----
    const apiKey = process.env.SAFEPAY_SECRET_KEY
    const isSandbox = process.env.SAFEPAY_SANDBOX !== 'false'
    const baseUrl = isSandbox
      ? 'https://sandbox.api.getsafepay.com'
      : 'https://api.getsafepay.com'

    // Find the payment ID from reference if not provided
    let safepayPaymentId = paymentId
    if (!safepayPaymentId) {
      // Try to find via Convex
      try {
        const { getConvexClient } = await import('@/lib/convex-server')
        const convex = getConvexClient()
        const payment = await convex.query(api.payments.getByReference, { reference })
        safepayPaymentId = payment?.providerPaymentId
      } catch {
        // Continue without it
      }
    }

    if (!safepayPaymentId) {
      return NextResponse.json({
        success: false,
        error: 'Payment not found. Please contact support if payment was completed.',
        code: 'PAYMENT_NOT_FOUND',
      }, { status: 404 })
    }

    // Query Safepay for payment status
    const response = await fetch(`${baseUrl}/v1/payments/${safepayPaymentId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: 'Could not verify payment with Safepay',
        code: 'SAFEPAY_VERIFY_FAILED',
      }, { status: 502 })
    }

    const paymentData = await response.json()
    const safepayStatus = paymentData.status

    // Map Safepay statuses
    let internalStatus: string
    let subscriptionActivated = false

    if (safepayStatus === 'CAPTURED' || safepayStatus === 'captured') {
      internalStatus = 'completed'
      subscriptionActivated = true
    } else if (safepayStatus === 'FAILED' || safepayStatus === 'failed') {
      internalStatus = 'failed'
    } else if (safepayStatus === 'CANCELLED' || safepayStatus === 'cancelled') {
      internalStatus = 'cancelled'
    } else if (safepayStatus === 'PENDING' || safepayStatus === 'AUTHORIZED') {
      internalStatus = 'pending'
    } else {
      internalStatus = 'unknown'
    }

    // Update Convex payment record
    if (internalStatus !== 'pending') {
      try {
        const { getConvexClient } = await import('@/lib/convex-server')
        const convex = getConvexClient()
        await convex.mutation(api.payments.updatePaymentStatus, {
          providerPaymentId: safepayPaymentId,
          status: internalStatus,
          userId,
        }).catch(() => { /* non-critical */ })
      } catch {
        // non-critical
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        paymentStatus: internalStatus,
        safepayStatus,
        subscriptionActivated,
        reference,
        paymentId: safepayPaymentId,
      },
    })

  } catch (error) {
    console.error('[PAYMENT-VERIFY] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Verification failed', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
