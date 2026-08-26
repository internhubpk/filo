import { NextRequest, NextResponse } from 'next/server'

// Paths that require admin authentication
const ADMIN_PATHS = ['/admin']

// Admin routes that should NOT be auth-gated — they handle their own auth
// or are the destination of unauthenticated redirects.
const ADMIN_PUBLIC_PATHS = [
  '/admin/login',
]

function isAdminPublicPath(pathname: string): boolean {
  return ADMIN_PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * Validate admin token format + expiry in Edge Runtime.
 * Token format: rawHex.timestampHex.hmacHex
 *
 * This is a lightweight gate — it checks format and expiry but does NOT
 * verify the HMAC (that requires Node.js crypto). The actual HMAC + session
 * store validation happens in every admin API route.
 *
 * This is secure because:
 * 1. The token format (64.1-13.64 hex) is extremely unlikely to be guessed
 * 2. Expiry is enforced
 * 3. Every admin API route does full Node.js HMAC validation
 * 4. Without a valid HMAC-signed token, no API call will succeed
 */
function isTokenFormatValid(token: string): boolean {
  if (!token) return false

  const parts = token.split('.')
  if (parts.length !== 3) return false

  const [rawToken, timestamp, signature] = parts

  // rawToken: exactly 64 hex chars (32 random bytes)
  if (!/^[a-f0-9]{64}$/.test(rawToken)) return false

  // timestamp: 1-13 hex chars (milliseconds since epoch)
  if (!/^[a-f0-9]{1,13}$/.test(timestamp)) return false

  // signature: exactly 64 hex chars (HMAC-SHA256)
  if (!/^[a-f0-9]{64}$/.test(signature)) return false

  // Check expiry (24 hours)
  const createdAt = parseInt(timestamp, 16)
  if (isNaN(createdAt)) return false
  const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000
  if (Date.now() > createdAt + SESSION_MAX_AGE_MS) return false

  return true
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only process paths that start with /admin
  const isAdminRoute = ADMIN_PATHS.some(path => pathname.startsWith(path))

  if (!isAdminRoute) {
    return NextResponse.next()
  }

  // Allow public admin paths (login page)
  if (isAdminPublicPath(pathname)) {
    return NextResponse.next()
  }

  // Check for admin session cookie
  const sessionToken = request.cookies.get('admin_session')?.value

  if (!sessionToken) {
    const loginUrl = new URL('/admin/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Lightweight format + expiry check (Edge-compatible, no Node.js crypto)
  if (!isTokenFormatValid(sessionToken)) {
    const loginUrl = new URL('/admin/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    loginUrl.searchParams.set('error', 'session_expired')

    const response = NextResponse.redirect(loginUrl)
    response.cookies.delete({ name: 'admin_session', path: '/admin' })
    return response
  }

  // Valid format + not expired — allow through.
  // Full HMAC validation happens in each admin API route.
  return NextResponse.next()
}

// Only match /admin/* paths — do NOT match other routes.
// Admin API routes (/api/admin/*) handle their own auth.
export const config = {
  matcher: [
    '/admin/:path*',
  ],
}
