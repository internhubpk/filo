// =============================================================================
// POST /api/auth/admin/login
// =============================================================================
// SECURITY FIX: This route previously validated credentials against the
// regular users table and issued an `admin_session` cookie to ANY registered
// user — giving every signed-up account full admin access (user lists,
// payment approval, activation/suspension, plan management).
//
// Admin authentication is now credential-based via the ADMIN_USERNAME /
// ADMIN_PASSWORD environment variables (documented in .env.example) and
// issues an HMAC-signed session token (see src/lib/admin-auth.ts). Ordinary
// product accounts can never obtain an admin session.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminSessionToken, ADMIN_COOKIE_NAME } from '@/lib/admin-auth'
import { getConvexClient } from '@/lib/convex-server'

// Session duration (24 hours)
const SESSION_MAX_AGE = 24 * 60 * 60

// Simple rate limiting (in-memory - use Redis in production)
const failedAttempts = new Map<string, { count: number; lastAttempt: number }>()

async function isRateLimited(ip: string): Promise<boolean> {
  const attempts = failedAttempts.get(ip)
  if (!attempts) return false
  if (Date.now() - attempts.lastAttempt > 15 * 60 * 1000) {
    failedAttempts.delete(ip)
    return false
  }
  return attempts.count >= 5
}

function recordFailedAttempt(ip: string): void {
  const attempts = failedAttempts.get(ip) || { count: 0, lastAttempt: Date.now() }
  failedAttempts.set(ip, {
    count: attempts.count + 1,
    lastAttempt: Date.now(),
  })
}

// Constant-time-ish string comparison to avoid leaking match length.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required', code: 'MISSING_CREDENTIALS' },
        { status: 400 }
      )
    }

    const clientIP =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      'unknown'

    if (await isRateLimited(clientIP)) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.', code: 'RATE_LIMITED' },
        { status: 429 }
      )
    }

    // ---- Verify admin credentials against environment configuration ----
    const envUsername = process.env.ADMIN_USERNAME || 'admin'
    const envPassword = process.env.ADMIN_PASSWORD

    if (!envPassword) {
      console.error('[Admin Login] ADMIN_PASSWORD is not configured')
      return NextResponse.json(
        {
          error: 'Admin panel is not configured. Set ADMIN_PASSWORD on the server.',
          code: 'ADMIN_NOT_CONFIGURED',
        },
        { status: 503 }
      )
    }

    if (!safeEqual(username.toLowerCase(), envUsername.toLowerCase()) || !safeEqual(password, envPassword)) {
      recordFailedAttempt(clientIP)
      console.warn('[Admin Login] Invalid admin credentials, IP:', clientIP)
      return NextResponse.json(
        { error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
        { status: 401 }
      )
    }

    // ---- Ensure the admin exists as a REAL database admin (isAdmin: true) ----
    // The credentials are re-verified INSIDE Convex against the Convex env
    // copies. This gives the env-cred admin a DB identity so every admin
    // surface can verify the LIVE isAdmin flag server-side (defense in depth:
    // a stolen cookie alone stops working if the DB admin record is removed).
    let adminUserId: string | null = null
    try {
      const convex = getConvexClient()
      const boot = (await convex.action('auth:bootstrapEnvAdmin' as never, {
        username: username.toLowerCase(),
        password,
      } as never)) as { success: boolean; userId?: string; error?: string }
      if (boot.success && boot.userId) {
        adminUserId = boot.userId
      } else if (boot.error?.includes('not configured')) {
        console.warn('[Admin Login] Convex env admin credentials not set; cookie issued without DB identity')
      } else {
        console.warn('[Admin Login] bootstrapEnvAdmin:', boot.error)
      }
    } catch (bootErr) {
      console.warn('[Admin Login] DB admin bootstrap skipped:', bootErr)
    }

    // ---- Issue HMAC-signed admin session cookie (sub = DB userId when known) ----
    const sessionToken = await createAdminSessionToken(adminUserId ?? `env:${envUsername}`)

    const response = NextResponse.json({
      success: true,
      message: 'Login successful',
      user: {
        username: envUsername,
        role: 'admin',
      },
    })

    response.cookies.set(ADMIN_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    })

    console.log('[Admin Login] Successful for:', envUsername)

    return response
  } catch (error) {
    console.error('[Admin Login] Unhandled error:', error)
    return NextResponse.json(
      { error: 'Login failed', code: 'SERVER_ERROR' },
      { status: 500 }
    )
  }
}
