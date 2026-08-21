import { NextRequest, NextResponse } from 'next/server'

// Paths that require admin authentication
const ADMIN_PATHS = ['/admin']

// Public paths that don't require auth
const PUBLIC_PATHS = ['/pricing', '/login', '/api/auth']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check if this is an admin route
  const isAdminRoute = ADMIN_PATHS.some(path => pathname.startsWith(path))

  if (!isAdminRoute) {
    // Not an admin route, allow through
    return NextResponse.next()
  }

  // For admin routes, check for session cookie
  const sessionToken = request.cookies.get('admin_session')?.value

  if (!sessionToken) {
    // No session - redirect to login
    const loginUrl = new URL('/admin/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Validate session token format
  if (!isValidSessionToken(sessionToken)) {
    // Invalid session - redirect to login
    const loginUrl = new URL('/admin/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    loginUrl.searchParams.set('error', 'session_expired')
    
    const response = NextResponse.redirect(loginUrl)
    // Clear invalid cookie
    response.cookies.delete('admin_session', { path: '/admin' })
    return response
  }

  // Valid session, allow access
  return NextResponse.next()
}

function isValidSessionToken(token: string): boolean {
  // Basic validation of token format (SHA-256 hex string)
  if (!token || token.length !== 64) {
    return false
  }
  
  // Check if it's a valid hex string
  return /^[a-f0-9]{64}$/.test(token)
}

// Configure middleware to run on specific paths
export const config = {
  matcher: [
    // Match all admin routes
    '/admin/:path*',
    // Exclude static files and API routes that handle their own auth
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/files|api/artifacts).*)',
  ],
}
