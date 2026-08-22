// Environment Configuration
// All secrets must be server-side only - NEVER exposed to client

export const env = {
  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db',
  
  // Application
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  APP_NAME: 'Filo',
  APP_VERSION: '0.1.0-beta',
  
  // Authentication
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  
  // AI Providers - SERVER SIDE ONLY - Never expose to client
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, // Convex secret in production
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  
  OPENAI_API_KEY: process.env.OPENAI_API_KEY, // Convex secret in production
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  
  // Cloudflare R2 - SERVER SIDE ONLY
  CLOUDFLARE_R2_ACCESS_KEY_ID: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID, // Convex secret
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY, // Convex secret
  CLOUDFLARE_R2_ACCOUNT_ID: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
  CLOUDFLARE_R2_BUCKET: process.env.CLOUDFLARE_R2_BUCKET || 'filo-artifacts',
  CLOUDFLARE_R2_PUBLIC_URL: process.env.CLOUDFLARE_R2_PUBLIC_URL || `https://pub-${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.dev`,
  
  // PayFast Payment Integration - SERVER SIDE ONLY
  PAYFAST_MERCHANT_ID: process.env.PAYFAST_MERCHANT_ID, // Convex secret
  PAYFAST_MERCHANT_KEY: process.env.PAYFAST_MERCHANT_KEY, // Convex secret
  PAYFAST_PASSPHRASE: process.env.PAYFAST_PASSPHRASE, // Convex secret
  PAYFAST_IS_SANDBOX: process.env.PAYFAST_IS_SANDBOX === 'true',
  PAYFAST_BASE_URL: process.env.PAYFAST_IS_SANDBOX === 'true'
    ? 'https://sandbox.payfast.co.za/eng/process'
    : 'https://www.payfast.co.za/eng/process',
  
  // Usage Limits (configurable)
  DEFAULT_CREDITS_LIMIT: parseInt(process.env.DEFAULT_CREDITS_LIMIT || '100'),
  FREE_STORAGE_LIMIT_MB: parseInt(process.env.FREE_STORAGE_LIMIT_MB || '100'),
  MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB || '50'),
  MAX_UPLOAD_FILES: parseInt(process.env.MAX_UPLOAD_FILES || '10'),
  
  // Job Processing
  JOB_TIMEOUT_MS: parseInt(process.env.JOB_TIMEOUT_MS || '300000'), // 5 minutes
  JOB_MAX_RETRIES: parseInt(process.env.JOB_MAX_RETRIES || '3'),
  
  // Security
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), // 1 minute
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  
  // Feature Flags
  ENABLE_REGISTRATION: process.env.ENABLE_REGISTRATION !== 'false',
  ENABLE_AI_GENERATION: process.env.ENABLE_AI_GENERATION !== 'false',
  ENABLE_PAYMENTS: process.env.ENABLE_PAYMENTS === 'true',
  ENABLE_ADMIN_PANEL: process.env.ENABLE_ADMIN_PANEL === 'true' || process.env.NODE_ENV === 'development',
} as const

// Validation helper
export function validateEnv(): string[] {
  const errors: string[] = []
  
  if (!env.DATABASE_URL) errors.push('DATABASE_URL is required')
  if (!env.NODE_ENV) errors.push('NODE_ENV is required')
  
  // Only validate API keys in production
  if (env.NODE_ENV === 'production') {
    if (!env.OPENROUTER_API_KEY && !env.OPENAI_API_KEY) {
      errors.push('At least one AI provider API key is required (OPENROUTER_API_KEY or OPENAI_API_KEY)')
    }
    if (!env.CLOUDFLARE_R2_ACCESS_KEY_ID) errors.push('CLOUDFLARE_R2_ACCESS_KEY_ID is required')
    if (!env.CLOUDFLARE_R2_SECRET_ACCESS_KEY) errors.push('CLOUDFLARE_R2_SECRET_ACCESS_KEY is required')
    if (!env.CLOUDFLARE_R2_ACCOUNT_ID) errors.push('CLOUDFLARE_R2_ACCOUNT_ID is required')
  }
  
  return errors
}

// Check if all required env vars are set for current mode
export function isEnvValid(): boolean {
  return validateEnv().length === 0
}

// Get safe public config (no secrets)
export function getPublicConfig() {
  return {
    appName: env.APP_NAME,
    version: env.APP_VERSION,
    enableRegistration: env.ENABLE_REGISTRATION,
    enableAiGeneration: env.ENABLE_AI_GENERATION,
    enablePayments: env.ENABLE_PAYMENTS,
    maxFileSizeMb: env.MAX_FILE_SIZE_MB,
    maxUploadFiles: env.MAX_UPLOAD_FILES,
  }
}
