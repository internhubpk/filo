// =============================================================================
// POST /api/generation/render  (INTERNAL — server-to-server, idempotent)
// =============================================================================
// The FINAL hop of the background generation pipeline. Called by the Convex
// worker when a job's sections are ready, and (as a safety net) by the
// user's browser if the worker's call ever fails. Safe to call repeatedly:
//
//   1. claimRender (idempotent, single-flight guard per job)
//   2. rebuild the ArtifactSpecification from the job blueprint + units
//   3. STRUCTURAL QA (spec §29-31): validate → bounded auto-repair → re-check
//   4. renderArtifact → real DOCX/PDF/XLSX/PPTX/CSV bytes (Node runtime)
//   5. post-render output validation (signature + size sanity)
//   6. professional filename + versioned R2 key (spec §44/§45)
//   7. upload to R2 + save artifact/file records + VERSION record (spec §27)
//   8. generation:completeJobRendered — the only path to "completed"
//
// AUTH (either one):
//   • { serverToken } — FILO_SERVER_SECRET (Convex worker path)
//   • Authorization: Bearer <session> — the job OWNER (browser fallback path)
//
// QUALITY GATE (spec §31): an artifact is only marked completed when
// generation succeeded AND the file rendered AND storage succeeded AND
// validation passed. Storage failures answer 503 FILE_STORAGE_UNAVAILABLE
// with the claim released so retry chains stay alive — never a fake success.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { api } from '@convex/_generated/api'
import { getConvexClient } from '@/lib/convex-server'
import { renderArtifact } from '@/services/document-renderer'
import { buildArtifactFilename } from '@/services/renderers/shared'
import {
  autoRepair,
  validateDocument,
  validateRenderedOutput,
  validateRenderedOutputDeep,
  type QaComponent,
} from '@/services/qa/structural'
import { classifyR2Error, isR2Configured, r2S3ErrorName, R2_STORAGE_UNAVAILABLE_MESSAGE } from '@/lib/r2/errors'
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
  sourceArtifactId?: string | null
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

/** Versioned artifact key (spec §45): users/{uid}/artifacts/{aid}/v{n}/{file} */
function artifactR2Key(userId: string, artifactId: string, version: number, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `users/${userId}/artifacts/${artifactId}/v${version}/${safeName}`
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

    // ==================== STRUCTURAL QA (spec §29/§30/§31) ================
    // Validate the assembled document, run ONE deterministic repair pass
    // (split overlong paragraphs, drop empty tables, cap slide bullets) and
    // re-check. QA issues that survive repair degrade to warnings — only
    // render/storage failures fail the job.
    const qaComponents: QaComponent[] = components.map((c) => ({
      sectionId: c.sectionId,
      index: c.order,
      type: c.type,
      content: c.content,
    }))
    let qaReport = validateDocument(blueprint, qaComponents)
    let effectiveComponents: RenderComponent[] = components
    if (!qaReport.passed || qaReport.issues.length > 0) {
      const repaired = autoRepair(blueprint, qaComponents, qaReport)
      qaReport = repaired.report
      // Repaired components are render-ready (repair only transforms content,
      // splits overlong paragraphs, converts tiny lists, drops empty tables —
      // never reorders sections). Rebuild the render list directly from them
      // so split chunks and conversions are all preserved.
      if (repaired.components !== qaComponents && repaired.components.length > 0) {
        effectiveComponents = repaired.components.map((q, i) => ({
          sectionId: q.sectionId,
          componentId: `qa-${i}`,
          type: q.type,
          content: q.content,
          order: i,
        }))
      }
    }
    const qaSummary = {
      score: qaReport.score,
      passed: qaReport.passed,
      repaired: qaReport.repaired,
      issueCount: qaReport.issues.length,
      issues: qaReport.issues.slice(0, 12).map((i) => ({ type: i.type, severity: i.severity, sectionId: i.sectionId, repaired: i.repaired ?? false })),
    }
    if (!qaReport.passed) {
      console.warn(`[GENERATION-RENDER] job ${jobId} QA score ${qaReport.score}: ${qaReport.issues.filter((i) => i.severity === 'error').map((i) => i.type).join(', ')}`)
    }

    // ==================== RENDER (Node runtime: docx/exceljs/pptxgenjs) ===
    let rendered
    try {
      rendered = await renderArtifact(blueprint, effectiveComponents, format)
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

    // ==================== POST-RENDER VALIDATION (spec §31) ================
    const buffer = Buffer.from(rendered.buffer)
    const outputCheck = validateRenderedOutput(buffer, format, rendered.mimeType || '')
    if (!outputCheck.ok) {
      const reasons = outputCheck.issues.map((i) => i.message).join('; ')
      console.error(`[GENERATION-RENDER] job ${jobId} output validation failed: ${reasons}`)
      await convexClient.mutation(api.generation.releaseRenderClaim, {
        serverToken,
        jobId: jobId as any,
        error: `Rendered file failed validation: ${reasons.slice(0, 250)}`,
      })
      return bad(`Rendered file failed validation: ${reasons}`, 'DOCUMENT_VALIDATION_FAILED', 500)
    }

    // Layer 2: STRUCTURAL re-open of the rendered bytes (unzip the OOXML
    // container / parse the PDF / RFC4180-check the CSV). A job may only be
    // marked completed when the artifact is genuinely readable by a consumer
    // — not merely non-empty. Failure releases the claim so the retry chain
    // can attempt a fresh render.
    const deepCheck = await validateRenderedOutputDeep(buffer, format)
    if (!deepCheck.ok) {
      const reasons = deepCheck.issues.map((i) => i.message).join('; ')
      console.error(`[GENERATION-RENDER] job ${jobId} deep validation failed: ${reasons}`)
      await convexClient.mutation(api.generation.releaseRenderClaim, {
        serverToken,
        jobId: jobId as any,
        error: `Rendered file failed structural validation: ${reasons.slice(0, 250)}`,
      })
      return bad(`Rendered file failed structural validation: ${reasons}`, 'DOCUMENT_VALIDATION_FAILED', 500)
    }

    // ==================== TARGET ARTIFACT (spec §27 versioning) ===========
    // Regeneration of an existing artifact → new VERSION on the SAME artifact.
    // Fresh generation → new artifact record, version 1.
    const operation = job.sourceArtifactId ? 'ai_edit' : 'generate'
    let artifactId: string
    let baseVersionCount = 0

    if (job.sourceArtifactId) {
      const existing = (await convexClient.query(api.artifacts.getArtifactForUser, {
        artifactId: job.sourceArtifactId as any,
        userId: job.userId as any,
      })) as { _id: string; versionCount?: number } | null
      if (existing) {
        artifactId = existing._id
        baseVersionCount = existing.versionCount ?? 1
        // Title/format track the latest revision.
        await convexClient.mutation(api.artifacts.updateArtifactMeta, {
          artifactId: artifactId as any,
          userId: job.userId as any,
          title: blueprint.title || 'Untitled document',
          format,
        }).catch(() => {})
      } else {
        // Source artifact was deleted mid-flight — create a fresh one.
        const fresh = (await convexClient.mutation(api.artifacts.saveArtifactRecord, {
          userId: job.userId as any,
          title: blueprint.title || 'Untitled document',
          type: (job.artifactType || blueprint.type || 'document').toLowerCase(),
          format,
          prompt: job.prompt,
          status: 'completed',
        })) as { saved: boolean; dbId?: string } | null
        artifactId = fresh?.dbId ?? ''
        baseVersionCount = 0
      }
    } else {
      const saved = (await convexClient.mutation(api.artifacts.saveArtifactRecord, {
        userId: job.userId as any,
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
      artifactId = saved.dbId
    }

    // ==================== PROFESSIONAL FILENAME (spec §44) =================
    const filename = buildArtifactFilename(blueprint.title || 'Generated_Document', format)

    // ==================== PERSIST (R2 + Convex records) ==================
    // R2 FAILURE CONTRACT: any storage failure answers HTTP 503
    // "File storage temporarily unavailable" (code FILE_STORAGE_UNAVAILABLE)
    // and RELEASES the render claim so the worker's renderRetry chain and the
    // browser fallback can re-attempt. Previously an S3 SDK error here
    // escaped as a generic 500 INTERNAL_ERROR — the claim stayed held for
    // 100s, every retry was bounced as IN_FLIGHT, and jobs hung at 97%
    // ("Creating your file") with no user-visible cause.
    const userId = job.userId
    const r2Key = artifactR2Key(userId, artifactId, baseVersionCount + 1, filename)
    try {
      const { uploadToR2 } = await import('@/lib/r2/client')
      await uploadToR2(r2Key, buffer, rendered.mimeType || 'application/octet-stream', {
        originalName: filename,
        size: String(buffer.length),
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
          // Diagnosis surface: the raw S3 error name + the classifier detail,
          // so a failing render is identifiable from the browser Network tab
          // alone (no server log access needed). Bounded and secret-free.
          s3ErrorName: r2S3ErrorName(r2Error),
          detail: info.detail,
        },
        { status: 503 }
      )
    }

    const fileDbId = (await convexClient.mutation(api.files.registerFile, {
      userId: userId as any,
      originalName: filename,
      mimeType: rendered.mimeType || 'application/octet-stream',
      size: buffer.length,
      r2Key,
      artifactId: artifactId as any,
    })) as unknown as string

    // ==================== VERSION RECORD (spec §27) =======================
    // Appends the immutable version row and points the artifact at the new
    // file. Non-fatal: a version-row hiccup must not lose a finished file.
    let versionNumber = baseVersionCount + 1
    try {
      const versionResult = (await convexClient.mutation(api.artifacts.saveArtifactVersion, {
        serverToken,
        artifactId: artifactId as any,
        userId: userId as any,
        operation,
        format,
        filename,
        fileId: fileDbId as any,
        r2Key,
        size: buffer.length,
        jobId: jobId as any,
        qaReport: qaSummary,
      })) as { success: boolean; version?: number }
      if (versionResult?.success && versionResult.version) {
        versionNumber = versionResult.version
      }
    } catch (versionErr) {
      console.error('[GENERATION-RENDER] Version record failed (non-fatal):', versionErr)
      // Fall back to a direct file link so the artifact stays usable.
      await convexClient.mutation(api.artifacts.linkFile, {
        artifactId: artifactId as any,
        userId: userId as any,
        fileId: fileDbId as any,
      }).catch(() => {})
    }

    const done = (await convexClient.mutation(api.generation.completeJobRendered, {
      serverToken,
      jobId: jobId as any,
      artifactId: artifactId as any,
      fileName: filename,
      fileSize: buffer.length,
    })) as { success: boolean; error?: string }

    if (!done.success) {
      // Release the claim so the next retry (worker renderRetry / browser
      // fallback) is not bounced as IN_FLIGHT for 100s. The file is already
      // in R2 and the artifact saved — retrying is safe but should start now.
      await convexClient.mutation(api.generation.releaseRenderClaim, {
        serverToken,
        jobId: jobId as any,
        error: `Complete failed: ${(done.error || 'unknown').slice(0, 300)}`,
      }).catch((releaseErr: unknown) => {
        console.error('[GENERATION-RENDER] Failed to release render claim:', releaseErr)
      })
      return bad(done.error || 'Could not complete job', 'COMPLETE_FAILED', 500)
    }

    console.log(
      `[GENERATION-RENDER] job ${jobId} completed: ${filename} v${versionNumber} (${buffer.length} bytes, QA ${qaReport.score}) → R2 ${r2Key}`
    )

    return NextResponse.json({
      success: true,
      data: {
        status: 'completed',
        artifactId,
        fileName: filename,
        fileSize: buffer.length,
        version: versionNumber,
        qa: qaSummary,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[GENERATION-RENDER] Unhandled error:', error)
    // Diagnosable 500s: the UI progress card renders `error`, so surface the
    // precise failure reason (bounded — no stacks, no secrets) instead of a
    // generic string. This is what makes a FILO_SERVER_SECRET mismatch, a
    // Convex mutation failure, or an SDK error visible on the job card
    // without trawling server logs.
    return NextResponse.json(
      {
        success: false,
        error: `Render failed: ${msg.slice(0, 300)}`,
        code: 'INTERNAL_ERROR',
      },
      { status: 500 }
    )
  }
}
