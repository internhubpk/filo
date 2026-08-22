// =============================================================================
// FILO Plan Configuration
// =============================================================================
// ARCHITECTURE: Plans are stored in Convex database (server-side).
// This file provides CLIENT-SIDE DEFAULTS for UI display only.
//
// IMPORTANT:
// - NEVER trust client-side plan limits for billing enforcement
// - ALWAYS validate against server-side plan data from Convex
// - Pricing/limits here are for display only, not enforcement
//
// CURRENCY: PKR (Pakistani Rupee) - Filo targets Pakistan market
// =============================================================================

export interface PlanConfig {
  id: string
  name: string
  description: string
  price: {
    monthly: number
    yearly: number
  }
  features: string[]
  limitations?: string[]
  cta: string
  popular: boolean
  icon: string
  badge?: string
  contactSales?: boolean
}

// Default plans configuration for UI display
// In production, fetch real plans from Convex: useQuery('plans:getActivePlans')
export const getDefaultPlans = (): PlanConfig[] => [
  {
    id: 'pro',
    name: 'Pro',
    description: 'For individual professionals and power users',
    price: {
      monthly: 1900,
      yearly: 19000,
    },
    features: [
      '500 AI generations per month',
      '5GB cloud storage',
      'All document types (DOCX, PDF, XLSX, PPTX)',
      'Priority processing queue',
      'Custom brand profiles',
      'Advanced export formats',
      'Email support (48hr response)',
      'No watermarks on exports',
    ],
    limitations: [
      'Single user account',
      'Standard API access',
    ],
    cta: 'Get Started',
    popular: true,
    icon: 'Crown',
    badge: 'Most Popular',
  },
  {
    id: 'team',
    name: 'Team',
    description: 'For small teams and growing businesses',
    price: {
      monthly: 4900,
      yearly: 49000,
    },
    features: [
      '2,500 AI generations per month (shared)',
      '25GB cloud storage (shared)',
      'Up to 5 team members',
      'All document types + custom templates',
      'Team collaboration features',
      'Admin dashboard & controls',
      'Priority email support (24hr response)',
      'API access with higher rate limits',
      'Shared brand profiles & assets',
      'Usage analytics & reporting',
    ],
    limitations: [],
    cta: 'Start Team Trial',
    popular: false,
    icon: 'Users',
    badge: 'Best for Teams',
  },
  {
    id: 'department',
    name: 'Department',
    description: 'For departments and large organizations',
    price: {
      monthly: 0, // Contact sales
      yearly: 0,
    },
    features: [
      'Unlimited AI generations',
      'Unlimited cloud storage',
      'Unlimited team members',
      'SSO & advanced security (SAML, OAuth)',
      'Dedicated account manager',
      'Custom integrations & API',
      'SLA guarantee (99.9% uptime)',
      'Priority phone & chat support',
      'On-premise deployment option',
      'Custom training & onboarding',
      'Advanced audit logs & compliance',
      'White-label options available',
    ],
    limitations: [],
    cta: 'Contact Sales',
    popular: false,
    icon: 'Building2',
    contactSales: true,
    badge: 'Enterprise',
  },
]

// Currency configuration - PKR for Pakistan market
export const currencyConfig = {
  symbol: '₨',
  code: 'PKR',
  position: 'before' as const,
}

// Contact sales URL
export const contactSalesUrl = 'mailto:sales@filo.ai'

// Safepay configuration (server-side only - used in API routes)
// Actual credentials come from environment/Convex secrets
export const safepayConfig = {
  isSandbox: process.env.SAFEPAY_SANDBOX === 'true' || process.env.NODE_ENV !== 'production',
  returnUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/billing?payment=success`,
  cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/billing?payment=cancelled`,
}
