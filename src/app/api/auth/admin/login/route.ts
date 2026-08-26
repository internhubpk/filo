import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// Admin configuration
const ADMIN_CONFIG = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin_secure_password_2024',
  sessionSecret: process.env.ADMIN_SESSION_SECRET || 'filo_admin_session_secret_key_2024',
}

// Session duration (24 hours)
const SESSION_MAX_AGE = 24 * 60 * 60

interface AdminSession {
  username: string
  loggedInAt: number
  expiresAt: number
  token: string
}

// POST /api/auth/admin/login - Admin login
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

    // Rate limiting (simple in-memory, use Redis/Convex in production)
    const clientIP = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'
    
    if (await isRateLimited(clientIP)) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.', code: 'RATE_LIMITED' },
        { status: 429 }
      )
    }

    // Validate credentials
    const isValid = await verifyCredentials(username, password)

    if (!isValid) {
      // Log failed attempt
      console.warn('Admin login failed:', { 
        username, 
        ip: clientIP,
        timestamp: new Date().toISOString() 
      })
      
      recordFailedAttempt(clientIP)

      return NextResponse.json(
        { error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
        { status: 401 }
      )
    }

    // Create session
    const session = createAdminSession(username)
    
    // Create response with session cookie
    const response = NextResponse.json({
      success: true,
      message: 'Login successful',
      user: {
        username: session.username,
        role: 'admin',
      },
    })

    // Set HTTP-only secure cookie
    response.cookies.set('admin_session', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/admin',
    })

    console.log('Admin logged in successfully:', { 
      username, 
      ip: clientIP,
      timestamp: new Date().toISOString() 
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

// ==================== HELPER FUNCTIONS ====================

async function verifyCredentials(username: string, password: string): Promise<boolean> {
  // Timing-safe comparison to prevent timing attacks
  try {
    const usernameMatch = crypto.timingSafeEqual(
      Buffer.from(username),
      Buffer.from(ADMIN_CONFIG.username)
    )

    const passwordMatch = crypto.timingSafeEqual(
      Buffer.from(password),
      Buffer.from(ADMIN_CONFIG.password)
    )

    return usernameMatch && passwordMatch
  } catch {
    // Length mismatch - definitely not equal
    return false
  }
}

function createAdminSession(username: string): AdminSession {
  const now = Date.now()
  const tokenData = `${username}:${now}:${Math.random().toString(36)}`
  
  const token = crypto
    .createHmac('sha256', ADMIN_CONFIG.sessionSecret)
    .update(tokenData)
    .digest('hex')

  return {
    username,
    loggedInAt: now,
    expiresAt: now + (SESSION_MAX_AGE * 1000),
    token,
  }
}

// Simple rate limiting (in-memory - use Redis in production)
const failedAttempts = new Map<string, { count: number; lastAttempt: number }>()

async function isRateLimited(ip: string): Promise<boolean> {
  const attempts = failedAttempts.get(ip)
  
  if (!attempts) return false
  
  // Reset after 15 minutes
  if (Date.now() - attempts.lastAttempt > 15 * 60 * 1000) {
    failedAttempts.delete(ip)
    return false
  }

  // Allow max 5 attempts per 15 minutes
  return attempts.count >= 5
}

function recordFailedAttempt(ip: string): void {
  const attempts = failedAttempts.get(ip) || { count: 0, lastAttempt: Date.now() }
  
  failedAttempts.set(ip, {
    count: attempts.count + 1,
    lastAttempt: Date.now(),
  })
}
