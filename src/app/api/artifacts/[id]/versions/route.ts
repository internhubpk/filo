// =============================================================================
// /api/artifacts/[id]/versions — GET version history / POST restore (spec §27)
// =============================================================================
// GET    → the artifact's immutable version trail (newest first), including
//          operation, format, filename, size, QA summary and timestamps.
// POST   → { version } restores a previous version: the artifact is re-pointed
//          at that version's file and a 'restore' version entry is appended —
//          history stays append-only and previous files are never deleted.
//
// SECURITY: session-authenticated; ownership enforced inside every Convex
// function. No R2 keys are accepted from the client.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { api } from '@convex/_generated/api'
import { getConvexClient } from '@/lib/convex-server'

export const runtime = 'nodejs'

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

    // Ownership is verified inside the query (userId must match).
    const result = (await convex.query(api.artifacts.listArtifactVersions, {
      artifactId: id as any,
      userId: user.id as any,
    })) as { success: boolean; versions: Array<Record<string, unknown>> }

    if (!result?.success) {
      return NextResponse.json(
        { success: false, error: 'Artifact not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: { versions: result.versions } })
  } catch (error) {
    console.error('[API /artifacts/[id]/versions GET] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to load version history', code: 'FETCH_ERROR' },
      { status: 500 }
    )
  }
}

export async function POST(
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
    let body: { version?: number } = {}
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 }
      )
    }

    const version = Number(body.version)
    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json(
        { success: false, error: 'A valid version number is required', code: 'INVALID_VERSION' },
        { status: 400 }
      )
    }

    const convex = getConvexClient()
    const serverToken = process.env.FILO_SERVER_SECRET
    if (!serverToken) {
      return NextResponse.json(
        { success: false, error: 'Restore unavailable (server secret missing)', code: 'SERVER_SECRET_MISSING' },
        { status: 503 }
      )
    }

    const result = (await convex.mutation(api.artifacts.restoreArtifactVersion, {
      serverToken,
      artifactId: id as any,
      userId: user.id as any,
      version,
    })) as { success: boolean; version?: number; restoredFrom?: number; error?: string }

    if (!result?.success) {
      return NextResponse.json(
        { success: false, error: result?.error ?? 'Version not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Audit (best-effort).
    try {
      await convex.mutation('billing:writeAuditLog' as never, {
        serverToken,
        actorId: user.id as never,
        actorEmail: user.email,
        actorType: 'user',
        action: 'artifact.version_restored',
        targetType: 'artifact',
        targetId: id,
        metadata: { restoredFrom: version },
      } as never)
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({
      success: true,
      data: {
        artifactId: id,
        restoredFrom: result.restoredFrom ?? version,
        newVersion: result.version,
      },
    })
  } catch (error) {
    console.error('[API /artifacts/[id]/versions POST] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to restore version', code: 'RESTORE_FAILED' },
      { status: 500 }
    )
  }
}
