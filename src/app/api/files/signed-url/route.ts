// =============================================================================
// /api/files/signed-url — Presigned R2 URL generation
// =============================================================================
// SECURITY FIX: this endpoint previously had NO authentication and happily
// issued presigned DOWNLOAD URLs for ANY key in the bucket (full public
// bucket read). Upload URLs also accepted a client-chosen ownerId, letting
// callers plant files under other users' prefixes.
//
// Now:
//   - a valid session is required for every request
//   - upload keys are always scoped under uploads/{authenticatedUserId}/
//   - download keys must belong to the caller's own prefix
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session'
import { generateUploadUrl, generateDownloadUrl } from '@/lib/r2/client'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50MB

export async function POST(request: NextRequest) {
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

    const userId = session.user.id
    const body = await request.json()
    const {
      filename,
      contentType,
      action = 'upload', // 'upload' or 'download'
      existingKey, // For download actions
    } = body

    if (action === 'download' && !existingKey) {
      return NextResponse.json(
        { error: 'File key required for download URL', code: 'MISSING_KEY' },
        { status: 400 }
      )
    }

    if (action === 'upload' && (!filename || !contentType)) {
      return NextResponse.json(
        { error: 'Filename and content type required for upload URL', code: 'MISSING_PARAMS' },
        { status: 400 }
      )
    }

    // Keys are namespaced per user: uploads/{userId}/...
    const userPrefix = `uploads/${userId}/`

    if (action === 'upload') {
      const { generateR2Key } = await import('@/lib/r2/client')
      // Force key scope to the authenticated user regardless of client input.
      const key = generateR2Key(userId, String(filename))
      if (!key.startsWith(userPrefix)) {
        return NextResponse.json(
          { error: 'Invalid storage key', code: 'INVALID_KEY' },
          { status: 400 }
        )
      }

      const uploadUrl = await generateUploadUrl(key, String(contentType))

      return NextResponse.json({
        success: true,
        url: uploadUrl,
        key,
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
        },
        expiresIn: 3600, // 1 hour
      })
    } else {
      const key = String(existingKey)
      // Restrict downloads to the caller's own prefix — no cross-user reads.
      if (!key.startsWith(userPrefix)) {
        return NextResponse.json(
          { error: 'Access denied for this file key', code: 'FORBIDDEN_KEY' },
          { status: 403 }
        )
      }

      const downloadUrl = await generateDownloadUrl(key)

      return NextResponse.json({
        success: true,
        url: downloadUrl,
        key,
        method: 'GET',
        expiresIn: 3600,
      })
    }

  } catch (error) {
    console.error('[SIGNED-URL] Error generating signed URL:', error)

    // Check if it's a configuration error
    if (error instanceof Error && error.message.includes('credentials')) {
      return NextResponse.json(
        {
          error: 'R2 storage not configured',
          code: 'R2_NOT_CONFIGURED',
          message: 'R2 credentials not set in environment variables'
        },
        { status: 503 } // Service Unavailable
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to generate signed URL',
        code: 'GENERATION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

// GET /api/files/signed-url - Health check
export async function GET() {
  // NOTE: intentionally does NOT reveal whether R2 credentials are configured.
  return NextResponse.json({
    service: 'filo-signed-url-generator',
    version: '1.1.0',
    endpoint: '/api/files/signed-url',
    methods: ['POST'],
    supportedActions: ['upload', 'download'],
  })
}
