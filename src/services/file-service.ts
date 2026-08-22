// File Management Service
// Handles uploads, downloads, and R2 integration

import { env } from '@/config/env'
import { R2_CONFIG, generateR2Key, isMimeTypeAllowed, getFileCategory } from '@/config/r2'
import type { FileUploadOptions, FileUploadResult, SignedUrlOptions } from '@/types'

// ==================== ERROR TYPES ====================

export class FileError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message)
    this.name = 'FileError'
  }
}

// ==================== FILE UPLOAD ====================

export async function uploadFile(options: FileUploadOptions): Promise<FileUploadResult> {
  const { workspaceId, ownerId, file, filename, mimeType, isPublic = false } = options
  
  // Validate
  if (!isMimeTypeAllowed(mimeType)) {
    throw new FileError(
      `File type not allowed: ${mimeType}`,
      'FILE_TYPE_NOT_ALLOWED',
      415
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  
  if (buffer.length > R2_CONFIG.maxFileSizeBytes) {
    throw new FileError(
      `File too large: ${(buffer.length / 1024 / 1024).toFixed(2)}MB exceeds limit of ${R2_CONFIG.maxFileSizeBytes / 1024 / 1024}MB`,
      'FILE_TOO_LARGE',
      413
    )
  }

  // Generate R2 key
  const r2Key = generateR2Key('user-file', { userId: ownerId }, filename)

  try {
    // Upload to R2 via our API route (server-side only)
    const formData = new FormData()
    formData.append('file', file, filename)
    formData.append('r2Key', r2Key)
    formData.append('workspaceId', workspaceId)
    formData.append('ownerId', ownerId)
    formData.append('mimeType', mimeType)
    formData.append('isPublic', String(isPublic))

    const response = await fetch('/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new FileError(error.message || 'Upload failed', error.code, response.status)
    }

    const result = await response.json()

    return {
      id: result.fileId,
      filename: result.filename,
      originalName: filename,
      mimeType,
      size: buffer.length,
      r2Key,
      url: result.url,
      signedUrl: result.signedUrl,
      expiresAt: result.expiresAt ? new Date(result.expiresAt) : undefined,
    }
  } catch (error) {
    if (error instanceof FileError) throw error
    throw new FileError(
      `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'UPLOAD_FAILED',
      500
    )
  }
}

// ==================== SIGNED URL GENERATION ====================

export async function generateSignedUrl(options: SignedUrlOptions): Promise<string> {
  // This must be called server-side or through our API
  const response = await fetch('/api/files/signed-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })

  if (!response.ok) {
    throw new Error('Failed to generate signed URL')
  }

  const data = await response.json()
  return data.url
}

// ==================== FILE DOWNLOAD ====================

export async function downloadFile(fileId: string): Promise<Blob> {
  const response = await fetch(`/api/files/${fileId}/download`)

  if (!response.ok) {
    throw new Error('Download failed')
  }

  return response.blob()
}

// ==================== FILE VALIDATION ====================

export interface FileValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  metadata: {
    size: number
    mimeType: string
    category: ReturnType<typeof getFileCategory>
    extension: string
  }
}

export function validateFile(file: File): FileValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check MIME type
  if (!isMimeTypeAllowed(file.type)) {
    errors.push(`File type not allowed: ${file.type}`)
  }

  // Check size
  if (file.size > R2_CONFIG.maxFileSizeBytes) {
    errors.push(`File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB`)
  }

  // Check empty file
  if (file.size === 0) {
    errors.push('File is empty')
  }

  // Check extension vs MIME type mismatch
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  const expectedExtensions: Record<string, string[]> = {
    'application/pdf': ['pdf'],
    'application/msword': ['doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.ms-excel': ['xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
    'application/vnd.ms-powerpoint': ['ppt'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
    'text/plain': ['txt'],
    'text/csv': ['csv'],
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
  }

  const expectedExts = expectedExtensions[file.type]
  if (expectedExts && !expectedExts.includes(extension)) {
    warnings.push(`Extension ".${extension}" doesn't match MIME type "${file.type}"`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata: {
      size: file.size,
      mimeType: file.type,
      category: getFileCategory(file.type),
      extension,
    },
  }
}

// ==================== FILE PROCESSING HELPERS ====================

/**
 * Extract text content from various file types
 * For now, this is a placeholder - actual extraction would use libraries like:
 * - pdf-parse for PDFs
 * - mammoth for DOCX
 * - xlsx for Excel files
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const mimeType = file.type

  switch (mimeType) {
    case 'text/plain':
    case 'text/markdown':
    case 'text/csv':
    case 'application/json':
    case 'application/xml':
      return await file.text()

    case 'application/pdf':
      // Would use pdf-parse library
      return `[PDF text extraction for: ${file.name}]`

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      // Would use mammoth library
      return `[DOCX text extraction for: ${file.name}]`

    default:
      return `[Unsupported text extraction for: ${mimeType}]`
  }
}

/**
 * Get human-readable file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = bytes / Math.pow(1024, i)
  
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

/**
 * Get file icon based on MIME type
 */
export function getFileIcon(mimeType: string): string {
  const category = getFileCategory(mimeType)
  
  switch (category) {
    case 'document':
      return 'FileText'
    case 'spreadsheet':
      return 'Table'
    case 'presentation':
      return 'Presentation'
    case 'image':
      return 'Image'
    case 'archive':
      return 'Archive'
    default:
      return 'File'
  }
}
