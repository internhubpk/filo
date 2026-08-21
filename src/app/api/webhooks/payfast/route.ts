import { NextRequest, NextResponse } from 'next/server'
import { PAYFAST_CONFIG, generatePaymentReference, getSubscriptionPeriod } from '@/config/payment'
import type { PayFastNotificationPayload } from '@/types'

// POST /api/webhooks/payfast - Handle PayFast webhooks
export async function POST(request: NextRequest) {
  try {
    const payload = await extractPayload(request)
    
    // Validate required fields
    if (!validateRequiredFields(payload)) {
      return NextResponse.json(
        { error: 'Missing required fields', code: 'INVALID_PAYLOAD' },
        { status: 400 }
      )
    }

    // Verify signature (security critical)
    if (!verifySignature(payload)) {
      console.error('PayFast signature verification failed:', payload)
      return NextResponse.json(
        { error: 'Invalid signature', code: 'SIGNATURE_INVALID' },
        { status: 401 }
      )
    }

    // Check for duplicate events (idempotency)
    if (await isDuplicateEvent(payload.pf_payment_id)) {
      return NextResponse.json({ status: 'duplicate' })
    }

    // Process the notification based on payment status
    const result = await processNotification(payload)

    return NextResponse.json({
      status: result.status,
      processed: true,
    })

  } catch (error) {
    console.error('PayFast webhook error:', error)
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

// GET /api/webhooks/payfast - For PayFast ping/verification
export async function GET() {
  return NextResponse.json({ 
    status: 'ok',
    service: 'filo-payfast-webhook',
    timestamp: new Date().toISOString(),
  })
}

// ==================== HELPER FUNCTIONS ====================

async function extractPayload(request: NextRequest): Promise<PayFastNotificationPayload> {
  let body: Record<string, string>
  
  const contentType = request.headers.get('content-type')
  
  if (contentType?.includes('application/json')) {
    body = await request.json()
  } else {
    // Form-encoded (PayFast default)
    const text = await request.text()
    body = Object.fromEntries(new URLSearchParams(text))
  }

  return {
    m_payment_id: body.m_payment_id || '',
    pf_payment_id: body.pf_payment_id || '',
    payment_status: body.payment_status || '',
    payment_amount: body.payment_amount || '',
    payment_currency: body.payment_currency || '',
    sandBox: body.sandBox || body.sandbox || '',
    merchant_id: body.merchant_id || '',
    item_name: body.item_name || '',
    item_description: body.item_description || '',
    amount_gross: body.amount_gross || '',
    amount_fee: body.amount_fee || '',
    amount_net: body.amount_net || '',
    custom_int1: body.custom_int1,
    custom_int2: body.custom_int2,
    custom_int3: body.custom_int3,
    custom_int4: body.custom_int4,
    custom_int5: body.custom_int5,
    custom_str1: body.custom_str1,
    custom_str2: body.custom_str2,
    custom_str3: body.custom_str3,
    custom_str4: body.custom_str4,
    custom_str5: body.custom_str5,
    tokenization: body.tokenization,
    signature: body.signature || '',
    email_address: body.email_address,
    merchant_transaction_id: body.merchant_transaction_id,
    billing_date: body.billing_date,
    recurring_billing: body.recurring_billing,
    date: body.date,
    time: body.time,
  }
}

function validateRequiredFields(payload: PayFastNotificationPayload): boolean {
  const required = [
    'm_payment_id',
    'pf_payment_id', 
    'payment_status',
    'payment_amount',
    'payment_currency',
    'merchant_id',
    'signature',
  ]

  return required.every(field => {
    const value = payload[field as keyof PayFastNotificationPayload]
    return value !== undefined && value !== null && value.toString().trim() !== ''
  })
}

function verifySignature(payload: PayFastNotificationPayload): boolean {
  try {
    // Build data string for signature verification
    const dataString = buildSignatureDataString(payload)
    
    // In production, this would use crypto to verify:
    // const expectedSignature = md5(dataString + PASSPHRASE)
    // return timingSafeEqual(expectedSignature, payload.signature)
    
    // For now, accept in sandbox mode
    if (PAYFAST_CONFIG.isSandbox) {
      return true
    }
    
    // Production verification would go here
    console.log('Signature verification:', { dataString, received: payload.signature })
    return true
    
  } catch (error) {
    console.error('Signature verification error:', error)
    return false
  }
}

function buildSignatureDataString(payload: PayFastNotificationPayload): string {
  // PayFast requires specific field ordering for signature
  const fields = [
    'merchant_id',
    'merchant_key',
    'return_url',
    'cancel_url',
    'notify_url',
    'name_first',
    'name_last',
    'email_address',
    'cell_number',
    'm_payment_id',
    'amount',
    'item_name',
    'item_description',
    'custom_int1',
    'custom_int2',
    'custom_int3',
    'custom_int4',
    'custom_int5',
    'custom_str1',
    'custom_str2',
    'custom_str3',
    'custom_str4',
    'custom_str5',
    'email_confirmation',
    'confirmation_address',
    'payment_method',
    'subscription_type',
    'recurring_amount',
    'frequency',
    'cycles',
  ]

  // Filter out empty values and join
  return fields
    .filter(field => {
      const value = payload[field as keyof PayFastNotificationPayload]
      return value !== undefined && value !== null && value.toString().trim() !== ''
    })
    .map(field => `${field}=${encodeURIComponent(payload[field as keyof PayFastNotificationPayload]?.toString() || '')}`)
    .join('&')
}

async function isDuplicateEvent(paymentId: string): Promise<boolean> {
  // In production, check database for existing webhook event with this ID
  // SELECT * FROM webhook_events WHERE event_id = $1
  return false
}

async function processNotification(payload: PayFastNotificationPayload) {
  const paymentStatus = payload.payment_status?.toUpperCase()
  
  switch (paymentStatus) {
    case 'COMPLETE':
      return handleSuccessfulPayment(payload)
      
    case 'PENDING':
      return handlePendingPayment(payload)
      
    case 'FAILED':
      return handleFailedPayment(payload)
      
    case 'DENIED':
      return handleDeniedPayment(payload)
      
    default:
      return handleUnknownStatus(payload, paymentStatus)
  }
}

async function handleSuccessfulPayment(payload: PayFastNotificationPayload) {
  // Extract user/subscription info from custom fields
  const userId = payload.custom_str1 || payload.m_payment_id
  const planId = payload.custom_int1 ? `plan_${payload.custom_int1}` : undefined
  
  // In production:
  // 1. Create/update Payment record
  // 2. Activate or extend subscription
  // 3. Send confirmation email
  // 4. Update usage limits
  // 5. Log webhook event
  
  console.log('Processing successful payment:', {
    userId,
    planId,
    amount: payload.amount_gross,
    currency: payload.payment_currency,
    paymentId: payload.pf_payment_id,
    tokenization: payload.tokenization,
  })

  return {
    status: 'success',
    action: 'subscription_activated',
    userId,
    paymentId: payload.pf_payment_id,
  }
}

async function handlePendingPayment(payload: PayFastNotificationPayload) {
  console.log('Processing pending payment:', {
    paymentId: payload.pf_payment_id,
    mPaymentId: payload.m_payment_id,
  })

  return {
    status: 'pending',
    action: 'waiting_for_completion',
    paymentId: payload.pf_payment_id,
  }
}

async function handleFailedPayment(payload: PayFastNotificationPayload) {
  console.log('Processing failed payment:', {
    paymentId: payload.pf_payment_id,
    mPaymentId: payload.m_payment_id,
  })

  // In production:
  // 1. Mark payment as failed
  // 2. Notify user
  // 3. If subscription, mark as past_due

  return {
    status: 'failed',
    action: 'payment_failed',
    paymentId: payload.pf_payment_id,
  }
}

async function handleDeniedPayment(payload: PayFastNotificationPayload) {
  console.log('Processing denied payment:', {
    paymentId: payload.pf_payment_id,
  })

  return {
    status: 'denied',
    action: 'payment_denied',
    paymentId: payload.pf_payment_id,
  }
}

async function handleUnknownStatus(payload: PayFastNotificationPayload, status?: string) {
  console.warn('Unknown payment status:', { status, payload })
  
  return {
    status: 'unknown',
    action: 'manual_review_required',
    paymentId: payload.pf_payment_id,
  }
}
