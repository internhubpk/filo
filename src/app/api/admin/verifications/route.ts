// =============================================================================
// GET /api/admin/verifications
// =============================================================================
// Admin-only endpoint. Lists all payment verification records.
//
// Query params:
//   ?status=pending  -> only pending verifications (default if not specified)
//   ?status=all      -> all verifications regardless of status
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

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status') || 'pending'

    const { getConvexClient } = await import('@/lib/convex-server')
    const convex = getConvexClient()

    const verifications =
      statusFilter === 'all'
        ? await convex.query(api.paymentVerifications.getAllVerifications, {})
        : await convex.query(api.paymentVerifications.getPendingVerifications, {})

    return NextResponse.json({
      success: true,
      data: verifications,
    })

  } catch (error) {
    console.error('[ADMIN VERIFICATIONS LIST] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch verifications', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
