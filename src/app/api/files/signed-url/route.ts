import { NextRequest, NextResponse } from 'next/server'
import { generateUploadUrl, generateDownloadUrl } from '@/lib/r2/client'

// POST /api/files/signed-url - Generate presigned URLs for direct uploads
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      filename, 
      contentType, 
      ownerId, 
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

    if (action === 'upload') {
      // Generate key for new upload
      const { generateR2Key } = await import('@/lib/r2/client')
      const key = generateR2Key(ownerId || 'anonymous', filename)
      
      // Generate presigned upload URL
      const uploadUrl = await generateUploadUrl(key, contentType)

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
      // Generate download URL for existing file
      const downloadUrl = await generateDownloadUrl(existingKey)

      return NextResponse.json({
        success: true,
        url: downloadUrl,
        key: existingKey,
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
  return NextResponse.json({
    service: 'filo-signed-url-generator',
    version: '1.0.0',
    endpoint: '/api/files/signed-url',
    methods: ['POST'],
    supportedActions: ['upload', 'download'],
    r2Configured: !!(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY),
  })
}
