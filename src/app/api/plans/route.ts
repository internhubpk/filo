// =============================================================================
// GET /api/plans
// =============================================================================
// Get available subscription plans
// =============================================================================

import { NextResponse } from 'next/server'
import { getConvexClient } from '@/lib/convex-server'

export async function GET() {
  try {
    const convex = getConvexClient()
    
    // Fetch active plans from Convex
    const plans = await convex.query('plans:getActivePlans')

    return NextResponse.json({
      success: true,
      data: plans || []
    })

  } catch (error) {
    console.error('[API /plans] Error:', error)
    
    // Return default plans if Convex query fails
    const defaultPlans = [
      {
        id: 'free',
        name: 'Free',
        priceMonthly: 0,
        priceYearly: 0,
        maxAiGenerations: 5,
        maxStorageMb: 100,
        features: [
          '5 AI generations per month',
          '100 MB storage',
          'Basic document formats',
          'Community support',
        ],
        popular: false,
      },
      {
        id: 'pro',
        name: 'Pro',
        priceMonthly: 19.99,
        priceYearly: 199.99,
        maxAiGenerations: 100,
        maxStorageMb: 5000,
        features: [
          '100 AI generations per month',
          '5 GB storage',
          'All document formats',
          'Priority support',
          'Advanced AI models',
          'Version history',
        ],
        popular: true,
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        priceMonthly: 49.99,
        priceYearly: 499.99,
        maxAiGenerations: -1, // Unlimited
        maxStorageMb: -1,     // Unlimited
        features: [
          'Unlimited AI generations',
          'Unlimited storage',
          'All document formats',
          'Dedicated support',
          'Custom AI fine-tuning',
          'Team collaboration',
          'API access',
          'SLA guarantee',
        ],
        popular: false,
      },
    ]

    return NextResponse.json({
      success: true,
      data: defaultPlans
    })
  }
}
