// =============================================================================
// POST /api/payments/create-checkout
// =============================================================================
// Creates a Safepay checkout session for subscription payment.
// Frontend calls this, which then calls Convex or directly calls Safepay API.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'

const IS_DEV = process.env.NODE_ENV === 'development'

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
    const { planId, isYearly = false, userEmail, userName } = body

    if (!planId) {
      return NextResponse.json(
        { success: false, error: 'planId is required', code: 'MISSING_PLAN' },
        { status: 400 }
      )
    }

    // ---- Validate User Session ----
    let userId: string | undefined
    let email: string | undefined

    try {
      const { getConvexClient } = await import('@/lib/convex-server')
      const convex = getConvexClient()
      const session = await convex.query(api.auth.validateSession, { token })

      if (!session?.valid || !session?.user) {
        return NextResponse.json(
          { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
          { status: 401 }
        )
      }

      userId = session.user.id
      email = session.user.email
    } catch (convexErr) {
      // Dev fallback: generate a dev user ID
      console.warn('[CREATE-CHECKOUT] Convex unavailable, using dev fallback')
      userId = 'dev-user'
      email = userEmail || 'dev@filo.ai'
    }

    // ---- Resolve Plan Details ----
    const plans: Record<string, { name: string; priceMonthly: number; priceYearly: number }> = {
      pro: { name: 'Pro', priceMonthly: 1900, priceYearly: 19000 },
      team: { name: 'Team', priceMonthly: 4900, priceYearly: 49000 },
    }

    const plan = plans[planId]
    if (!plan) {
      return NextResponse.json(
        { success: false, error: `Unknown plan: ${planId}`, code: 'PLAN_NOT_FOUND' },
        { status: 400 }
      )
    }

    const amount = isYearly ? plan.priceYearly : plan.priceMonthly
    if (amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'This plan requires contacting sales', code: 'CONTACT_SALES' },
        { status: 400 }
      )
    }

    // ---- Generate Reference ----
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 8)
    const reference = `FLO-${timestamp}-${random}`.toUpperCase()

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const isSandbox = process.env.SAFEPAY_SANDBOX !== 'false'
    const safepayBaseUrl = isSandbox
      ? 'https://sandbox.api.getsafepay.com'
      : 'https://api.getsafepay.com'

    // ---- DEV MODE: Return a mock checkout ----
    if (IS_DEV || !process.env.SAFEPAY_SECRET_KEY) {
      console.log(`[CREATE-CHECKOUT] DEV MODE: Mock checkout for ${plan.name}`)
      return NextResponse.json({
        success: true,
        data: {
          checkoutUrl: `${appUrl}/billing?payment=success&ref=${reference}&plan=${planId}&yearly=${isYearly}`,
          checkoutToken: 'dev-mock-token',
          reference,
          amount,
          currency: 'PKR',
          planName: plan.name,
          isYearly,
          isSandbox: true,
          devMode: true,
        },
      })
    }

    // ---- PRODUCTION: Call Safepay API directly ----
    const apiKey = process.env.SAFEPAY_SECRET_KEY
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'Payment gateway not configured', code: 'SAFEPAY_NOT_CONFIGURED' },
        { status: 503 }
      )
    }

    console.log(`[CREATE-CHECKOUT] Creating Safepay checkout: ${reference} for user ${userId}`)

    const safepayResponse = await fetch(`${safepayBaseUrl}/v1/checkouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        amount,
        currency: 'PKR',
        reference,
        description: `Filo ${plan.name} - ${isYearly ? 'Yearly' : 'Monthly'}`,
        metadata: {
          userId,
          planId,
          email: email || userEmail,
          name: userName,
          isYearly,
          reference,
          source: 'filo-web',
        },
        redirect_url: `${appUrl}/billing?payment=success&ref=${reference}`,
        cancel_url: `${appUrl}/billing?payment=cancelled&ref=${reference}`,
      }),
    })

    if (!safepayResponse.ok) {
      const errorData = await safepayResponse.text()
      console.error(`[CREATE-CHECKOUT] Safepay API error (${safepayResponse.status}):`, errorData)
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to create payment session',
          code: 'SAFEPAY_API_ERROR',
          details: errorData,
        },
        { status: 502 }
      )
    }

    const checkoutData = await safepayResponse.json()
    console.log(`[CREATE-CHECKOUT] Safepay checkout created: ${checkoutData.data?.id || 'unknown'}`)

    // ---- Save pending payment record to Convex (non-blocking) ----
    try {
      const { getConvexClient } = await import('@/lib/convex-server')
      const convex = getConvexClient()
      await convex.mutation(api.payments.createPendingPayment, {
        userId,
        amount,
        currency: 'PKR',
        providerPaymentId: checkoutData.data?.id,
        reference,
        planId,
        isYearly,
        description: `Filo ${plan.name} - ${isYearly ? 'Yearly' : 'Monthly'} (${reference})`,
      }).catch(() => { /* non-critical */ })
    } catch {
      // Non-critical
    }

    return NextResponse.json({
      success: true,
      data: {
        checkoutUrl: checkoutData.data?.url,
        checkoutToken: checkoutData.data?.token,
        paymentId: checkoutData.data?.id,
        reference,
        amount,
        currency: 'PKR',
        planName: plan.name,
        isYearly,
        isSandbox,
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
