// =============================================================================
// POST /api/auth/signup
// =============================================================================
// Proxy route that handles signup via Convex auth function
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { getConvexClient } from '@/lib/convex-server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, email, password } = body

    // Validate required fields
    if (!name || !email || !password) {
      return NextResponse.json(
        { success: false, error: 'All fields are required (name, email, password)', code: 'MISSING_FIELDS' },
        { status: 400 }
      )
    }

    // Validate name
    if (name.trim().length < 2) {
      return NextResponse.json(
        { success: false, error: 'Name must be at least 2 characters', code: 'INVALID_NAME' },
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

    // Validate password
    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 6 characters', code: 'PASSWORD_TOO_SHORT' },
        { status: 400 }
      )
    }

    console.log('[API /auth/signup] Creating account for:', email.toLowerCase().trim())

    // Call Convex signup action
    const convex = getConvexClient()
    
    const result = await convex.action('auth:signup', {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
    })

    console.log('[API /auth/signup] Result:', { success: result.success, code: result.code })

    if (!result.success) {
      // Map common error codes to appropriate HTTP statuses
      const statusCode = result.code === 'EMAIL_EXISTS' ? 409 : 400
      
      return NextResponse.json(
        { 
          success: false, 
          error: result.error || 'Signup failed',
          code: result.code || 'SIGNUP_FAILED' 
        },
        { status: statusCode }
      )
    }

    // Return successful response
    console.log('[API /auth/signup] Account created successfully for:', email)

    return NextResponse.json({
      success: true,
      data: {
        user: result.user,
        sessionToken: result.sessionToken,
      }
    })

  } catch (error) {
    console.error('[API /auth/signup] Error:', error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error during signup',
        code: 'INTERNAL_ERROR' 
      },
      { status: 500 }
    )
  }
}
