// =============================================================================
// POST /api/auth/logout
// =============================================================================
// Proxy route that handles logout via Convex auth function
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { getConvexClient } from '@/lib/convex-server'

export async function POST(request: NextRequest) {
  try {
    // Get token from Authorization header or request body
    let token: string | undefined

    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    }

    if (!token) {
      try {
        const body = await request.json()
        token = body.token
      } catch {
        // No body, that's ok
      }
    }

    // If we have a token, invalidate it on the backend
    if (token) {
      try {
        const convex = getConvexClient()
        await convex.action('auth:logout', { token })
      } catch (error) {
        // Log but don't fail - client-side cleanup is what matters
        console.warn('[API /auth/logout] Failed to invalidate session on backend:', error)
      }
    }

    // Always return success - client should clear local storage regardless
    return NextResponse.json({
      success: true,
      data: { message: 'Logged out successfully' }
    })

  } catch (error) {
    console.error('[API /auth/logout] Error:', error)
    
    // Still return success - logout should always "work" on client side
    return NextResponse.json({
      success: true,
      data: { message: 'Logged out successfully' }
    })
  }
}

// Also support DELETE method
export async function DELETE(request: NextRequest) {
  return POST(request)
}
