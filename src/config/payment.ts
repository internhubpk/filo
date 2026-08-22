// =============================================================================
// FILO Payment Configuration - Safepay (Beta)
// =============================================================================
// ARCHITECTURE: Safepay is the ONLY payment gateway for beta
//
// IMPORTANT:
// - All Safepay credentials are server-side only (Convex secrets / env vars)
// - Never expose payment credentials to the client
// - Payment state is confirmed through server-side webhooks ONLY
// - Currency: PKR (Pakistani Rupee)
//
// REMOVED: PayFast integration (no longer used)
// =============================================================================

import type { SafepayConfig } from '@/types'

// Safepay configuration (server-side only)
export const SAFEPAY_CONFIG: SafepayConfig = {
  publicKey: process.env.SAFEPAY_PUBLIC_KEY || '',
  secretKey: process.env.SAFEPAY_SECRET_KEY || '',
  webhookSecret: process.env.SAFEPAY_WEBHOOK_SECRET || '',
  isSandbox: process.env.SAFEPAY_SANDBOX === 'true' || process.env.NODE_ENV !== 'production',
  
  // Return URLs
  returnUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/billing?payment=success`,
  cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/billing?payment=cancelled`,
  
  // Webhook URL (where Safepay sends events)
  webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/webhooks/safepay`,
}

// Payment status mapping (Safepay → Internal)
export const PAYMENT_STATUS_MAP = {
  // Safepay statuses to our internal statuses
  CAPTURED: 'COMPLETED' as const,
  AUTHORIZED: 'PENDING' as const,
  FAILED: 'FAILED' as const,
  CANCELLED: 'CANCELLED' as const,
  REFUNDED: 'REFUNDED' as const,
}

// Webhook event types we handle from Safepay
export const SAFEPAY_EVENT_TYPES = [
  'payment.captured',
  'payment.authorized',
  'payment.failed',
  'payment.cancelled',
  'payment.refunded',
  'subscription.created',
  'subscription.updated',
  'subscription.cancelled',
] as const

// Security: Fields to validate in Safepay webhook
export const SAFEPAY_REQUIRED_FIELDS = [
  'id',
  'type',
  'data.id',
  'data.status',
  'data.amount',
  'data.currency',
] as const

// Generate unique payment reference
export function generatePaymentReference(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `FLO-${timestamp}-${random}`.toUpperCase()
}

// Calculate subscription dates
export function getSubscriptionPeriod(
  planId: string,
  startDate: Date = new Date()
): { currentPeriodStart: Date; currentPeriodEnd: Date } {
  const start = new Date(startDate)
  let end = new Date(start)
  
  if (planId.includes('yearly')) {
    end.setFullYear(end.getFullYear() + 1)
  } else {
    end.setMonth(end.getMonth() + 1)
  }
  
  return { currentPeriodStart: start, currentPeriodEnd: end }
}
