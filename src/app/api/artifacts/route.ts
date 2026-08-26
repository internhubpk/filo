// =============================================================================
// GET /api/artifacts
// =============================================================================
// List user's artifacts with optional filtering
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { getConvexClient } from '@/lib/convex-server'
import { api } from '@convex/_generated/api'

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.substring(7)

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    }

    // Validate session locally (HMAC, no DB lookup)
    const session = validateSessionToken(token)
    if (!session.valid || !session.user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session', code: 'INVALID_SESSION' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const type = searchParams.get('type') || ''
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Query artifacts from Convex
    const convex = getConvexClient()
    let artifacts: any[] = []
    
    try {
      // listUserArtifacts accepts userId + limit. Search/type filtering is
      // applied in-memory here (small result sets); move it into the Convex
      // query with a searchIndex if artifact counts grow.
      const all = await convex.query(api.artifacts.listUserArtifacts, {
        userId: userId as any,
        limit: Math.max(limit + offset, 50),
      })
      let filtered = (all as any[]) || []
      if (type) {
        filtered = filtered.filter((a) => a.type === type)
      }
      if (search) {
        const q = search.toLowerCase()
        filtered = filtered.filter(
          (a) =>
            (a.title || '').toLowerCase().includes(q) ||
            (a.prompt || '').toLowerCase().includes(q)
        )
      }
      artifacts = filtered.slice(offset, offset + limit)
    } catch {
      // Fallback: If the query fails (e.g. Convex cold start), return empty
      // rather than throwing — the UI shows an empty state.
      console.warn('[API /artifacts] listUserArtifacts query failed, returning empty')
      artifacts = []
    }

    return NextResponse.json({
      success: true,
      data: {
        artifacts,
        total: artifacts.length,
        limit,
        offset,
      }
    })

  } catch (error) {
    console.error('[API /artifacts] Error:', error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch artifacts',
        code: 'FETCH_ERROR' 
      },
      { status: 500 }
    )
  }
}
