import { NextRequest, NextResponse } from 'next/server'
import { generateDownloadUrl, fileExistsInR2 } from '@/lib/r2/client'
import { validateSessionToken } from '@/lib/session'

// GET /api/files/[fileId]/download - Generate download URL or redirect
// This endpoint provides a download link for a specific file.
// SECURITY: requires a valid session; callers may only access keys under
// their own uploads/{userId}/ prefix.

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

    // Ownership: files are stored under uploads/{userId}/... — no cross-user reads.
    if (!fileId.startsWith(`uploads/${session.user.id}/`)) {
      return NextResponse.json(
        { error: 'Access denied for this file', code: 'FORBIDDEN_FILE' },
        { status: 403 }
      )
    }

    // Check if file exists in R2 (optional - may fail if R2 not configured)
    let fileExists = false
    try {
      fileExists = await fileExistsInR2(fileId)
    } catch {
      // R2 might not be configured - continue anyway
      console.warn('[DOWNLOAD] Could not check file existence in R2')
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
    
    if (error instanceof Error && error.message.includes('credentials')) {
      return NextResponse.json(
        { 
          error: 'Storage service unavailable', 
          code: 'STORAGE_UNAVAILABLE',
          message: 'File storage is not properly configured'
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

    // Ownership: only the uploader may delete.
    if (!fileId.startsWith(`uploads/${session.user.id}/`)) {
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
