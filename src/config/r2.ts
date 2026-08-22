// Cloudflare R2 Configuration
// All credentials are server-side only

import { env } from './env'

export const R2_CONFIG = {
  // Account & Authentication
  accountId: env.CLOUDFLARE_R2_ACCOUNT_ID,
  accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
  secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  
  // Bucket
  bucket: env.CLOUDFLARE_R2_BUCKET,
  
  // URLs
  publicUrl: env.CLOUDFLARE_R2_PUBLIC_URL,
  
  // Signed URL settings
  signedUrlExpiry: {
    download: 3600,      // 1 hour for downloads
    upload: 1800,        // 30 minutes for uploads
    preview: 300,        // 5 minutes for previews
  },
  
  // File size limits
  maxFileSizeBytes: env.MAX_FILE_SIZE_MB * 1024 * 1024, // Convert MB to bytes
  
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
      return `${R2_CONFIG.paths.versions(params.artifactId, params.version)}/${timestamp}_${randomString}_${sanitizedFilename}`
    
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
  return R2_CONFIG.allowedMimeTypes.includes(mimeType)
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
