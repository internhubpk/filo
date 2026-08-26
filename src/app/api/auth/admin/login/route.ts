// =============================================================================
// POST /api/auth/admin/login - Admin login
// =============================================================================
// Validates admin credentials and issues a secure, HMAC-signed session token.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import {
  verifyCredentials,
  createSession,
  isRateLimited,
  recordFailedAttempt,
} from '@/lib/admin-auth'

// Session duration (24 hours, in seconds for Set-Cookie maxAge)
const SESSION_MAX_AGE = 24 * 60 * 60

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, password } = body

    // Validate input
    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required', code: 'MISSING_CREDENTIALS' },
        { status: 400 }
      )
    }

    // Rate limiting
    const clientIP = request.headers.get('x-forwarded-for') ||
                     request.headers.get('x-real-ip') ||
                     'unknown'

    if (isRateLimited(clientIP)) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.', code: 'RATE_LIMITED' },
        { status: 429 }
      )
    }

    // Validate credentials
    const isValid = verifyCredentials(username, password)

    if (!isValid) {
      console.warn('Admin login failed:', {
        username,
        ip: clientIP,
        timestamp: new Date().toISOString(),
      })

      recordFailedAttempt(clientIP)

      return NextResponse.json(
        { error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
        { status: 401 }
      )
    }

    // Create secure session
    const { token, expiresAt } = createSession(username)

    // Create response with session cookie
    const response = NextResponse.json({
      success: true,
      message: 'Login successful',
      user: {
        username,
        role: 'admin',
      },
    })

    // Set HTTP-only secure cookie
    response.cookies.set('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/admin',
    })

    console.log('Admin logged in successfully:', {
      username,
      ip: clientIP,
      timestamp: new Date().toISOString(),
    })

    return response

  } catch (error) {
    console.error('Admin login error:', error)
    return NextResponse.json(
      { error: 'Login failed', code: 'SERVER_ERROR' },
      { status: 500 }
    )
  }
}
