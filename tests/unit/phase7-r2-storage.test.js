// Phase 7 — Cloudflare R2 storage failure contract ("File storage
// temporarily unavailable").
//
// Pins the contract that keeps storage failures honest and recoverable:
//   §1  One error classifier (src/lib/r2/errors.ts) maps every S3/R2 SDK
//       failure: InvalidAccessKeyId/SignatureDoesNotMatch/AccessDenied → AUTH
//       (not retryable), CredentialProviderError → NOT_CONFIGURED,
//       NoSuchKey/NotFound → NOT_FOUND, 5xx/SlowDown/InternalError → SERVICE
//       (retryable), NetworkingError/ETIMEDOUT → NETWORK (retryable).
//   §2  USER CONTRACT: R2 failure → HTTP 503 → "File storage temporarily
//       unavailable" (code FILE_STORAGE_UNAVAILABLE) — never a raw SDK error.
//   §3  The render route (97% "Creating your file") catches R2 upload
//       failures, RELEASES the render claim, and returns 503 so the worker's
//       renderRetry chain + browser fallback keep retrying. Previously the
//       S3 error escaped as a generic 500, the claim stayed held, and jobs
//       hung at 97% with no visible cause.
//   §4  /api/files POST: only a genuinely unconfigured runtime falls back to
//       base64 (dev mode); a configured-but-failing R2 answers 503 instead
//       of a fake-success base64 body that hides quota/permission breakage.
//   §5  The brittle `error.message.includes('credentials')` checks are gone
//       from signed-url and download routes (they missed wrong-credential
//       errors, which leaked as 500s, and the download route mis-classified
//       bad credentials as 404 "File not found").
//   §6  fileExistsInR2 uses HeadObject (metadata-only) — never downloads the
//       object body — and answers "false" ONLY for genuine 404s, rethrowing
//       everything else.
//   §7  Admin diagnostics: GET/POST /api/admin/r2/status exists, is
//       admin-guarded, live-probes the bucket with ListObjectsV2(maxKeys=1),
//       reports S3 error NAMES (never values) and never returns credentials.
//   §8  .env.example documents the truth: R2_* run on the NEXT.JS runtime
//       (not Convex), token policy = Object Read & Write scoped to the
//       bucket, bucket stays PRIVATE, CORS policy for browser presigned
//       uploads.
//   §9  R2 credentials never reach the browser (no NEXT_PUBLIC_R2 anywhere).
//   §10 R2 4xx request rejections (NotImplemented/InvalidArgument/…) classify
//       as non-retryable SERVICE, the S3Client is pinned to R2 compat config
//       (WHEN_REQUIRED checksums + path-style), and the render 503 body
//       carries s3ErrorName + detail so failures self-diagnose from the
//       browser Network tab alone.
//   §11 Malformed credential FORMAT (R2 "Credential access key has length N,
//       should be 32") → non-retryable AUTH with the 32-char hint; generic
//       4xx details quote R2's message scrubbed of credentials; the client
//       warns at boot when R2_ACCESS_KEY_ID length ≠ 32.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..')

const read = (...p) => readFileSync(resolve(REPO_ROOT, ...p), 'utf8')

const errors = read('src', 'lib', 'r2', 'errors.ts')
const client = read('src', 'lib', 'r2', 'client.ts')
const renderRoute = read('src', 'app', 'api', 'generation', 'render', 'route.ts')
const filesRoute = read('src', 'app', 'api', 'files', 'route.ts')
const signedUrlRoute = read('src', 'app', 'api', 'files', 'signed-url', 'route.ts')
const downloadRoute = read('src', 'app', 'api', 'files', '[fileId]', 'download', 'route.ts')
const adminR2Route = read('src', 'app', 'api', 'admin', 'r2', 'status', 'route.ts')
const envExample = read('.env.example')

// ---------------------------------------------------------------------------
// §1 — error classification
// ---------------------------------------------------------------------------

test('§1 classifier defines the six R2 error kinds', () => {
  for (const kind of [
    'NOT_CONFIGURED',
    'AUTH',
    'NOT_FOUND',
    'SERVICE',
    'NETWORK',
    'UNKNOWN',
  ]) {
    assert.ok(errors.includes(`'${kind}'`), `kind ${kind} must exist in the union`)
  }
})

test('§1 wrong credentials map to AUTH (never UNKNOWN/500)', () => {
  for (const name of ['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'AccessDenied']) {
    assert.ok(errors.includes(name), `classifier must recognize ${name}`)
  }
  assert.match(errors, /status === 401[\s\S]{0,40}\|\|[\s\S]{0,40}status === 403/)
})

test('§1 missing credentials map to NOT_CONFIGURED and are not retryable', () => {
  assert.match(errors, /CredentialProviderError/)
  assert.match(
    errors,
    /kind: 'NOT_CONFIGURED',\s*\n\s*retryable: false/,
    'NOT_CONFIGURED must be non-retryable'
  )
})

test('§1 NoSuchKey/NotFound → NOT_FOUND (excluded from 503 semantics)', () => {
  assert.match(errors, /name === 'NoSuchKey' \|\| name === 'NotFound'/)
})

test('§1 5xx / SlowDown / InternalError → SERVICE (retryable)', () => {
  assert.match(errors, /slowdown|internalerror|serviceunavailable/i)
  assert.match(
    errors,
    /kind: 'SERVICE',\s*\n\s*retryable: true/,
    'SERVICE must be retryable'
  )
})

test('§1 NetworkingError / timeouts → NETWORK (retryable)', () => {
  assert.match(errors, /NetworkingError|ETIMEDOUT|ECONNREFUSED/i)
  assert.match(errors, /kind: 'NETWORK',\s*\n\s*retryable: true/)
})

test('§1 user contract message constant exists verbatim', () => {
  assert.match(
    errors,
    /export const R2_STORAGE_UNAVAILABLE_MESSAGE = 'File storage temporarily unavailable'/
  )
})

// ---------------------------------------------------------------------------
// §2/§3 — render route (the 97% "Creating your file" fix)
// ---------------------------------------------------------------------------

test('§2 render route returns 503 FILE_STORAGE_UNAVAILABLE with the contract message', () => {
  assert.match(renderRoute, /R2_STORAGE_UNAVAILABLE_MESSAGE/)
  assert.match(renderRoute, /FILE_STORAGE_UNAVAILABLE/)
  assert.match(renderRoute, /status: 503/)
})

test('§3 render route wraps uploadToR2 and releases the claim on failure', () => {
  assert.match(
    renderRoute,
    /try \{\s*\n\s*await uploadToR2\(/,
    'uploadToR2 must be inside try/catch'
  )
  assert.match(
    renderRoute,
    /catch \(r2Error\) \{[\s\S]*?releaseRenderClaim[\s\S]*?status: 503/,
    'the R2 catch block must release the render claim and answer 503'
  )
})

test('§3 render route classifies and logs the failure kind before responding', () => {
  assert.match(renderRoute, /classifyR2Error\(r2Error\)/)
  assert.match(renderRoute, /\[GENERATION-RENDER\] R2 upload failed/)
})

test('§3a render route 500s are diagnosable (precise message, not generic)', () => {
  const outerCatch = renderRoute.match(/\} catch \(error\) \{[\s\S]*?INTERNAL_ERROR[\s\S]*?\n  \}/)?.[0] || ''
  assert.ok(outerCatch, 'outer catch block must exist')
  assert.match(outerCatch, /Render failed: \$\{msg\.slice\(0, 300\)\}/, 'outer 500 must surface the precise reason')
  assert.doesNotMatch(outerCatch, /error: 'Internal server error'/, 'generic hidden 500 message must be gone')
})

test('§3b COMPLETE_FAILED releases the render claim before returning', () => {
  const block = renderRoute.match(/if \(!done\.success\) \{[\s\S]*?COMPLETE_FAILED[\s\S]*?\n    \}/)?.[0] || ''
  assert.ok(block, 'COMPLETE_FAILED block must exist')
  assert.match(block, /releaseRenderClaim/, 'complete-failure must release the claim so retries are not IN_FLIGHT-bounced')
})

test('§3c PDF renderer rejects on pdfkit errors and cannot hang forever', () => {
  const pdf = read('src', 'services', 'document-renderer.ts')
  const pdfRender = pdf.match(/class PdfRenderer[\s\S]*?async render\([\s\S]*?\n  \}/)?.[0] || ''
  assert.match(pdfRender, /doc\.on\('error', fail\)/, 'pdfkit stream errors must reject the render promise')
  assert.match(pdfRender, /timed out after 120s/, 'PDF render must be bounded by a timeout')
  assert.match(pdfRender, /return done/, 'render must await the guarded promise')
})

// ---------------------------------------------------------------------------
// §4 — files upload route
// ---------------------------------------------------------------------------

test('§4 files route keeps base64 fallback ONLY for unconfigured runtime', () => {
  assert.match(
    filesRoute,
    /info\.kind === 'NOT_CONFIGURED' && !isR2Configured\(\)/,
    'fallback must be gated on both the classifier AND the env check'
  )
  assert.match(filesRoute, /storageType: 'fallback'/)
})

test('§4 configured-but-failing R2 answers 503 instead of fake-success base64', () => {
  assert.match(
    filesRoute,
    /code: 'FILE_STORAGE_UNAVAILABLE',\s*\n\s*kind: info\.kind,[\s\S]*?\{ status: 503 \}/
  )
})

// ---------------------------------------------------------------------------
// §5 — signed-url + download routes
// ---------------------------------------------------------------------------

test('§5 brittle includes(credentials) checks are gone', () => {
  for (const [name, src] of [
    ['signed-url', signedUrlRoute],
    ['download', downloadRoute],
  ]) {
    assert.doesNotMatch(
      src,
      /includes\('credentials'\)/,
      `${name} route must use the classifier, not string sniffing`
    )
    assert.match(src, /classifyR2Error\(/, `${name} route must classify R2 errors`)
    assert.match(src, /status: 503/, `${name} route must answer 503 on storage failures`)
  }
})

test('§5 download route surfaces storage failure from the existence check', () => {
  assert.match(
    downloadRoute,
    /R2 existence check failed[\s\S]*?FILE_STORAGE_UNAVAILABLE/,
    'existence-check failures must return the 503 contract, not 404'
  )
})

// ---------------------------------------------------------------------------
// §6 — R2 client
// ---------------------------------------------------------------------------

test('§6 fileExistsInR2 uses HeadObject (no full-body downloads)', () => {
  assert.match(client, /HeadObjectCommand/)
  const existsFn = client.match(/export async function fileExistsInR2[\s\S]*?\n\}/)?.[0] || ''
  assert.ok(existsFn.includes('HeadObjectCommand'), 'existence check must use HeadObject')
  assert.ok(!existsFn.includes('GetObjectCommand'), 'existence check must NOT use GetObject')
})

test('§6 only genuine 404s mean "absent"; all other errors rethrow', () => {
  const existsFn = client.match(/export async function fileExistsInR2[\s\S]*?\n\}/)?.[0] || ''
  assert.match(existsFn, /NoSuchKey|NotFound|status === 404/)
  assert.match(existsFn, /throw error/, 'non-404 failures must rethrow')
})

// ---------------------------------------------------------------------------
// §7 — admin diagnostics
// ---------------------------------------------------------------------------

test('§7 admin R2 status route exists and is admin-guarded', () => {
  assert.match(adminR2Route, /requireAdminAccess\(request\)/)
  assert.match(adminR2Route, /if \(!admin\.ok\) return admin\.response/)
})

test('§7 live probe uses ListObjectsV2 with MaxKeys 1', () => {
  assert.match(adminR2Route, /ListObjectsV2Command/)
  assert.match(adminR2Route, /MaxKeys: 1/)
})

test('§7 diagnostics never expose credential values', () => {
  assert.match(
    adminR2Route,
    /R2_SECRET_ACCESS_KEY: process\.env\.R2_SECRET_ACCESS_KEY \? "set" : "MISSING"/,
    'secret presence is reported as set/MISSING, never its value'
  )
  assert.doesNotMatch(
    adminR2Route,
    /secretAccessKey: "?\$\{|`.*\$\{process\.env\.R2_SECRET_ACCESS_KEY\}.*`/,
    'no template interpolation of the secret into responses'
  )
  assert.match(adminR2Route, /s3ErrorName/, 'probe reports S3 error NAMES')
})

// ---------------------------------------------------------------------------
// §8 — .env.example documentation truth
// ---------------------------------------------------------------------------

test('§8 R2 matrix: Next.js runtime required, Convex not needed', () => {
  assert.match(
    envExample,
    /R2_ACCOUNT_ID \/ _ACCESS_KEY_ID \/ _SECRET_ACCESS_KEY \/ _BUCKET_NAME[\s\S]{0,200}✅[\s\S]{0,80}—[\s\S]{0,80}required \(files\+render\)/,
    'matrix row must mark Vercel ✅ and Convex — for R2_*'
  )
  assert.match(envExample, /Convex worker never calls R2 directly/)
  assert.doesNotMatch(envExample, /R2 object storage \(used by the Convex worker\)/, 'stale Convex-worker R2 claim must be gone')
})

test('§8 token policy + private bucket + CORS guidance documented', () => {
  assert.match(envExample, /Object Read & Write/)
  assert.match(envExample, /keep the bucket PRIVATE/)
  assert.match(envExample, /CORS/)
  assert.match(envExample, /api\/admin\/r2\/status/)
})

// ---------------------------------------------------------------------------
// §9 — no browser-side credentials
// ---------------------------------------------------------------------------

test('§9 no NEXT_PUBLIC_R2 variables anywhere', () => {
  const srcs = [errors, client, renderRoute, filesRoute, signedUrlRoute, downloadRoute, adminR2Route, envExample]
  for (const src of srcs) {
    assert.doesNotMatch(src, /NEXT_PUBLIC_R2/, 'R2 credentials must never be public')
  }
})

// ---------------------------------------------------------------------------
// §10 — R2 4xx request rejections + self-diagnosing 503 bodies
//       (the "kind: UNKNOWN" blind spot: a PutObject refused by R2 with
//       e.g. NotImplemented used to fall through to UNKNOWN with no detail)
// ---------------------------------------------------------------------------

test('§10 S3Client is pinned to the documented R2 compatibility config', () => {
  assert.match(client, /forcePathStyle:\s*true/, 'R2 requires path-style addressing')
  assert.match(
    client,
    /requestChecksumCalculation:\s*"WHEN_REQUIRED"/,
    'SDK v3.729+ default (WHEN_SUPPORTED) stamps CRC32 headers R2 rejects with NotImplemented'
  )
  assert.match(client, /responseChecksumValidation:\s*"WHEN_REQUIRED"/)
  assert.match(client, /region:\s*"auto"/)
})

test('§10 classifier recognizes 4xx request rejections as non-retryable SERVICE', () => {
  assert.match(errors, /notimplemented/, 'NotImplemented (checksum rejection) must be classified')
  for (const name of ['malformedxml', 'invalidargument', 'entitytolarge', 'permanentredirect']) {
    assert.ok(errors.includes(name), `4xx class ${name} must be recognized`)
  }
  assert.match(errors, /status >= 400 && status < 500/, 'generic 4xx catch-all must exist')
  assert.match(
    errors,
    /kind: 'SERVICE',\s*\n\s*retryable: false/,
    'request rejections are deterministic — not retryable'
  )
  assert.match(errors, /requestChecksumCalculation/, 'NotImplemented hint names the fix')
})

test('§10 UNKNOWN fallthrough detail carries the raw error name', () => {
  assert.match(
    errors,
    /\$\{name \|\| code \|\| 'Unknown error'\}/,
    'UNKNOWN detail must be name-prefixed so logs are actionable'
  )
})

test('§10 render route 503 body exposes s3ErrorName + detail (self-diagnosing)', () => {
  assert.match(renderRoute, /r2S3ErrorName/, 'render route must import the helper')
  assert.match(renderRoute, /s3ErrorName:\s*r2S3ErrorName\(r2Error\)/)
  assert.match(renderRoute, /detail:\s*info\.detail/)
  assert.match(errors, /export function r2S3ErrorName/, 'helper must be exported')
})

// ---------------------------------------------------------------------------
// §11 — malformed credential FORMAT (the "InvalidArgument" trap)
//       R2 answers HTTP 400 InvalidArgument "Credential access key has
//       length N, should be 32" BEFORE signature verification when the
//       Access Key ID is not a genuine 32-char R2 key (AWS key = 20 chars,
//       token JWT, Cloudflare API token, truncated/quoted paste).
// ---------------------------------------------------------------------------

test('§11 credential-format rejection classifies as AUTH with the 32-char hint', () => {
  assert.match(errors, /access key has length/, 'classifier must recognize the R2 credential-length message')
  assert.match(errors, /should be 32/)
  assert.match(
    errors,
    /kind: 'AUTH',\s*\n\s*retryable: false,\s*\n\s*detail:\s*\n?\s*'R2 rejected the credential format/,
    'must map to non-retryable AUTH with the precise fix'
  )
  assert.match(errors, /32-character Access Key ID/, 'hint must say what a valid key is')
})

test('§11 generic 4xx detail quotes the R2 message, scrubbed of secrets', () => {
  assert.match(errors, /scrubbedMessage/, 'message scrubber must exist')
  assert.match(
    errors,
    /scrubbedMessage\(message\)\.slice\(0, 140\)/,
    '4xx detail must embed the bounded R2 message'
  )
  assert.match(errors, /out\.split\(key\)\.join\('<redacted>'\)/, 'access key must be scrubbed')
  assert.match(errors, /out\.split\(secret\)\.join\('<redacted>'\)/, 'secret must be scrubbed')
})

test('§11 client warns at boot when R2_ACCESS_KEY_ID length is not 32', () => {
  assert.match(client, /ACCESS_KEY_ID\.length !== 32/, 'length check must exist')
  assert.match(client, /Access Key IDs are exactly 32 characters/, 'warning must explain the rule')
})
