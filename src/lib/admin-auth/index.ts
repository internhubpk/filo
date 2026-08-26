// =============================================================================
// FILO Admin Authentication - Secure Session Management
// =============================================================================
//
// PROBLEM: The original implementation only validated that the admin_session
// cookie was a 64-character hex string — ANY such string would pass.
//
// FIX: We store issued sessions in an in-memory Map keyed by token. Sessions
// have a configurable TTL and are purged on validation if expired.
//
// TRADE-OFF: Sessions are in-memory (lost on restart). This is acceptable for
// an admin panel with 1-3 concurrent admins. For multi-instance deploys,
// switch to a Convex table or Redis.
// =============================================================================

import crypto from 'crypto'

// --------------- Configuration ---------------

const ADMIN_CONFIG = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin_secure_password_2024',
  sessionSecret: process.env.ADMIN_SESSION_SECRET || 'filo_admin_session_secret_key_2024',
}

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

// --------------- Session Storage ---------------

interface AdminSession {
  username: string
  token: string
  createdAt: number
  expiresAt: number
}

// In-memory session store: token → session
const sessions = new Map<string, AdminSession>()

// --------------- Public API ---------------

/**
 * Verify admin credentials (username + password).
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyCredentials(
  username: string,
  password: string
): boolean {
  try {
    const usernameMatch = crypto.timingSafeEqual(
      Buffer.from(username),
      Buffer.from(ADMIN_CONFIG.username)
    )
    const passwordMatch = crypto.timingSafeEqual(
      Buffer.from(password),
      Buffer.from(ADMIN_CONFIG.password)
    )
    return usernameMatch && passwordMatch
  } catch {
    // Buffer length mismatch → definitely not equal
    return false
  }
}

/**
 * Create a new admin session, store it, and return the token.
 */
export function createSession(username: string): {
  token: string
  expiresAt: number
} {
  const now = Date.now()
  const expiresAt = now + SESSION_MAX_AGE_MS

  // Generate a cryptographically random token
  const rawToken = crypto.randomBytes(32).toString('hex') // 64 hex chars

  // Sign it with HMAC so even if someone guesses the format they can't forge it
  const payload = `${rawToken}:${now}`
  const signature = crypto
    .createHmac('sha256', ADMIN_CONFIG.sessionSecret)
    .update(payload)
    .digest('hex')

  const token = `${rawToken}.${signature}`

  // Store the session
  sessions.set(rawToken, {
    username,
    token: rawToken,
    createdAt: now,
    expiresAt,
  })

  // Clean up old sessions periodically (every 100 new sessions)
  if (sessions.size > 100) {
    purgeExpiredSessions()
  }

  return { token, expiresAt }
}

/**
 * Validate an admin session token from the cookie.
 * Returns the session data if valid, or null if invalid/expired.
 */
export function validateSession(token: string): AdminSession | null {
  if (!token) return null

  // Tokens are in format: <rawHex>.<hmacHex>
  const dotIndex = token.indexOf('.')
  if (dotIndex === -1) return null

  const rawToken = token.substring(0, dotIndex)
  const signature = token.substring(dotIndex + 1)

  // Validate raw token format (64 hex chars)
  if (!/^[a-f0-9]{64}$/.test(rawToken)) return null

  // Validate signature format (64 hex chars)
  if (!/^[a-f0-9]{64}$/.test(signature)) return null

  // Look up session
  const session = sessions.get(rawToken)
  if (!session) return null

  // Check expiry
  if (Date.now() > session.expiresAt) {
    sessions.delete(rawToken)
    return null
  }

  // Re-verify the HMAC signature to prevent token tampering
  const payload = `${rawToken}:${session.createdAt}`
  const expectedSignature = crypto
    .createHmac('sha256', ADMIN_CONFIG.sessionSecret)
    .update(payload)
    .digest('hex')

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    // Signature mismatch — possible tampering, delete session
    sessions.delete(rawToken)
    return null
  }

  return session
}

/**
 * Destroy a session (used on logout).
 */
export function destroySession(token: string): boolean {
  if (!token) return false

  const dotIndex = token.indexOf('.')
  if (dotIndex === -1) return false

  const rawToken = token.substring(0, dotIndex)
  return sessions.delete(rawToken)
}

/**
 * Express/Next.js middleware helper: check if a request has a valid admin session.
 * Extracts the token from the `admin_session` cookie and validates it.
 */
export function isAdminRequest(request: { cookies: { get: (name: string) => { value: string } | undefined } }): boolean {
  const token = request.cookies.get('admin_session')?.value
  if (!token) return false
  return validateSession(token) !== null
}

/**
 * Get the current admin username from a request, or null if not authenticated.
 */
export function getAdminUsername(
  request: { cookies: { get: (name: string) => { value: string } | undefined } }
): string | null {
  const token = request.cookies.get('admin_session')?.value
  if (!token) return null
  const session = validateSession(token)
  return session?.username ?? null
}

// --------------- Internal ---------------

function purgeExpiredSessions(): void {
  const now = Date.now()
  for (const [key, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(key)
    }
  }
}

// --------------- Rate Limiting ---------------

const failedAttempts = new Map<string, { count: number; lastAttempt: number }>()

export function isRateLimited(ip: string): boolean {
  const attempts = failedAttempts.get(ip)
  if (!attempts) return false

  // Reset after 15 minutes
  if (Date.now() - attempts.lastAttempt > 15 * 60 * 1000) {
    failedAttempts.delete(ip)
    return false
  }

  // Max 5 attempts per 15 minutes
  return attempts.count >= 5
}

export function recordFailedAttempt(ip: string): void {
  const attempts = failedAttempts.get(ip) || { count: 0, lastAttempt: Date.now() }
  failedAttempts.set(ip, {
    count: attempts.count + 1,
    lastAttempt: Date.now(),
  })
}
