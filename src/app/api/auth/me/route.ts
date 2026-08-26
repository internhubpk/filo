// =============================================================================
// GET /api/auth/me
// =============================================================================
// Get current authenticated user from session token.
// Returns the user's activation status so the client can gate AI generation:
//   - status === "pending_activation" -> show "pending verification" UI
//   - status === "active"             -> allow AI generation
//   - status === "suspended"          -> show "account suspended" UI
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { getConvexClient } from '@/lib/convex-server'

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

    // Validate session with Convex
    const convex = getConvexClient()

    const result = await convex.query('auth:validateSession', { token })

    if (!result.valid || !result.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    // Return user data with activation status
    return NextResponse.json({
      success: true,
      data: result.user
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
