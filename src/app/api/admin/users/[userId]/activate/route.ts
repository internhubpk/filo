// =============================================================================
// POST /api/admin/users/[userId]/activate
// =============================================================================
// Admin-only endpoint. LIFTS A SUSPENSION (suspended → active) after the
// admin has reviewed a moderation case. It CANNOT grant paid plans: manual
// plan activation was removed in the rebuild — entitlements flow only from
// verified payment signals. A planId in the body is rejected with 400.
// Body (optional):
//   { note?: string }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { api } from '@convex/_generated/api'


export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    if (!(await isAdminRequest(request))) {
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
      // No body or invalid JSON is fine - note is optional
    }
    // POLICY (rebuild v2): manual plan grants are REMOVED. If a client still
    // sends planId it is rejected rather than silently ignored — admins must
    // not create unpaid entitlements. Paid plans are activated exclusively
    // by verified Safepay signals (webhook / signed return / tracker).
    const { planId, note } = body
    if (planId) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Manual plan activation is not allowed. Paid entitlements are activated automatically by verified payments.',
          code: 'MANUAL_PLAN_ACTIVATION_DISABLED',
        },
        { status: 400 }
      )
    }

    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()

    const updated = await convex.mutation(api.users.activateUser, {
      userId: userId as any,
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
