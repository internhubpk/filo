// =============================================================================
// POST /api/artifacts/export-zip — download selected artifacts as one ZIP
// =============================================================================
// Body: { ids: string[] } (max 50, deduped)
//
// SECURITY: each artifact is fetched through the ownership-checked Convex
// query (`artifacts:listUserArtifacts` for the SESSION user); foreign ids are
// silently skipped, never exported. File bytes come from R2 via the stored
// file row's r2Key — the key itself is never trusted from the client.
//
// ZIP contents:
//   <safe-title>.<ext>          — the actual generated files (collision-safe:
//                                 duplicates get " (2)", " (3)" suffixes)
//   manifest.json               — titles, types, formats, generated dates
//
// Response: binary application/zip with an ASCII-safe filename
// (Content-Disposition requires ASCII; the same non-ASCII header bug class
// that stalled the worker pipeline applies here).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { validateSessionToken } from '@/lib/session'
import { downloadFromR2 } from '@/lib/r2/client'
import { getConvexClient } from '@/lib/convex-server'
import { api } from '@convex/_generated/api'

const MAX_FILES = 50
const MAX_TOTAL_BYTES = 200 * 1024 * 1024 // 200MB hard ceiling

const EXT_FOR: Record<string, string> = {
  docx: 'docx', pdf: 'pdf', xlsx: 'xlsx', csv: 'csv',
  pptx: 'pptx', txt: 'txt', html: 'html', md: 'md',
}

/** ASCII-safe filesystem name: keeps readability, strips everything risky. */
function safeName(title: string, fallback: string): string {
  const base = (title || fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks
    .replace(/[^\w\s.-]/g, '')       // keep word chars, spaces, dot, dash
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim()
  return base || fallback
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase())
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase())
      return candidate
    }
  }
  return `${stem}-${Date.now()}${ext}`
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
    const session = token ? validateSessionToken(token) : null
    if (!session?.valid || !session.user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    const body = (await request.json().catch(() => null)) as { ids?: unknown } | null
    const ids = Array.isArray(body?.ids)
      ? [...new Set(body!.ids.filter((v): v is string => typeof v === 'string' && v.length > 0))]
      : []

    if (ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No artifacts selected', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }
    if (ids.length > MAX_FILES) {
      return NextResponse.json(
        { success: false, error: `Export at most ${MAX_FILES} files per ZIP`, code: 'TOO_MANY' },
        { status: 400 }
      )
    }

    const convex = getConvexClient()
    const artifacts = (await convex.query('artifacts:listUserArtifacts' as never, {
      userId: session.user.id as never,
    } as never)) as Array<Record<string, unknown>>
    const byId = new Map(artifacts.map((a) => [String(a._id), a]))

    const zip = new JSZip()
    const usedNames = new Set<string>()
    const manifest: Array<{
      file: string
      title: string
      type: string
      format: string
      status: string
      generatedAt: string
      sizeBytes?: number
    }> = []

    let included = 0
    let skipped: Array<{ id: string; reason: string }> = []
    let totalBytes = 0

    for (const id of ids) {
      if (included >= MAX_FILES) break
      const artifact = byId.get(id)
      if (!artifact) {
        skipped.push({ id, reason: 'not found' })
        continue
      }

      const title = String(artifact.title ?? 'document')
      const format = String(artifact.format ?? 'DOCX').toLowerCase()
      const fileId = artifact.fileId as string | null | undefined

      if (!fileId) {
        skipped.push({ id, reason: 'no stored file (pre-persistence artifact)' })
        continue
      }

      let fileRow: { r2Key: string; originalName: string; size?: number } | null = null
      try {
        fileRow = (await convex.query(api.files.getFileForUser, {
          fileId: fileId as never,
          userId: session.user.id as never,
        })) as { r2Key: string; originalName: string; size?: number } | null
      } catch {
        fileRow = null
      }
      if (!fileRow?.r2Key) {
        skipped.push({ id, reason: 'backing file missing' })
        continue
      }

      try {
        const bytes = await downloadFromR2(fileRow.r2Key)
        totalBytes += bytes.length
        if (totalBytes > MAX_TOTAL_BYTES) {
          skipped.push({ id, reason: 'total size limit reached' })
          break
        }
        const ext = EXT_FOR[format] ?? (format || 'bin')
        const filename = uniqueName(`${safeName(title, 'document')}.${ext}`, usedNames)
        zip.file(filename, bytes)
        manifest.push({
          file: filename,
          title,
          type: String(artifact.type ?? 'document'),
          format: String(artifact.format ?? format.toUpperCase()),
          status: String(artifact.status ?? ''),
          generatedAt: new Date(Number(artifact.createdAt ?? Date.now())).toISOString(),
          sizeBytes: bytes.length,
        })
        included += 1
      } catch (err) {
        console.warn('[ARTIFACTS EXPORT-ZIP] fetch failed:', id, err)
        skipped.push({ id, reason: 'download from storage failed' })
      }
    }

    if (included === 0) {
      return NextResponse.json(
        {
          success: false,
          error: skipped.length > 0
            ? 'None of the selected artifacts have a stored file to export.'
            : 'Selected artifacts could not be exported.',
          code: 'NOTHING_TO_EXPORT',
        },
        { status: 409 }
      )
    }

    zip.file(
      'manifest.json',
      JSON.stringify(
        {
          exportedBy: session.user.email,
          exportedAt: new Date().toISOString(),
          fileCount: included,
          skipped,
          artifacts: manifest,
        },
        null,
        2
      )
    )

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    const date = new Date().toISOString().slice(0, 10)
    const zipName = `filo-export-${date}.zip`

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[API /artifacts/export-zip] Error:', error)
    return NextResponse.json(
      { success: false, error: 'ZIP export failed', code: 'ZIP_FAILED' },
      { status: 500 }
    )
  }
}
