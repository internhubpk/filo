import { NextRequest, NextResponse } from 'next/server'
import { validateFile, formatFileSize } from '@/services/file-service'
import { getFileCategory } from '@/config/r2'
import { uploadToR2, generateR2Key, generateDownloadUrl } from '@/lib/r2/client'

// POST /api/files/upload - Handle file uploads (R2 Integration)
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const workspaceId = formData.get('workspaceId') as string
    const ownerId = formData.get('ownerId') as string
    const mimeType = formData.get('mimeType') as string

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided', code: 'NO_FILE' },
        { status: 400 }
      )
    }

    if (!workspaceId || !ownerId) {
      return NextResponse.json(
        { error: 'Missing workspace or owner ID', code: 'MISSING_PARAMS' },
        { status: 400 }
      )
    }

    // Validate the file
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

    // Generate unique R2 key
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
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')
    const ownerId = searchParams.get('ownerId')
    const type = searchParams.get('type')

    if (!workspaceId && !ownerId) {
      return NextResponse.json(
        { error: 'Workspace ID or Owner ID required', code: 'MISSING_PARAMS' },
        { status: 400 }
      )
    }

    // In production, query Convex database for file metadata
    // For now, return empty array with proper structure
    return NextResponse.json({
      success: true,
      files: [],
      total: 0,
      filters: { workspaceId, ownerId, type },
      message: 'File listing available with Convex integration',
      // Example of what a file entry looks like:
      exampleEntry: {
        id: 'file_123',
        filename: 'document.pdf',
        size: 1024000,
        mimeType: 'application/pdf',
        category: 'document',
        r2Key: 'uploads/user123/12345678-doc.pdf',
        createdAt: new Date().toISOString(),
      }
    })

  } catch (error) {
    console.error('[FILES] List error:', error)
    return NextResponse.json(
      { error: 'Failed to list files', code: 'LIST_ERROR' },
      { status: 500 }
    )
  }
}
