// =============================================================================
// POST /api/artifacts/agent-generate
// =============================================================================
// Agent Router: Generates REAL downloadable documents (DOCX/PDF/XLSX/PPTX/CSV)
// Pipeline: Prompt → Type Detection → AI Planning → AI Content → File Render
//
// Fixes included in this version:
//  1. LIVE account-status check: status is re-read from the database on every
//     request. Previously it trusted `session.user.status` from the HMAC
//     token, which stays valid for 7 days — so SUSPENDED users could keep
//     generating for up to a week, and freshly-activated users were locked
//     out until they logged in again.
//  2. Quota PRE-CHECK: plan limit minus current-month usage is verified
//     BEFORE spending AI tokens. Previously only post-success usage recording
//     existed, so limits were never actually enforced.
//  3. Duplicate-request guard: while one generation is running for a user,
//     additional concurrent requests are rejected instead of silently
//     consuming multiple credits.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { agentRouter, type AgentRouterInput } from '@/services/agent-router'
import { api } from '@convex/_generated/api'
import { getConvexClient } from '@/lib/convex-server'

// Simple per-user in-flight generation guard (per server instance).
// Prevents double-click / parallel duplicate submissions from racing past
// the client-side button disable. Keyed by userId, auto-cleared in finally.
const inFlightGenerations = new Map<string, number>()

const MAX_CONCURRENT_GENERATION_AGE_MS = 10 * 60 * 1000 // safety window

function tryAcquireGenerationSlot(userId: string): boolean {
  const now = Date.now()
  const startedAt = inFlightGenerations.get(userId)
  if (
    startedAt !== undefined &&
    now - startedAt < MAX_CONCURRENT_GENERATION_AGE_MS
  ) {
    return false // already generating on this instance
  }
  inFlightGenerations.set(userId, now)
  return true
}

function releaseGenerationSlot(userId: string): void {
  inFlightGenerations.delete(userId)
}

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

    if (!session?.valid || !session?.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    if (userId === 'dev-user') {
      console.warn('[AGENT-GENERATE] dev-user bypasses activation checks')
    }

    // ==================== LIVE ACCOUNT STATUS CHECK ====================
    // Re-read the user's CURRENT status from the database. The session token
    // may be up to 7 days old and can embed a stale status.
    let liveStatus: string = session.user.status ?? 'pending_activation'
    let livePlanId: string | null = session.user.planId ?? null

    if (userId !== 'dev-user') {
      const convexClient = getConvexClient()
      try {
        const dbUser = await convexClient.query(api.users.getUser, {
          userId: userId as any,
        })
        if (!dbUser) {
          return NextResponse.json(
            {
              success: false,
              error: 'Account not found. Please log out and log in again.',
              code: 'ACCOUNT_NOT_FOUND',
            },
            { status: 401 }
          )
        }
        liveStatus = (dbUser as any).status ?? liveStatus
        livePlanId = (dbUser as any).planId ?? null
      } catch (statusErr) {
        // Fail SOFT on infrastructure errors using the token's embedded
        // status (better to allow a paying user than hard-block everyone on
        // a transient Convex hiccup). Logged for observability.
        console.warn('[AGENT-GENERATE] Live status lookup failed, using token status:', statusErr)
      }

      // Manual activation gate (now against LIVE status)
      if (liveStatus !== 'active') {
        const message =
          liveStatus === 'pending_activation'
            ? 'Your account is pending activation. An administrator will activate it after verifying your payment. Please try again later.'
            : liveStatus === 'suspended'
              ? 'Your account has been suspended. Please contact support for assistance.'
              : 'Your account is not active. Please contact support.'
        return NextResponse.json(
          {
            success: false,
            error: message,
            code:
              liveStatus === 'pending_activation'
                ? 'ACCOUNT_PENDING_ACTIVATION'
                : liveStatus === 'suspended'
                  ? 'ACCOUNT_SUSPENDED'
                  : 'ACCOUNT_NOT_ACTIVE',
          },
          { status: 403 }
        )
      }
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

    // Validate attached files (count + size caps so uploads cannot blow up memory)
    const MAX_FILES = 10
    const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10MB base64 content each
    let safeFiles = files
    if (Array.isArray(files)) {
      if (files.length > MAX_FILES) {
        return NextResponse.json(
          { success: false, error: `Too many attached files (max ${MAX_FILES})`, code: 'TOO_MANY_FILES' },
          { status: 400 }
        )
      }
      for (const f of files) {
        if (
          !f ||
          typeof f.filename !== 'string' ||
          typeof f.content !== 'string' ||
          f.content.length > MAX_FILE_BYTES * 1.4 // base64 overhead allowance
        ) {
          return NextResponse.json(
            { success: false, error: `Each attached file must be smaller than ${MAX_FILE_BYTES / (1024 * 1024)}MB`, code: 'FILE_TOO_LARGE' },
            { status: 400 }
          )
        }
      }
      safeFiles = files.map((f: any) => ({
        filename: String(f.filename).slice(0, 255),
        mimeType: typeof f.mimeType === 'string' ? f.mimeType : 'application/octet-stream',
        content: f.content,
      }))
    } else if (files !== undefined && files !== null) {
      return NextResponse.json(
        { success: false, error: 'Invalid files payload', code: 'INVALID_FILES' },
        { status: 400 }
      )
    }

    // ==================== DUPLICATE REQUEST GUARD ====================
    if (userId !== 'dev-user' && !tryAcquireGenerationSlot(userId)) {
      return NextResponse.json(
        {
          success: false,
          error: 'A generation is already in progress. Please wait for it to finish.',
          code: 'GENERATION_IN_PROGRESS',
        },
        { status: 429 }
      )
    }

    try {
      // ==================== QUOTA PRE-CHECK ====================
      // Enforce the plan's monthly AI-generation limit BEFORE calling AI
      // providers (so a failed/exhausted quota never costs provider spend and
      // failed generations never consume credits — usage is recorded only on
      // success further below).
      if (userId !== 'dev-user') {
        try {
          const convexClient = getConvexClient()

          // Plan limit: explicit plan or sensible default for active users.
          let planLimit = 500
          if (livePlanId) {
            try {
              const plan = await convexClient.query(api.plans.getPlanById, {
                planId: livePlanId as any,
              })
              if (plan?.maxAiGenerations !== undefined && plan.maxAiGenerations !== null) {
                planLimit = plan.maxAiGenerations
              }
            } catch (planErr) {
              console.warn('[AGENT-GENERATE] Plan lookup failed, using default limit:', planErr)
            }
          }

          if (planLimit >= 0) {
            // Monthly usage — new Convex query; degrades gracefully (fail-open)
            // if the deployment hasn't been updated yet.
            try {
              const usage = await convexClient.query(api.subscriptions.getMonthlyAiUsage, {
                userId: userId as any,
              })
              const used = usage?.used ?? 0
              if (used >= planLimit) {
                return NextResponse.json(
                  {
                    success: false,
                    error: `Monthly generation limit reached (${used}/${planLimit}). Your limit resets next month.`,
                    code: 'LIMIT_REACHED',
                    data: { remaining: Math.max(0, planLimit - used), limit: planLimit },
                  },
                  { status: 429 }
                )
              }
            } catch (usageErr) {
              console.warn('[AGENT-GENERATE] Usage lookup unavailable (pre-deploy), skipping pre-check:', usageErr)
            }
          }
        } catch (quotaErr) {
          console.warn('[AGENT-GENERATE] Quota pre-check skipped:', quotaErr)
        }
      }

      console.log(`[AGENT-GENERATE] Starting generation for user: ${userId}`)
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
        files: safeFiles,
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
        const convexClient = getConvexClient()
        if (userId !== 'dev-user') {
          await convexClient.mutation(api.artifacts.saveArtifactRecord, {
            userId: userId as any,
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

      // Record usage AFTER successful generation only (never on failure)
      try {
        const convexClient = getConvexClient()
        if (userId !== 'dev-user') {
          await convexClient.mutation(api.subscriptions.recordAIGeneration, {
            userId: userId as any,
          }).catch(() => {})
        }
      } catch {
        // Non-critical
      }

      console.log(`[AGENT-GENERATE] Success! File: ${result.artifact.fileName} (${result.artifact.fileSize} bytes)`)

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
    } finally {
      releaseGenerationSlot(userId)
    }
  } catch (error) {
    console.error('[AGENT-GENERATE] Unhandled error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
