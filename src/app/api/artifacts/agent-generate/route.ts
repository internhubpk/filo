// =============================================================================
// POST /api/artifacts/agent-generate
// =============================================================================
// Agent Router: Generates REAL downloadable documents (DOCX/PDF/XLSX/PPTX/CSV)
// Uses the Agent Router pipeline:
//   Prompt → Type Detection → AI Planning → AI Content → File Rendering → Output
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { agentRouter, type AgentRouterInput } from '@/services/agent-router'

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

    // Validate session with Convex
    let convexClient: any
    let session: any
    try {
      const { getConvexClient } = await import('@/lib/convex-server')
      convexClient = getConvexClient()
      session = await convexClient.query('auth:validateSession', { token })
    } catch (convexErr) {
      // If Convex is not configured, skip session validation (dev mode)
      console.warn('[AGENT-GENERATE] Convex not available, skipping session check')
      session = { valid: true, user: { id: 'dev-user' } }
    }

    if (!session?.valid || !session?.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    // ==================== ACCOUNT ACTIVATION ENFORCEMENT ====================
    // Manual activation flow: only "active" users can perform chat/generation.
    // Users with status "pending_activation" or "suspended" are blocked here
    // (defense-in-depth — the client also gates on user.status).
    const userStatus = session.user.status
    if (userStatus && userStatus !== 'active') {
      const message =
        userStatus === 'pending_activation'
          ? 'Your account is pending activation. An administrator will activate it after verifying your payment. Please try again later.'
          : userStatus === 'suspended'
            ? 'Your account has been suspended. Please contact support for assistance.'
            : 'Your account is not active. Please contact support.'
      return NextResponse.json(
        {
          success: false,
          error: message,
          code:
            userStatus === 'pending_activation'
              ? 'ACCOUNT_PENDING_ACTIVATION'
              : userStatus === 'suspended'
                ? 'ACCOUNT_SUSPENDED'
                : 'ACCOUNT_NOT_ACTIVE',
        },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { prompt, artifactType, outputFormat, workspaceId, brandConfig, files } = body

    // Validate prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
      return NextResponse.json(
        { success: false, error: 'Prompt must be at least 10 characters', code: 'INVALID_PROMPT' },
        { status: 400 }
      )
    }

    console.log(`[AGENT-GENERATE] Starting generation for user: ${session.user.id}`)
    console.log(`[AGENT-GENERATE] Prompt: ${prompt.substring(0, 100)}...`)
    console.log(`[AGENT-GENERATE] Format: ${outputFormat || 'auto'}, Type: ${artifactType || 'auto'}`)

    // Build input for agent router
    const routerInput: AgentRouterInput = {
      prompt: prompt.trim(),
      outputFormat: outputFormat,
      artifactType,
      userId: session.user.id,
      workspaceId: workspaceId || session.user.id,
      brandConfig,
      files,
    }

    // Run the agent router pipeline
    const result = await agentRouter.generate(routerInput)

    if (!result.success || !result.artifact) {
      // Map error codes to HTTP status
      let statusCode = 500
      if (result.code === 'API_KEY_MISSING') statusCode = 502
      else if (result.code === 'RATE_LIMITED') statusCode = 429
      else if (result.code === 'TIMEOUT') statusCode = 504
      else if (result.code === 'PLANNING_FAILED') statusCode = 422

      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Generation failed',
          code: result.code || 'GENERATION_FAILED',
          stages: result.stages,
        },
        { status: statusCode }
      )
    }

    // Save artifact record to Convex (non-blocking, best-effort)
    try {
      if (convexClient && session.user.id !== 'dev-user') {
        await convexClient.mutation('artifacts:saveArtifactRecord', {
          userId: session.user.id,
          title: result.artifact.title,
          type: result.artifact.type,
          format: result.artifact.format,
          prompt: prompt.trim(),
          status: 'completed',
        }).catch(() => {
          // Non-critical: Don't fail if saving fails
        })
      }
    } catch (saveErr) {
      console.warn('[AGENT-GENERATE] Non-critical: Could not save artifact record')
    }

    // Record usage (non-blocking)
    try {
      if (convexClient && session.user.id !== 'dev-user') {
        await convexClient.mutation('subscriptions:recordAIGeneration', {
          userId: session.user.id,
        }).catch(() => {})
      }
    } catch {
      // Non-critical
    }

    console.log(`[AGENT-GENERATE] Success! File: ${result.artifact.fileName} (${result.artifact.fileSize} bytes)`)
    console.log(`[AGENT-GENERATE] Tokens used: ${result.tokensUsed}, Time: ${result.generationTimeMs}ms`)

    return NextResponse.json({
      success: true,
      data: {
        artifact: {
          id: result.artifact.id,
          title: result.artifact.title,
          type: result.artifact.type,
          format: result.artifact.format,
          content: result.artifact.content,
          fileData: result.artifact.fileData,
          fileSize: result.artifact.fileSize,
          fileName: result.artifact.fileName,
          mimeType: result.artifact.mimeType,
        },
        tokensUsed: result.tokensUsed,
        generationTimeMs: result.generationTimeMs,
        stages: result.stages,
      },
    })

  } catch (error) {
    console.error('[AGENT-GENERATE] Unhandled error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
