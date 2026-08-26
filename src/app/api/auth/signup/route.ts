// =============================================================================
// POST /api/auth/signup
// =============================================================================
// Proxy route that handles signup via Convex.
// New signups always start with status="pending_activation" — the user must
// submit a payment and an admin must verify it before they can generate.
//
// Session tokens are now self-contained (HMAC-signed). They do NOT
// depend on the Convex "sessions" table.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'
import { createSessionToken } from '@/lib/session'

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

    const normalizedEmail = email.toLowerCase().trim()
    console.log('[API /auth/signup] Creating account for:', normalizedEmail)

    // ---- Initialize Convex client ----
    let convexClient: any
    try {
      const { getConvexClient } = await import('@/lib/convex-server')
      convexClient = getConvexClient()
    } catch (initError) {
      console.error('[API /auth/signup] Convex not configured:', initError)
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication service is not available. Please try again later.',
          code: 'SERVICE_UNAVAILABLE'
        },
        { status: 503 }
      )
    }

    // Step 1: Check if user already exists
    console.log('[API /auth/signup] Step 1: Checking if user exists...')

    let existingUser: any = null
    try {
      existingUser = await convexClient.query(api.users.getUserByEmail, {
        email: normalizedEmail,
      })
    } catch (queryError) {
      console.warn('[API /auth/signup] Existing-user check failed (continuing):', queryError)
    }

    if (existingUser) {
      console.log('[API /auth/signup] User already exists:', existingUser._id)
      return NextResponse.json(
        {
          success: false,
          error: 'An account with this email already exists',
          code: 'EMAIL_EXISTS'
        },
        { status: 409 }
      )
    }

    // Step 2: Hash password & create user
    console.log('[API /auth/signup] Step 2: Creating user...')

    const encoder = new TextEncoder()
    const data = encoder.encode(password + "filo_salt_2024_secret")
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const passwordHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    let userId: string
    try {
      userId = await convexClient.mutation(api.users.createUserWithPassword, {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
      })
      console.log('[API /auth/signup] User created with ID:', userId)
    } catch (mutationError) {
      console.error('[API /auth/signup] createUserWithPassword failed:', mutationError)
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to create user account',
          code: 'USER_CREATION_FAILED',
          details: String(mutationError)
        },
        { status: 500 }
      )
    }

    // Step 3: Create self-contained session token (HMAC-signed)
    // This token encodes the user payload and is validated locally
    // without needing a Convex session lookup.
    console.log('[API /auth/signup] Step 3: Creating session token...')

    const sessionToken = createSessionToken({
      id: userId,
      name: name.trim(),
      email: normalizedEmail,
      status: 'pending_activation',
      planId: null,
    })

    // Best-effort: also store in Convex sessions table for backward compat.
    // Failure is non-fatal — the HMAC token works independently.
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
      console.warn('[API /auth/signup] Convex session creation skipped (non-fatal):', e)
    }

    console.log('[API /auth/signup] ✅ Account created successfully (pending activation)')

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: userId,
          name: name.trim(),
          email: normalizedEmail,
          status: 'pending_activation',
        },
        sessionToken,
      }
    })

  } catch (error) {
    console.error('[API /auth/signup] Route error:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error during signup',
        code: 'INTERNAL_ERROR',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}