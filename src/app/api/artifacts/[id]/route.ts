// =============================================================================
// /api/artifacts/[id] — GET single artifact / DELETE artifact
// =============================================================================
// DELETE removes the artifact row (ownership verified) and best-effort
// deletes the linked R2 object. Deletion is audited. Usage history is
// preserved (billing accuracy).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { deleteFromR2 } from '@/lib/r2/client'
import { getConvexClient } from '@/lib/convex-server'

async function requireSession(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
  if (!token) return null
  const session = validateSessionToken(token)
  if (!session.valid || !session.user) return null
  return session.user
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireSession(request)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    const { id } = await params
    const convex = getConvexClient()
    const artifacts = (await convex.query('artifacts:listUserArtifacts' as never, {
      userId: user.id as never,
    } as never)) as Array<Record<string, unknown>>

    const artifact = artifacts.find((a) => a._id === id)
    if (!artifact) {
      return NextResponse.json(
        { success: false, error: 'Artifact not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }
    return NextResponse.json({ success: true, data: artifact })
  } catch (error) {
    console.error('[API /artifacts/[id] GET] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to load artifact', code: 'FETCH_ERROR' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireSession(request)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    const { id } = await params
    const convex = getConvexClient()

    const result = (await convex.mutation('artifacts:deleteUserArtifact' as never, {
      artifactId: id as never,
      userId: user.id as never,
    } as never)) as { success: boolean; r2Key?: string; error?: string }

    if (!result?.success) {
      return NextResponse.json(
        { success: false, error: result?.error ?? 'Artifact not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Best-effort R2 cleanup for the linked object.
    if (result.r2Key) {
      try {
        await deleteFromR2(result.r2Key)
      } catch (r2Err) {
        console.warn('[ARTIFACTS DELETE] R2 deletion failed:', r2Err)
      }
    }

    // Audit (best-effort).
    try {
      const { serverToken } = await import('@/lib/billing-server')
      await convex.mutation('billing:writeAuditLog' as never, {
        serverToken: serverToken(),
        actorId: user.id as never,
        actorEmail: user.email,
        actorType: 'user',
        action: 'artifact.deleted',
        targetType: 'artifact',
        targetId: id,
      } as never)
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({ success: true, data: { deletedId: id } })
  } catch (error) {
    console.error('[API /artifacts/[id] DELETE] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete artifact', code: 'DELETE_FAILED' },
      { status: 500 }
    )
  }
}
