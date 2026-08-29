// Phase 9 — PRODUCTION-INCIDENT REGRESSIONS (2026-08-29 outage).
//
// Symptom in production:
//   • Every artifact job with a non-ASCII (CJK) title stalled at 97% forever.
//   • Worker log: render endpoint 503 FILE_STORAGE_UNAVAILABLE, retried every
//     ~10-60s, same failure, forever.
//   • Root cause body: "TypeError: Invalid character in header content
//     [\"x-amz-meta-originalname\"]" — the artifact FILENAME (derived from the
//     document title) was placed into S3 object metadata, which is transmitted
//     as x-amz-meta-* HTTP headers. Node's HTTP client rejects header values
//     outside latin1, so CJK/emoji titles crashed the upload DETERMINISTICALLY.
//   • The classifier bucketed that TypeError as UNKNOWN/retryable → the worker
//     retried an unfixed error forever (stall), instead of failing honestly.
//   • Secondary failure: "Failed to parse AI planning response" killed jobs
//     whose LLM output was prose-wrapped / fenced / truncated JSON.
//
// These tests reproduce the EXACT failure with REAL bytes through the REAL
// AWS SDK v3 client against a REAL local HTTP server (which exercises Node's
// actual header serializer — no mocks of the failing layer), and pin the fix:
//   §S1 non-ASCII metadata must be sanitized (upload succeeds, header latin1-safe)
//   §S2 header-serialization TypeErrors are NON-retryable
//   §S3 the full production sequence (render → filename → metadata upload) works for CJK
//   §P1 extractJsonObject survives prose/fence/truncation/repair cases
//   §P2 the worker honors the endpoint's retryable:false contract (source pin)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import { loadEngine } from './helpers/ts-build.js'

const require = createRequire(import.meta.url)

// ---- Local S3-compatible endpoint: records received request headers --------
const received = []
const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    received.push({
      method: req.method,
      url: req.url,
      headers: { ...req.headers },
      bodyLength: Buffer.concat(chunks).length,
    })
    if (req.method === 'PUT') {
      res.writeHead(200, { etag: '"d41d8cd98f00b204e9800998ecf8427e"' })
      res.end()
    } else {
      res.writeHead(200, { 'content-type': 'application/xml' })
      res.end('<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult/>')
    }
  })
})

// ---- R2 env BEFORE the client module is loaded (module reads env at import) --
const CJK_NAME = '2026年第三季度业务分析报告_2026.pptx'

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  process.env.R2_ENDPOINT = `http://127.0.0.1:${port}`
  process.env.R2_ACCOUNT_ID = 'verify-account'
  process.env.R2_ACCESS_KEY_ID = 'A'.repeat(32)
  process.env.R2_SECRET_ACCESS_KEY = 's'.repeat(40)
  process.env.R2_BUCKET_NAME = 'verify-bucket'
})

after(() => {
  server.close()
})

function loadClient() {
  return loadEngine('@/lib/r2/client')
}
function loadErrors() {
  return loadEngine('@/lib/r2/errors')
}
function loadPlanning() {
  return loadEngine('@/services/artifact-planning')
}

// ---------------------------------------------------------------------------
// §S1 — THE EXACT PRODUCTION FAILURE: non-ASCII metadata in x-amz-meta-*
// ---------------------------------------------------------------------------
test('§S1a reproduces the incident: raw CJK metadata crashes the real HTTP stack', async () => {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  })
  const command = new PutObjectCommand({
    Bucket: 'verify-bucket',
    Key: 'raw/unsafe.bin',
    Body: Buffer.from('x'),
    ContentType: 'application/octet-stream',
    Metadata: { originalName: CJK_NAME }, // exactly what the old code did
  })
  await assert.rejects(
    () => client.send(command),
    (err) => {
      const msg = `${err?.name ?? ''}: ${err?.message ?? ''}`
      assert.match(msg, /Invalid character in header content/)
      assert.match(msg, /x-amz-meta-originalname/)
      return true
    },
    'expected Node to reject the CJK metadata header (the production root cause)'
  )
})

test('§S1b fixed uploadToR2 succeeds with CJK metadata and sends a latin1-safe header', async () => {
  const { uploadToR2 } = loadClient()
  const body = Buffer.alloc(2048, 7)
  await uploadToR2('users/u1/artifacts/a1/v1/file.pptx', body, 'application/vnd.testing', {
    originalName: CJK_NAME,
    size: String(body.length),
    uploadedAt: new Date().toISOString(),
    category: 'artifact',
  })
  const put = received.find((r) => r.url.includes('/file.pptx'))
  assert.ok(put, 'PUT reached the endpoint')
  const headerName = Object.keys(put.headers).find((h) => h === 'x-amz-meta-originalname')
  assert.ok(headerName, 'metadata header present')
  const sentValue = put.headers[headerName]
  // The header Node actually transmitted must be pure printable ASCII.
  assert.match(sentValue, /^[\x20-\x7e]+$/, 'transmitted header must be latin1-safe')
  // And it must round-trip back to the exact original filename.
  assert.equal(decodeURIComponent(sentValue), CJK_NAME)
  assert.equal(put.bodyLength, body.length, 'object bytes unchanged by metadata sanitization')
})

test('§S1c sanitizer folds control characters (no header injection)', async () => {
  const { uploadToR2 } = loadClient()
  received.length = 0
  await uploadToR2('inject/probe.bin', Buffer.from('y'), 'application/octet-stream', {
    originalName: 'safe\r\nX-Injected: yes\u0007name',
  })
  const put = received.find((r) => r.url.includes('probe.bin'))
  const value = put.headers['x-amz-meta-originalname']
  assert.doesNotMatch(value, /[\r\n\u0007]/, 'control characters must be folded away')
  assert.match(value, /^[\x20-\x7e]+$/)
})

// ---------------------------------------------------------------------------
// §S2 — CLASSIFIER: the incident error must be NON-retryable
// ---------------------------------------------------------------------------
test('§S2a "Invalid character in header content" is deterministic → retryable:false', () => {
  const { classifyR2Error } = loadErrors()
  const productionError = new TypeError(
    'Invalid character in header content ["x-amz-meta-originalname"]'
  )
  const info = classifyR2Error(productionError)
  assert.equal(info.retryable, false, 'retrying an unserializable request can never succeed')
  assert.match(info.detail, /non-retryable/)
})

test('§S2b transient failures stay retryable (no over-correction)', () => {
  const { classifyR2Error } = loadErrors()
  // Node's genuine network error is a TypeError TOO — must remain retryable.
  const fetchFailed = classifyR2Error(new TypeError('fetch failed'))
  assert.equal(fetchFailed.kind, 'NETWORK')
  assert.equal(fetchFailed.retryable, true)
  const svc = classifyR2Error(Object.assign(new Error('ServiceUnavailable'), { name: 'ServiceUnavailable' }))
  assert.equal(svc.kind, 'SERVICE')
  assert.equal(svc.retryable, true)
})

test('§S2c auth/config failures remain non-retryable AUTH', () => {
  const { classifyR2Error } = loadErrors()
  const auth = classifyR2Error(Object.assign(new Error('The AWS Access Key Id you provided does not exist'), { name: 'InvalidAccessKeyId' }))
  assert.equal(auth.kind, 'AUTH')
  assert.equal(auth.retryable, false)
})

// ---------------------------------------------------------------------------
// §S3 — FULL PRODUCTION SEQUENCE with a CJK title:
// render → buildArtifactFilename → R2 key → uploadToR2
// ---------------------------------------------------------------------------
test('§S3 the complete pipeline sequence survives a fully Chinese document', async () => {
  const { buildArtifactFilename } = loadEngine('@/services/renderers/shared')
  const { uploadToR2 } = loadClient()

  const title = '2026年第三季度业务分析报告'
  const filename = buildArtifactFilename(title, 'PPTX')
  assert.match(filename, /\.pptx$/)
  assert.ok(filename.includes('2026'), 'filename keeps the readable year')

  // Object keys are sanitized to ASCII by the render route (artifactR2Key);
  // metadata keeps the human-readable name — now header-safe.
  const r2Key = `users/u1/artifacts/art1/v1/${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  assert.match(r2Key, /^[\x20-\x7e]+$/, 'object key ASCII-safe')

  received.length = 0
  const bytes = Buffer.alloc(4096, 1)
  await uploadToR2(r2Key, bytes, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', {
    originalName: filename,
    size: String(bytes.length),
  })
  const put = received.find((r) => r.url.includes('/art1/'))
  assert.ok(put, 'PUT reached the endpoint')
  assert.equal(decodeURIComponent(put.headers['x-amz-meta-originalname']), filename)
})

// ---------------------------------------------------------------------------
// §P1 — AI PLANNING JSON EXTRACTION (second production killer)
// ---------------------------------------------------------------------------
const SAMPLE_PLAN = JSON.stringify({
  title: 'Quarterly Business Review',
  sections: [{ id: 's1', type: 'cover', title: 'Cover', order: 0, components: [] }],
})

test('§P1 extractJsonObject survives every observed failure shape', () => {
  const { extractJsonObject } = loadPlanning()

  // 1. Plain JSON (happy path)
  assert.deepEqual(extractJsonObject(SAMPLE_PLAN), JSON.parse(SAMPLE_PLAN))
  // 2. Prose-wrapped ("Here is your plan: {...} hope this helps")
  const prose = `Here is your professional plan:\n\n${SAMPLE_PLAN}\n\nHope this helps!`
  assert.deepEqual(extractJsonObject(prose), JSON.parse(SAMPLE_PLAN))
  // 3. Fenced with language tag
  assert.deepEqual(extractJsonObject('```json\n' + SAMPLE_PLAN + '\n```'), JSON.parse(SAMPLE_PLAN))
  // 4. Fenced + surrounding prose
  assert.deepEqual(extractJsonObject(`Sure!\n\`\`\`json\n${SAMPLE_PLAN}\n\`\`\`\nDone.`), JSON.parse(SAMPLE_PLAN))
  // 5. Trailing commas
  assert.deepEqual(
    extractJsonObject('{"title":"X","sections":[{ "id":"s1","components":[],},],}'),
    JSON.parse('{"title":"X","sections":[{"id":"s1","components":[]}]}')
  )
  // 6. Raw control characters inside a string
  assert.equal(
    extractJsonObject('{"title":"line1\nline2"}').title,
    'line1 line2'
  )
  // 7. Braces inside strings must not confuse the scanner
  assert.equal(extractJsonObject('{"a":"hello {world}","b":1}').b, 1)
  // 8. BOM + zero-width junk prefix
  assert.deepEqual(extractJsonObject('\uFEFF\u200B' + SAMPLE_PLAN), JSON.parse(SAMPLE_PLAN))
  // 9. TRUNCATED mid-string (maxTokens cut) — rescue closes the object
  const truncatedString = '{"title":"2026年第三季度业务分'
  assert.equal(extractJsonObject(truncatedString).title, '2026年第三季度业务分')
  // 10. TRUNCATED mid-object (deep nesting) — rescue closes every bracket
  const truncatedDeep =
    '{"title":"Plan","sections":[{"id":"s1","components":[{"type":"LIST","content":["a","b"'
  const rescued = extractJsonObject(truncatedDeep)
  assert.equal(rescued.title, 'Plan')
  assert.equal(rescued.sections[0].components[0].content[1], 'b')
  // 11. Truly garbage → DIAGNOSTIC error (not a blind throw)
  assert.throws(() => extractJsonObject('I cannot produce JSON for this.'), /Failed to parse AI planning response/)
})

// ---------------------------------------------------------------------------
// §P2 — WORKER CONTRACT: honor the endpoint's retryable:false (source pin)
// ---------------------------------------------------------------------------
test('§P2 worker parses the render endpoint error body and fails fast on retryable:false', () => {
  const { readFileSync } = require('node:fs')
  const { resolve } = require('node:path')
  const workerSrc = readFileSync(resolve(process.cwd(), 'convex/worker.ts'), 'utf8')
  assert.match(workerSrc, /JSON\.parse\(bodyText\)/, 'worker must parse the structured error body')
  assert.match(workerSrc, /retryable === false/, 'worker must honor the retryable contract')
  assert.match(workerSrc, /failJobFromRender/, 'non-retryable → honest job failure')
})

test('§P2 render route stores artifact filename in metadata through the sanitized uploader', () => {
  const { readFileSync } = require('node:fs')
  const { resolve } = require('node:path')
  const routeSrc = readFileSync(resolve(process.cwd(), 'src/app/api/generation/render/route.ts'), 'utf8')
  assert.match(routeSrc, /originalName: filename/, 'filename metadata still present (now safe)')
  assert.match(routeSrc, /uploadToR2/, 'uploads flow through the sanitizing client')
})
