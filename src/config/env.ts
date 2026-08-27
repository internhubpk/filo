// =============================================================================
// FILO Environment Configuration
// =============================================================================
// ARCHITECTURE: Next.js = UI only | Convex = Backend + Secrets + Database
//
// IMPORTANT: This file contains ONLY:
// 1. Public frontend config (NEXT_PUBLIC_*)
// 2. Admin auth config (server-side only, HTTP-only cookies)
// 3. App constants (not secrets)
//
// ALL API keys and secrets live in Convex environment.
// See .env.example for Convex secret configuration.
// =============================================================================

export const env = {
  // Application Basics (Public)
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  
  // Application Identity
  APP_NAME: 'Filo',
  APP_VERSION: '0.1.0-beta',
  
  // Admin Panel Authentication (Server-side only, HTTP-only cookies)
  // These are used in API routes, never exposed to client
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
  
  // File Upload Limits (Public constants, not secrets)
  MAX_FILE_SIZE_MB: 50,
  MAX_UPLOAD_FILES: 10,
  
  // Feature Flags (Public)
  ENABLE_REGISTRATION: true,
  ENABLE_AI_GENERATION: true,
  ENABLE_ADMIN_PANEL: process.env.NODE_ENV === 'development',
} as const

// Public configuration safe for client-side use
export function getPublicConfig() {
  return {
    appName: env.APP_NAME,
    version: env.APP_VERSION,
    appUrl: env.APP_URL,
    convexUrl: env.CONVEX_URL,
    enableRegistration: env.ENABLE_REGISTRATION,
    enableAiGeneration: env.ENABLE_AI_GENERATION,
    maxFileSizeMb: env.MAX_FILE_SIZE_MB,
    maxUploadFiles: env.MAX_UPLOAD_FILES,
  }
}

// Validate admin config is set (server-side only)
export function validateAdminConfig(): string[] {
  const errors: string[] = []
  
  if (!env.ADMIN_PASSWORD) {
    errors.push('ADMIN_PASSWORD is required for admin panel')
  }
  if (!env.ADMIN_SESSION_SECRET) {
    errors.push('ADMIN_SESSION_SECRET is required for admin panel')
  }
  
  return errors
}
