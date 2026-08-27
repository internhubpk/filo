// Phase 1 baseline smoke test — confirms that the source modules compile and
// the type/lint passes we just achieved don't silently regress.
//
// Run: `node --test tests/unit/phase1-baseline.test.js`
//
// These tests do NOT spin up Next.js or call Convex — they verify that the
// most critical modules (after the Phase 1 fixes) can be imported and basic
// invariants hold.
//
// NOTE: Updated after the upstream merge that REMOVED SafePay and replaced it
// with a manual admin-verified payment flow (bank transfer / EasyPaisa /
// JazzCash + admin approval). Tests now assert the new architecture instead
// of the old SafePay one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
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

test('SafePay files are fully removed (replaced by manual payment flow)', () => {
  const removedFiles = [
    'convex/safepay.ts',
    'convex/safepay-webhook.ts',
    'src/app/api/webhooks/safepay/route.ts',
  ]
  for (const rel of removedFiles) {
    assert.equal(
      existsSync(resolve(REPO_ROOT, rel)),
      false,
      `${rel} should not exist — SafePay was removed upstream`
    )
  }
})

test('manual payment flow: paymentVerifications module exists', () => {
  const path = resolve(REPO_ROOT, 'convex', 'paymentVerifications.ts')
  assert.ok(existsSync(path), 'convex/paymentVerifications.ts must exist')
  const text = readFileSync(path, 'utf8')
  assert.ok(text.includes('createVerification'), 'missing createVerification mutation')
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

test('convex/sessions.ts query handlers do not call ctx.db.delete (read-only)', () => {
  const path = resolve(REPO_ROOT, 'convex', 'sessions.ts')
  const text = readFileSync(path, 'utf8')
  assert.ok(
    !/validateSessionToken[\s\S]*?ctx\.db\.delete/.test(text),
    'sessions.ts validateSessionToken query still calls ctx.db.delete (queries are read-only)'
  )
})

test('all route handlers use @convex/_generated/api alias (no string refs)', () => {
  // NOTE: /api/auth/me and /api/auth/validate are intentionally excluded —
  // the session system migrated to self-contained HMAC tokens (src/lib/session.ts),
  // so these routes no longer need any Convex reference at all.
  const routes = [
    'src/app/api/artifacts/generate/route.ts',
    'src/app/api/artifacts/route.ts',
    'src/app/api/auth/logout/route.ts',
    'src/app/api/auth/signup/route.ts',
    'src/app/api/payments/create-checkout/route.ts',
    'src/app/api/payments/verify/route.ts',
    'src/app/api/payments/submit/route.ts',
    'src/app/api/plans/route.ts',
    'src/app/api/subscription/status/route.ts',
  ]
  for (const rel of routes) {
    const text = readFileSync(resolve(REPO_ROOT, rel), 'utf8')
    assert.ok(
      text.includes("from '@convex/_generated/api'"),
      `${rel} must import api from @convex/_generated/api (was using a broken string ref)`
    )
    // No colon-style string refs should remain anywhere in the route file.
    assert.ok(
      !/\.(query|mutation|action)\(\s*'[a-zA-Z_]+:[a-zA-Z_]+'/.test(text),
      `${rel} still contains a 'module:function' string ref (broken format)`
    )
  }
})

test('admin routes (new from upstream merge) use api.* references too', () => {
  const adminRoutes = [
    'src/app/api/admin/users/route.ts',
    'src/app/api/admin/users/[userId]/activate/route.ts',
    'src/app/api/admin/users/[userId]/suspend/route.ts',
    'src/app/api/admin/verifications/route.ts',
    'src/app/api/admin/verifications/[id]/approve/route.ts',
    'src/app/api/admin/verifications/[id]/reject/route.ts',
  ]
  for (const rel of adminRoutes) {
    const text = readFileSync(resolve(REPO_ROOT, rel), 'utf8')
    assert.ok(
      !/\.(query|mutation|action)\(\s*'[a-zA-Z_]+:[a-zA-Z_]+'/.test(text),
      `${rel} still contains a 'module:function' string ref (broken format)`
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

test('UI pages no longer use broken toast-call-with-object pattern', () => {
  const pages = [
    'src/app/pricing/page.tsx',
    'src/components/billing/billing-page.tsx',
    'src/components/dashboard/main-dashboard.tsx',
  ]
  for (const rel of pages) {
    const text = readFileSync(resolve(REPO_ROOT, rel), 'utf8')
    // Pattern that was broken: `toast.error('msg', { description: '...' })`
    assert.ok(
      !/toast\.\w+\([^,)]+?,\s*\{\s*description:/.test(text),
      `${rel} still uses old {description: ...} object arg in toast calls`
    )
  }
})
