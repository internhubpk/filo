// =============================================================================
// GET /api/auth/me
// =============================================================================
// Get current authenticated user from session token.
// Uses self-contained HMAC tokens — no Convex DB lookup needed.
// Returns the user's activation status so the client can gate AI generation.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'

export async function GET(request: NextRequest) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.substring(7) // Remove "Bearer " prefix

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'No authentication token provided', code: 'NO_TOKEN' },
        { status: 401 }
      )
    }

    // Validate session locally (HMAC, no DB lookup)
    const session = validateSessionToken(token)

    if (!session.valid || !session.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    // Return user data with activation status
    return NextResponse.json({
      success: true,
      data: session.user
    })

  } catch (error) {
    console.error('[API /auth/me] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to validate session',
        code: 'VALIDATION_ERROR'
      },
      { status: 500 }
    )
  }
}