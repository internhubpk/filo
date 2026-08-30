// =============================================================================
// POST /api/artifacts/bulk — bulk operations on the caller's artifacts
// =============================================================================
// Supported actions:
//   { action: "delete", ids: string[] }
//
// SECURITY: every id is deleted through the ownership-checked Convex
// mutation (`artifacts:deleteUserArtifact`), so artifacts belonging to other
// users are impossible to touch even if a caller fabricates the id list.
// The linked R2 object is removed best-effort (deletion still succeeds if
// storage cleanup fails — a dangling object is preferable to a stuck UI).
// One audit event per batch keeps the audit log readable.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { deleteFromR2 } from '@/lib/r2/client'
import { getConvexClient } from '@/lib/convex-server'

const MAX_IDS = 100

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

    const body = (await request.json().catch(() => null)) as
      | { action?: string; ids?: unknown }
      | null

    if (body?.action !== 'delete') {
      return NextResponse.json(
        { success: false, error: 'Unsupported action', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.filter((v): v is string => typeof v === 'string' && v.length > 0))]
      : []

    if (ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No artifacts selected', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json(
        { success: false, error: `Select at most ${MAX_IDS} items per batch`, code: 'TOO_MANY' },
        { status: 400 }
      )
    }

    const convex = getConvexClient()
    const deleted: string[] = []
    const failed: Array<{ id: string; error: string }> = []
    const r2Keys: string[] = []

    for (const id of ids) {
      try {
        const result = (await convex.mutation('artifacts:deleteUserArtifact' as never, {
          artifactId: id as never,
          userId: session.user.id as never,
        } as never)) as { success: boolean; r2Key?: string; error?: string }

        if (result?.success) {
          deleted.push(id)
          if (result.r2Key) r2Keys.push(result.r2Key)
        } else {
          failed.push({ id, error: result?.error ?? 'Artifact not found' })
        }
      } catch (err) {
        failed.push({
          id,
          error: err instanceof Error ? err.message.slice(0, 120) : 'Delete failed',
        })
      }
    }

    // Best-effort storage cleanup — sequential and capped so a flaky R2
    // never turns a completed delete into a user-facing failure.
    let storageCleaned = 0
    for (const key of r2Keys) {
      try {
        await deleteFromR2(key)
        storageCleaned += 1
      } catch (err) {
        console.warn('[ARTIFACTS BULK] R2 cleanup failed:', key, err)
      }
    }

    // Single audit event for the whole batch (best-effort).
    if (deleted.length > 0) {
      try {
        const { serverToken } = await import('@/lib/billing-server')
        await convex.mutation('billing:writeAuditLog' as never, {
          serverToken: serverToken(),
          actorId: session.user.id as never,
          actorEmail: session.user.email,
          actorType: 'user',
          action: 'artifact.bulk_deleted',
          targetType: 'artifact',
          targetId: deleted[0],
          metadata: { count: deleted.length, requested: ids.length },
        } as never)
      } catch {
        /* non-fatal */
      }
    }

    return NextResponse.json({
      success: failed.length === 0 || deleted.length > 0,
      data: {
        deleted,
        deletedCount: deleted.length,
        failed,
        storageCleaned,
        requested: ids.length,
      },
    })
  } catch (error) {
    console.error('[API /artifacts/bulk] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Bulk operation failed', code: 'BULK_FAILED' },
      { status: 500 }
    )
  }
}
