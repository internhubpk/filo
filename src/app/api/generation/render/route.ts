// =============================================================================
// POST /api/generation/render  (INTERNAL — server-to-server, idempotent)
// =============================================================================
// The FINAL hop of the background generation pipeline. Called by the Convex
// worker when a job's sections are ready, and (as a safety net) by the
// user's browser if the worker's call ever fails. Safe to call repeatedly:
//
//   1. claimRender (idempotent, single-flight guard per job)
//   2. rebuild the ArtifactSpecification from the job blueprint + units
//   3. renderArtifact → real DOCX/PDF/XLSX/PPTX/CSV bytes (Node runtime)
//   4. upload to R2 + save artifact/file records
//   5. generation:completeJobRendered — the only path to "completed"
//
// AUTH (either one):
//   • { serverToken } — FILO_SERVER_SECRET (Convex worker path)
//   • Authorization: Bearer <session> — the job OWNER (browser fallback path)
//
// This route is why generation can finish with the tab closed: the worker
// (or a later client visit) triggers it independent of any single request.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { api } from '@convex/_generated/api'
import { getConvexClient } from '@/lib/convex-server'
import { renderArtifact } from '@/services/document-renderer'
import { classifyR2Error, isR2Configured, R2_STORAGE_UNAVAILABLE_MESSAGE } from '@/lib/r2/errors'
import type { ArtifactSpecification, OutputFormat } from '@/types'

// Rendering is CPU-bound and typically takes a few seconds; allow up to 5
// minutes for pathological documents (Pro plan maximum).
export const maxDuration = 300
export const runtime = 'nodejs'

interface RenderJob {
  _id: string
  userId: string
  prompt: string
  artifactType?: string
  outputFormat?: string
  status: string
  blueprint?: Record<string, unknown> | null
  error?: string
}

interface RenderUnit {
  _id: string
  sequence: number
  title: string
  status: string
  content?: { components?: Array<{ type?: string; content?: unknown }> } | null
}

interface RenderComponent {
  sectionId: string
  componentId: string
  type: string
  content: unknown
  order: number
}

function bad(error: string, code: string, status: number) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function POST(request: NextRequest) {
  try {
    const convexClient = getConvexClient()
    const serverToken = process.env.FILO_SERVER_SECRET
    if (!serverToken) {
      return bad('Render service not configured (FILO_SERVER_SECRET missing).', 'SERVER_SECRET_MISSING', 503)
    }

    // ==================== AUTHENTICATION (two accepted callers) ===========
    let jobId: string | null = null
    let ownerUserId: string | null = null

    let body: { serverToken?: string; jobId?: string } = {}
    try {
      body = await request.json()
    } catch {
      return bad('Invalid JSON body', 'INVALID_BODY', 400)
    }

    if (body.serverToken === serverToken && typeof body.jobId === 'string') {
      // Worker path (server-to-server)
      jobId = body.jobId
    } else {
      // Browser fallback path — must be the job's owner.
      const authHeader = request.headers.get('authorization')
      const sessionToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
      const session = sessionToken ? validateSessionToken(sessionToken) : null
      if (!session?.valid || !session?.user || typeof body.jobId !== 'string') {
        return bad('Unauthorized', 'UNAUTHORIZED', 401)
      }
      jobId = body.jobId
      ownerUserId = session.user.id
    }

    // ==================== LOAD JOB ====================
    const loaded = (await convexClient.query(api.generation.getJobForRender, {
      serverToken,
      jobId: jobId as any,
    })) as { job: RenderJob; units: RenderUnit[] } | null

    if (!loaded) return bad('Job not found', 'NOT_FOUND', 404)
    const job = loaded.job
    const units = loaded.units ?? []

    // Ownership re-check for the browser path.
    if (ownerUserId && job.userId !== ownerUserId) {
      return bad('Unauthorized', 'UNAUTHORIZED', 403)
    }

    // ==================== IDEMPOTENCY / STATE GUARDS ====================
    if (job.status === 'completed') {
      return NextResponse.json({ success: true, data: { status: 'completed', alreadyCompleted: true } })
    }
    if (job.status === 'cancelled') {
      return bad('Job was cancelled', 'CANCELLED', 409)
    }
    if (job.status !== 'rendering') {
      return NextResponse.json(
        { success: false, error: `Job is not ready to render (status: ${job.status})`, code: 'NOT_RENDERING' },
        { status: 409 }
      )
    }

    // Single-flight claim: only one render at a time per job. A claim older
    // than 100s is abandoned and may be re-claimed.
    const claim = (await convexClient.mutation(api.generation.claimRender, {
      serverToken,
      jobId: jobId as any,
    })) as { claimed: boolean; reason?: string }

    if (!claim.claimed) {
      if (claim.reason === 'COMPLETED') {
        return NextResponse.json({ success: true, data: { status: 'completed', alreadyCompleted: true } })
      }
      // IN_FLIGHT / NOT_RENDERING etc. — not an error for the caller.
      return NextResponse.json({ success: true, data: { status: job.status, claimed: false } })
    }

    // ==================== REBUILD SPEC + COMPONENTS ====================
    const blueprint = job.blueprint as ArtifactSpecification | null
    if (!blueprint || !Array.isArray(blueprint.sections) || blueprint.sections.length === 0) {
      await convexClient.mutation(api.generation.failJobFromRender, {
        serverToken,
        jobId: jobId as any,
        error: 'Blueprint missing — cannot render. Retry to re-plan the document.',
      })
      return bad('Job blueprint is missing', 'BLUEPRINT_MISSING', 422)
    }

    const format = (
      job.outputFormat ||
      blueprint.outputFormat ||
      'DOCX'
    ).toString().toUpperCase() as OutputFormat

    const components: RenderComponent[] = []
    for (const unit of units) {
      if (unit.status !== 'completed' || !unit.content) continue
      const section = blueprint.sections[unit.sequence] ?? blueprint.sections[0]
      if (!section) continue
      const list = Array.isArray(unit.content.components) ? unit.content.components : []
      list.forEach((c, idx) => {
        if (c === null || c === undefined || c.content === null || c.content === undefined) return
        components.push({
          sectionId: section.id,
          componentId: `${unit._id}-${idx}`,
          type: String(c.type || 'PARAGRAPH'),
          content: c.content,
          order: idx,
        })
      })
    }

    // Guaranteed-minimum content: every section renders, even if its unit
    // failed (same behavior as the legacy synchronous pipeline).
    const coveredSections = new Set(components.map((c) => c.sectionId))
    for (const section of blueprint.sections) {
      if (!coveredSections.has(section.id)) {
        components.push({
          sectionId: section.id,
          componentId: `placeholder-${section.id}`,
          type: 'PARAGRAPH',
          content: 'This section could not be generated. Please regenerate the document.',
          order: 0,
        })
      }
    }

    // ==================== RENDER (Node runtime: docx/exceljs/pptxgenjs) ===
    let rendered
    try {
      rendered = await renderArtifact(blueprint, components, format)
    } catch (renderErr) {
      const msg = renderErr instanceof Error ? renderErr.message : String(renderErr)
      console.error('[GENERATION-RENDER] renderArtifact failed:', msg)
      // Release the claim so a retry can proceed; keep the job in
      // "rendering" (the worker's retry chain / client fallback re-triggers).
      await convexClient.mutation(api.generation.releaseRenderClaim, {
        serverToken,
        jobId: jobId as any,
        error: `Render failed: ${msg.slice(0, 300)}`,
      })
      return bad(`Document rendering failed: ${msg}`, 'RENDER_FAILED', 500)
    }

    // ==================== PERSIST (R2 + Convex records) ==================
    // R2 FAILURE CONTRACT: any storage failure answers HTTP 503
    // "File storage temporarily unavailable" (code FILE_STORAGE_UNAVAILABLE)
    // and RELEASES the render claim so the worker's renderRetry chain and the
    // browser fallback can re-attempt. Previously an S3 SDK error here
    // escaped as a generic 500 INTERNAL_ERROR — the claim stayed held for
    // 100s, every retry was bounced as IN_FLIGHT, and jobs hung at 97%
    // ("Creating your file") with no user-visible cause.
    const userId = job.userId
    const buffer = Buffer.from(rendered.buffer)
    const { uploadToR2, generateR2Key } = await import('@/lib/r2/client')
    const r2Key = generateR2Key(userId, rendered.filename || `artifact-${Date.now()}`)
    try {
      await uploadToR2(r2Key, buffer, rendered.mimeType || 'application/octet-stream', {
        originalName: rendered.filename || 'artifact',
        size: String(rendered.size ?? buffer.length),
        workspaceId: userId,
        ownerId: userId,
        uploadedAt: new Date().toISOString(),
        category: 'artifact',
      })
    } catch (r2Error) {
      const info = classifyR2Error(r2Error)
      console.error(
        `[GENERATION-RENDER] R2 upload failed for job ${jobId} [${info.kind}]${info.retryable ? ' (retryable)' : ''}: ${info.detail}`,
        r2Error
      )
      await convexClient.mutation(api.generation.releaseRenderClaim, {
        serverToken,
        jobId: jobId as any,
        error: `Storage upload failed: ${info.detail.slice(0, 300)}`,
      }).catch((releaseErr: unknown) => {
        console.error('[GENERATION-RENDER] Failed to release render claim:', releaseErr)
      })
      const hint =
        info.kind === 'NOT_CONFIGURED'
          ? ' (R2_* environment variables are not set on the app runtime)'
          : info.kind === 'AUTH'
            ? ' (R2 credentials or API-token permissions rejected)'
            : ''
      return NextResponse.json(
        {
          success: false,
          error: `${R2_STORAGE_UNAVAILABLE_MESSAGE}${hint}`,
          code: 'FILE_STORAGE_UNAVAILABLE',
          kind: info.kind,
          retryable: info.retryable,
        },
        { status: 503 }
      )
    }

    const saved = (await convexClient.mutation(api.artifacts.saveArtifactRecord, {
      userId: userId as any,
      title: blueprint.title || 'Untitled document',
      type: (job.artifactType || blueprint.type || 'document').toLowerCase(),
      format,
      prompt: job.prompt,
      status: 'completed',
    })) as { saved: boolean; dbId?: string } | null

    if (!saved?.saved || !saved.dbId) {
      await convexClient.mutation(api.generation.releaseRenderClaim, {
        serverToken,
        jobId: jobId as any,
        error: 'Artifact record could not be saved — retrying is safe (file is in R2).',
      })
      return bad('Could not save artifact record', 'SAVE_FAILED', 500)
    }

    const fileDbId = (await convexClient.mutation(api.files.registerFile, {
      userId: userId as any,
      originalName: rendered.filename || 'artifact',
      mimeType: rendered.mimeType || 'application/octet-stream',
      size: rendered.size ?? buffer.length,
      r2Key,
    })) as unknown as string

    await convexClient.mutation(api.artifacts.linkFile, {
      artifactId: saved.dbId as any,
      userId: userId as any,
      fileId: fileDbId as any,
    })

    const done = (await convexClient.mutation(api.generation.completeJobRendered, {
      serverToken,
      jobId: jobId as any,
      artifactId: saved.dbId as any,
      fileName: rendered.filename,
      fileSize: rendered.size ?? buffer.length,
    })) as { success: boolean; error?: string }

    if (!done.success) {
      return bad(done.error || 'Could not complete job', 'COMPLETE_FAILED', 500)
    }

    console.log(
      `[GENERATION-RENDER] job ${jobId} completed: ${rendered.filename} (${rendered.size} bytes) → R2 ${r2Key}`
    )

    return NextResponse.json({
      success: true,
      data: {
        status: 'completed',
        artifactId: saved.dbId,
        fileName: rendered.filename,
        fileSize: rendered.size ?? buffer.length,
      },
    })
  } catch (error) {
    console.error('[GENERATION-RENDER] Unhandled error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
