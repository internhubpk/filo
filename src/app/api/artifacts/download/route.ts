// =============================================================================
// GET /api/artifacts/download?id=<artifactId>
// =============================================================================
// Downloads a generated artifact.
//   Primary path: artifact.fileId → files row → presigned R2 URL (JSON
//   { url } so the browser can download cross-origin natively).
//   Legacy path: ?data=<base64>&format= streams bytes directly (kept for
//   in-session downloads that predate R2 persistence).
//
// SECURITY: the artifact is fetched with an ownership-checked Convex query
// derived from the SESSION user — cross-user downloads are impossible.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { generateDownloadUrl } from '@/lib/r2/client'
import { getConvexClient } from '@/lib/convex-server'
import { api } from '@convex/_generated/api'

function getMimeType(format: string): string {
  switch (format.toUpperCase()) {
    case 'DOCX': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'PDF': return 'application/pdf'
    case 'XLSX': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'PPTX': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case 'CSV': return 'text/csv'
    case 'TXT': return 'text/plain'
    case 'HTML': return 'text/html'
    default: return 'application/octet-stream'
  }
}

export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url)
    const artifactId = searchParams.get('id')

    // ---- Primary: download the persisted file from R2 ----
    if (artifactId) {
      const convex = getConvexClient()

      // Ownership-checked row fetch.
      const artifacts = (await convex.query('artifacts:listUserArtifacts' as never, {
        userId: session.user.id as never,
      } as never)) as Array<Record<string, unknown>>
      const artifact = artifacts.find((a) => a._id === artifactId)
      if (!artifact) {
        return NextResponse.json(
          { success: false, error: 'Artifact not found', code: 'NOT_FOUND' },
          { status: 404 }
        )
      }

      const fileId = artifact.fileId as string | null | undefined
      if (!fileId) {
        return NextResponse.json(
          {
            success: false,
            error: 'This artifact was generated before file persistence was enabled and has no stored file. Regenerate it to get a downloadable copy.',
            code: 'NO_PERSISTED_FILE',
          },
          { status: 409 }
        )
      }

      const fileRow = (await convex.query(api.files.getFileForUser, {
        fileId: fileId as any,
        userId: session.user.id as any,
      })) as { r2Key: string; originalName: string } | null
      if (!fileRow) {
        return NextResponse.json(
          { success: false, error: 'Backing file not found', code: 'FILE_NOT_FOUND' },
          { status: 404 }
        )
      }

      const url = await generateDownloadUrl(fileRow.r2Key)
      return NextResponse.json({
        success: true,
        data: {
          url,
          fileName: fileRow.originalName,
          format: artifact.format,
          expiresIn: 3600,
        },
      })
    }

    // ---- Legacy: stream posted base64 data ----
    const fileData = searchParams.get('data')
    if (fileData) {
      const format = searchParams.get('format') || 'DOCX'
      const title = searchParams.get('title') || 'document'
      const mimeType = getMimeType(format)
      const extension = format.toLowerCase()
      const sanitizedTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50)
      const filename = `${sanitizedTitle}.${extension}`
      const buffer = Buffer.from(fileData, 'base64')
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': buffer.length.toString(),
          'Cache-Control': 'no-cache',
        },
      })
    }

    return NextResponse.json(
      { success: false, error: 'Provide ?id=<artifactId>', code: 'BAD_REQUEST' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[ARTIFACTS DOWNLOAD] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Download failed', code: 'DOWNLOAD_ERROR' },
      { status: 500 }
    )
  }
}
