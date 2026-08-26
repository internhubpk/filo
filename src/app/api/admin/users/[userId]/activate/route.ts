// =============================================================================
// POST /api/admin/users/[userId]/activate
// =============================================================================
// Admin-only endpoint. Manually activates a user account, granting them
// access to AI generation. Typically called after the admin has reviewed
// the user's payment verification and confirmed the payment.
//
// Body (optional):
//   { planId?: string, note?: string }
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

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      // No body or invalid JSON is fine - planId/note are optional
    }
    const { planId, note } = body

    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()

    const updated = await convex.mutation(api.users.activateUser, {
      userId: userId as any,
      planId: planId ?? undefined,
      note: note ?? undefined,
    })

    console.log(`[ADMIN ACTIVATE] User ${userId} activated`)

    return NextResponse.json({
      success: true,
      data: {
        userId: (updated as any)?._id ?? userId,
        status: (updated as any)?.status ?? 'active',
        activatedAt: (updated as any)?.activatedAt ?? Date.now(),
      },
    })

  } catch (error) {
    console.error('[ADMIN ACTIVATE] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to activate user',
        code: 'ACTIVATION_FAILED',
      },
      { status: 500 }
    )
  }
}
