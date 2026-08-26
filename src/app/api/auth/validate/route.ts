// =============================================================================
// POST /api/auth/validate
// =============================================================================
// Explicitly validate a session token.
// Uses self-contained HMAC tokens — no Convex DB lookup needed.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'

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

    // Validate locally (HMAC, no DB lookup)
    const session = validateSessionToken(token)

    if (!session.valid) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid or expired token',
          code: 'INVALID_TOKEN',
          data: { valid: false, user: null, reason: session.reason }
        },
        { status: 401 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        valid: true,
        user: session.user
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