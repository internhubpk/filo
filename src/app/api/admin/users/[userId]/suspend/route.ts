// =============================================================================
// POST /api/admin/users/[userId]/suspend
// =============================================================================
// Admin-only endpoint. Suspends a user account, revoking AI generation
// access. Typically called when a user has been flagged for abuse or has
// requested cancellation past a refund window.
//
// Body (optional):
//   { note?: string }   // admin reason shown to the user
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { api } from '@convex/_generated/api'

function isAdminRequest(request: NextRequest): boolean {
  const token = request.cookies.get('admin_session')?.value
  if (!token) return false
  return /^[a-f0-9]{64}$/.test(token)
}

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

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      // No body is fine
    }
    const { note } = body

    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()

    const updated = await convex.mutation(api.users.suspendUser, {
      userId: userId as any,
      note: note ?? undefined,
    })

    console.log(`[ADMIN SUSPEND] User ${userId} suspended`)

    return NextResponse.json({
      success: true,
      data: {
        userId: (updated as any)?._id ?? userId,
        status: (updated as any)?.status ?? 'suspended',
      },
    })

  } catch (error) {
    console.error('[ADMIN SUSPEND] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to suspend user',
        code: 'SUSPEND_FAILED',
      },
      { status: 500 }
    )
  }
}
