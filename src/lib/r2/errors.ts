// =============================================================================
// FILO R2 Error Classification
// =============================================================================
// One classifier for every Cloudflare R2 (S3 API) failure so all four touch
// points (/api/files, /api/files/signed-url, /api/files/[fileId]/download,
// /api/generation/render) answer consistently:
//
//   R2 failure → HTTP 503 → "File storage temporarily unavailable"
//
// Previously each route had its own ad-hoc detection — the download route
// even mis-classified WRONG credentials as "file not found" (404), and the
// render route let S3 SDK errors crash straight through as a generic 500,
// leaving generation jobs stuck at 97% ("rendering").
//
// Error name reference (AWS SDK v3 ↔ R2 S3 API):
//   InvalidAccessKeyId            → the token's Access Key ID is wrong/deleted
//   SignatureDoesNotMatch         → wrong Secret Access Key
//   AuthorizationHeaderMalformed  → malformed auth header (e.g. bad endpoint)
//   AccessDenied                  → token lacks permission for the operation
//                                   (e.g. "Object Read only" token uploading)
//   CredentialProviderError       → SDK could not build credentials at all
//                                   (env vars missing/empty)
//   NoSuchBucket                  → R2_BUCKET_NAME does not match a bucket
//   NetworkingError / ENOTFOUND   → network/DNS failure
//   NotImplemented / InvalidArgument /
//   MalformedXML / 4xx (other)    → R2 refused the request itself
//                                   (e.g. SDK default checksum headers)
//   InternalError / SlowDown /
//   ServiceUnavailable            → Cloudflare-side transient failure
// =============================================================================

// The user-safe message shown for every 503 returned by R2-backed routes.
// Kept as a single constant so tests and the UI stay in sync.
export const R2_STORAGE_UNAVAILABLE_MESSAGE = 'File storage temporarily unavailable'

export type R2ErrorKind =
  | 'NOT_CONFIGURED'   // R2_* env vars missing on this runtime
  | 'AUTH'             // wrong key / wrong secret / insufficient token perms
  | 'NOT_FOUND'        // object genuinely absent (NoSuchKey / NotFound / 404)
  | 'SERVICE'          // transient Cloudflare-side failure (5xx, SlowDown)
  | 'NETWORK'          // DNS / connection / timeout failures
  | 'UNKNOWN'

export interface R2ErrorInfo {
  kind: R2ErrorKind
  /** Whether a retry of the same operation can plausibly succeed. */
  retryable: boolean
  /** Single-line developer diagnostic (never includes secrets). */
  detail: string
}

/** True when the R2_* environment variables are present on this runtime. */
export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
  )
}

interface AwsLikeError {
  name?: string
  code?: string
  message?: string
  $metadata?: { httpStatusCode?: number }
  ['toString']?: () => string
}

function errText(error: unknown): { name: string; code: string; message: string; status?: number } {
  const e = (error ?? {}) as AwsLikeError
  const name = String(e.name || '')
  const code = String(e.code || '')
  const message = String(e.message || '')
  const status = e.$metadata?.httpStatusCode
  return { name, code, message, status }
}

/**
 * Map any thrown value from an S3/R2 SDK call into a stable R2ErrorInfo.
 * Never throws. Never includes credential values in the detail string.
 */
export function classifyR2Error(error: unknown): R2ErrorInfo {
  const { name, code, message, status } = errText(error)
  const haystack = `${name} ${code} ${message}`.toLowerCase()

  // ---- 1. Runtime misconfiguration (env vars missing/empty) ---------------
  // The SDK raises CredentialProviderError, or our client was built with
  // empty strings and signing fails with "Credentials"/"endpoint" text.
  if (
    /credentialprovidererror|credentials.*(not|missing|unset|empty|undefined)|no credentials|unable to resolve credentials/.test(
      haystack
    )
  ) {
    return {
      kind: 'NOT_CONFIGURED',
      retryable: false,
      detail: 'R2 credentials are not set on this runtime (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)',
    }
  }

  // ---- 2. Auth / permission failures (deterministic — retrying won't fix) --
  if (
    /invalidaccesskeyid|signaturedoesnotmatch|authorizationheadermalformed|accessdenied|invalidsecurity|not authorized|invalid token/.test(
      haystack
    ) ||
    status === 401 ||
    status === 403
  ) {
    return {
      kind: 'AUTH',
      retryable: false,
      detail: `R2 rejected the credentials (${name || code || `HTTP ${status ?? '?'}`}) — check the API token's Access Key, Secret, and "Object Read & Write" scope`,
    }
  }

  // ---- 3. Object genuinely missing -----------------------------------------
  // HeadObject answers "NotFound" (404, no body); GetObject answers NoSuchKey.
  if (name === 'NoSuchKey' || name === 'NotFound' || /nosuchkey|^notfound$|status code: 404\b/.test(haystack)) {
    return {
      kind: 'NOT_FOUND',
      retryable: false,
      detail: 'Object does not exist in the bucket',
    }
  }

  // ---- 4. Bucket / service-side transient failures --------------------------
  if (
    /nosuchbucket|internalerror|slowdown|serviceunavailable|internal server error|bad gateway|gateway timeout/.test(
      haystack
    ) ||
    (typeof status === 'number' && status >= 500)
  ) {
    return {
      kind: 'SERVICE',
      retryable: true,
      detail: `R2 service failure (${name || code || `HTTP ${status ?? '?'}`})`,
    }
  }

  // ---- 5. Network-level failures --------------------------------------------
  if (
    /networkingerror|enotfound|econnrefused|econnreset|etimedout|timeout|aborted|socket|dns|fetch failed|endpoint.*unreachable/.test(
      haystack
    )
  ) {
    return {
      kind: 'NETWORK',
      retryable: true,
      detail: `Could not reach the R2 endpoint (${message.slice(0, 160) || name || code})`,
    }
  }

  // ---- 5b. Request-level rejections (R2 answered HTTP 4xx) ----------------
  // The request REACHED R2 and was refused: NotImplemented (R2 rejecting the
  // SDK's default flexible-checksum headers — fixed by the S3Client pins in
  // client.ts), InvalidArgument, MalformedXML, EntityTooLarge, redirects
  // (wrong endpoint / account-id). Retrying the identical request cannot
  // succeed, so these are non-retryable SERVICE failures (still 503).
  if (
    /notimplemented|malformedxml|invalidargument|invalidbucketname|entitytolarge|keytoolong|metadatatoolarge|permanentredirect|temporaryredirect|xmlparser|illegallocationconstraint/.test(
      haystack
    ) ||
    (typeof status === 'number' && status >= 400 && status < 500)
  ) {
    const hint =
      /notimplemented/.test(haystack)
        ? ' — R2 refused a request feature enabled by default in AWS SDK v3 (flexible checksums); the S3Client must set requestChecksumCalculation: "WHEN_REQUIRED"'
        : ''
    return {
      kind: 'SERVICE',
      retryable: false,
      detail: `R2 rejected the request (${name || code || `HTTP ${status ?? '?'}`})${hint}`,
    }
  }

  // ---- 6. Everything else ----------------------------------------------------
  return {
    kind: 'UNKNOWN',
    retryable: true,
    detail: `${name || code || 'Unknown error'}: ${message.slice(0, 180) || 'no message (check the S3 client configuration)'}`,
  }
}

/**
 * Best-effort extraction of the raw S3 error NAME (e.g. "NotImplemented",
 * "InvalidAccessKeyId") for diagnostic response bodies. Never throws, never
 * returns credential values.
 */
export function r2S3ErrorName(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const name = (error as AwsLikeError).name
  return typeof name === 'string' && name.length > 0 ? name.slice(0, 60) : undefined
}

/**
 * True when the error is one of the classes that must surface to clients as
 * HTTP 503 "File storage temporarily unavailable" (misconfiguration, bad
 * credentials, transient service/network failures). NOT_FOUND is excluded —
 * callers translate that into their own 404 semantics.
 */
export function isR2ServiceFailure(error: unknown): boolean {
  const { kind } = classifyR2Error(error)
  return (
    kind === 'NOT_CONFIGURED' || kind === 'AUTH' || kind === 'SERVICE' || kind === 'NETWORK'
  )
}
