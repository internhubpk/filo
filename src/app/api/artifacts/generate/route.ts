// =============================================================================
// POST /api/artifacts/generate
// =============================================================================
// Proxy route for AI-powered artifact generation
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { getConvexClient } from '@/lib/convex-server'
import { api } from '@convex/_generated/api'
import { isAiChatAllowedForPlan } from '@/lib/ai-entitlement'

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.substring(7)

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    // Validate session locally (HMAC, no DB lookup)
    const session = validateSessionToken(token)
    if (!session.valid || !session.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // Parse request body
    const body = await request.json()
    const { prompt, artifactType, outputFormat, workspaceId } = body

    // Validate prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
      return NextResponse.json(
        { success: false, error: 'Prompt must be at least 10 characters', code: 'INVALID_PROMPT' },
        { status: 400 }
      )
    }

    console.log('[API /artifacts/generate] Starting generation for user:', userId)

    // Check subscription/usage limits
    const convex = getConvexClient()

    // ---- PAID-FEATURE GATE: AI chat/generation (free plans are blocked) ----
    try {
      const dbUser = await convex.query(api.users.getUser, { userId: userId as any })
      const planId = (dbUser as any)?.planId as string | undefined
      let plan: any = null
      if (planId) {
        plan = await convex.query(api.plans.getPlanById, { planId: planId as any })
      }
      if (!plan) {
        plan = await convex.query(api.plans.getFreePlan, {})
      }
      if (!isAiChatAllowedForPlan(plan)) {
        return NextResponse.json(
          {
            success: false,
            error: 'AI generation is a premium feature. Upgrade to Pro to create documents with AI.',
            code: 'PLAN_UPGRADE_REQUIRED',
            data: { upgradeUrl: '/billing' },
          },
          { status: 403 }
        )
      }
    } catch (gateErr) {
      console.warn('[API /artifacts/generate] Entitlement gate lookup failed:', gateErr)
    }

    try {
      const subscriptionStatus = await convex.query(api.subscriptions.canGenerateAI, {
        userId: userId as any,
      })

      if (!subscriptionStatus.allowed) {
        return NextResponse.json(
          {
            success: false,
            error: subscriptionStatus.reason || 'AI generation limit reached',
            code: 'LIMIT_REACHED',
            data: {
              remaining: subscriptionStatus.remaining,
              limit: subscriptionStatus.limit,
            }
          },
          { status: 429 }
        )
      }
    } catch (subError) {
      // If subscription check fails, allow generation anyway (MVP)
      console.warn('[API /artifacts/generate] Subscription check failed, allowing:', subError)
    }

    // Call Convex action to generate artifact
    const result = await convex.action(api.artifacts.generateArtifact, {
      prompt: prompt.trim(),
      artifactType: artifactType || undefined,
      outputFormat: outputFormat || undefined,
      workspaceId: workspaceId || session.user.id,
      userId: session.user.id,
    })

    console.log('[API /artifacts/generate] Generation result:', {
      success: result.success,
      hasArtifact: !!result.artifact,
      code: result.code,
    })

    if (!result.success) {
      // Map error codes to appropriate HTTP statuses
      let statusCode = 500
      if (result.code === 'API_KEY_MISSING' || result.code === 'PROVIDER_ERROR') {
        statusCode = 502  // Bad gateway (AI provider issue)
      } else if (result.code === 'RATE_LIMITED') {
        statusCode = 429  // Too many requests
      } else if (result.code === 'TIMEOUT') {
        statusCode = 504  // Gateway timeout
      }

      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Artifact generation failed',
          code: result.code || 'GENERATION_FAILED'
        },
        { status: statusCode }
      )
    }

    // Record usage after successful generation (server-token gated)
    try {
      await convex.mutation(api.subscriptions.recordAIGeneration, {
        serverToken: process.env.FILO_SERVER_SECRET ?? '',
        userId: userId as any,
      })
    } catch (usageError) {
      console.warn('[API /artifacts/generate] Failed to record usage:', usageError)
    }

    // Return successful response with artifact data
    return NextResponse.json({
      success: true,
      data: {
        artifact: result.artifact,
        tokensUsed: result.tokensUsed,
      }
    })

  } catch (error) {
    console.error('[API /artifacts/generate] Error:', error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error during generation',
        code: 'INTERNAL_ERROR' 
      },
      { status: 500 }
    )
  }
}
