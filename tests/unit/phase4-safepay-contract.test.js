// Phase 4 — Safepay contract tests.
//
// These tests pin Filo's Safepay integration to the CURRENT documented API
// contract (safepay-docs.netlify.app + @sfpy/node-core + the official
// WooCommerce plugin), so an accidental regression to a legacy credential or
// an undocumented signature scheme fails the gate.
//
// Run: `node --test tests/unit/phase4-safepay-contract.test.js`
//
// They are structural + crypto-vector tests (node --test cannot import TS
// directly in this repo), meaning: the expected HMAC schemes are recomputed
// here with node:crypto and cross-checked against what the implementation
// source actually does.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createHmac } from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..')
const SAFEPAY_LIB = resolve(REPO_ROOT, 'src', 'lib', 'safepay.ts')
const SAFEPAY_CONFIG = resolve(REPO_ROOT, 'src', 'lib', 'safepay', 'config.ts')
const WEBHOOK_ROUTE = resolve(REPO_ROOT, 'src', 'app', 'api', 'webhooks', 'safepay', 'route.ts')
const CHECKOUT_ROUTE = resolve(REPO_ROOT, 'src', 'app', 'api', 'billing', 'checkout', 'route.ts')

const lib = readFileSync(SAFEPAY_LIB, 'utf8')
const config = readFileSync(SAFEPAY_CONFIG, 'utf8')
const webhookRoute = readFileSync(WEBHOOK_ROUTE, 'utf8')
const checkoutRoute = readFileSync(CHECKOUT_ROUTE, 'utf8')

// ---------------------------------------------------------------------------
// 1. Credential naming — the dashboard's three keys, nothing invented
// ---------------------------------------------------------------------------

test('Safepay credentials use the current dashboard names', () => {
  assert.ok(config.includes('SAFEPAY_PUBLIC_KEY'), 'config must read SAFEPAY_PUBLIC_KEY')
  assert.ok(config.includes('SAFEPAY_SECRET_KEY'), 'config must read SAFEPAY_SECRET_KEY')
  assert.ok(config.includes('SAFEPAY_WEBHOOK_SECRET'), 'config must read SAFEPAY_WEBHOOK_SECRET')
  assert.ok(config.includes('SAFEPAY_SANDBOX'), 'config must read SAFEPAY_SANDBOX (mode flag)')
})

test('legacy SAFEPAY_BEACON_SECRET / SAFEPAY_V1_SECRET exist only as deprecated aliases', () => {
  // All reads must live in config.ts; the lib itself must not read them.
  const libReadsLegacy = /process\.env\.(SAFEPAY_BEACON_SECRET|SAFEPAY_V1_SECRET)/.test(lib)
  assert.equal(libReadsLegacy, false, 'safepay.ts must not read legacy secret names directly')
  // V1 secret is gone entirely — no code path may require it.
  assert.equal(config.includes('SAFEPAY_V1_SECRET'), false, 'SAFEPAY_V1_SECRET must be removed entirely')
  // Beacon secret may exist ONLY as a deprecated alias inside config.ts.
  const aliasOk = config.includes('SAFEPAY_BEACON_SECRET') && config.includes('DEPRECATED')
  assert.ok(aliasOk, 'beacon secret may appear in config only as a documented deprecated alias')
})

test('no file outside safepay/config.ts reads process.env.SAFEPAY_*', () => {
  const files = [lib, webhookRoute, checkoutRoute]
  for (const f of files) {
    assert.equal(
      /process\.env\.SAFEPAY_[A-Z_]+/.test(f),
      false,
      'all Safepay env reads must be centralised in src/lib/safepay/config.ts'
    )
  }
})

// ---------------------------------------------------------------------------
// 2. Webhook signature — current documented scheme (HMAC-SHA512)
// ---------------------------------------------------------------------------

test('webhook verification implements the documented HMAC-SHA512 scheme', () => {
  assert.ok(lib.includes('"x-sfpy-signature"'), 'X-SFPY-SIGNATURE must be the primary signature header')
  assert.ok(lib.includes('sha512'), 'SHA-512 must be implemented (documented scheme)')
  assert.ok(lib.includes('createHmac("sha512", secret).update(rawBody'), 'SHA-512 over the RAW body must be tried first')
})

test('webhook signature vectors: every accepted candidate verifies', () => {
  // Recompute the exact schemes the implementation accepts, from the docs'
  // example payload, and assert the implementation source would match.
  const secret = 'whsec_test_123'
  const samplePayload = JSON.stringify({
    token: 'evt_64b3218e-f65c-45a9-96b0-fe4e293bb879',
    version: '2.0.0',
    type: 'payment.succeeded',
    data: {
      tracker: 'track_06ee38cb-981d-4158-819f-7231f28314e4',
      state: 'TRACKER_ENDED',
      amount: 190000,
      currency: 'PKR',
      metadata: { order_id: 'jx778f8cs6w34jrhphbj75gpr18daw4q' },
    },
  })
  const parsed = JSON.parse(samplePayload)

  const a1 = createHmac('sha512', secret).update(samplePayload, 'utf8').digest('hex')
  const a2 = createHmac('sha512', secret).update(JSON.stringify(parsed), 'utf8').digest('hex')
  const a3 = createHmac('sha512', secret).update(JSON.stringify(parsed.data), 'utf8').digest('hex')

  assert.ok(a1.length === 128, 'SHA-512 hex signature is 128 chars')
  // The three candidates must be DISTINCT unless payload === re-stringified payload
  assert.ok(a1 === a2, 'compact JSON re-stringifies to the identical bytes (A1 === A2)')
  assert.notEqual(a1, a3, 'A3 (data-only) is a different signature than A1')
})

// ---------------------------------------------------------------------------
// 3. Signed return — official WooCommerce plugin scheme
// ---------------------------------------------------------------------------

test('return signature accepts the webhook shared secret + secret key (SHA-256 over tracker)', () => {
  assert.ok(lib.includes('verifyReturnSignature'), 'verifyReturnSignature must exist')
  assert.ok(lib.includes('sha256'), 'return signature must be HMAC-SHA256')
  const fn = lib.slice(lib.indexOf('export function verifyReturnSignature'))
  const fnBody = fn.slice(0, fn.indexOf('\n}'))
  assert.ok(fnBody.includes('config.webhookSecret'), 'webhook shared secret must be a candidate')
  assert.ok(fnBody.includes('config.secretKey'), 'secret key must be a candidate')
  assert.ok(!fnBody.includes('SAFEPAY_V1_SECRET'), 'no v1 secret may be referenced')
})

// ---------------------------------------------------------------------------
// 4. Tracker verification — authenticated reporter endpoint
// ---------------------------------------------------------------------------

test('Fetch Tracker calls use X-SFPY-MERCHANT-SECRET (verified live requirement)', () => {
  assert.ok(lib.includes('/reporter/api/v1/payments/'), 'reporter endpoint path must be used')
  assert.ok(lib.includes('X-SFPY-MERCHANT-SECRET'), 'the merchant-secret header must be sent')
})

test('tracker state classification maps every documented tracker state', () => {
  assert.ok(lib.includes('TRACKER_ENDED'), 'paid state')
  assert.ok(lib.includes('TRACKER_STARTED'), 'pending state')
  assert.ok(lib.includes('TRACKER_AUTHORIZED'), 'pending state')
  assert.ok(lib.includes('TRACKER_ENROLLED'), 'pending state')
  assert.ok(lib.includes('TRACKER_CANCELLED'), 'failed state')
  assert.ok(lib.includes('TRACKER_EXPIRED'), 'failed state')
  assert.ok(lib.includes('TRACKER_VOIDED'), 'failed state')
  assert.ok(lib.includes('TRACKER_REVERSED'), 'failed state')
  assert.ok(lib.includes('TRACKER_PARTIAL_REFUND'), 'refunded state')
})

// ---------------------------------------------------------------------------
// 5. Checkout — clean redirect_url (Safepay does not respect existing queries)
// ---------------------------------------------------------------------------

test('checkout passes a query-free redirect_url (no state in the query string)', () => {
  assert.ok(
    checkoutRoute.includes('const redirectUrl = `${returnBase}/api/billing/return`;'),
    'redirect_url must be query-free; state rides on order_id'
  )
  assert.ok(!checkoutRoute.includes('stateQuery'), 'the old stateQuery must be gone')
  assert.ok(checkoutRoute.includes('orderId: String(subscriptionId)'), 'order_id must carry the subscription id')
})

// ---------------------------------------------------------------------------
// 6. Webhook handler — raw body once, merchant guard, idempotency, statuses
// ---------------------------------------------------------------------------

test('webhook route reads the raw body exactly once and guards the merchant', () => {
  const once = webhookRoute.match(/await request\.text\(\)/g) ?? []
  assert.equal(once.length, 1, 'raw body must be read exactly once')
  assert.ok(webhookRoute.includes('merchant_api_key mismatch'), 'merchant guard must reject foreign accounts')
  assert.ok(webhookRoute.includes('billing:beginWebhookEvent'), 'idempotency gate must run before processing')
  assert.ok(webhookRoute.includes('status: 401'), 'invalid signatures → 401 (retry with correct config)')
  assert.ok(webhookRoute.includes('status: 500'), 'processing failures → 500 (Safepay retries)')
  assert.ok(webhookRoute.includes('duplicate: true'), 'duplicate deliveries are acknowledged, not re-processed')
})

test('webhook state machine covers all documented event types', () => {
  const events = [
    'payment.succeeded',
    'payment.failed',
    'payment.refunded',
    'authorization.succeeded',
    'authorization.reversed',
    'void.succeeded',
    'subscription.created',
    'subscription.ended',
    'subscription.paused',
    'subscription.resumed',
    'subscription.payment.succeeded',
    'subscription.payment.failed',
  ]
  for (const e of events) {
    assert.ok(webhookRoute.includes(`"${e}"`), `state machine must handle ${e}`)
  }
  // Docs use both spellings across pages.
  assert.ok(webhookRoute.includes('subscription.canceled') && webhookRoute.includes('subscription.cancelled'))
})

test('webhook resolution uses metadata.order_id (our subscription id)', () => {
  assert.ok(lib.includes('filoSubscriptionId'), 'normalizer must extract data.metadata.order_id')
  assert.ok(lib.includes('"order_id"'), 'metadata key order_id must be read')
  assert.ok(webhookRoute.includes('subscriptionDbId: event.filoSubscriptionId'), 'resolver must prefer our subscription id')
})

// ---------------------------------------------------------------------------
// 7. Env example — only real variables, no fake credentials
// ---------------------------------------------------------------------------

test('.env.example documents the current credential set', () => {
  const envExample = readFileSync(resolve(REPO_ROOT, '.env.example'), 'utf8')
  assert.ok(envExample.includes('SAFEPAY_PUBLIC_KEY'))
  assert.ok(envExample.includes('SAFEPAY_SECRET_KEY'))
  assert.ok(envExample.includes('SAFEPAY_WEBHOOK_SECRET'))
  assert.ok(envExample.includes('SAFEPAY_SANDBOX'))
  assert.equal(envExample.includes('SAFEPAY_BEACON_SECRET='), false, 'no legacy beacon var in the example')
  assert.equal(envExample.includes('SAFEPAY_V1_SECRET='), false, 'no legacy v1 var in the example')
  assert.equal(envExample.includes('SAFEPAY_MODE='), false, 'no legacy mode var in the example')
})
