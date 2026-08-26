// =============================================================================
// POST /api/admin/verifications/[id]/approve
// =============================================================================
// Admin-only endpoint. Approves a payment verification.
//
// Side effects:
//   1. The verification record is marked "approved" with the admin's note.
//   2. The user's `status` is flipped to "active" — they can immediately
//      perform AI generation on their next request.
//   3. The user's `planId` is updated to match the verification's planId
//      (if one was set when the user submitted the payment).
//
// Body (optional):
//   { adminNote?: string }   // optional note shown to the user
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
      // No body is fine - adminNote is optional
    }
    const { adminNote } = body

    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()

    const result = await convex.mutation(api.paymentVerifications.approveVerification, {
      verificationId: id as any,
      reviewedBy: 'admin',
      adminNote: adminNote ?? undefined,
    })

    console.log(`[ADMIN APPROVE] Verification ${id} approved. User ${result?.userId} activated.`)

    return NextResponse.json({
      success: true,
      data: {
        verificationId: id,
        userId: result?.userId,
        activated: true,
      },
    })

  } catch (error) {
    console.error('[ADMIN APPROVE] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to approve verification',
        code: 'APPROVE_FAILED',
      },
      { status: 500 }
    )
  }
}
