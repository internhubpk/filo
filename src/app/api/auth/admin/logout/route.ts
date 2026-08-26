// =============================================================================
// POST/DELETE /api/auth/admin/logout - Admin logout
// =============================================================================
// Destroys the server-side session and clears the cookie.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { destroySession } from '@/lib/admin-auth'

function logout(request: NextRequest) {
  // Destroy the server-side session
  const token = request.cookies.get('admin_session')?.value
  if (token) {
    destroySession(token)
  }

  const response = NextResponse.json({
    success: true,
    message: 'Logged out successfully',
  })

  // Clear session cookie
  response.cookies.set('admin_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/admin',
  })

  return response
}

export async function POST(request: NextRequest) {
  return logout(request)
}

export async function DELETE(request: NextRequest) {
  return logout(request)
}
