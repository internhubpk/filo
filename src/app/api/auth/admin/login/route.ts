import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'

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

// POST /api/auth/admin/login - Admin login against Convex database
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, password } = body

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required', code: 'MISSING_CREDENTIALS' },
        { status: 400 }
      )
    }

    const clientIP = request.headers.get('x-forwarded-for') ||
                     request.headers.get('x-real-ip') ||
                     'unknown'

    if (await isRateLimited(clientIP)) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.', code: 'RATE_LIMITED' },
        { status: 429 }
      )
    }

    // Initialize Convex client
    let convexClient: any
    try {
      const { getConvexClient } = await import('@/lib/convex-server')
      convexClient = getConvexClient()
    } catch (initError) {
      console.error('[Admin Login] Failed to initialize Convex client:', initError)
      return NextResponse.json(
        { error: 'Authentication service unavailable. Please try again later.', code: 'SERVICE_UNAVAILABLE' },
        { status: 503 }
      )
    }

    // Look up user by email (admin login uses email as username)
    const input = username.trim().toLowerCase()
    let user: any = null
    try {
      user = await convexClient.query(api.users.getUserByEmail, {
        email: input,
      })
    } catch (queryError) {
      console.error('[Admin Login] User lookup failed:', queryError)
      return NextResponse.json(
        { error: 'Login failed. Please try again.', code: 'LOGIN_FAILED' },
        { status: 500 }
      )
    }

    if (!user) {
      console.log('[Admin Login] User not found:', input)
      recordFailedAttempt(clientIP)
      return NextResponse.json(
        { error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
        { status: 401 }
      )
    }

    // Hash the password the same way as user login (SHA-256 with filo salt)
    const encoder = new TextEncoder()
    const data = encoder.encode(password + "filo_salt_2024_secret")
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const passwordHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    if (passwordHash !== (user.passwordHash || '')) {
      console.log('[Admin Login] Invalid password for:', input)
      recordFailedAttempt(clientIP)
      return NextResponse.json(
        { error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
        { status: 401 }
      )
    }

    // Generate session token (64-char hex for middleware compatibility)
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    const sessionToken = Array.from(array)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    // Create response with session cookie
    const response = NextResponse.json({
      success: true,
      message: 'Login successful',
      user: {
        username: user.email,
        name: user.name,
        role: 'admin',
      },
    })

    response.cookies.set('admin_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    })

    console.log('[Admin Login] Successful for:', user.email, 'IP:', clientIP)

    return response

  } catch (error) {
    console.error('[Admin Login] Unhandled error:', error)
    return NextResponse.json(
      { error: 'Login failed', code: 'SERVER_ERROR' },
      { status: 500 }
    )
  }
}
