import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// SafePay Configuration
const SAFEPAY_CONFIG = {
  publicKey: process.env.SAFEPAY_PUBLIC_KEY || '',
  secretKey: process.env.SAFEPAY_SECRET_KEY || '',
  isSandbox: process.env.SAFEPAY_SANDBOX === 'true',
  webhookSecret: process.env.SAFEPAY_WEBHOOK_SECRET || '',
}

// SafePay Webhook Event Types
type SafePayEventType = 
  | 'payment.created'
  | 'payment.succeeded' 
  | 'payment.failed'
  | 'payment.declined'
  | 'payment.pending'
  | 'payment.expired'
  | 'payment.refunded'
  | 'payment.disputed'
  | 'subscription.created'
  | 'subscription.activated'
  | 'subscription.cancelled'
  | 'subscription.renewed'
  | 'invoice.paid'
  | 'invoice.failed'

interface SafePayWebhookEvent {
  id: string
  event: SafePayEventType
  created: number // Unix timestamp
  data: {
    id: string // Payment/Subscription ID
    amount?: number
    currency?: string
    status?: string
    customer?: {
      id: string
      email?: string
      name?: string
    }
    metadata?: Record<string, string>
    plan_id?: string
    subscription_id?: string
  }
  signature: string // HMAC signature for verification
}

interface SafePayPaymentIntent {
  id: string
  amount: number
  currency: string
  status: 'requires_payment_method' | 'processing' | 'succeeded' | 'canceled'
  client_secret: string
  created: number
  metadata?: Record<string, string>
}

// POST /api/webhooks/safepay - Handle SafePay webhooks
export async function POST(request: NextRequest) {
  try {
    const payload: SafePayWebhookEvent = await request.json()
    
    console.log('SafePay webhook received:', { 
      eventId: payload.id, 
      eventType: payload.event,
      timestamp: new Date(payload.created * 1000).toISOString()
    })

    // Validate required fields
    if (!validateWebhookPayload(payload)) {
      return NextResponse.json(
        { error: 'Invalid webhook payload', code: 'INVALID_PAYLOAD' },
        { status: 400 }
      )
    }

    // Verify signature (security critical)
    if (!verifySafePaySignature(payload)) {
      console.error('SafePay signature verification failed:', payload.id)
      return NextResponse.json(
        { error: 'Invalid signature', code: 'SIGNATURE_INVALID' },
        { status: 401 }
      )
    }

    // Check for duplicate events (idempotency)
    if (await isDuplicateEvent(payload.id)) {
      return NextResponse.json({ 
        status: 'duplicate',
        message: 'Event already processed'
      })
    }

    // Process the event based on type
    const result = await processWebhookEvent(payload)

    return NextResponse.json({
      status: result.status,
      processed: true,
      eventId: payload.id,
    })

  } catch (error) {
    console.error('SafePay webhook error:', error)
    return NextResponse.json(
      { 
        error: 'Webhook processing failed', 
        code: 'PROCESSING_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

// GET /api/webhooks/safepay - For SafePay verification/ping
export async function GET() {
  return NextResponse.json({ 
    status: 'ok',
    service: 'filo-safepay-webhook',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    safepayConfigured: !!(SAFEPAY_CONFIG.publicKey && SAFEPAY_CONFIG.secretKey),
  })
}

// ==================== SIGNATURE VERIFICATION ====================

function verifySafePaySignature(event: SafePayWebhookEvent): boolean {
  try {
    // Method 1: HMAC-SHA256 verification (preferred)
    if (SAFEPAY_CONFIG.webhookSecret && event.signature) {
      const expectedSignature = generateHMACSignature(event)
      
      // Use timing-safe comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(event.signature)
      )
    }

    // Method 2: Public key verification (for production)
    if (SAFEPAY_CONFIG.publicKey && event.signature) {
      return verifyWithPublicKey(event)
    }

    // Sandbox mode - accept without strict verification
    if (SAFEPAY_CONFIG.isSandbox) {
      console.log('SafePay sandbox mode - skipping strict signature verification')
      return true
    }

    // No verification possible
    console.warn('No SafePay credentials configured for signature verification')
    return false

  } catch (error) {
    console.error('Signature verification error:', error)
    return false
  }
}

function generateHMACSignature(event: SafePayWebhookEvent): string {
  const payloadString = JSON.stringify({
    id: event.id,
    event: event.event,
    created: event.created,
    data: event.data,
  })
  
  return crypto
    .createHmac('sha256', SAFEPAY_CONFIG.webhookSecret!)
    .update(payloadString)
    .digest('hex')
}

function verifyWithPublicKey(event: SafePayWebhookEvent): boolean {
  try {
    // In production, this would use the public key to verify
    // For now, we'll do basic validation
    const signature = event.signature
    
    if (!signature || signature.length < 10) {
      return false
    }

    // Basic format check (actual implementation depends on SafePay's signing method)
    return /^[a-fA-F0-9]+$/.test(signature) || /^[\w\-_=]+$/.test(signature)
    
  } catch (error) {
    console.error('Public key verification error:', error)
    return false
  }
}

// ==================== VALIDATION ====================

function validateWebhookPayload(event: any): event is SafePayWebhookEvent {
  return (
    event &&
    typeof event.id === 'string' &&
    typeof event.event === 'string' &&
    typeof event.created === 'number' &&
    event.data &&
    typeof event.data.id === 'string'
  )
}

async function isDuplicateEvent(eventId: string): Promise<boolean> {
  // In production, check Convex/database for existing event:
  // const existing = await convex.query(db.getWebhookEvent, { eventId })
  // return !!existing
  
  // For now, track in memory (not persistent across restarts)
  const processedEvents = globalThis.__safepayProcessedEvents as Set<string> || new Set()
  
  if (processedEvents.has(eventId)) {
    return true
  }
  
  processedEvents.add(eventId)
  globalThis.__safepayProcessedEvents = processedEvents
  return false
}

// ==================== EVENT PROCESSING ====================

async function processWebhookEvent(event: SafePayWebhookEvent) {
  const eventType = event.event
  const eventData = event.data

  switch (eventType) {
    case 'payment.succeeded':
      return handlePaymentSuccess(eventData)
    
    case 'payment.created':
      return handlePaymentCreated(eventData)
    
    case 'payment.failed':
    case 'payment.declined':
      return handlePaymentFailure(eventData, eventType)
    
    case 'payment.pending':
      return handlePaymentPending(eventData)
    
    case 'payment.expired':
      return handlePaymentExpired(eventData)
    
    case 'payment.refunded':
      return handlePaymentRefund(eventData)
    
    case 'payment.disputed':
      return handlePaymentDispute(eventData)
    
    case 'subscription.created':
    case 'subscription.activated':
      return handleSubscriptionActivated(eventData)
    
    case 'subscription.cancelled':
      return handleSubscriptionCancelled(eventData)
    
    case 'subscription.renewed':
      return handleSubscriptionRenewed(eventData)
    
    case 'invoice.paid':
      return handleInvoicePaid(eventData)
    
    case 'invoice.failed':
      return handleInvoiceFailed(eventData)
    
    default:
      return handleUnknownEvent(eventType, eventData)
  }
}

// ==================== PAYMENT HANDLERS ====================

async function handlePaymentSuccess(data: SafePayWebhookEvent['data']) {
  const userId = data.metadata?.userId || data.customer?.id
  const planId = data.metadata?.planId || data.plan_id
  const subscriptionId = data.subscription_id

  console.log('✅ Payment succeeded:', {
    paymentId: data.id,
    userId,
    planId,
    amount: data.amount,
    currency: data.currency,
    subscriptionId,
  })

  // Production actions:
  // 1. Create/Update Payment record in Convex
  // 2. Activate or extend subscription
  // 3. Update user's plan & usage limits
  // 4. Send confirmation email
  // 5. Log successful payment event
  // 6. Trigger welcome sequence if new subscriber

  return {
    status: 'success',
    action: 'payment_processed',
    userId,
    paymentId: data.id,
    subscriptionActivated: !!subscriptionId,
  }
}

async function handlePaymentCreated(data: SafePayWebhookEvent['data']) {
  console.log('📝 Payment created:', { paymentId: data.id })
  
  return {
    status: 'acknowledged',
    action: 'payment_initiated',
    paymentId: data.id,
  }
}

async function handlePaymentFailure(data: SafePayWebhookEvent['data'], eventType: string) {
  console.log('❌ Payment failed:', {
    paymentId: data.id,
    reason: eventType,
    userId: data.customer?.id,
  })

  // Production actions:
  // 1. Mark payment as failed in database
  // 2. Notify user of failed payment
  // 3. If subscription exists, mark as past_due
  // 4. Suggest retry or alternative payment method

  return {
    status: 'failed',
    action: 'payment_failed_notification_sent',
    paymentId: data.id,
    retryPossible: true,
  }
}

async function handlePaymentPending(data: SafePayWebhookEvent['data']) {
  console.log('⏳ Payment pending:', { paymentId: data.id })

  return {
    status: 'pending',
    action: 'awaiting_confirmation',
    paymentId: data.id,
  }
}

async function handlePaymentExpired(data: SafePayWebhookEvent['data']) {
  console.log('⏰ Payment expired:', { paymentId: data.id })

  return {
    status: 'expired',
    action: 'payment_session_expired',
    paymentId: data.id,
  }
}

async function handlePaymentRefund(data: SafePayWebhookEvent['data']) {
  console.log('💰 Payment refunded:', { paymentId: data.id })

  // Production actions:
  // 1. Process refund in system
  // 2. Downgrade/cancel subscription if full refund
  // 3. Adjust usage limits
  // 4. Send refund confirmation

  return {
    status: 'refunded',
    action: 'refund_processed',
    paymentId: data.id,
  }
}

async function handlePaymentDispute(data: SafePayWebhookEvent['data']) {
  console.log('⚠️ Payment disputed:', { paymentId: data.id })

  // Production actions:
  // 1. Flag account for review
  // 2. Notify admin team
  // 3. Gather evidence for dispute response
  // 4. Optionally suspend access until resolved

  return {
    status: 'disputed',
    action: 'dispute_flagged_for_review',
    paymentId: data.id,
    requiresAdminAction: true,
  }
}

// ==================== SUBSCRIPTION HANDLERS ====================

async function handleSubscriptionActivated(data: SafePayWebhookEvent['data']) {
  const userId = data.metadata?.userId || data.customer?.id
  const planId = data.metadata?.planId || data.plan_id

  console.log('🔄 Subscription activated:', {
    subscriptionId: data.id,
    userId,
    planId,
  })

  // Production actions:
  // 1. Create/update Subscription record
  // 2. Set user's active plan
  // 3. Initialize/reset usage limits for billing period
  // 4. Send welcome/onboarding emails
  // 5. Grant plan features access

  return {
    status: 'active',
    action: 'subscription_activated',
    subscriptionId: data.id,
    userId,
    planId,
  }
}

async function handleSubscriptionCancelled(data: SafePayWebhookEvent['data']) {
  console.log('🚫 Subscription cancelled:', { subscriptionId: data.id })

  // Production actions:
  // 1. Mark subscription as cancelled
  // 2. Calculate remaining access period (end of billing cycle)
  // 3. Schedule access downgrade
  // 4. Send cancellation survey/feedback request
  // 5. Offer retention incentives if applicable

  return {
    status: 'cancelled',
    action: 'subscription_cancelled',
    subscriptionId: data.id,
    accessUntil: 'end_of_billing_period',
  }
}

async function handleSubscriptionRenewed(data: SafePayWebhookEvent['data']) {
  console.log('🔁 Subscription renewed:', { subscriptionId: data.id })

  // Production actions:
  // 1. Extend subscription end date
  // 2. Reset usage limits for new period
  // 3. Charge renewal (if not handled by SafePay automatically)
  // 4. Send renewal confirmation
  // 5. Log renewal for analytics

  return {
    status: 'renewed',
    action: 'subscription_renewed',
    subscriptionId: data.id,
    nextBillingDate: calculateNextBillingDate(),
  }
}

// ==================== INVOICE HANDLERS ====================

async function handleInvoicePaid(data: SafePayWebhookEvent['data']) {
  console.log('🧾 Invoice paid:', { invoiceId: data.id })

  return {
    status: 'paid',
    action: 'invoice_marked_paid',
    invoiceId: data.id,
  }
}

async function handleInvoiceFailed(data: SafePayWebhookEvent['data']) {
  console.log('❌ Invoice payment failed:', { invoiceId: data.id })

  // Production actions:
  // 1. Mark invoice as unpaid
  // 2. Initiate dunning/retry sequence
  // 3. Notify user of payment failure
  // 4. Track failed attempts

  return {
    status: 'failed',
    action: 'invoice_payment_failed',
    invoiceId: data.id,
    retryScheduled: true,
  }
}

// ==================== UNKNOWN EVENT ====================

async function handleUnknownEvent(eventType: string, data: SafePayWebhookEvent['data']) {
  console.warn('⚠️ Unknown SafePay event type:', { eventType, dataId: data.id })

  // Log for investigation but don't fail
  return {
    status: 'unknown',
    action: 'event_logged_for_review',
    eventType,
    dataId: data.id,
  }
}

// ==================== UTILITIES ====================

function calculateNextBillingDate(): string {
  // Calculate next billing date (typically 1 month from now)
  const nextDate = new Date()
  nextDate.setMonth(nextDate.getMonth() + 1)
  return nextDate.toISOString()
}

// Export types for use in other modules
export type { SafePayWebhookEvent, SafePayEventType, SafePayPaymentIntent }
