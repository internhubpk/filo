// =============================================================================
// FILO AI — Typed Error Hierarchy
// =============================================================================
// Every AI failure in Filo surfaces as one of these error classes so callers
// can branch on `instanceof` (or on `code`) instead of parsing message
// strings. `retryable` drives the retry loop in router.ts.
// =============================================================================

import type { ProviderId } from './types'

export type AiErrorCode =
  | 'API_KEY_MISSING'
  | 'PROVIDER_UNCONFIGURED'
  | 'AUTH_FAILED' // spec category: AUTHENTICATION_FAILED (401/403)
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'CONTEXT_TOO_LONG'
  | 'CONTENT_FILTERED' // spec category: CONTENT_BLOCKED
  | 'MODEL_NOT_FOUND'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'JSON_PARSE_FAILED'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'ALL_PROVIDERS_FAILED'
  | 'UNKNOWN'

/** Base class for every AI error in Filo. */
export class AiBaseError extends Error {
  constructor(
    message: string,
    public readonly code: AiErrorCode,
    public readonly provider: ProviderId | 'ROUTER',
    public readonly retryable: boolean,
    public readonly statusCode?: number,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = this.constructor.name
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      provider: this.provider,
      retryable: this.retryable,
      statusCode: this.statusCode,
      message: this.message,
    }
  }
}

/** The provider's API key is missing or empty. */
export class ApiKeyMissingError extends AiBaseError {
  constructor(provider: ProviderId, envVar: string) {
    super(
      `${provider} API key not configured. Set ${envVar} in the server environment.`,
      'API_KEY_MISSING',
      provider,
      false
    )
  }
}

/** The provider rejected our credentials. */
export class AuthFailedError extends AiBaseError {
  constructor(provider: ProviderId, statusCode: number, detail?: string) {
    super(
      `${provider} rejected the request credentials${detail ? `: ${detail}` : ''}.`,
      'AUTH_FAILED',
      provider,
      false,
      statusCode
    )
  }
}

/** Rate limited — safe to retry with backoff. */
export class RateLimitedError extends AiBaseError {
  constructor(
    provider: ProviderId,
    public readonly retryAfterMs?: number
  ) {
    super(
      `${provider} rate limit exceeded${retryAfterMs ? ` — retry after ${retryAfterMs}ms` : ''}.`,
      'RATE_LIMITED',
      provider,
      true,
      429
    )
  }
}

/** Quota/billing exhausted — NOT retryable (needs human action). */
export class QuotaExceededError extends AiBaseError {
  constructor(provider: ProviderId, detail?: string) {
    super(
      `${provider} quota exceeded${detail ? `: ${detail}` : ''}. Check billing.`,
      'QUOTA_EXCEEDED',
      provider,
      false
    )
  }
}

/** Request timed out — retryable. */
export class TimeoutError extends AiBaseError {
  constructor(provider: ProviderId, timeoutMs: number) {
    super(
      `${provider} request timed out after ${timeoutMs}ms.`,
      'TIMEOUT',
      provider,
      true
    )
  }
}

/** Network-level failure — retryable. */
export class NetworkError extends AiBaseError {
  constructor(provider: ProviderId, detail: string, cause?: unknown) {
    super(
      `${provider} network error: ${detail}.`,
      'NETWORK_ERROR',
      provider,
      true,
      undefined,
      cause
    )
  }
}

/**
 * undici / Node fetch wrap the real socket/DNS failure inside `err.cause`
 * ("fetch failed" alone is undiagnosable). Extract the deepest cause codes so
 * log lines answer WHY the network hop failed:
 *   ENOTFOUND    → hostname does not resolve (bad base URL / private host)
 *   ECONNREFUSED → nothing listening on the target host/port
 *   ECONNRESET / ECONNABORTED → connection cut mid-flight (firewall/WAF)
 *   ETIMEDOUT / UND_ERR_CONNECT_TIMEOUT → packets black-holed (egress block)
 *   CERT_*       → TLS certificate problem
 */
function describeFetchCause(err: unknown, depth = 0): string {
  if (!err || depth > 3) return ''
  const e = err as { code?: string; message?: string; cause?: unknown }
  const code = typeof e.code === 'string' ? e.code : ''
  const message = typeof e.message === 'string' ? e.message : ''
  const deeper = describeFetchCause(e.cause, depth + 1)
  const here = [code, message].filter(Boolean).join(' ')
  if (here && deeper && !deeper.includes(here)) return `${here} ← ${deeper}`
  return here || deeper
}

/** Human-actionable hint for the most common fetch-cause codes. */
function networkHint(causeText: string): string {
  if (/ENOTFOUND/i.test(causeText)) {
    return 'hostname does not resolve — verify the base URL points at the public API host'
  }
  if (/ECONNREFUSED/i.test(causeText)) {
    return 'connection refused — nothing is listening at the target host/port'
  }
  if (/ECONNRESET|ECONNABORTED|UND_ERR_SOCKET/i.test(causeText)) {
    return 'connection reset — a firewall/WAF likely cut the connection'
  }
  if (/ETIMEDOUT|CONNECT_TIMEOUT|UND_ERR_CONNECT/i.test(causeText)) {
    return 'connect timed out — the egress network may be blocking the host'
  }
  if (/CERT/i.test(causeText)) {
    return 'TLS certificate error — check proxy/SSL interception'
  }
  return 'check network egress and the configured base URL'
}

/** Provider returned a payload we could not parse. */
export class MalformedResponseError extends AiBaseError {
  constructor(provider: ProviderId, detail: string) {
    super(
      `${provider} returned a malformed response: ${detail}.`,
      'MALFORMED_RESPONSE',
      provider,
      true
    )
  }
}

/** JSON response could not be parsed. */
export class JsonParseFailedError extends AiBaseError {
  constructor(provider: ProviderId, detail: string, public readonly rawContent: string) {
    super(
      `Failed to parse ${provider} JSON response: ${detail}.`,
      'JSON_PARSE_FAILED',
      provider,
      true
    )
  }
}

/** Structured output failed schema validation. */
export class SchemaValidationError extends AiBaseError {
  constructor(provider: ProviderId, detail: string) {
    super(
      `${provider} response failed schema validation: ${detail}.`,
      'SCHEMA_VALIDATION_FAILED',
      provider,
      true
    )
  }
}

/** Every provider in the fallback chain failed. */
export class AllProvidersFailedError extends AiBaseError {
  public readonly attempts: Array<{ provider: ProviderId; code: AiErrorCode; message: string }>

  constructor(
    attempts: Array<{ provider: ProviderId; code: AiErrorCode; message: string }>
  ) {
    // Surface EVERY attempt's detail (HTTP status + provider message) so the
    // error is actionable from the UI alone. Consecutive duplicates (same
    // provider+code, e.g. retry rounds) collapse into one "×N" entry.
    const parts: string[] = []
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i]
      let count = 1
      while (
        i + count < attempts.length &&
        attempts[i + count].provider === a.provider &&
        attempts[i + count].code === a.code
      ) {
        count++
      }
      i += count - 1
      const label = count > 1 ? `${a.provider}:${a.code} ×${count}` : `${a.provider}:${a.code}`
      const detail = a.message ? ` — ${a.message.slice(0, 200)}` : ''
      parts.push(`${label}${detail}`)
    }
    super(
      `All AI providers failed (${parts.join(' | ')}).`,
      'ALL_PROVIDERS_FAILED',
      'ROUTER',
      false
    )
    this.attempts = attempts
  }
}

/** Provider unavailable (5xx) — retryable. */
export class ProviderUnavailableError extends AiBaseError {
  constructor(provider: ProviderId, statusCode: number, detail?: string) {
    super(
      `${provider} unavailable (HTTP ${statusCode})${detail ? `: ${detail}` : ''}.`,
      'PROVIDER_UNAVAILABLE',
      provider,
      true,
      statusCode
    )
  }
}

/** Content filtered by provider safety systems. */
export class ContentFilteredError extends AiBaseError {
  constructor(provider: ProviderId, detail?: string) {
    super(
      `${provider} filtered the request or response${detail ? `: ${detail}` : ''}.`,
      'CONTENT_FILTERED',
      provider,
      false
    )
  }
}

/**
 * Bad server-side configuration (malformed base URL, invalid env shape).
 * NOT retryable. A different provider may still serve the request — but a
 * misconfiguration never masquerades as a provider outage.
 */
export class ConfigurationError extends AiBaseError {
  constructor(provider: ProviderId, detail: string) {
    super(
      `${provider} is misconfigured: ${detail}.`,
      'CONFIGURATION_ERROR',
      provider,
      false
    )
  }
}

/** Context window exceeded — NOT retryable with the same payload. */
export class ContextTooLongError extends AiBaseError {
  constructor(provider: ProviderId, detail?: string) {
    super(
      `${provider} context window exceeded${detail ? `: ${detail}` : ''}.`,
      'CONTEXT_TOO_LONG',
      provider,
      false
    )
  }
}

/**
 * Normalize any thrown value into an AiBaseError.
 * Unknown errors become retryable UNKNOWN errors (safe default for transient
 * infrastructure blips), except obvious non-retryable HTTP statuses.
 */
export function normalizeAiError(provider: ProviderId, err: unknown): AiBaseError {
  if (err instanceof AiBaseError) return err
  if (err instanceof Error) {
    // fetch() throws TypeError on network failure
    if (err.name === 'TypeError' || err.message.includes('fetch failed')) {
      const causeText = describeFetchCause(err)
      const detail = causeText
        ? `${err.message} (${causeText} — ${networkHint(causeText)})`
        : `${err.message} — ${networkHint('')}`
      return new NetworkError(provider, detail, err)
    }
    // AbortError = our timeout
    if (err.name === 'AbortError') {
      return new TimeoutError(provider, 0)
    }
    return new AiBaseError(err.message, 'UNKNOWN', provider, true, undefined, err)
  }
  return new AiBaseError(String(err), 'UNKNOWN', provider, true, undefined, err)
}

/**
 * Map an HTTP status code to the right error class.
 */
export function errorFromHttpStatus(
  provider: ProviderId,
  status: number,
  body: string
): AiBaseError {
  switch (status) {
    case 401:
    case 403:
      return new AuthFailedError(provider, status, body.slice(0, 200))
    case 402:
      return new QuotaExceededError(provider, body.slice(0, 200))
    case 429:
      return new RateLimitedError(provider)
    case 404:
      return new AiBaseError(
        `${provider} model not found: ${body.slice(0, 200)}`,
        'MODEL_NOT_FOUND',
        provider,
        false,
        status
      )
    case 413:
    case 400:
      // An invalid API key arrives as 400 INVALID_ARGUMENT from Google —
      // classify it as an AUTH problem, never INVALID_REQUEST/UNAVAILABLE.
      if (/api[_ ]?key|api_key_invalid|unregistered/i.test(body)) {
        return new AuthFailedError(provider, status, body.slice(0, 200))
      }
      // 400 is usually a bad request, but Gemini returns it for token limits too.
      if (/token|context|length/i.test(body)) {
        return new ContextTooLongError(provider, body.slice(0, 200))
      }
      return new AiBaseError(
        `${provider} rejected the request: ${body.slice(0, 200)}`,
        'INVALID_REQUEST',
        provider,
        false,
        status
      )
    default:
      if (status >= 500) {
        return new ProviderUnavailableError(provider, status, body.slice(0, 200))
      }
      return new AiBaseError(
        `${provider} returned HTTP ${status}: ${body.slice(0, 200)}`,
        'UNKNOWN',
        provider,
        true,
        status
      )
  }
}

/**
 * Map any thrown AI error to a USER-SAFE message (AI-repair spec §16):
 * never exposes provider ids, error codes, model ids, or response bodies.
 * Full diagnostics stay in server logs and in the error object (`attempts`)
 * for developers/admins.
 */
export function userSafeAiMessage(err: unknown): string {
  if (err instanceof AllProvidersFailedError) {
    // Deterministic configuration gap: every attempt was skipped or rejected
    // for a MISSING credential. Retrying can never succeed — tell the
    // operator what to fix instead of asking them to "try again".
    const attemptCodes = err.attempts.map((a) => a.code)
    const nothingConfigured =
      attemptCodes.length > 0 &&
      attemptCodes.every(
        (c) => c === 'PROVIDER_UNCONFIGURED' || c === 'API_KEY_MISSING'
      )
    if (nothingConfigured) {
      return 'Document generation is not configured on this deployment — no AI provider key was found by the generator. Add an AI key (OPENAI_API_KEY or GEMINI_API_KEY) to the server environment and retry.'
    }
    return 'We could not generate your document right now. Please try again in a moment.'
  }
  if (err instanceof AiBaseError) {
    switch (err.code) {
      case 'RATE_LIMITED':
      case 'TIMEOUT':
      case 'NETWORK_ERROR':
      case 'PROVIDER_UNAVAILABLE':
        return 'The AI service is busy right now. Please try again in a moment.'
      case 'QUOTA_EXCEEDED':
        return 'The AI service has reached its usage limit. Please try again later.'
      case 'AUTH_FAILED':
      case 'API_KEY_MISSING':
      case 'PROVIDER_UNCONFIGURED':
      case 'CONFIGURATION_ERROR':
        return 'The AI service is temporarily unavailable due to a configuration issue. Please contact support.'
      case 'CONTENT_FILTERED':
        return 'Your request was blocked by the AI safety system. Please adjust the content and try again.'
      case 'CONTEXT_TOO_LONG':
        return 'Your request is too large for the AI service. Try a shorter prompt or fewer sections.'
      default:
        return 'Something went wrong while generating. Please try again.'
    }
  }
  return 'Something went wrong while generating. Please try again.'
}
