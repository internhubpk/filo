// =============================================================================
// GET /api/subscription/status
// =============================================================================
// Get current user's subscription and usage status
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'

const IS_DEV = process.env.NODE_ENV === 'development'

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.substring(7)

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    // ---- DEV MODE: Return unlimited access ----
    if (IS_DEV || !process.env.NEXT_PUBLIC_CONVEX_URL) {
      return NextResponse.json({
        success: true,
        data: {
          hasActiveSubscription: true,
          remainingGenerations: 999,
          planLimit: 999,
          planName: 'Pro (Dev)',
        }
      })
    }

    // ---- PRODUCTION: Use Convex ----
    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()
    
    const session = await convex.query(api.auth.validateSession, { token })
    if (!session.valid || !session.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    // Get subscription status
    const status = await convex.query(api.subscriptions.hasActiveSubscription, {
      userId: session.user.id,
    })

    return NextResponse.json({
      success: true,
      data: status
    })

  } catch (error) {
    console.error('[API /subscription/status] Error:', error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get subscription status',
        code: 'FETCH_ERROR' 
      },
      { status: 500 }
    )
  }
}
