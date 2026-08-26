// =============================================================================
// POST /api/auth/login
// =============================================================================
// Proxy route that handles login via Convex.
// Login is allowed even when the user's status is "pending_activation" —
// we return the status to the client so the UI can show the
// "Your account is pending verification" banner and block AI generation.
//
// Session tokens are now self-contained (HMAC-signed). They do NOT
// depend on the Convex "sessions" table. This eliminates the bug where
// silent session-creation failures left the client with an orphaned token.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'
import { createSessionToken } from '@/lib/session'

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

    // ---- Look up user in Convex ----
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

    // ---- Verify password (SHA-256, same as signup) ----
    const encoder = new TextEncoder()
    const data = encoder.encode(password + "filo_salt_2024_secret")
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const passwordHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    if (passwordHash !== (user.passwordHash || '')) {
      console.log('[API /auth/login] Invalid password for:', normalizedEmail)
      return NextResponse.json(
        { success: false, error: 'Incorrect password', code: 'INVALID_PASSWORD' },
        { status: 401 }
      )
    }

    console.log('[API /auth/login] Password valid for:', user.email)

    // ---- Create self-contained session token (HMAC-signed) ----
    // This token encodes the user payload and is validated locally
    // without needing a Convex session lookup.
    const sessionToken = createSessionToken({
      id: user._id,
      name: user.name,
      email: user.email,
      status: user.status ?? 'pending_activation',
      planId: user.planId ?? null,
    })

    // Best-effort: also store in Convex sessions table for backward compat
    // (e.g. if other parts of the system still query it). Failure is non-fatal.
    try {
      const array = new Uint8Array(32)
      crypto.getRandomValues(array)
      const convexToken = Array.from(array)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
      await convexClient.mutation(api.sessions.createSessionByEmail, {
        email: normalizedEmail,
        token: convexToken,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      })
    } catch (e) {
      console.warn('[API /auth/login] Convex session creation skipped (non-fatal):', e)
    }

    console.log('[API /auth/login] Login successful for:', user.email)

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