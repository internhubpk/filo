// =============================================================================
// /api/files — Upload & list files (R2-backed)
// =============================================================================
// SECURITY FIX: these handlers previously had NO authentication at all:
//   - anyone could upload arbitrary files to the R2 bucket
//   - anyone could request presigned DOWNLOAD URLs for ANY key in the bucket
//     (full bucket read access), with `ownerId` supplied by the caller.
//
// Now both handlers require a valid self-contained HMAC session token
// (Authorization: Bearer ...) and the owner is derived from the signed token,
// never from client-provided form fields.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { validateFile, formatFileSize } from '@/services/file-service'
import { uploadToR2, generateR2Key, generateDownloadUrl } from '@/lib/r2/client'
import { classifyR2Error, isR2Configured, R2_STORAGE_UNAVAILABLE_MESSAGE } from '@/lib/r2/errors'
import { getConvexClient } from '@/lib/convex-server'
import { api } from '@convex/_generated/api'

async function requireSession(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

  if (!token) return null
  const session = validateSessionToken(token)
  if (!session.valid || !session.user) return null
  return session.user
}

export async function POST(request: NextRequest) {
  try {
    // ---- Auth (was completely missing before) ----
    const user = await requireSession(request)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const workspaceId = (formData.get('workspaceId') as string) || user.id
    // ownerId supplied by clients is IGNORED — the authenticated user is the owner.
    const ownerId = user.id
    const mimeType = formData.get('mimeType') as string

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided', code: 'NO_FILE' },
        { status: 400 }
      )
    }

    // Validate the file (type + size limits per src/config/r2.ts)
    const validation = validateFile(file)

    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'File validation failed',
          code: 'VALIDATION_ERROR',
          details: validation.errors
        },
        { status: 400 }
      )
    }

    // Generate unique R2 key scoped to the AUTHENTICATED user
    const r2Key = generateR2Key(ownerId, file.name)

    // Convert file to buffer for R2 upload
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to R2 (real cloud storage)
    try {
      await uploadToR2(
        r2Key,
        buffer,
        validation.metadata.mimeType || mimeType || file.type,
        {
          originalName: file.name,
          size: String(file.size),
          workspaceId,
          ownerId,
          uploadedAt: new Date().toISOString(),
          category: validation.metadata.category || 'unknown',
        }
      )
    } catch (r2Error) {
      console.error('[FILES] R2 upload failed:', r2Error)
      const info = classifyR2Error(r2Error)

      // ONLY a genuinely unconfigured runtime falls back to base64 — that is
      // the documented development mode (no R2 credentials at all).
      if (info.kind === 'NOT_CONFIGURED' && !isR2Configured()) {
        const base64 = buffer.toString('base64')
        return NextResponse.json({
          success: true,
          fileId: r2Key,
          filename: file.name,
          size: file.size,
          mimeType: validation.metadata.mimeType || mimeType || file.type,
          category: validation.metadata.category,
          // Fallback: Return base64 when R2 not available
          fileData: `data:${file.type};base64,${base64}`,
          storageType: 'fallback',
          warnings: [
            'R2 storage not configured - using fallback mode',
            ...(validation.warnings.length > 0 ? validation.warnings : [])
          ],
        })
      }

      // R2 IS configured but the upload failed (bad key, wrong token
      // permissions, bucket name mismatch, Cloudflare outage, network).
      // Surface the user's contract instead of a fake-success base64 body:
      //   R2 failure → HTTP 503 → "File storage temporarily unavailable"
      // A silent base64 fallback in production hides quota/permission
      // breakage and produces files that vanish on the next signed-URL read.
      return NextResponse.json(
        {
          success: false,
          error: R2_STORAGE_UNAVAILABLE_MESSAGE,
          code: 'FILE_STORAGE_UNAVAILABLE',
          kind: info.kind,
          retryable: info.retryable,
          detail: info.detail,
        },
        { status: 503 }
      )
    }

    // Generate download URL (valid for 1 hour)
    let downloadUrl: string | undefined
    try {
      downloadUrl = await generateDownloadUrl(r2Key)
    } catch (urlError) {
      console.warn('[FILES] Could not generate download URL:', urlError)
    }

    // ---- Register metadata in Convex (single source of truth for the file
    // manager + storage quotas). Ownership = authenticated user. ----
    let dbFileId: string | null = null
    if (user.id !== 'dev-user') {
      try {
        dbFileId = await getConvexClient().mutation(api.files.registerFile, {
          userId: user.id as any,
          originalName: file.name.slice(0, 255),
          mimeType: validation.metadata.mimeType || mimeType || file.type || 'application/octet-stream',
          size: file.size,
          r2Key,
        }) as unknown as string
      } catch (dbErr) {
        console.warn('[FILES] Convex registration failed (file exists in R2):', dbErr)
      }
    }

    const uploadWarnings = [
      ...(dbFileId ? [] : ['Metadata registration in database failed — the file exists in storage but may not appear in your file list.']),
      ...(validation.warnings.length > 0 ? validation.warnings : []),
    ]

    return NextResponse.json({
      success: true,
      fileId: dbFileId ?? r2Key,
      filename: file.name,
      size: file.size,
      formattedSize: formatFileSize(file.size),
      mimeType: validation.metadata.mimeType || mimeType || file.type,
      category: validation.metadata.category,
      r2Key,
      downloadUrl,
      storageType: 'r2',
      warnings: uploadWarnings.length > 0 ? uploadWarnings : undefined,
    })

  } catch (error) {
    console.error('[FILES] Upload error:', error)
    return NextResponse.json(
      {
        error: 'Upload failed',
        code: 'UPLOAD_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

// GET /api/files - List files for the authenticated user (REAL Convex rows)
export async function GET(request: NextRequest) {
  try {
    // ---- Auth ----
    const user = await requireSession(request)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    let files: any[] = []
    if (user.id !== 'dev-user') {
      try {
        files = (await getConvexClient().query(api.files.getUserFiles, {
          userId: user.id as any,
        })) as any[]
      } catch (listErr) {
        console.error('[FILES] Convex listing failed:', listErr)
        return NextResponse.json(
          { success: false, error: 'Failed to load files', code: 'LIST_ERROR' },
          { status: 503 }
        )
      }
    }

    // Standard response envelope: { success, data }. The list previously
    // returned { files } at the TOP level while every consumer reads
    // `data.files` — so the Files page permanently showed "0 files" even
    // when uploads existed. One envelope, consistent with every other API.
    return NextResponse.json({
      success: true,
      data: {
        files: files.map((f) => ({
          id: f._id,
          name: f.originalName,
          originalName: f.originalName,
          mimeType: f.mimeType,
          size: f.size,
          r2Key: f.r2Key,
          createdAt: f.createdAt,
          uploaded: f.uploaded,
        })),
        total: files.length,
        storageBytes: files.reduce((s, f) => s + (f.size || 0), 0),
      },
    })
  } catch (error) {
    console.error('[FILES] List error:', error)
    return NextResponse.json(
      { error: 'Failed to list files', code: 'LIST_ERROR' },
      { status: 500 }
    )
  }
}
