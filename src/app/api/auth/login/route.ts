// =============================================================================
// POST /api/auth/login
// =============================================================================
// Proxy route that handles login via Convex.
// Login is allowed even when the user's status is "pending_activation" —
// we return the status to the client so the UI can show the
// "Your account is pending verification" banner and block AI generation.
//
// Password hashing & verification is done HERE (Node.js) to match the
// signup flow and avoid relying on crypto.subtle inside Convex actions.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'

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

    // Step 1: Look up user by email (same as signup checks)
    console.log('[API /auth/login] Looking up user:', normalizedEmail)
    let user: any = null
    try {
      user = await convexClient.query(api.users.getUserByEmail, {
        email: normalizedEmail,
      })
    } catch (queryError) {
      console.error('[API /auth/login] User lookup failed:', queryError)
      return NextResponse.json(
        { success: false, error: 'Login failed. Please try again.', code: 'LOGIN_FAILED' },
        { status: 500 }
      )
    }

    if (!user) {
      console.log('[API /auth/login] User not found:', normalizedEmail)
      return NextResponse.json(
        { success: false, error: 'No account found with this email', code: 'USER_NOT_FOUND' },
        { status: 404 }
      )
    }

    // Step 2: Hash the password on the Next.js server (same method as signup)
    // This avoids relying on crypto.subtle inside Convex actions.
    const encoder = new TextEncoder()
    const data = encoder.encode(password + "filo_salt_2024_secret")
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const passwordHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    // Step 3: Compare hashes
    if (passwordHash !== (user.passwordHash || '')) {
      console.log('[API /auth/login] Invalid password for:', normalizedEmail)
      return NextResponse.json(
        { success: false, error: 'Incorrect password', code: 'INVALID_PASSWORD' },
        { status: 401 }
      )
    }

    console.log('[API /auth/login] Password valid, creating session for user:', user._id)

    // Step 4: Generate session token
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    const sessionToken = Array.from(array)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    // Step 5: Try to create session in Convex (non-fatal — matches signup behavior)
    // If this fails, the token is still returned to the client and stored in
    // localStorage, which is sufficient for the app to function.
    let sessionCreated = false
    try {
      await convexClient.mutation(api.sessions.createSession, {
        userId: user._id,
        token: sessionToken,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      })
      sessionCreated = true
      console.log('[API /auth/login] Session created successfully')
    } catch (sessionError) {
      console.warn('[API /auth/login] Session creation failed (non-fatal, matching signup):', sessionError)
    }

    console.log('[API /auth/login] Login successful for:', user.email)

    // Successful login. Surface the user's activation status so the client
    // can decide whether to allow AI generation or show a "pending" banner.
    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          status: user.status ?? 'pending_activation',
          planId: user.planId ?? null,
        },
        sessionToken,
        warning: !sessionCreated
          ? 'Session storage had an issue, but you are logged in. If problems persist, try logging in again.'
          : undefined,
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
