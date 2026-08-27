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
//
// ERROR CODES RETURNED (passed through from the Convex action):
//   MISSING_FIELDS / INVALID_EMAIL / USER_NOT_FOUND / INVALID_PASSWORD
//   LOGIN_LOOKUP_FAILED   - user lookup query threw inside Convex
//   LOGIN_HASH_FAILED     - password verification threw (runtime problem)
//   LOGIN_SESSION_FAILED  - session insert threw (often a stale deploy)
//   LOGIN_ERROR           - unexpected action-level failure
//   CONVEX_ACTION_ERROR   - transport/function-missing level failure. Usually
//                           means the Convex functions were NOT redeployed
//                           after this repo changed them: run `npx convex deploy`
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'
import { createSessionToken } from '@/lib/session'
import { createAdminSessionToken, ADMIN_COOKIE_NAME } from '@/lib/admin-auth'
import { getConvexClient } from '@/lib/convex-server'

// Admin cookie lifetime (matches the admin login flow)
const SESSION_MAX_AGE = 24 * 60 * 60

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
      // Transport-level rejection (no handler ran). Common cause: the deployed
      // Convex functions are missing or out of sync with this repository.
      const detail =
        actionError instanceof Error ? actionError.message : String(actionError)
      console.error(
        '[API /auth/login] Convex action rejected:',
        actionError
      )
      return NextResponse.json(
        {
          success: false,
          error:
            'Authentication service is not responding correctly. If this persists, the Convex backend needs redeployment.',
          code: 'CONVEX_ACTION_ERROR',
          detail,
        },
        { status: 503 }
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
      // Infrastructure-level failures are server errors; validation is client.
      const status =
        code === 'USER_NOT_FOUND'
          ? 404
          : code === 'INVALID_PASSWORD'
            ? 401
            : code.endsWith('_FAILED') || code.endsWith('_ERROR')
              ? 500
              : 400

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

    // ---- DB admins additionally receive an admin session cookie ----
    // The /admin pages are cookie-gated by middleware (Edge runtime, no DB
    // access). Issuing the cookie here — ONLY after Convex confirmed the
    // user's live isAdmin flag — lets database admins reach the console.
    // Every admin API endpoint still re-verifies the LIVE isAdmin flag, so
    // the cookie alone grants nothing.
    let adminCookie: string | null = null
    try {
      const convexClient = getConvexClient()
      const liveAdmin = (await convexClient.query('users:getUser' as never, {
        userId: result.user.id as never,
      } as never)) as { isAdmin?: boolean; status?: string } | null
      if (liveAdmin?.isAdmin === true && liveAdmin.status === 'active') {
        adminCookie = await createAdminSessionToken(result.user.id)
      }
    } catch (adminErr) {
      console.warn('[API /auth/login] admin flag lookup skipped:', adminErr)
    }

    const loginResponse = NextResponse.json({
      success: true,
      data: {
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          status: result.user.status ?? 'active',
          planId: result.user.planId ?? null,
          // UX hint only: lets the client send DB admins straight to /admin.
          // Authorization itself is ALWAYS re-verified server-side.
          isAdmin: adminCookie !== null,
        },
        sessionToken,
      }
    })

    if (adminCookie) {
      loginResponse.cookies.set(ADMIN_COOKIE_NAME, adminCookie, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE,
        path: '/',
      })
    }

    console.log('[API /auth/login] Login successful for:', result.user.email)
    return loginResponse
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
