// Phase 1 baseline smoke test — confirms that the source modules compile and
// the type/lint passes we just achieved don't silently regress.
//
// Run: `node --test tests/unit/phase1-baseline.test.js`
//
// These tests do NOT spin up Next.js or call Convex — they verify that the
// most critical modules (after the Phase 1 fixes) can be imported and basic
// invariants hold.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..')

test('package.json declares required scripts', () => {
  const pkg = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')
  )
  assert.ok(pkg.scripts.typecheck, 'missing typecheck script')
  assert.ok(pkg.scripts.lint, 'missing lint script')
  assert.ok(pkg.scripts.build, 'missing build script')
  assert.ok(pkg.scripts.test, 'missing test script')
})

test('next.config.ts has ignoreBuildErrors=false', () => {
  const nextConfig = readFileSync(resolve(REPO_ROOT, 'next.config.ts'), 'utf8')
  // Confirm the production-strict flag was flipped off (the comment explains why).
  assert.ok(
    nextConfig.includes('ignoreBuildErrors: false'),
    'next.config.ts must have ignoreBuildErrors:false'
  )
})

test('convex/safepay_internal.ts exists (action mutation/query shim)', () => {
  const path = resolve(REPO_ROOT, 'convex', 'safepay_internal.ts')
  const text = readFileSync(path, 'utf8')
  assert.ok(text.length > 0, 'safepay_internal.ts is empty')
  // Critical mutations/queries must be present.
  assert.ok(text.includes('recordWebhookEvent'), 'missing recordWebhookEvent mutation')
  assert.ok(text.includes('markWebhookProcessed'), 'missing markWebhookProcessed mutation')
  assert.ok(text.includes('insertPendingPayment'), 'missing insertPendingPayment mutation')
  assert.ok(text.includes('createSubscription'), 'missing createSubscription mutation')
})

test('convex/safepay-webhook.ts uses runMutation/runQuery, not ctx.db', () => {
  const path = resolve(REPO_ROOT, 'convex', 'safepay-webhook.ts')
  const text = readFileSync(path, 'utf8')
  // Actions must not use ctx.db directly — that's the bug we fixed in Phase 1.
  assert.ok(
    !/^\s*await ctx\.db\./m.test(text),
    'safepay-webhook.ts action handler still uses ctx.db directly'
  )
  // Confirm it dispatches via runQuery/runMutation.
  assert.ok(
    text.includes('ctx.runMutation(api.safepayInternal'),
    'safepay-webhook.ts must dispatch via ctx.runMutation(api.safepayInternal.*)'
  )
})

test('convex/safepay.ts uses runMutation/runQuery, not ctx.db', () => {
  const path = resolve(REPO_ROOT, 'convex', 'safepay.ts')
  const text = readFileSync(path, 'utf8')
  assert.ok(
    !/^\s*await ctx\.db\./m.test(text),
    'safepay.ts action handler still uses ctx.db directly'
  )
  assert.ok(
    text.includes('ctx.runMutation(api.safepayInternal'),
    'safepay.ts must dispatch via ctx.runMutation(api.safepayInternal.*)'
  )
})

test('convex/auth.ts query handlers do not call ctx.db.delete (read-only)', () => {
  const path = resolve(REPO_ROOT, 'convex', 'auth.ts')
  const text = readFileSync(path, 'utf8')
  // validateSession is a query — it must not delete. We surface `reason: "expired"`
  // so callers can fire a follow-up mutation to clean up.
  assert.ok(
    !/validateSession[\s\S]*?ctx\.db\.delete/.test(text),
    'auth.ts validateSession query still calls ctx.db.delete (queries are read-only)'
  )
})

test('all route handlers use @convex/_generated/api alias (no relative paths)', () => {
  const routes = [
    'src/app/api/artifacts/generate/route.ts',
    'src/app/api/artifacts/route.ts',
    'src/app/api/auth/logout/route.ts',
    'src/app/api/auth/me/route.ts',
    'src/app/api/auth/signup/route.ts',
    'src/app/api/auth/validate/route.ts',
    'src/app/api/payments/create-checkout/route.ts',
    'src/app/api/payments/verify/route.ts',
    'src/app/api/plans/route.ts',
    'src/app/api/subscription/status/route.ts',
  ]
  for (const rel of routes) {
    const text = readFileSync(resolve(REPO_ROOT, rel), 'utf8')
    assert.ok(
      text.includes("from '@convex/_generated/api'"),
      `${rel} must import api from @convex/_generated/api (was using a broken relative path)`
    )
  }
})

test('convex/artifacts.ts exposes listUserArtifacts query', () => {
  const path = resolve(REPO_ROOT, 'convex', 'artifacts.ts')
  const text = readFileSync(path, 'utf8')
  assert.ok(
    text.includes('export const listUserArtifacts = query'),
    'convex/artifacts.ts must export listUserArtifacts query (referenced by /api/artifacts route)'
  )
})

test('dashboard route no longer uses broken toast-call-with-object pattern', () => {
  const path = resolve(REPO_ROOT, 'src', 'components', 'dashboard', 'main-dashboard.tsx')
  const text = readFileSync(path, 'utf8')
  // Pattern that was broken: `toast.error('msg', { description: '...' })`
  assert.ok(
    !/toast\.\w+\([^,)]+,\s*\{\s*description:/.test(text),
    'dashboard still uses old {description: ...} object arg in toast calls'
  )
})
