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

      // If R2 is not configured, fall back to returning base64 data
      // This allows the app to work in development without R2 credentials
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

    // Generate download URL (valid for 1 hour)
    let downloadUrl: string | undefined
    try {
      downloadUrl = await generateDownloadUrl(r2Key)
    } catch (urlError) {
      console.warn('[FILES] Could not generate download URL:', urlError)
    }

    return NextResponse.json({
      success: true,
      fileId: r2Key,
      filename: file.name,
      size: file.size,
      formattedSize: formatFileSize(file.size),
      mimeType: validation.metadata.mimeType || mimeType || file.type,
      category: validation.metadata.category,
      // R2-specific fields
      r2Key,
      downloadUrl,
      storageType: 'r2',
      // Don't include fileData when using R2 - saves bandwidth
      warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
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

// GET /api/files - List files for workspace/user
export async function GET(request: NextRequest) {
  try {
    // ---- Auth (was missing) ----
    const user = await requireSession(request)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')
    const type = searchParams.get('type')

    // Ownership enforced: users can only ever list their own files.

    return NextResponse.json({
      success: true,
      files: [],
      total: 0,
      filters: { workspaceId, ownerId: user.id, type },
      message: 'File metadata listing is handled by Convex; uploads are stored in R2.',
    })

  } catch (error) {
    console.error('[FILES] List error:', error)
    return NextResponse.json(
      { error: 'Failed to list files', code: 'LIST_ERROR' },
      { status: 500 }
    )
  }
}
