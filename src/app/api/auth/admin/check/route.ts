import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSessionToken, ADMIN_COOKIE_NAME } from '@/lib/admin-auth'

// GET /api/auth/admin/check - Check if admin is authenticated
export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get(ADMIN_COOKIE_NAME)?.value

  // Cryptographic verification of the signed admin token (see src/lib/admin-auth.ts).
  const verification = await verifyAdminSessionToken(sessionToken)

  if (!verification.valid) {
    return NextResponse.json(
      { authenticated: false, code: verification.reason === 'expired' ? 'INVALID_SESSION' : 'NO_SESSION' },
      { status: 401 }
    )
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      role: 'admin',
    },
  })
}
