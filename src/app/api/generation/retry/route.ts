// =============================================================================
// POST /api/generation/retry — resume a failed/stalled generation job
// =============================================================================
// Session-authenticated; ownership re-verified inside Convex. Requeues failed
// units (bounded per-unit attempts) or re-plans if planning never finished,
// then reschedules the Convex worker. Also un-sticks jobs left in
// "rendering" by a crashed render call.

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

    const result = (await getConvexClient().mutation(api.generation.resumeUserJob, {
      serverToken,
      jobId: jobId as any,
      userId: session.user.id as any,
      // Forward the server's AI keys so a retry works even without Convex env
      // keys (same fallback policy as enqueue).
      aiKeys: {
        gemini: process.env.GEMINI_API_KEY || undefined,
        geminiBaseUrl: process.env.GEMINI_BASE_URL || undefined,
        geminiModel: process.env.GEMINI_MODEL || undefined,
        openrouter: process.env.OPENROUTER_API_KEY || undefined,
        openai: process.env.OPENAI_API_KEY || undefined,
      },
    })) as { success: boolean; jobId?: string; error?: string; code?: string }

    if (!result.success) {
      const status = result.code === 'RETRY_LIMIT' ? 429 : result.code === 'INVALID_STATE' ? 409 : 404
      return NextResponse.json(
        { success: false, error: result.error || 'Could not retry', code: result.code || 'RETRY_FAILED' },
        { status }
      )
    }

    return NextResponse.json({
      success: true,
      data: { jobId: result.jobId, status: 'resumed' },
    })
  } catch (error) {
    console.error('[GENERATION-RETRY] Unhandled error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
