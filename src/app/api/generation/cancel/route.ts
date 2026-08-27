// =============================================================================
// POST /api/generation/cancel — cancel the caller's active generation job
// =============================================================================
// Session-authenticated. Ownership is re-verified inside Convex. The worker
// honors cancellation at the next unit boundary (within one AI call).

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { api } from '@convex/_generated/api'
import { getConvexClient } from '@/lib/convex-server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.substring(7)
    const session = token ? validateSessionToken(token) : null
    if (!session?.valid || !session?.user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    const serverToken = process.env.FILO_SERVER_SECRET
    if (!serverToken) {
      return NextResponse.json(
        { success: false, error: 'Generation service is not configured', code: 'SERVER_SECRET_MISSING' },
        { status: 503 }
      )
    }

    const { jobId } = await request.json()
    if (!jobId || typeof jobId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'jobId is required', code: 'INVALID_JOB_ID' },
        { status: 400 }
      )
    }

    const result = (await getConvexClient().mutation(api.generation.cancelUserJob, {
      serverToken,
      jobId: jobId as any,
      userId: session.user.id as any,
    })) as { success: boolean; error?: string; code?: string }

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Could not cancel', code: result.code || 'CANCEL_FAILED' },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true, data: { status: 'cancelled' } })
  } catch (error) {
    console.error('[GENERATION-CANCEL] Unhandled error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
