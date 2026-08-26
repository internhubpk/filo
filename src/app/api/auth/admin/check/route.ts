// =============================================================================
// GET /api/auth/admin/check - Check if admin is authenticated
// =============================================================================
// Validates the admin_session cookie using HMAC-signed tokens.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  const token = request.cookies.get('admin_session')?.value

  if (!token) {
    return NextResponse.json(
      { authenticated: false, code: 'NO_SESSION' },
      { status: 401 }
    )
  }

  const session = validateSession(token)

  if (!session) {
    return NextResponse.json(
      { authenticated: false, code: 'INVALID_SESSION' },
      { status: 401 }
    )
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      username: session.username,
      role: 'admin',
    },
  })
}
