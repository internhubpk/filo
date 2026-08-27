// =============================================================================
// DELETE /api/files/[fileId] — delete a file (R2 object + Convex metadata)
// =============================================================================
// fileId is the Convex `files` row id. Ownership is enforced twice: the row
// is fetched and compared against the session user, and the Convex mutation
// re-checks. The R2 object is deleted best-effort BEFORE the metadata row so
// storage metrics never undercount.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { deleteFromR2 } from '@/lib/r2/client'
import { getConvexClient } from '@/lib/convex-server'
import { api } from '@convex/_generated/api'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
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

    const { fileId } = await params
    if (!fileId) {
      return NextResponse.json(
        { success: false, error: 'File ID required', code: 'MISSING_FILE_ID' },
        { status: 400 }
      )
    }

    const convex = getConvexClient()

    // Ownership check: fetch the single row and compare owner ids.
    const row = (await convex.query(api.files.getFileForUser, {
      fileId: fileId as any,
      userId: session.user.id as any,
    })) as { _id: string; r2Key: string } | null

    if (!row) {
      return NextResponse.json(
        { success: false, error: 'File not found or not yours', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Best-effort R2 deletion (the metadata row is authoritative).
    try {
      await deleteFromR2(row.r2Key)
    } catch (r2Err) {
      console.warn('[FILES DELETE] R2 deletion failed (row still removed):', r2Err)
    }

    await convex.mutation(api.files.deleteFile, {
      fileId: fileId as any,
      userId: session.user.id as any,
    })

    return NextResponse.json({ success: true, data: { deletedId: fileId } })
  } catch (error) {
    console.error('[FILES DELETE] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete file', code: 'DELETE_FAILED' },
      { status: 500 }
    )
  }
}
