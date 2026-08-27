// =============================================================================
// POST /api/auth/login
// =============================================================================
// Proxy route that handles login via the Convex `auth.login` action.
//
// SECURITY: password verification happens INSIDE Convex (the action reads the
// hash through an internalQuery). This route never sees or transmits a
// password hash — previously it fetched the full user document (including
// `passwordHash`) from a PUBLIC query, meaning anyone with the deployment URL
// could harvest all users' hashes.
//
// On success this route issues its own self-contained HMAC session token
// (see src/lib/session.ts), keeping the response shape unchanged for clients.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'
import { createSessionToken } from '@/lib/session'
import { getConvexClient } from '@/lib/convex-server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = typeof body?.email === 'string' ? body.email : ''
    const password = typeof body?.password === 'string' ? body.password : ''

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

    // ---- Initialize Convex client ----
    let convexClient
    try {
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

    // ---- Delegate credential check to the Convex action ----
    console.log('[API /auth/login] Verifying credentials for:', normalizedEmail)
    let result: {
      success: boolean
      user?: { id: string; name: string; email: string; status?: string; planId?: string | null }
      error?: string
      code?: string
    }
    try {
      result = await convexClient.action(api.auth.login, {
        email: normalizedEmail,
        password,
      })
    } catch (actionError) {
      console.error('[API /auth/login] Convex action failed:', actionError)
      return NextResponse.json(
        { success: false, error: 'Login failed. Please try again.', code: 'LOGIN_FAILED' },
        { status: 500 }
      )
    }

    if (!result?.success || !result.user) {
      const code = result?.code ?? 'LOGIN_FAILED'
      const message =
        result?.error ??
        (code === 'USER_NOT_FOUND'
          ? 'No account found with this email'
          : code === 'INVALID_PASSWORD'
            ? 'Incorrect password'
            : 'Login failed')
      const status = code === 'USER_NOT_FOUND' ? 404 : code === 'INVALID_PASSWORD' ? 401 : 500

      console.log('[API /auth/login] Rejected:', normalizedEmail, 'code:', code)
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
      status: result.user.status,
      planId: result.user.planId ?? null,
    })

    console.log('[API /auth/login] Login successful for:', result.user.email)

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
