// =============================================================================
// POST /api/admin/users/[userId]/set-role
// =============================================================================
// Admin-only endpoint. Sets a user's role to "admin" or "user".
// Promoting to admin also auto-activates the account.
//
// Body:
//   { role: "admin" | "user" }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'
import { isAdminRequest } from '@/lib/admin-auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    if (!isAdminRequest(request)) {
      return NextResponse.json(
        { success: false, error: 'Admin authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    const { userId } = await params
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required', code: 'MISSING_USER' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { role } = body

    if (role !== 'admin' && role !== 'user') {
      return NextResponse.json(
        { success: false, error: 'role must be "admin" or "user"', code: 'INVALID_ROLE' },
        { status: 400 }
      )
    }

    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()

    const updated = await convex.mutation(api.users.setUserRole, {
      userId: userId as any,
      role,
    })

    console.log(`[ADMIN SET-ROLE] User ${userId} role set to ${role}`)

    return NextResponse.json({
      success: true,
      data: {
        userId: (updated as any)?._id ?? userId,
        role: (updated as any)?.role ?? role,
        status: (updated as any)?.status,
      },
    })

  } catch (error) {
    console.error('[ADMIN SET-ROLE] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set user role',
        code: 'SET_ROLE_FAILED',
      },
      { status: 500 }
    )
  }
}
