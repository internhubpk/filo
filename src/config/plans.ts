// Plan configuration - fully configurable via environment variables
// All plans are paid. No free tier.
// Plans: Pro (individual), Team (small teams), Department/Enterprise (contact sales)

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
  badge?: string // e.g., "Most Popular", "Best Value"
  contactSales?: boolean // For department/enterprise plans
}

// Default plans configuration - PRO, TEAM, DEPARTMENT (no free plan)
export const getDefaultPlans = (): PlanConfig[] => [
  {
    id: process.env.NEXT_PUBLIC_PLAN_PRO_ID || 'pro',
    name: process.env.NEXT_PUBLIC_PLAN_PRO_NAME || 'Pro',
    description: process.env.NEXT_PUBLIC_PLAN_PRO_DESC || 'For individual professionals and power users',
    price: {
      monthly: parseInt(process.env.NEXT_PUBLIC_PLAN_PRO_MONTHLY_PRICE || '190'),
      yearly: parseInt(process.env.NEXT_PUBLIC_PLAN_PRO_YEARLY_PRICE || '1900'),
    },
    features: [
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_1 || '500 AI generations per month',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_2 || '5GB cloud storage',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_3 || 'All document types (DOCX, PDF, XLSX, PPTX)',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_4 || 'Priority processing queue',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_5 || 'Custom brand profiles',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_6 || 'Advanced export formats',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_7 || 'Email support (48hr response)',
      process.env.NEXT_PUBLIC_PLAN_PRO_FEATURE_8 || 'No watermarks on exports',
    ],
    limitations: [
      process.env.NEXT_PUBLIC_PLAN_PRO_LIMIT_1 || 'Single user account',
      process.env.NEXT_PUBLIC_PLAN_PRO_LIMIT_2 || 'Standard API access',
    ],
    cta: 'Get Started',
    popular: true,
    icon: 'Crown',
    badge: 'Most Popular',
  },
  {
    id: process.env.NEXT_PUBLIC_PLAN_TEAM_ID || 'team',
    name: process.env.NEXT_PUBLIC_PLAN_TEAM_NAME || 'Team',
    description: process.env.NEXT_PUBLIC_PLAN_TEAM_DESC || 'For small teams and growing businesses',
    price: {
      monthly: parseInt(process.env.NEXT_PUBLIC_PLAN_TEAM_MONTHLY_PRICE || '490'),
      yearly: parseInt(process.env.NEXT_PUBLIC_PLAN_TEAM_YEARLY_PRICE || '4900'),
    },
    features: [
      process.env.NEXT_PUBLIC_PLAN_TEAM_FEATURE_1 || '2,500 AI generations per month (shared)',
      process.env.NEXT_PUBLIC_PLAN_TEAM_FEATURE_2 || '25GB cloud storage (shared)',
      process.env.NEXT_PUBLIC_PLAN_TEAM_FEATURE_3 || 'Up to 5 team members',
      process.env.NEXT_PUBLIC_PLAN_TEAM_FEATURE_4 || 'All document types + custom templates',
      process.env.NEXT_PUBLIC_PLAN_TEAM_FEATURE_5 || 'Team collaboration features',
      process.env.NEXT_PUBLIC_PLAN_TEAM_FEATURE_6 || 'Admin dashboard & controls',
      process.env.NEXT_PUBLIC_PLAN_TEAM_FEATURE_7 || 'Priority email support (24hr response)',
      process.env.NEXT_PUBLIC_PLAN_TEAM_FEATURE_8 || 'API access with higher rate limits',
      process.env.NEXT_PUBLIC_PLAN_TEAM_FEATURE_9 || 'Shared brand profiles & assets',
      process.env.NEXT_PUBLIC_PLAN_TEAM_FEATURE_10 || 'Usage analytics & reporting',
    ],
    limitations: [],
    cta: 'Start Team Trial',
    popular: false,
    icon: 'Users',
    badge: 'Best for Teams',
  },
  {
    id: process.env.NEXT_PUBLIC_PLAN_DEPARTMENT_ID || 'department',
    name: process.env.NEXT_PUBLIC_PLAN_DEPARTMENT_NAME || 'Department',
    description: process.env.NEXT_PUBLIC_PLAN_DEPARTMENT_DESC || 'For departments and large organizations',
    price: {
      monthly: 0, // Contact sales
      yearly: 0,
    },
    features: [
      process.env.NEXT_PUBLIC_PLAN_DEPT_FEATURE_1 || 'Unlimited AI generations',
      process.env.NEXT_PUBLIC_PLAN_DEPT_FEATURE_2 || 'Unlimited cloud storage',
      process.env.NEXT_PUBLIC_PLAN_DEPT_FEATURE_3 || 'Unlimited team members',
      process.env.NEXT_PUBLIC_PLAN_DEPT_FEATURE_4 || 'SSO & advanced security (SAML, OAuth)',
      process.env.NEXT_PUBLIC_PLAN_DEPT_FEATURE_5 || 'Dedicated account manager',
      process.env.NEXT_PUBLIC_PLAN_DEPT_FEATURE_6 || 'Custom integrations & API',
      process.env.NEXT_PUBLIC_PLAN_DEPT_FEATURE_7 || 'SLA guarantee (99.9% uptime)',
      process.env.NEXT_PUBLIC_PLAN_DEPT_FEATURE_8 || 'Priority phone & chat support',
      process.env.NEXT_PUBLIC_PLAN_DEPT_FEATURE_9 || 'On-premise deployment option',
      process.env.NEXT_PUBLIC_PLAN_DEPT_FEATURE_10 || 'Custom training & onboarding',
      process.env.NEXT_PUBLIC_PLAN_DEPT_FEATURE_11 || 'Advanced audit logs & compliance',
      process.env.NEXT_PUBLIC_PLAN_DEPT_FEATURE_12 || 'White-label options available',
    ],
    limitations: [],
    cta: 'Contact Sales',
    popular: false,
    icon: 'Building2',
    contactSales: true,
    badge: 'Enterprise',
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

// Contact sales URL
export const contactSalesUrl = process.env.NEXT_PUBLIC_CONTACT_SALES_URL || 'mailto:sales@filo.ai'
