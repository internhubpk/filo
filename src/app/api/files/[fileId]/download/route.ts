import { NextRequest, NextResponse } from 'next/server'
import { generateDownloadUrl, fileExistsInR2, ownsObjectKey } from '@/lib/r2/client'
import { validateSessionToken } from '@/lib/session'
import { classifyR2Error, R2_STORAGE_UNAVAILABLE_MESSAGE } from '@/lib/r2/errors'

// GET /api/files/[fileId]/download - Generate download URL or redirect
// This endpoint provides a download link for a specific file.
// SECURITY: requires a valid session; callers may only access keys under
// their own uploads/{userId}/ or users/{userId}/artifacts/ prefixes.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    // ---- Auth (was missing) ----
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
    const session = token ? validateSessionToken(token) : null

    if (!session?.valid || !session.user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    const { fileId } = await params

    if (!fileId) {
      return NextResponse.json(
        { error: 'File ID required', code: 'MISSING_FILE_ID' },
        { status: 400 }
      )
    }

    // Ownership: user files live under uploads/{userId}/... and generated
    // artifacts under users/{userId}/artifacts/... (spec §45). No cross-user
    // reads — either prefix proves the object belongs to the caller.
    if (!ownsObjectKey(fileId, session.user.id)) {
      return NextResponse.json(
        { error: 'Access denied for this file', code: 'FORBIDDEN_FILE' },
        { status: 403 }
      )
    }

    // Check if file exists in R2. fileExistsInR2 only answers "false" for a
    // genuine 404 (NoSuchKey/NotFound) — every other failure rethrows, so a
    // bad R2 token can no longer masquerade as "file not found".
    let fileExists = false
    try {
      fileExists = await fileExistsInR2(fileId)
    } catch (existsError) {
      const info = classifyR2Error(existsError)
      console.error(`[DOWNLOAD] R2 existence check failed [${info.kind}]: ${info.detail}`)
      if (info.kind !== 'UNKNOWN') {
        return NextResponse.json(
          {
            error: R2_STORAGE_UNAVAILABLE_MESSAGE,
            code: info.kind === 'NOT_CONFIGURED' ? 'STORAGE_NOT_CONFIGURED' : 'FILE_STORAGE_UNAVAILABLE',
            message: info.detail,
            kind: info.kind,
          },
          { status: 503 }
        )
      }
      throw existsError
    }

    if (!fileExists) {
      return NextResponse.json(
        { 
          error: 'File not found', 
          code: 'FILE_NOT_FOUND',
          fileId,
          suggestion: 'The file may have been deleted or expired'
        },
        { status: 404 }
      )
    }

    // Generate a fresh download URL
    const downloadUrl = await generateDownloadUrl(fileId)

    // Return the URL for client-side redirect
    return NextResponse.json({
      success: true,
      fileId,
      downloadUrl,
      expiresIn: 3600, // 1 hour
      message: 'Use the downloadUrl to fetch the file',
    })

  } catch (error) {
    console.error('[DOWNLOAD] Error:', error)
    
    // Contract: R2 failure → HTTP 503 → "File storage temporarily unavailable".
    // The old word-sniffing check only caught MISSING credentials; wrong-
    // credential errors (InvalidAccessKeyId / SignatureDoesNotMatch) leaked
    // as raw SDK messages in a 500.
    const info = classifyR2Error(error)
    if (info.kind !== 'UNKNOWN') {
      return NextResponse.json(
        { 
          error: R2_STORAGE_UNAVAILABLE_MESSAGE, 
          code: info.kind === 'NOT_CONFIGURED' ? 'STORAGE_NOT_CONFIGURED' : 'FILE_STORAGE_UNAVAILABLE',
          message: info.detail,
          kind: info.kind,
        },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { 
        error: 'Download failed', 
        code: 'DOWNLOAD_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

// DELETE /api/files/[fileId]/download - Delete a file
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    // ---- Auth (was missing — previously anyone could delete any object) ----
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
    const session = token ? validateSessionToken(token) : null

    if (!session?.valid || !session.user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    const { fileId } = await params

    if (!fileId) {
      return NextResponse.json(
        { error: 'File ID required', code: 'MISSING_FILE_ID' },
        { status: 400 }
      )
    }

    // Ownership: only the uploader/owner may delete.
    if (!ownsObjectKey(fileId, session.user.id)) {
      return NextResponse.json(
        { error: 'Access denied for this file', code: 'FORBIDDEN_FILE' },
        { status: 403 }
      )
    }

    // Import delete function
    const { deleteFromR2 } = await import('@/lib/r2/client')

    await deleteFromR2(fileId)

    return NextResponse.json({
      success: true,
      fileId,
      message: 'File deleted successfully',
    })

  } catch (error) {
    console.error('[DELETE] Error:', error)
    
    return NextResponse.json(
      { 
        error: 'Delete failed', 
        code: 'DELETE_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
