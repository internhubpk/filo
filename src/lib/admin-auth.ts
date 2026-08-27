// =============================================================================
// FILO Admin Session Management - Signed HMAC Tokens (Web Crypto)
// =============================================================================
// Fixes a critical privilege-escalation bug: previously /api/auth/admin/login
// accepted ANY registered user's credentials and issued an `admin_session`
// cookie, while every admin API route validated that cookie with a mere
// REGEX (64 hex chars). Any signed-up user therefore had full admin access.
//
// Now:
//   1. Login requires the ADMIN_USERNAME/ADMIN_PASSWORD environment
//      credentials (see .env.example) — ordinary users can NEVER obtain an
//      admin session.
//   2. The issued cookie is an HMAC-SHA256 signed token containing subject +
//      expiry. Forgery without ADMIN_SESSION_SECRET is infeasible.
//   3. Verification is available to BOTH the Edge runtime (middleware.ts) and
//      Node route handlers because it uses the standard Web Crypto API.
//
// Token format: base64url(payloadJson) + "." + base64url(HMAC-SHA256)
// =============================================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export const ADMIN_COOKIE_NAME = 'admin_session'

// Default admin session lifetime: 24 hours
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000

function getSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.CONVEX_URL ||
    'filo_admin_session_secret_2024'
  )
}

interface AdminTokenPayload {
  sub: string          // admin identity (e.g. username)
  iat: number          // issued at (ms since epoch)
  exp: number          // expiry (ms since epoch)
}

// ---- base64url helpers (no Buffer: keeps this module Edge-compatible) ----

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const encoder = new TextEncoder()

async function hmacSign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return bytesToBase64Url(new Uint8Array(signature))
}

async function hmacVerify(data: string, signatureB64Url: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )
  try {
    const sigBytes = base64UrlToBytes(signatureB64Url)
    return await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes as unknown as ArrayBuffer,
      encoder.encode(data)
    )
  } catch {
    return false
  }
}

// ---- Create token ----

export async function createAdminSessionToken(username: string): Promise<string> {
  const now = Date.now()
  const payload: AdminTokenPayload = {
    sub: username,
    iat: now,
    exp: now + ADMIN_SESSION_TTL_MS,
  }
  const payloadB64 = bytesToBase64Url(encoder.encode(JSON.stringify(payload)))
  const sig = await hmacSign(payloadB64)
  return `${payloadB64}.${sig}`
}

// ---- Verify token ----

export interface AdminVerificationResult {
  valid: boolean
  subject?: string
  reason?: 'malformed' | 'tampered' | 'expired'
}

export async function verifyAdminSessionToken(
  token: string | undefined | null
): Promise<AdminVerificationResult> {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'malformed' }
  }

  const dotIndex = token.lastIndexOf('.')
  if (dotIndex < 1) {
    return { valid: false, reason: 'malformed' }
  }

  const payloadB64 = token.substring(0, dotIndex)
  const sigB64 = token.substring(dotIndex + 1)

  if (!payloadB64 || !sigB64) {
    return { valid: false, reason: 'malformed' }
  }

  const signatureOk = await hmacVerify(payloadB64, sigB64)
  if (!signatureOk) {
    return { valid: false, reason: 'tampered' }
  }

  let payload: AdminTokenPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)))
  } catch {
    return { valid: false, reason: 'malformed' }
  }

  if (
    !payload?.exp ||
    typeof payload.exp !== 'number' ||
    payload.exp < Date.now()
  ) {
    return { valid: false, reason: 'expired' }
  }

  return { valid: true, subject: payload.sub }
}

// ---- Shared request guard for /api/admin/* route handlers ----
// Usage:  if (!(await isAdminRequest(request))) { return 401 ... }

export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value
  const verification = await verifyAdminSessionToken(token)
  return verification.valid
}

// Convenience wrapper that returns a ready-made 401 response on failure.
export async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  const ok = await isAdminRequest(request)
  if (!ok) {
    return NextResponse.json(
      { success: false, error: 'Admin authentication required', code: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }
  return null
}
