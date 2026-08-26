// =============================================================================
// GET /api/artifacts/download?id=xxx&format=xxx
// =============================================================================
// Downloads a previously generated artifact file.
// The artifact data (base64) must be passed in the query or posted.
// For artifacts stored in R2, fetches from there.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const artifactId = searchParams.get('id')
    const format = searchParams.get('format') || 'DOCX'
    const title = searchParams.get('title') || 'document'
    const fileData = searchParams.get('data') // Base64 encoded file data

    if (!fileData) {
      return NextResponse.json(
        { success: false, error: 'No file data provided. Pass base64 data in ?data= parameter', code: 'NO_DATA' },
        { status: 400 }
      )
    }

    const mimeType = getMimeType(format as any)
    const extension = format.toLowerCase()
    const sanitizedTitle = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)
    const filename = `${sanitizedTitle}.${extension}`

    const buffer = Buffer.from(fileData, 'base64')

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('[ARTIFACTS DOWNLOAD] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Download failed', code: 'DOWNLOAD_ERROR' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { fileData, format, title } = body

    if (!fileData) {
      return NextResponse.json(
        { success: false, error: 'No file data provided', code: 'NO_DATA' },
        { status: 400 }
      )
    }

    const mimeType = getMimeType(format || 'DOCX')
    const extension = (format || 'DOCX').toLowerCase()
    const sanitizedTitle = (title || 'document')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)
    const filename = `${sanitizedTitle}.${extension}`

    const buffer = Buffer.from(fileData, 'base64')

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('[ARTIFACTS DOWNLOAD] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Download failed', code: 'DOWNLOAD_ERROR' },
      { status: 500 }
    )
  }
}

function getMimeType(format: string): string {
  const types: Record<string, string> = {
    DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    PDF: 'application/pdf',
    XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    CSV: 'text/csv',
    TXT: 'text/plain',
  }
  return types[format.toUpperCase()] || 'application/octet-stream'
}
