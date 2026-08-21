// Plan configuration - can be overridden by environment variables
// In production, these would come from Convex/Database or environment config

export interface PlanConfig {
  id: string
  name: string
  description: string
  price: {
    monthly: number
    yearly: number
  }
  features: string[]
  limitations: string[]
  cta: string
  popular: boolean
  icon: string
}

// Default plans configuration
export const getDefaultPlans = (): PlanConfig[] => [
  {
    id: process.env.NEXT_PUBLIC_PLAN_FREE_ID || 'free',
    name: process.env.NEXT_PUBLIC_PLAN_FREE_NAME || 'Free',
    description: process.env.NEXT_PUBLIC_PLAN_FREE_DESC || 'Perfect for trying Filo',
    price: {
      monthly: 0,
      yearly: 0,
    },
    features: [
      process.env.NEXT_PUBLIC_PLAN_FREE_FEATURE_1 || '50 AI generations per month',
      process.env.NEXT_PUBLIC_PLAN_FREE_FEATURE_2 || '100MB cloud storage',
      process.env.NEXT_PUBLIC_PLAN_FREE_FEATURE_3 || 'Basic document types',
      process.env.NEXT_PUBLIC_PLAN_FREE_FEATURE_4 || 'Standard exports (DOCX, PDF)',
      process.env.NEXT_PUBLIC_PLAN_FREE_FEATURE_5 || 'Community support',
    ],
    limitations: [
      process.env.NEXT_PUBLIC_PLAN_FREE_LIMIT_1 || 'Limited AI models',
      process.env.NEXT_PUBLIC_PLAN_FREE_LIMIT_2 || 'No brand profiles',
      process.env.NEXT_PUBLIC_PLAN_FREE_LIMIT_3 || 'Watermark on exports',
      process.env.NEXT_PUBLIC_PLAN_FREE_LIMIT_4 || 'Standard processing priority',
    ],
    cta: 'Current Plan',
    popular: false,
    icon: 'Zap',
  },
  {
    id: process.env.NEXT_PUBLIC_PLAN_PRO_MONTHLY_ID || 'pro-monthly',
    name: process.env.NEXT_PUBLIC_PLAN_PRO_MONTHLY_NAME || 'Pro Monthly',
    description: process.env.NEXT_PUBLIC_PLAN_PRO_MONTHLY_DESC || 'For professionals and power users',
    price: {
      monthly: parseInt(process.env.NEXT_PUBLIC_PLAN_PRO_MONTHLY_PRICE || '190'),
      yearly: 0,
    },
    features: [
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_1 || '500 AI generations per month',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_2 || '5GB cloud storage',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_3 || 'All document types',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_4 || 'Priority processing',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_5 || 'Brand profiles',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_6 || 'Advanced exports (XLSX, PPTX, CSV)',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_7 || 'Email support',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_8 || 'No watermarks',
    ],
    limitations: [],
    cta: 'Upgrade to Pro',
    popular: true,
    icon: 'Crown',
  },
  {
    id: process.env.NEXT_PUBLIC_PLAN_PRO_YEARLY_ID || 'pro-yearly',
    name: process.env.NEXT_PUBLIC_PLAN_PRO_YEARLY_NAME || 'Pro Yearly',
    description: process.env.NEXT_PUBLIC_PLAN_PRO_YEARLY_DESC || 'Best value - save 2 months',
    price: {
      monthly: 0,
      yearly: parseInt(process.env.NEXT_PUBLIC_PLAN_PRO_YEARLY_PRICE || '1900'),
    },
    features: [
      process.env.NEXT_PUBLIC_PLAN_YEARLY_FEATURE_1 || '600 AI generations per month',
      process.env.NEXT_PUBLIC_PLAN_YEARLY_FEATURE_2 || '5GB cloud storage',
      process.env.NEXT_PUBLIC_PLAN_YEARLY_FEATURE_3 || 'All document types',
      process.env.NEXT_PUBLIC_PLAN_YEARLY_FEATURE_4 || 'Priority processing',
      process.env.NEXT_PUBLIC_PLAN_YEARLY_FEATURE_5 || 'Brand profiles',
      process.env.NEXT_PUBLIC_PLAN_YEARLY_FEATURE_6 || 'Advanced exports',
      process.env.NEXT_PUBLIC_PLAN_YEARLY_FEATURE_7 || 'Priority email support',
      process.env.NEXT_PUBLIC_PLAN_YEARLY_FEATURE_8 || 'No watermarks',
      process.env.NEXT_PUBLIC_PLAN_YEARLY_FEATURE_9 || `Save ~R${parseInt(process.env.NEXT_PUBLIC_PLAN_PRO_YEARLY_PRICE || '1900') / 12 * 2} vs monthly`,
    ],
    limitations: [],
    cta: 'Upgrade & Save',
    popular: false,
    icon: 'Crown',
  },
]

// Currency configuration
export const currencyConfig = {
  symbol: process.env.NEXT_PUBLIC_CURRENCY_SYMBOL || 'R',
  code: process.env.NEXT_PUBLIC_CURRENCY_CODE || 'ZAR',
  position: 'before' as const,
}

// PayFast configuration (server-side only values should not be exposed here)
export const payfastConfig = {
  merchantId: process.env.NEXT_PUBLIC_PAYFAST_MERCHANT_ID || '',
  merchantKey: process.env.NEXT_PUBLIC_PAYFAST_MERCHANT_KEY || '',
  sandboxMode: process.env.NEXT_PUBLIC_PAYFAST_SANDBOX === 'true',
  returnUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/billing?payment=success`,
  cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/billing?payment=cancelled`,
  notifyUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/webhooks/payfast`,
}
