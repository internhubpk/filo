import { NextResponse } from 'next/server'

// DELETE /api/auth/admin/logout - Admin logout
export async function DELETE() {
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
    path: '/',
  })

  return response
}

// POST /api/auth/admin/logout - Alternative method for logout
export async function POST() {
  return DELETE()
}
