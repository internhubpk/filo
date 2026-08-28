// =============================================================================
// GET /api/artifacts/[id]/export?format=XLSX  (spec §42, §43 — conversions)
// =============================================================================
// Re-renders an artifact's ORIGINAL blueprint + completed section content in
// a different output format — the same internal semantic model, a different
// renderer. This is what powers real conversions for GENERATED artifacts:
//
//   document  → DOCX | PDF | TXT
//   spreadsheet → XLSX | CSV | PDF
//   presentation → PPTX | PDF
//
// The exported file is stored as a NEW VERSION (operation 'export') of the
// artifact — nothing is mutated destructively and nothing is re-billed (no
// AI calls run; this is a pure re-render).
//
// SECURITY: session-authenticated; ownership enforced in Convex; R2 upload
// uses the server-side client with a user-scoped key.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { api } from '@convex/_generated/api'
import { getConvexClient } from '@/lib/convex-server'
import { renderArtifact } from '@/services/document-renderer'
import { buildArtifactFilename, MIME_BY_FORMAT } from '@/services/renderers/shared'
import type { ArtifactSpecification, OutputFormat } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 120

/** Formats genuinely renderable from each artifact type (spec §43). */
const EXPORT_MATRIX: Record<string, string[]> = {
  document: ['DOCX', 'PDF', 'TXT'],
  report: ['DOCX', 'PDF', 'TXT'],
  proposal: ['DOCX', 'PDF', 'TXT'],
  contract: ['DOCX', 'PDF', 'TXT'],
  invoice: ['PDF', 'XLSX'],
  resume: ['PDF', 'DOCX'],
  lesson_plan: ['PDF', 'DOCX'],
  email: ['DOCX', 'PDF', 'TXT'],
  spreadsheet: ['XLSX', 'CSV', 'PDF'],
  presentation: ['PPTX', 'PDF'],
  csv: ['CSV', 'XLSX'],
  custom: ['DOCX', 'PDF'],
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
    const session = token ? validateSessionToken(token) : null
    if (!session?.valid || !session?.user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }
    const user = session.user

    const { id } = await params
    const requestedFormat = (request.nextUrl.searchParams.get('format') || '').toUpperCase()

    // ---- Artifact + ownership ----
    const convex = getConvexClient()
    const artifact = (await convex.query(api.artifacts.getArtifactForUser, {
      artifactId: id as any,
      userId: user.id as any,
    })) as { _id: string; type: string; format: string; versionCount?: number; title?: string } | null

    if (!artifact) {
      return NextResponse.json(
        { success: false, error: 'Artifact not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // ---- Format whitelist: only genuinely supported exports are exposed ----
    const allowed = EXPORT_MATRIX[artifact.type?.toLowerCase()] ?? EXPORT_MATRIX.document
    const format = (requestedFormat || allowed.find((f) => f !== artifact.format) || allowed[0]) as OutputFormat
    if (!allowed.includes(format)) {
      return NextResponse.json(
        {
          success: false,
          error: `${format} export is not available for this artifact. Available: ${allowed.join(', ')}`,
          code: 'UNSUPPORTED_FORMAT',
          data: { allowed },
        },
        { status: 400 }
      )
    }

    // ---- Source blueprint + completed units (the original semantic model) ----
    const source = (await convex.query(api.artifacts.getArtifactSourceJob, {
      artifactId: id as any,
      userId: user.id as any,
    })) as
      | {
          job: { blueprint: ArtifactSpecification; prompt: string }
          units: Array<{ sequence: number; status: string; content?: { components?: Array<{ type?: string; content?: unknown }> } | null }>
        }
      | null

    if (!source?.job?.blueprint) {
      return NextResponse.json(
        {
          success: false,
          error: 'This artifact cannot be re-exported (its original generation content is no longer available). Download the existing file instead.',
          code: 'SOURCE_UNAVAILABLE',
        },
        { status: 409 }
      )
    }

    const blueprint = source.job.blueprint
    const components: Array<{ sectionId: string; componentId: string; type: string; content: unknown; order: number }> = []
    for (const unit of source.units ?? []) {
      if (unit.status !== 'completed' || !unit.content) continue
      const section = blueprint.sections[unit.sequence] ?? blueprint.sections[0]
      if (!section) continue
      const list = Array.isArray(unit.content.components) ? unit.content.components : []
      list.forEach((c, idx) => {
        if (c === null || c === undefined || c.content === null || c.content === undefined) return
        components.push({
          sectionId: section.id,
          componentId: `export-${unit.sequence}-${idx}`,
          type: String(c.type || 'PARAGRAPH'),
          content: c.content,
          order: idx,
        })
      })
    }

    if (components.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No content available to export', code: 'EMPTY_CONTENT' },
        { status: 409 }
      )
    }

    // ---- Re-render through the artifact's format-specific renderer ----
    let rendered
    try {
      rendered = await renderArtifact(blueprint, components, format)
    } catch (renderErr) {
      const msg = renderErr instanceof Error ? renderErr.message : String(renderErr)
      console.error(`[EXPORT] render failed for artifact ${id} → ${format}:`, msg)
      return NextResponse.json(
        { success: false, error: `Export rendering failed: ${msg.slice(0, 200)}`, code: 'RENDER_FAILED' },
        { status: 500 }
      )
    }

    const buffer = Buffer.from(rendered.buffer)
    if (buffer.length < 512) {
      return NextResponse.json(
        { success: false, error: 'Exported file failed validation', code: 'DOCUMENT_VALIDATION_FAILED' },
        { status: 500 }
      )
    }

    // ---- Store as a new version (operation: 'export') ----
    const serverToken = process.env.FILO_SERVER_SECRET
    const filename = buildArtifactFilename(blueprint.title || artifact.title || 'Export', format)

    let r2Key = ''
    let fileDbId = ''
    let version = (artifact.versionCount ?? 1) + 1
    try {
      const { uploadToR2 } = await import('@/lib/r2/client')
      r2Key = `users/${user.id}/artifacts/${artifact._id}/v${version}/${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      await uploadToR2(r2Key, buffer, rendered.mimeType || MIME_BY_FORMAT[format] || 'application/octet-stream', {
        originalName: filename,
        size: String(buffer.length),
        ownerId: user.id,
        uploadedAt: new Date().toISOString(),
        category: 'artifact',
      })
    } catch (r2Error) {
      const { classifyR2Error, R2_STORAGE_UNAVAILABLE_MESSAGE } = await import('@/lib/r2/errors')
      const info = classifyR2Error(r2Error)
      console.error(`[EXPORT] R2 upload failed for artifact ${id} [${info.kind}]: ${info.detail}`)
      return NextResponse.json(
        {
          success: false,
          error: `${R2_STORAGE_UNAVAILABLE_MESSAGE}`,
          code: 'FILE_STORAGE_UNAVAILABLE',
          kind: info.kind,
          retryable: info.retryable,
        },
        { status: 503 }
      )
    }

    if (serverToken) {
      fileDbId = (await convex.mutation(api.files.registerFile, {
        userId: user.id as any,
        originalName: filename,
        mimeType: rendered.mimeType || MIME_BY_FORMAT[format] || 'application/octet-stream',
        size: buffer.length,
        r2Key,
        artifactId: artifact._id as any,
      })) as unknown as string

      const versionResult = (await convex.mutation(api.artifacts.saveArtifactVersion, {
        serverToken,
        artifactId: artifact._id as any,
        userId: user.id as any,
        operation: 'export',
        format,
        filename,
        fileId: fileDbId as any,
        r2Key,
        size: buffer.length,
      })) as { success: boolean; version?: number }
      if (versionResult?.success && versionResult.version) {
        version = versionResult.version
      }
    }

    console.log(`[EXPORT] artifact ${id} → ${format} v${version} (${buffer.length} bytes)`)

    return NextResponse.json({
      success: true,
      data: {
        artifactId: artifact._id,
        format,
        filename,
        size: buffer.length,
        version,
        r2Key,
        message: `Exported as ${format} — saved as version ${version}.`,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[EXPORT] Unhandled error:', error)
    return NextResponse.json(
      { success: false, error: `Export failed: ${msg.slice(0, 200)}`, code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
