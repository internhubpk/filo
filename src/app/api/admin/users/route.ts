// =============================================================================
// GET /api/admin/users
// =============================================================================
// List all users with their activation status. Admin-only endpoint.
//
// Returns:
//   - all users (newest first, capped at 200)
//   - pending users (status === "pending_activation")
//   - active users (status === "active")
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'
import { isAdminRequest } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  try {
    if (!isAdminRequest(request)) {
      return NextResponse.json(
        { success: false, error: 'Admin authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()

    const [all, pending, active] = await Promise.all([
      convex.query(api.users.getAllUsers, {}),
      convex.query(api.users.getPendingUsers, {}),
      convex.query(api.users.getActiveUsers, {}),
    ])

    // Strip password hashes before sending to the client
    const strip = (users: any[]) =>
      users.map((u: any) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        role: u.role ?? 'user',
        status: u.status ?? 'pending_activation',
        planId: u.planId ?? null,
        activatedAt: u.activatedAt ?? null,
        activationNote: u.activationNote ?? null,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      }))

    return NextResponse.json({
      success: true,
      data: {
        all: strip(all),
        pending: strip(pending),
        active: strip(active),
        counts: {
          total: all.length,
          pending: pending.length,
          active: active.length,
          suspended: all.filter((u: any) => u.status === 'suspended').length,
          admins: all.filter((u: any) => u.role === 'admin').length,
        },
      },
    })

  } catch (error) {
    console.error('[ADMIN /api/admin/users] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch users', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
