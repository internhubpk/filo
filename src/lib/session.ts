// =============================================================================
// FILO Session Token Management - Self-Contained HMAC Tokens
// =============================================================================
// Tokens are signed with HMAC-SHA256 and contain the user payload inline.
// This means session validation does NOT require a database lookup.
//
// Why this exists:
//   The previous approach stored sessions in the Convex "sessions" table
//   via a mutation (createSessionByEmail). If that mutation failed silently
//   (wrong Convex deploy, network glitch, schema mismatch), the token was
//   returned to the client but never stored in the DB. Every subsequent
//   API call that validated the token against the DB would fail with
//   "Invalid or expired session".
//
//   Self-contained tokens eliminate this class of failure entirely:
//   the token IS the session — no database round-trip needed.
// =============================================================================

import { createHmac, timingSafeEqual } from 'crypto'

// ---- Secret ----
// Uses CONVEX_URL (unique per deployment, already in env) as the HMAC key.
// Falls back to a compile-time constant so the app never crashes.
// TODO: In production, set SESSION_SECRET in .env for extra security.
function getSecret(): Buffer {
  const raw =
    process.env.SESSION_SECRET ||
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    'filo_session_secret_2024'
  return Buffer.from(raw, 'utf-8')
}

// ---- Types ----

export interface SessionUser {
  id: string
  name: string
  email: string
  status: 'pending_activation' | 'active' | 'suspended'
  planId: string | null
}

export interface ValidatedSession {
  valid: true
  user: SessionUser
  reason: 'active'
  expiresAt: number
}

export interface InvalidSession {
  valid: false
  user: null
  reason: 'expired' | 'tampered' | 'malformed'
}

export type SessionResult = ValidatedSession | InvalidSession

// Internal payload stored inside the token
interface TokenPayload {
  uid: string   // userId
  em: string    // email
  nm: string    // name
  st: string    // status
  pid: string | null // planId
  exp: number   // expiry (ms since epoch)
  iat: number   // issued at (ms since epoch)
}

// ---- Create Token ----

/**
 * Create a signed session token that encodes the user payload.
 * Returns a string of the form:  base64url(payload).base64url(signature)
 */
export function createSessionToken(user: {
  id: string
  name: string
  email: string
  status?: string
  planId?: string | null
}, ttlMs: number = 7 * 24 * 60 * 60 * 1000): string {
  const now = Date.now()
  const payload: TokenPayload = {
    uid: user.id,
    em: user.email,
    nm: user.name,
    st: user.status || 'active',
    pid: user.planId || null,
    exp: now + ttlMs,
    iat: now,
  }

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url')
  const sig = createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('base64url')

  return `${payloadB64}.${sig}`
}

// ---- Validate Token ----

/**
 * Validate a session token and extract the user payload.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function validateSessionToken(token: string): SessionResult {
  // 1. Basic format check — must contain exactly one dot separating payload and sig
  const dotIndex = token.lastIndexOf('.')
  if (dotIndex < 1) {
    return { valid: false, user: null, reason: 'malformed' }
  }

  const payloadB64 = token.substring(0, dotIndex)
  const sigB64 = token.substring(dotIndex + 1)

  if (!payloadB64 || !sigB64) {
    return { valid: false, user: null, reason: 'malformed' }
  }

  // 2. Verify HMAC signature (timing-safe)
  const expectedSig = createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('base64url')

  try {
    const sigBuf = Buffer.from(sigB64, 'base64url')
    const expectedBuf = Buffer.from(expectedSig, 'base64url')

    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return { valid: false, user: null, reason: 'tampered' }
    }
  } catch {
    return { valid: false, user: null, reason: 'malformed' }
  }

  // 3. Decode payload
  let payload: TokenPayload
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8')
    )
  } catch {
    return { valid: false, user: null, reason: 'malformed' }
  }

  // 4. Check expiry
  if (!payload.exp || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
    return { valid: false, user: null, reason: 'expired' }
  }

  // 5. Return validated session
  return {
    valid: true,
    user: {
      id: payload.uid,
      name: payload.nm,
      email: payload.em,
      status: (payload.st as SessionUser['status']) || 'active',
      planId: payload.pid,
    },
    reason: 'active',
    expiresAt: payload.exp,
  }
}
