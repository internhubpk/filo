// =============================================================================
// POST /api/auth/login
// =============================================================================
// Proxy route that handles login via Convex auth function
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'

const IS_DEV = process.env.NODE_ENV === 'development'

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

    const normalizedEmail = email.toLowerCase().trim()

    // ---- DEV MODE or NO CONVEX: Bypass backend, create local session ----
    if (IS_DEV || !process.env.NEXT_PUBLIC_CONVEX_URL) {
      console.log('[API /auth/login] DEV MODE: Skipping Convex auth')
      
      // Generate a dev session token
      const array = new Uint8Array(32)
      crypto.getRandomValues(array)
      const sessionToken = Array.from(array)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const name = normalizedEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

      return NextResponse.json({
        success: true,
        data: {
          user: {
            id: 'dev-user-' + Date.now(),
            name,
            email: normalizedEmail,
          },
          sessionToken,
        }
      })
    }

    // ---- PRODUCTION: Use Convex ----
    let convexClient: any
    try {
      const { getConvexClient } = await import('@/lib/convex-server')
      convexClient = getConvexClient()
    } catch (initError) {
      console.error('[API /auth/login] Failed to initialize Convex client:', initError)
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication service is not available. Please try again later.',
          code: 'SERVICE_UNAVAILABLE'
        },
        { status: 503 }
      )
    }
    
    // Call Convex auth action
    let result: any
    try {
      result = await convexClient.action('auth:login', {
        email: normalizedEmail,
        password,
      })
    } catch (actionError) {
      console.error('[API /auth/login] Convex action error:', actionError)
      const msg = actionError instanceof Error ? actionError.message : String(actionError)
      
      // If Convex is unreachable, provide a clear error
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('ECONNREFUSED') || msg.includes('Failed to fetch')) {
        return NextResponse.json(
          {
            success: false,
            error: 'Unable to reach authentication server. Please check your connection and try again.',
            code: 'SERVICE_UNAVAILABLE'
          },
          { status: 503 }
        )
      }
      
      return NextResponse.json(
        {
          success: false,
          error: 'Login failed. Please try again.',
          code: 'LOGIN_FAILED'
        },
        { status: 500 }
      )
    }

    // Check Convex action result
    if (!result || !result.success) {
      const errorCode = result?.code || 'LOGIN_FAILED'
      const errorMsg = result?.error || 'Login failed'
      
      // Use 401 for authentication failures, 404 for missing users
      const status = errorCode === 'USER_NOT_FOUND' ? 404 : 401
      
      return NextResponse.json(
        {
          success: false,
          error: errorMsg,
          code: errorCode
        },
        { status }
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
    console.error('[API /auth/login] Unhandled error:', error)
    
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