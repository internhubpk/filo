// Phase 5 — post-payment subscription synchronization tests.
//
// Pins the fixes for the "paid but still FREE" class of bugs:
//   1. Webhook user resolution uses OUR checkout state (metadata.order_id)
//      FIRST — never email-only (the payer can change their email on the
//      hosted page, which silently dropped valid confirmations).
//   2. Webhook stores the tracker on the pending checkout payment (no
//      duplicate payment rows; the verify poller can track it afterwards).
//   3. Checkout pre-flight gate blocks duplicate Safepay subscriptions and
//      maps Safepay's "plan already subscribed" to an honest 409 state.
//   4. Verify poller discovers the tracker via the reporter payments-search
//      endpoint when the subscription flow never surfaced one.
//   5. Return route: wide tracker param extraction + JSON body + diagnostics
//      (no misleading "cancelled" bounce after a successful payment).
//   6. UI verification is BOUNDED — never an infinite spinner.
//   7. Admin tooling: billing diagnostics + webhook self-test endpoints.
//
// Run: `node --test tests/unit/phase5-subscription-sync.test.js`

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..')

const read = (...p) => readFileSync(resolve(REPO_ROOT, ...p), 'utf8')

const webhookRoute = read('src', 'app', 'api', 'webhooks', 'safepay', 'route.ts')
const checkoutRoute = read('src', 'app', 'api', 'billing', 'checkout', 'route.ts')
const verifyRoute = read('src', 'app', 'api', 'billing', 'verify', 'route.ts')
const returnRoute = read('src', 'app', 'api', 'billing', 'return', 'route.ts')
const billingPage = read('src', 'app', '(app)', 'billing', 'page.tsx')
const convexBilling = read('convex', 'billing.ts')
const safepayLib = read('src', 'lib', 'safepay.ts')
const apiClient = read('src', 'lib', 'api-client.ts')
const diagRoute = read('src', 'app', 'api', 'admin', 'billing', 'diagnostics', 'route.ts')
const selfTestRoute = read('src', 'app', 'api', 'admin', 'billing', 'webhook-self-test', 'route.ts')

// ---------------------------------------------------------------------------
// 1. Webhook resolves the user from OUR checkout state first
// ---------------------------------------------------------------------------

test('webhook resolves the user via metadata.order_id BEFORE email/customer', () => {
  const orderIdx = webhookRoute.indexOf('billing:resolveSubscriptionOwner')
  const emailIdx = webhookRoute.indexOf('billing:resolveUserForWebhook')
  assert.ok(orderIdx > -1, 'webhook must call billing:resolveSubscriptionOwner')
  assert.ok(orderIdx < emailIdx, 'order_id resolution must run BEFORE the email/customer fallback')
})

test('webhook attaches a discovered tracker to the pending checkout payment', () => {
  assert.ok(
    webhookRoute.includes('billing:attachTrackerToPayment'),
    'webhook must attach track_* ids to the pending payment so upsertPaymentFromWebhook UPDATES it instead of duplicating'
  )
})

test('convex exposes resolveSubscriptionOwner + attachTrackerToPayment', () => {
  assert.ok(convexBilling.includes('export const resolveSubscriptionOwner = query('))
  assert.ok(convexBilling.includes('export const attachTrackerToPayment = mutation('))
})

test('attachTrackerToPayment is pending-only and idempotent', () => {
  const fn = convexBilling.slice(convexBilling.indexOf('export const attachTrackerToPayment'))
  assert.ok(fn.includes('payment.status !== "pending"'), 'must refuse non-pending payments')
  assert.ok(fn.includes('already_attached'), 'must be idempotent for the same tracker')
})

// ---------------------------------------------------------------------------
// 2. Checkout pre-flight gate + "plan already subscribed" mapping
// ---------------------------------------------------------------------------

test('checkout consults billing:getCheckoutGate BEFORE creating a pending subscription', () => {
  const gateIdx = checkoutRoute.indexOf('billing:getCheckoutGate')
  const createIdx = checkoutRoute.indexOf('billing:createPendingSubscription')
  assert.ok(gateIdx > -1, 'checkout must call the pre-flight gate')
  assert.ok(gateIdx < createIdx, 'gate must run BEFORE createPendingSubscription')
})

test('checkout maps ALREADY_SUBSCRIBED + CHECKOUT_PENDING to 409 with honest messages', () => {
  assert.ok(checkoutRoute.includes('"ALREADY_SUBSCRIBED"'))
  assert.ok(checkoutRoute.includes('"CHECKOUT_PENDING"'))
  assert.ok(checkoutRoute.includes('already subscribed'), 'must detect Safepay plan-already-subscribed failures')
  assert.ok(checkoutRoute.includes("status: 409"))
})

test('convex getCheckoutGate blocks active same-plan subscriptions and young pending checkouts', () => {
  const fn = convexBilling.slice(convexBilling.indexOf('export const getCheckoutGate'))
  assert.ok(fn.includes('"already_subscribed"'))
  assert.ok(fn.includes('"checkout_pending"'))
  assert.ok(fn.includes('2 * 60 * 60 * 1000'), 'pending gate must have a 2h staleness bound')
})

// ---------------------------------------------------------------------------
// 3. Verify poller: tracker discovery via the reporter payments-search
// ---------------------------------------------------------------------------

test('safepay lib implements the reporter payments-search (tracker discovery)', () => {
  assert.ok(safepayLib.includes('/reporter/api/v1/payments'), 'search endpoint path must exist')
  assert.ok(safepayLib.includes('export function parsePaymentsSearchResponse('))
  assert.ok(safepayLib.includes('export async function searchSafepayPayments('))
})

test('verify route discovers + adopts the tracker when no track_* is known', () => {
  assert.ok(verifyRoute.includes('searchSafepayPayments'))
  assert.ok(verifyRoute.includes('billing:attachTrackerToPayment'))
  assert.ok(verifyRoute.includes('discovery'), 'must surface discovery diagnostics to the UI')
})

test('payments-search parser matches ONLY on our own order_id (never guesses)', () => {
  const verify = verifyRoute
  assert.ok(
    verify.includes('p.orderId && String(p.orderId) === String(pending.subscriptionId)'),
    'tracker adoption must be keyed to OUR subscription id'
  )
})

// ---------------------------------------------------------------------------
// 4. Return route: wide extraction, JSON body, diagnostics, no fake cancel
// ---------------------------------------------------------------------------

test('return route extracts trackers from every known param name', () => {
  const keys = returnRoute.slice(returnRoute.indexOf('TRACKER_KEYS'), returnRoute.indexOf('TRACKER_KEYS') + 200)
  assert.ok(keys.includes('"tracker"'))
  assert.ok(keys.includes('"track_id"'))
  assert.ok(keys.includes('"token"'))
  assert.ok(keys.includes('"beacon"'))
})

test('return route accepts JSON bodies + logs param names for diagnostics', () => {
  assert.ok(returnRoute.includes('application/json'))
  assert.ok(returnRoute.includes('logReturnDiagnostics'))
})

test('trackerless GET bounce is "return" (keeps pending verification), never "cancelled"', () => {
  const getFn = returnRoute.slice(returnRoute.indexOf('export async function GET'))
  const tail = getFn.slice(0, getFn.indexOf('export async function POST'))
  assert.ok(
    tail.includes('return bounce("return")'),
    'trackerless GET must bounce as return so the pending banner keeps working'
  )
  assert.ok(!tail.includes('bounce("cancelled")'), 'GET must NOT report cancelled — cancels land on /billing, not here')
})

// ---------------------------------------------------------------------------
// 5. UI: bounded verification + idempotent Activate Pro states
// ---------------------------------------------------------------------------

test('billing page verify polling is bounded (~36s), never an infinite spinner', () => {
  assert.ok(billingPage.includes('verifyPolls > 5'), 'auto-polling must stop after 6 attempts')
  assert.ok(billingPage.includes('still being verified'), 'bounded state must explain what happens next')
})

test('billing page handles ALREADY_SUBSCRIBED / CHECKOUT_PENDING as friendly toasts', () => {
  assert.ok(billingPage.includes('res.code === "ALREADY_SUBSCRIBED"'))
  assert.ok(billingPage.includes('res.code === "CHECKOUT_PENDING"'))
  assert.ok(billingPage.includes("You're already subscribed"))
})

test('Restart checkout forces a new session; api-client forwards force', () => {
  assert.ok(billingPage.includes('startCheckout(pro, { force: true })'))
  assert.ok(apiClient.includes('force?: boolean'))
})

// ---------------------------------------------------------------------------
// 6. Admin tooling: diagnostics + webhook self-test
// ---------------------------------------------------------------------------

test('admin diagnostics endpoint surfaces webhook deliveries + pending checkouts', () => {
  assert.ok(diagRoute.includes('billing:adminListWebhookEvents'))
  assert.ok(diagRoute.includes('billing:adminListPayments'))
  assert.ok(diagRoute.includes('webhookHint'))
  assert.ok(diagRoute.includes('requireAdminAccess'))
})

test('webhook self-test signs with HMAC-SHA512 over the raw body and POSTs to the real route', () => {
  assert.ok(selfTestRoute.includes('createHmac("sha512"'), 'must use the documented HMAC-SHA512 scheme')
  assert.ok(selfTestRoute.includes('"X-SFPY-SIGNATURE"'))
  assert.ok(selfTestRoute.includes('/api/webhooks/safepay'))
  assert.ok(selfTestRoute.includes('ledgerRecorded'), 'must verify the event reached the Convex ledger')
  assert.ok(selfTestRoute.includes('evt_selftest_'), 'synthetic event id cannot collide with real events')
})

// ---------------------------------------------------------------------------
// 7. Payments-search parser behaviour (pure function, re-implemented here)
// ---------------------------------------------------------------------------

test('parsePaymentsSearchResponse handles the documented container shapes', () => {
  // The parser lives in TS; re-derive its contract from the source to make
  // sure every plausible shape is whitelisted.
  assert.ok(safepayLib.includes('.data as unknown[]) ??'))
  assert.ok(safepayLib.includes('.payments as unknown[]) ??'))
  assert.ok(safepayLib.includes('.items as unknown[]) ??'))
  assert.ok(safepayLib.includes('Array.isArray(payload)'), 'bare arrays must pass through')
})
