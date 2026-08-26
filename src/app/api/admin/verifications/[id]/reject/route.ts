// =============================================================================
// POST /api/admin/verifications/[id]/reject
// =============================================================================
// Admin-only endpoint. Rejects a payment verification with a reason.
//
// Side effects:
//   1. The verification record is marked "rejected" with the admin's note.
//   2. The user's `status` is NOT changed (they remain in whatever state
//      they were - typically still "pending_activation"). The admin note
//      is surfaced back to the user on their /billing page so they can
//      re-submit with correct information.
//
// Body:
//   { adminNote: string }   // REQUIRED - reason shown to the user
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isAdminRequest(request)) {
      return NextResponse.json(
        { success: false, error: 'Admin authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'verification id is required', code: 'MISSING_ID' },
        { status: 400 }
      )
    }

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const adminNote = body?.adminNote
    if (!adminNote || typeof adminNote !== 'string' || adminNote.trim().length < 3) {
      return NextResponse.json(
        {
          success: false,
          error: 'A reason (adminNote) is required when rejecting a verification',
          code: 'MISSING_REASON',
        },
        { status: 400 }
      )
    }

    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()

    const result = await convex.mutation(api.paymentVerifications.rejectVerification, {
      verificationId: id as any,
      reviewedBy: 'admin',
      adminNote: adminNote.trim(),
    })

    console.log(`[ADMIN REJECT] Verification ${id} rejected. User ${result?.userId} remains pending.`)

    return NextResponse.json({
      success: true,
      data: {
        verificationId: id,
        userId: result?.userId,
        activated: false,
      },
    })

  } catch (error) {
    console.error('[ADMIN REJECT] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reject verification',
        code: 'REJECT_FAILED',
      },
      { status: 500 }
    )
  }
}
