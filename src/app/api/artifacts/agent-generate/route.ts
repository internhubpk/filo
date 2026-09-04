// =============================================================================
// POST /api/artifacts/agent-generate  (BACKGROUND JOB EDITION)
// =============================================================================
// Starts a durable generation job in Convex and returns in milliseconds.
// The AI work runs in a Convex worker (convex/worker.ts) — it keeps running
// after the user closes the tab, logs out, or loses connectivity. This is the
// definitive fix for the 504s: nothing long-running happens on Vercel.
//
// Pipeline (server-side, tab-independent):
//   this route → generation:enqueueJob → scheduled worker (designer + plan +
//   sections) → POST /api/generation/render (DOCX/PDF/… + R2 upload) → job
//   completed
//
// Checks BEFORE any AI spend:
//   1. Authentication (HMAC session + live DB re-read)
//   2. Account status (suspended blocks)
//   3. Plan entitlement (AI chat/generation is a PAID feature — free plans
//      are denied with PLAN_UPGRADE_REQUIRED; enforced here AND in Convex)
//   4. Monthly quota (plan limit vs usage, from real DB values)
//   5. Duplicate guard (one active job per user; returns the running jobId
//      so the client can just attach to it)
//
// FILE INGESTION (spec §21/§22): attached files are INGESTED HERE — real
// content extraction (DOCX/PDF/XLSX/PPTX/CSV/TXT) via the ingestion pipeline
// — and the bounded, structured context is passed to the worker so the AI
// genuinely operates on the user's material. Previously only file NAMES
// reached the worker and content was silently discarded.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { api } from '@convex/_generated/api'
import { getConvexClient } from '@/lib/convex-server'
import { isAiChatAllowedForPlan, type PlanEntitlementDoc } from '@/lib/ai-entitlement'
import { ingestFile, buildSourceContext, type IngestedFile } from '@/services/ingestion'
import { sanitizeTemplateId } from '@/config/templates'

// Shape of the plan documents we read for entitlement/quota decisions.
type PlanDoc = PlanEntitlementDoc

export async function POST(request: NextRequest) {
  try {
    // ==================== AUTHENTICATION ====================
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.substring(7)

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    const session = validateSessionToken(token)
    if (!session?.valid || !session?.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // ==================== LIVE ACCOUNT STATUS ====================
    // Re-read the user's CURRENT record — the HMAC token can be up to 7
    // days old and embed a stale status.
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
        livePlanId = (dbUser as any).planId ?? null
        if (((dbUser as any).status ?? 'active') === 'suspended') {
          return NextResponse.json(
            {
              success: false,
              error: 'Your account has been suspended. Please contact support for assistance.',
              code: 'ACCOUNT_SUSPENDED',
            },
            { status: 403 }
          )
        }
      } catch (statusErr) {
        console.warn('[AGENT-GENERATE] Live status lookup failed, using token status:', statusErr)
      }
    }

    // ==================== REQUEST VALIDATION ====================
    const body = await request.json()
    const { prompt, artifactType, outputFormat, workspaceId, brandConfig, files } = body

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
      // EDIT MODE may arrive with only an editInstruction — the effective
      // prompt is derived after source resolution; here we only hard-reject
      // requests that have NEITHER a usable prompt NOR an instruction.
      const hasInstruction = typeof body.editInstruction === 'string' && body.editInstruction.trim().length >= 3
      const hasSource = typeof body.sourceArtifactId === 'string' && body.sourceArtifactId.length > 0
      if (!(hasInstruction && hasSource)) {
        return NextResponse.json(
          { success: false, error: 'Prompt must be at least 10 characters', code: 'INVALID_PROMPT' },
          { status: 400 }
        )
      }
    }

    // Validate attached files (names are persisted; content stays ephemeral —
    // the background worker never uploads base64 payloads into the database).
    const MAX_FILES = 10
    const MAX_FILE_BYTES = 10 * 1024 * 1024
    let safeFiles: Array<{ filename: string; mimeType: string; content: string }> = []
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
          f.content.length > MAX_FILE_BYTES * 1.4
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

    // ==================== FILE INGESTION (spec §21/§22) ====================
    // Extract STRUCTURED content from the attached files so the AI can
    // actually work with them. Files arrive as base64 (client-side encode);
    // we ingest with magic-byte type detection (never trusting the declared
    // MIME alone) and build a bounded textual context.
    const ingestionWarnings: string[] = []
    let sourceContext: string | undefined
    if (safeFiles.length > 0) {
      const ingested: IngestedFile[] = []
      for (const f of safeFiles) {
        try {
          let buffer: Buffer
          try {
            const base64 = f.content.includes(',') ? f.content.slice(f.content.indexOf(',') + 1) : f.content
            buffer = Buffer.from(base64, 'base64')
          } catch {
            ingestionWarnings.push(`${f.filename}: could not decode file content`)
            continue
          }
          if (buffer.length === 0) {
            ingestionWarnings.push(`${f.filename}: file is empty`)
            continue
          }
          const result = await ingestFile(buffer, f.filename, f.mimeType)
          ingested.push(result)
          for (const w of result.warnings) ingestionWarnings.push(`${f.filename}: ${w}`)
        } catch (ingestErr) {
          // One unreadable file must not block the whole generation — the AI
          // still gets the prompt (and the file NAME) as context.
          const msg = ingestErr instanceof Error ? ingestErr.message : String(ingestErr)
          ingestionWarnings.push(`${f.filename}: ${msg.slice(0, 140)}`)
        }
      }
      if (ingested.length > 0) {
        // Bounded context: comfortably below the 1MB Convex document cap.
        sourceContext = buildSourceContext(ingested, 48_000)
      }
    }

    if (userId === 'dev-user') {
      return NextResponse.json(
        { success: false, error: 'Background generation requires a real account', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    // ==================== AI EDIT OF AN EXISTING ARTIFACT =================
    // sourceArtifactId switches the job into EDIT MODE: the artifact's
    // CURRENT file is downloaded, ingested, and passed as the editable source
    // document; the output format defaults to the artifact's own format (an
    // edited DOCX must come back as a DOCX). The versioned render path
    // (resolveRenderTarget) then writes the result as a NEW VERSION of the
    // same artifact instead of a duplicate.
    const sourceArtifactId = typeof body.sourceArtifactId === 'string' ? body.sourceArtifactId : undefined
    const editInstruction = typeof body.editInstruction === 'string' ? body.editInstruction.trim() : undefined
    // Effective request: an edit merges the instruction into the prompt and
    // defaults the output format to the source artifact's format.
    let effectivePrompt = prompt.trim()
    let effectiveOutputFormat: string | undefined = outputFormat
    if (sourceArtifactId) {
      const convexClientForEdit = getConvexClient()
      const artifactDoc = (await convexClientForEdit.query(api.artifacts.getArtifactForUser, {
        artifactId: sourceArtifactId as any,
        userId: userId as any,
      }).catch(() => null)) as { _id: string; format?: string; title?: string; fileId?: string } | null
      if (!artifactDoc) {
        return NextResponse.json(
          { success: false, error: 'Artifact to edit was not found in your library', code: 'SOURCE_ARTIFACT_NOT_FOUND' },
          { status: 404 }
        )
      }

      // EDIT MODE + no attached files → pull the artifact's current file and
      // ingest it so the model edits REAL content, not a summary.
      if (safeFiles.length === 0 && artifactDoc.fileId) {
        try {
          const fileDoc = (await convexClientForEdit.query(api.files.getFileForUser, {
            fileId: artifactDoc.fileId as any,
            userId: userId as any,
          }).catch(() => null)) as { r2Key?: string; originalName?: string; mimeType?: string } | null
          if (fileDoc?.r2Key) {
            const { downloadFromR2 } = await import('@/lib/r2/client')
            const bytes = await downloadFromR2(fileDoc.r2Key)
            const ingestedArtifact = await ingestFile(bytes, fileDoc.originalName || 'artifact', fileDoc.mimeType || 'application/octet-stream')
            sourceContext = buildSourceContext([ingestedArtifact], 48_000)
            for (const w of ingestedArtifact.warnings) ingestionWarnings.push(`${fileDoc.originalName || 'artifact'}: ${w}`)
          }
        } catch (downloadErr) {
          console.warn('[AGENT-GENERATE] Artifact file download failed — editing from metadata only:', downloadErr)
          ingestionWarnings.push('The current file of this artifact could not be read; the AI will work from the artifact metadata.')
        }
      }
      // An edited document comes back in ITS OWN format unless explicitly overridden.
      if (!effectiveOutputFormat && artifactDoc.format) {
        effectiveOutputFormat = artifactDoc.format
      }
      // The prompt for an edit carries the INSTRUCTION; the architect prompt
      // gets the full EDIT preamble from the worker.
      if (editInstruction) {
        effectivePrompt = `Apply this edit to my document "${artifactDoc.title || ''}": ${editInstruction}`
      }
    }

    // ==================== PLAN + QUOTA (single Convex round-trip each) ====
    const convexClient = getConvexClient()
    const serverToken = process.env.FILO_SERVER_SECRET
    if (!serverToken) {
      return NextResponse.json(
        {
          success: false,
          error: 'Generation is temporarily unavailable (server secret not configured).',
          code: 'BILLING_SERVER_SECRET_MISSING',
        },
        { status: 503 }
      )
    }

    // ---- Plan lookup: explicit plan → Free plan → null ----
    let plan: PlanDoc | null = null
    if (livePlanId) {
      try {
        plan = (await convexClient.query(api.plans.getPlanById, {
          planId: livePlanId as any,
        })) as PlanDoc | null
      } catch (planErr) {
        console.warn('[AGENT-GENERATE] Plan lookup failed, falling back to Free plan:', planErr)
      }
    }
    if (!plan) {
      try {
        plan = (await convexClient.query(api.plans.getFreePlan, {})) as PlanDoc | null
      } catch (freeErr) {
        console.warn('[AGENT-GENERATE] Free plan lookup failed:', freeErr)
      }
    }

    // ---- PAID-FEATURE GATE: AI chat/generation ----
    if (!isAiChatAllowedForPlan(plan)) {
      return NextResponse.json(
        {
          success: false,
          error:
            'AI generation is a premium feature. Upgrade to Pro to create documents with AI.',
          code: 'PLAN_UPGRADE_REQUIRED',
          data: { planName: plan?.name ?? 'Free', upgradeUrl: '/billing' },
        },
        { status: 403 }
      )
    }

    // ---- Monthly quota pre-check (never spend tokens on an exhausted plan) ----
    const planLimit = plan?.maxAiGenerations ?? null
    if (planLimit !== null && planLimit >= 0) {
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
              data: { remaining: 0, limit: planLimit },
            },
            { status: 429 }
          )
        }
      } catch (usageErr) {
        console.warn('[AGENT-GENERATE] Usage lookup unavailable, skipping pre-check:', usageErr)
      }
    }

    // ---- Duplicate guard (DB-backed; works across serverless instances) ----
    try {
      const activeJob = (await convexClient.query(api.generation.getActiveUserJob, {
        userId: userId as any,
      })) as { _id: string; status: string } | null
      if (activeJob) {
        return NextResponse.json(
          {
            success: false,
            error: 'A generation is already in progress.',
            code: 'GENERATION_IN_PROGRESS',
            data: { jobId: activeJob._id, status: activeJob.status },
          },
          { status: 429 }
        )
      }
    } catch (guardErr) {
      console.warn('[AGENT-GENERATE] Duplicate guard lookup failed:', guardErr)
    }

    // ==================== ENQUEUE (returns immediately) ====================
    // The Convex mutation stores the job and SCHEDULES the worker — the
    // pipeline is now Convex's responsibility, not this HTTP request's.
    const origin =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
      request.nextUrl.origin

    const result = (await convexClient.mutation(api.generation.enqueueJob, {
      serverToken,
      userId: userId as any,
      prompt: effectivePrompt,
      workspaceId: (workspaceId || undefined) as any,
      artifactType: artifactType || undefined,
      outputFormat: effectiveOutputFormat || undefined,
      template: sanitizeTemplateId(body.template),
      appBaseUrl: origin,
      brandConfig: brandConfig ?? undefined,
      attachedFileNames: safeFiles.map((f) => f.filename),
      sourceContext: sourceContext || undefined,
      sourceArtifactId: (body.sourceArtifactId || undefined) as any,
      // Fallback keys so the worker can call AI even before the keys are
      // configured on the Convex deployment. Recommended production setup:
      // `npx convex env set AGENT_ROUTER_API_KEY ...` (then these stay unused).
      aiKeys: {
        agentRouter: process.env.AGENT_ROUTER_API_KEY || undefined,
        gemini: process.env.GEMINI_API_KEY || undefined,
        openai: process.env.OPENAI_API_KEY || undefined,
      },
    })) as { success: boolean; jobId?: string; error?: string; code?: string }

    if (!result.success || !result.jobId) {
      return NextResponse.json(
        { success: false, error: result.error || 'Could not start generation', code: result.code || 'ENQUEUE_FAILED' },
        { status: 400 }
      )
    }

    console.log(
      `[AGENT-GENERATE] Job ${result.jobId} queued for user ${userId} (prompt: ${prompt.substring(0, 80)}…)` +
        (sourceContext ? ` + ${safeFiles.length} ingested file(s), context ${sourceContext.length} chars` : '')
    )

    return NextResponse.json({
      success: true,
      data: {
        jobId: result.jobId,
        status: 'queued',
        message: 'Generation started — it will continue even if you close this page.',
        ingestionWarnings: ingestionWarnings.length > 0 ? ingestionWarnings : undefined,
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
