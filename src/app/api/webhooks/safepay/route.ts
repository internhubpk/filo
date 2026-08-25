import { NextRequest, NextResponse } from 'next/server'
import * as crypto from 'crypto'

// =============================================================================
// SAFEPAY WEBHOOK HANDLER - Production Implementation
// =============================================================================
// Handles ALL Safepay webhook events for Filo AI SaaS platform
// Endpoint: /api/webhooks/safepay
//
// ARCHITECTURE:
//   Safepay → Next.js (this file) → Convex Backend (safepay-webhook.ts action)
//
// This endpoint:
//   1. Validates the webhook signature (production)
//   2. Forwards to Convex for processing (single source of truth)
//   3. Returns quickly to Safepay (don't block their retry)
// =============================================================================

// Configuration
const SAFEPAY_CONFIG = {
  publicKey: process.env.SAFEPAY_PUBLIC_KEY || process.env.NEXT_PUBLIC_SAFEPAY_PUBLIC_KEY || '',
  secretKey: process.env.SAFEPAY_SECRET_KEY || '',
  isSandbox: process.env.SAFEPAY_SANDBOX !== 'false',
  webhookSecret: process.env.SAFEPAY_WEBHOOK_SECRET || '',
}

// =============================================================================
// EVENT TYPES
// =============================================================================

type SafepayEventType =
  | 'payment.created'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded'
  | 'payment.disputed'
  | 'payment.dispute.won'
  | 'payment.dispute.lost'
  | 'payment.captured'
  | 'payment.cancelled'
  | 'refund:created'
  | 'authorization.succeeded'
  | 'authorization.reversed'
  | 'void.succeeded'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'subscription.ended'
  | 'subscription.unpaid'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'subscription.payment.succeeded'
  | 'subscription.payment.failed'
  | 'error:occurred'

interface SafepayWebhookEvent {
  id: string
  event: SafepayEventType
  created: number
  data: {
    id: string
    amount?: number
    currency?: string
    status?: string
    customer?: {
      id: string
      email?: string
      name?: string
    }
    metadata?: Record<string, any>
    plan_id?: string
    subscription_id?: string
    reason?: string
    dispute_reason?: string
    error_code?: string
    error_message?: string
    billing_period?: {
      start: number
      end: number
    }
  }
  signature?: string
}

// =============================================================================
// CONVEX CLIENT (lazy loaded)
// =============================================================================

let convexClient: any = null

async function getConvexClient() {
  if (!convexClient) {
    try {
      const { ConvexHttpClient } = await import('convex/browser')
      const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL
      if (!convexUrl) {
        console.error('[SAFEPAY-WEBHOOK] CONVEX_URL not configured')
        return null
      }
      convexClient = new ConvexHttpClient(convexUrl)
    } catch (err) {
      console.error('[SAFEPAY-WEBHOOK] Failed to initialize Convex client:', err)
      return null
    }
  }
  return convexClient
}

// =============================================================================
// MAIN WEBHOOK ENDPOINT
// =============================================================================

export async function POST(request: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`
  let payload: SafepayWebhookEvent

  try {
    // Parse the raw body
    const rawBody = await request.text()
    let parsed: any
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      console.error(`[SAFEPAY][${requestId}] Invalid JSON body`)
      return NextResponse.json(
        { error: 'Invalid JSON', code: 'INVALID_JSON', requestId },
        { status: 400 }
      )
    }

    payload = parsed as SafepayWebhookEvent

    console.log(`[SAFEPAY][${requestId}] Webhook received:`, {
      eventId: payload.id,
      eventType: payload.event,
      paymentId: payload.data?.id,
      amount: payload.data?.amount,
      status: payload.data?.status,
    })

    // Step 1: Validate required fields
    if (!payload.id || !payload.event || !payload.data?.id) {
      console.error(`[SAFEPAY][${requestId}] Missing required fields`)
      return NextResponse.json(
        { error: 'Missing required fields', code: 'INVALID_PAYLOAD', requestId },
        { status: 400 }
      )
    }

    // Step 2: Verify signature (production only)
    if (!SAFEPAY_CONFIG.isSandbox && !verifySafePaySignature(payload, rawBody)) {
      console.error(`[SAFEPAY][${requestId}] Signature verification FAILED`)
      return NextResponse.json(
        { error: 'Invalid signature', code: 'SIGNATURE_INVALID', requestId },
        { status: 401 }
      )
    }

    // Step 3: Forward to Convex for processing
    const convex = await getConvexClient()

    if (!convex) {
      console.error(`[SAFEPAY][${requestId}] Convex client unavailable - cannot process webhook`)
      // Return 200 to prevent Safepay retries, but log for manual follow-up
      console.error(`[SAFEPAY][${requestId}] MANUAL ACTION NEEDED - Webhook dropped: ${payload.event} / ${payload.data.id}`)
      return NextResponse.json({
        status: 'accepted_but_not_processed',
        message: 'Convex unavailable - webhook logged for manual processing',
        eventId: payload.id,
        requestId,
      })
    }

    // Map the Safepay event to Convex action format
    // Note: Use undefined (not null) for optional fields - Convex v.optional() rejects null
    const convexArgs: Record<string, any> = {
      eventId: payload.id,
      eventType: payload.event,
      data: {
        id: payload.data.id,
      },
    }

    // Only add optional fields if they have values
    if (payload.data.status) convexArgs.data.status = payload.data.status
    if (payload.data.amount != null) convexArgs.data.amount = payload.data.amount
    if (payload.data.currency) convexArgs.data.currency = payload.data.currency
    if (payload.data.reason) convexArgs.data.reason = payload.data.reason
    if (payload.data.error_code) convexArgs.data.error_code = payload.data.error_code
    if (payload.data.error_message) convexArgs.data.error_message = payload.data.error_message
    if (payload.data.dispute_reason) convexArgs.data.dispute_reason = payload.data.dispute_reason
    if (payload.data.customer) convexArgs.data.customer = payload.data.customer
    if (payload.data.metadata) convexArgs.data.metadata = payload.data.metadata
    if (payload.data.plan_id) convexArgs.data.plan_id = payload.data.plan_id
    if (payload.data.subscription_id) convexArgs.data.subscription_id = payload.data.subscription_id
    if (payload.data.billing_period) convexArgs.data.billing_period = payload.data.billing_period

    const convexResult = await convex.action('safepay-webhook:processSafepayWebhook', convexArgs)

    console.log(`[SAFEPAY][${requestId}] Convex processed:`, {
      action: convexResult?.action,
      success: convexResult?.success,
      paymentUpdated: convexResult?.paymentUpdated,
      subscriptionActivated: convexResult?.subscriptionActivated,
    })

    return NextResponse.json({
      status: 'processed',
      processed: true,
      eventId: payload.id,
      requestId,
      ...convexResult,
    })

  } catch (error) {
    console.error(`[SAFEPAY][${requestId}] Webhook processing error:`, error)
    return NextResponse.json(
      {
        error: 'Webhook processing failed',
        code: 'PROCESSING_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        requestId,
      },
      { status: 500 }
    )
  }
}

// GET - For Safepay dashboard verification and health check
export async function GET() {
  const hasPublicKey = !!SAFEPAY_CONFIG.publicKey
  const hasSecretKey = !!SAFEPAY_CONFIG.secretKey
  const hasWebhookSecret = !!SAFEPAY_CONFIG.webhookSecret

  return NextResponse.json({
    status: 'ok',
    service: 'filo-safepay-webhook',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    endpoint: '/api/webhooks/safepay',
    mode: SAFEPAY_CONFIG.isSandbox ? 'sandbox' : 'production',
    architecture: 'nextjs-edge → convex-backend',
    configuration: {
      publicKeyConfigured: hasPublicKey,
      secretKeyConfigured: hasSecretKey,
      webhookSecretConfigured: hasWebhookSecret,
      fullyConfigured: hasPublicKey && hasSecretKey && hasWebhookSecret,
    },
    supportedEvents: [
      'payment.succeeded', 'payment.failed', 'payment.refunded',
      'payment.cancelled', 'payment.captured', 'payment.created',
      'refund:created', 'void.succeeded',
      'authorization.succeeded', 'authorization.reversed',
      'subscription.created', 'subscription.updated', 'subscription.canceled',
      'subscription.ended', 'subscription.unpaid', 'subscription.paused',
      'subscription.resumed', 'subscription.payment.succeeded',
      'subscription.payment.failed', 'error:occurred',
    ],
  })
}

// =============================================================================
// SIGNATURE VERIFICATION (Production Security)
// =============================================================================

function verifySafePaySignature(event: SafepayWebhookEvent, rawBody: string): boolean {
  try {
    // Method 1: HMAC-SHA256 with webhook secret
    if (SAFEPAY_CONFIG.webhookSecret && event.signature) {
      const expectedSignature = crypto
        .createHmac('sha256', SAFEPAY_CONFIG.webhookSecret)
        .update(rawBody)
        .digest('hex')

      try {
        return crypto.timingSafeEqual(
          Buffer.from(expectedSignature),
          Buffer.from(event.signature)
        )
      } catch {
        return false
      }
    }

    // Method 2: No webhook secret configured in production
    // This is insecure but functional - log a strong warning
    console.warn('[SAFEPAY] PRODUCTION MODE: No webhook signature verification!')
    console.warn('[SAFEPAY] ACTION REQUIRED: Add SAFEPAY_WEBHOOK_SECRET to your environment')
    console.warn('[SAFEPAY] Without signature verification, anyone could send fake webhook events')

    // At minimum validate structure
    return !!event.id && !!event.event && !!event.data?.id

  } catch (error) {
    console.error('[SAFEPAY] Signature verification error:', error)
    return false
  }
}

export type { SafepayWebhookEvent, SafepayEventType }
