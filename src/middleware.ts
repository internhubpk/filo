import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSessionToken, ADMIN_COOKIE_NAME } from '@/lib/admin-auth'

// Paths that require admin authentication
const ADMIN_PATHS = ['/admin']

// Admin routes that should NOT be auth-gated — they handle their own auth
// or are the destination of unauthenticated redirects. Without this list,
// the middleware would redirect /admin/login → /admin/login → ... forever
// (ERR_TOO_MANY_REDIRECTS in the browser).
const ADMIN_PUBLIC_PATHS = [
  '/admin/login',
]

function isAdminPublicPath(pathname: string): boolean {
  return ADMIN_PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check if this is an admin route
  const isAdminRoute = ADMIN_PATHS.some(path => pathname.startsWith(path))

  if (!isAdminRoute) {
    // Not an admin route, allow through
    return NextResponse.next()
  }

  // Allow /admin/login and any nested sub-paths we declared public to pass
  // through without a session check (otherwise we redirect to ourselves).
  if (isAdminPublicPath(pathname)) {
    return NextResponse.next()
  }

  // For admin routes, cryptographically verify the signed session cookie.
  // (Previously this was a mere format regex — any 64-hex string passed,
  // which combined with a permissive login route let regular users in.)
  const sessionToken = request.cookies.get(ADMIN_COOKIE_NAME)?.value
  const verification = await verifyAdminSessionToken(sessionToken)

  if (!verification.valid) {
    const loginUrl = new URL('/admin/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    if (verification.reason === 'expired') {
      loginUrl.searchParams.set('error', 'session_expired')
    }

    const response = NextResponse.redirect(loginUrl)
    // Clear invalid/expired cookie
    response.cookies.delete({ name: ADMIN_COOKIE_NAME, path: '/' })
    return response
  }

  // Valid session, allow access
  return NextResponse.next()
}

// Configure middleware to run on specific paths
export const config = {
  matcher: [
    // Match all admin routes
    '/admin/:path*',
  ],
}
