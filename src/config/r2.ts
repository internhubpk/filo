// =============================================================================
// FILO Cloudflare R2 Configuration
// =============================================================================
// ARCHITECTURE: R2 credentials are server-side only (Convex secrets / env vars)
//
// SINGLE SOURCE OF TRUTH: Uses R2_* environment variables (no duplicates)
// - R2_ACCOUNT_ID
// - R2_ACCESS_KEY_ID
// - R2_SECRET_ACCESS_KEY
// - R2_BUCKET_NAME
//
// NOTE: This config is used by server-side code only (API routes, Convex actions)
// The actual S3 client lives in src/lib/r2/client.ts
// =============================================================================

import { env } from './env'

export const R2_CONFIG = {
  // Account & Authentication (from R2_* env vars)
  accountId: process.env.R2_ACCOUNT_ID || '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  
  // Bucket
  bucket: process.env.R2_BUCKET_NAME || 'filo-uploads',
  
  // Endpoint (derived from account ID)
  endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  
  // Public URL for assets (if any are public)
  publicUrl: process.env.R2_PUBLIC_URL,
  
  // Signed URL settings
  signedUrlExpiry: {
    download: 3600,      // 1 hour for downloads
    upload: 1800,        // 30 minutes for uploads
    preview: 300,        // 5 minutes for previews
  },
  
  // File size limits (from app config)
  maxFileSizeBytes: env.MAX_FILE_SIZE_MB * 1024 * 1024,
  
  // Allowed MIME types
  allowedMimeTypes: [
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    
    // Text
    'text/plain',
    'text/csv',
    'text/markdown',
    
    // Images
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    
    // Archives
    'application/zip',
    'application/x-rar-compressed',
    
    // Data
    'application/json',
    'application/xml',
  ],
  
  // Storage paths
  paths: {
    userFiles: (userId: string) => `users/${userId}/files`,
    artifacts: (artifactId: string) => `artifacts/${artifactId}`,
    versions: (artifactId: string, version: number) => `artifacts/${artifactId}/versions/v${version}`,
    temp: () => `temp/${Date.now()}`,
    brandLogos: (brandId: string) => `brands/${brandId}/logo`,
    generatedImages: (artifactId: string) => `artifacts/${artifactId}/images`,
  },
} as const

// Generate R2 key for a file
export function generateR2Key(
  type: 'user-file' | 'artifact' | 'version' | 'temp' | 'brand-logo' | 'generated-image',
  params: Record<string, string>,
  originalFilename: string
): string {
  const timestamp = Date.now()
  const randomString = Math.random().toString(36).substring(2, 8)
  const sanitizedFilename = originalFilename
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '_')
    .replace(/_+/g, '_')
  
  switch (type) {
    case 'user-file':
      return `${R2_CONFIG.paths.userFiles(params.userId)}/${timestamp}_${randomString}_${sanitizedFilename}`
    
    case 'artifact':
      return `${R2_CONFIG.paths.artifacts(params.artifactId)}/${timestamp}_${randomString}_${sanitizedFilename}`
    
    case 'version':
      return `${R2_CONFIG.paths.versions(params.artifactId, parseInt(params.version))}/${timestamp}_${randomString}_${sanitizedFilename}`
    
    case 'temp':
      return `${R2_CONFIG.paths.temp()}/${timestamp}_${randomString}_${sanitizedFilename}`
    
    case 'brand-logo':
      return `${R2_CONFIG.paths.brandLogos(params.brandId)}/${sanitizedFilename}`
    
    case 'generated-image':
      return `${R2_CONFIG.paths.generatedImages(params.artifactId)}/${timestamp}_${randomString}_${sanitizedFilename}`
    
    default:
      throw new Error(`Unknown R2 key type: ${type}`)
  }
}

// Validate file type is allowed
export function isMimeTypeAllowed(mimeType: string): boolean {
  return R2_CONFIG.allowedMimeTypes.includes(mimeType as typeof R2_CONFIG.allowedMimeTypes[number])
}

// Get category from MIME type
export function getFileCategory(mimeType: string): 'document' | 'spreadsheet' | 'presentation' | 'image' | 'text' | 'archive' | 'other' {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') return 'spreadsheet'
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'presentation'
  if (mimeType.includes('pdf') || mimeType.includes('word') || mimeType.includes('document')) return 'document'
  if (mimeType.startsWith('text/')) return 'text'
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('archive')) return 'archive'
  return 'other'
}
