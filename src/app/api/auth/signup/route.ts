// =============================================================================
// POST /api/auth/signup
// =============================================================================
// Proxy route that handles signup via the Convex `auth.signup` action.
//
// SECURITY FIX: the previous implementation hashed the password in the route
// and pushed the raw hash through the PUBLIC `createUserWithPassword`
// mutation (callable by anyone). User creation now happens entirely inside
// Convex via an internal mutation — plaintext passwords stop at TLS into the
// action, and hash insertion is not publicly invokable.
//
// New signups always start with status="pending_activation" — an admin must
// verify payment before they can generate.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'
import { createSessionToken } from '@/lib/session'
import { getConvexClient } from '@/lib/convex-server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const name = typeof body?.name === 'string' ? body.name : ''
    const email = typeof body?.email === 'string' ? body.email : ''
    const password = typeof body?.password === 'string' ? body.password : ''

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
    let convexClient
    try {
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

    // ---- Delegate account creation to the Convex action ----
    let result: {
      success: boolean
      user?: { id: string; name: string; email: string; status?: string; planId?: string | null }
      error?: string
      code?: string
    }
    try {
      result = await convexClient.action(api.auth.signup, {
        name: name.trim(),
        email: normalizedEmail,
        password,
      })
    } catch (actionError) {
      console.error('[API /auth/signup] Convex action failed:', actionError)
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to create user account',
          code: 'USER_CREATION_FAILED',
        },
        { status: 500 }
      )
    }

    if (!result?.success || !result.user) {
      const code = result?.code ?? 'USER_CREATION_FAILED'
      const message =
        result?.error ??
        (code === 'EMAIL_EXISTS'
          ? 'An account with this email already exists'
          : code === 'PASSWORD_TOO_SHORT'
            ? 'Password must be at least 6 characters'
            : 'Account creation failed')
      const status = code === 'EMAIL_EXISTS' ? 409 : 400

      console.log('[API /auth/signup] Rejected:', normalizedEmail, 'code:', code)
      return NextResponse.json(
        { success: false, error: message, code },
        { status }
      )
    }

    // ---- Create self-contained HMAC session token ----
    const sessionToken = createSessionToken({
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      status: result.user.status ?? 'pending_activation',
      planId: result.user.planId ?? null,
    })

    console.log('[API /auth/signup] ✅ Account created successfully (pending activation)')

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          status: result.user.status ?? 'pending_activation',
          planId: result.user.planId ?? null,
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
      },
      { status: 500 }
    )
  }
}
