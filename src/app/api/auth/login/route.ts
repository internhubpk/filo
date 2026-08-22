// =============================================================================
// POST /api/auth/login
// =============================================================================
// Proxy route that handles login via Convex auth function
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { getConvexClient } from '@/lib/convex-server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required', code: 'MISSING_FIELDS' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email format', code: 'INVALID_EMAIL' },
        { status: 400 }
      )
    }

    // Call Convex login action
    const convex = getConvexClient()
    
    const result = await convex.action('auth:login', {
      email: email.toLowerCase().trim(),
      password,
    })

    if (!result.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: result.error || 'Login failed',
          code: result.code || 'LOGIN_FAILED' 
        },
        { status: 401 }
      )
    }

    // Return successful response with user data and session token
    return NextResponse.json({
      success: true,
      data: {
        user: result.user,
        sessionToken: result.sessionToken,
      }
    })

  } catch (error) {
    console.error('[API /auth/login] Error:', error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error during login',
        code: 'INTERNAL_ERROR' 
      },
      { status: 500 }
    )
  }
}
