// PayFast Payment Configuration
// All credentials are server-side only

import { env } from './env'
import type { PayFastConfig } from '@/types'

export const PAYFAST_CONFIG: PayFastConfig = {
  merchantId: env.PAYFAST_MERCHANT_ID || '',
  merchantKey: env.PAYFAST_MERCHANT_KEY || '',
  passphrase: env.PAYFAST_PASSPHRASE || '',
  isSandbox: env.PAYFAST_IS_SANDBOX,
  baseUrl: env.PAYFAST_BASE_URL,
  
  // Return URLs (should be absolute)
  returnUrl: `${env.APP_URL}/billing/confirmation`,
  cancelUrl: `${env.APP_URL}/billing/cancelled`,
  notifyUrl: `${env.APP_URL}/api/webhooks/payfast`,
}

// Subscription Plans
export const SUBSCRIPTION_PLANS = [
  {
    id: 'free',
    name: 'Free / Beta',
    description: 'Perfect for trying out Filo',
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'USD',
    
    // Limits
    aiRequestsLimit: 50,
    storageLimitMb: 100,
    artifactLimit: 20,
    
    // Features
    features: [
      '50 AI generations per month',
      '100MB storage',
      'Basic document types',
      'Standard exports',
      'Community support',
    ],
    
    payfastToken: null,
    isActive: true,
  },
  {
    id: 'pro-monthly',
    name: 'Pro (Monthly)',
    description: 'For professionals and power users',
    priceMonthly: 1900, // R190/month (~$10 USD)
    priceYearly: null,
    currency: 'ZAR',
    
    // Limits
    aiRequestsLimit: 500,
    storageLimitMb: 5000,
    artifactLimit: null, // unlimited
    
    // Features
    features: [
      '500 AI generations per month',
      '5GB cloud storage',
      'All document types',
      'Priority processing',
      'Brand profiles',
      'Advanced exports',
      'Email support',
    ],
    
    payfastToken: null, // Set in production
    isActive: true,
  },
  {
    id: 'pro-yearly',
    name: 'Pro (Yearly)',
    description: 'Best value - save 2 months',
    priceMonthly: null,
    priceYearly: 19000, // R1900/year (~$100 USD)
    currency: 'ZAR',
    
    // Limits
    aiRequestsLimit: 600, // 50 extra per year
    storageLimitMb: 5000,
    artifactLimit: null,
    
    // Features
    features: [
      '600 AI generations per month',
      '5GB cloud storage',
      'All document types',
      'Priority processing',
      'Brand profiles',
      'Advanced exports',
      'Priority email support',
      'Save ~R380 vs monthly',
    ],
    
    payfastToken: null,
    isActive: true,
  },
  {
    id: 'team',
    name: 'Team',
    description: 'For teams and organizations',
    priceMonthly: 4900, // R490/month (~$25 USD)
    priceYearly: null,
    currency: 'ZAR',
    
    // Limits
    aiRequestsLimit: 2000,
    storageLimitMb: 25000,
    artifactLimit: null,
    
    // Features
    features: [
      '2000 AI generations per month',
      '25GB shared storage',
      'All document types',
      'Team workspaces',
      'Collaboration tools',
      'Admin dashboard',
      'Priority support',
      'Custom branding',
      'API access (coming soon)',
    ],
    
    payfastToken: null,
    isActive: false, // Coming soon
  },
]

// Payment status mapping
export const PAYMENT_STATUS_MAP = {
  // PayFast statuses to our internal statuses
  COMPLETE: 'PAID' as const,
  PENDING: 'PENDING' as const,
  FAILED: 'FAILED' as const,
  DENIED: 'FAILED' as const,
  CANCELLED: 'CANCELLED' as const,
}

// Webhook event types we handle
export const PAYFAST_EVENT_TYPES = [
  'PAYMENT_NOTIFICATION',
  'SUBSCRIPTION_UPDATE',
  'TOKENIZATION',
] as const

// Security: Fields to validate in webhook
export const PAYFAST_REQUIRED_FIELDS = [
  'm_payment_id',
  'pf_payment_id',
  'payment_status',
  'payment_amount',
  'payment_currency',
  'merchant_id',
  'signature',
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
