// =============================================================================
// POST /api/auth/validate
// =============================================================================
// Explicitly validate a session token
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { getConvexClient } from '@/lib/convex-server'
import { api } from '@convex/_generated/api'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token } = body

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token is required', code: 'MISSING_TOKEN' },
        { status: 400 }
      )
    }

    // Validate with Convex
    const convex = getConvexClient()
    
    const result = await convex.query(api.auth.validateSession, { token })

    if (!result.valid) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid or expired token',
          code: 'INVALID_TOKEN',
          data: { valid: false, user: null }
        },
        { status: 401 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        valid: true,
        user: result.user
      }
    })

  } catch (error) {
    console.error('[API /auth/validate] Error:', error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Validation failed',
        code: 'VALIDATION_ERROR' 
      },
      { status: 500 }
    )
  }
}
