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
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'CONTEXT_TOO_LONG'
  | 'CONTENT_FILTERED'
  | 'MODEL_NOT_FOUND'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
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
    super(
      `All AI providers failed (${attempts.map((a) => `${a.provider}:${a.code}`).join(', ')}).`,
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
      return new NetworkError(provider, err.message, err)
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
