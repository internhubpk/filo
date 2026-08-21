import { NextRequest, NextResponse } from 'next/server'

// GET /api/auth/admin/check - Check if admin is authenticated
export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get('admin_session')?.value

  if (!sessionToken) {
    return NextResponse.json(
      { authenticated: false, code: 'NO_SESSION' },
      { status: 401 }
    )
  }

  const isValid = await validateSessionToken(sessionToken)

  if (!isValid) {
    return NextResponse.json(
      { authenticated: false, code: 'INVALID_SESSION' },
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

async function validateSessionToken(token: string): Promise<boolean> {
  try {
    // Validate token format (SHA-256 hex)
    if (!token || token.length !== 64) {
      return false
    }

    // Basic format validation
    // In production, you'd check against a database/Convex for stored sessions
    return /^[a-f0-9]{64}$/.test(token)
  } catch {
    return false
  }
}
