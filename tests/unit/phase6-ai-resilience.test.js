// Phase 6 — AI provider resilience & diagnostics (AI-repair spec).
//
// Pins the contract that keeps generation reliable and honest:
//   §4  Error classification — 401/403→AUTH, 402→QUOTA, 404→MODEL_NOT_FOUND,
//       429→RATE_LIMITED, 5xx→PROVIDER_UNAVAILABLE, Google's 400
//       "API key not valid" → AUTH (never UNAVAILABLE for all of these).
//   §5  Bounded retry: 2 attempts per model, hard cap of 4 per provider.
//   §6  Gemini model registry lives in ONE place and uses -latest aliases.
//   §7  OpenRouter slugs are the LIVE-verified ones (no retired models).
//   §8  Quota exhaustion stops the provider for the request + cooldown.
//   §10 OpenAI optional: unconfigured = skipped, not attempted.
//   §13 Request validation happens BEFORE any provider call.
//   §14 Short-lived provider health (degraded / quota_exhausted) exists.
//   §16 User-safe messages: no provider codes in user-facing surfaces;
//       developer diagnostics retain the full failure chain.
//   §17 Admin diagnostics surface exists (Convex-runtime probes, no secrets).
//   §18 Generation runs in Convex; probes run in the same runtime.
//   §21 requestId propagates into AI logs.
//   §22 Every provider call is timeout-bounded (AbortController).
//   §24 No NEXT_PUBLIC_* AI key variables anywhere.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..')

const read = (...p) => readFileSync(resolve(REPO_ROOT, ...p), 'utf8')

const errors = read('src', 'services', 'ai', 'errors.ts')
const router = read('src', 'services', 'ai', 'router.ts')
const gemini = read('src', 'services', 'ai', 'gemini.ts')
const openrouter = read('src', 'services', 'ai', 'openrouter.ts')
const worker = read('convex', 'worker.ts')
const aiDiagnostics = read('convex', 'aiDiagnostics.ts')
const aiStatusRoute = read('src', 'app', 'api', 'admin', 'ai', 'status', 'route.ts')
const aiIndex = read('src', 'services', 'ai', 'index.ts')
const envExample = read('.env.example')
const adminPlans = read('src', 'app', 'admin', '(console)', 'plans', 'page.tsx')

// ---------------------------------------------------------------------------
// §4 — error classification
// ---------------------------------------------------------------------------

test('§4 401/403 map to AUTH_FAILED (never PROVIDER_UNAVAILABLE)', () => {
  const block = errors.match(/case 401:\s*case 403:\s*return new AuthFailedError/)
  assert.ok(block, '401/403 must construct AuthFailedError')
})

test('§4 402 maps to QUOTA_EXCEEDED and 429 to RATE_LIMITED', () => {
  assert.match(errors, /case 402:\s*return new QuotaExceededError/, '402 → QuotaExceededError')
  assert.match(errors, /case 429:\s*return new RateLimitedError/, '429 → RateLimitedError')
})

test('§4 404 maps to MODEL_NOT_FOUND (advances model fallback)', () => {
  assert.match(
    errors,
    /case 404:\s*return new AiBaseError\([\s\S]{0,200}?'MODEL_NOT_FOUND'/,
    '404 → MODEL_NOT_FOUND'
  )
})

test('§4 only 5xx maps to PROVIDER_UNAVAILABLE', () => {
  const block = errors.match(/default:\s*if \(status >= 500\) \{\s*return new ProviderUnavailableError/)
  assert.ok(block, 'PROVIDER_UNAVAILABLE must only be produced from the 5xx default branch')
})

test("§4 Google's 400 'API key not valid' is classified as AUTH, not INVALID_REQUEST", () => {
  assert.match(
    errors,
    /case 413:\s*case 400:[\s\S]*?api\[_ \]\?key[\s\S]*?AuthFailedError/,
    '400 with an api-key error body must construct AuthFailedError'
  )
})

test('§4 CONFIGURATION_ERROR exists for bad server-side config (bad base URL)', () => {
  assert.match(errors, /'CONFIGURATION_ERROR'/, 'code registered in the union')
  assert.match(errors, /class ConfigurationError extends AiBaseError/)
  assert.match(gemini, /ConfigurationError\(\s*'GEMINI'/, 'gemini.ts throws it for an invalid GEMINI_BASE_URL')
})

// ---------------------------------------------------------------------------
// §5 — bounded retry
// ---------------------------------------------------------------------------

test('§5 retry policy is bounded: 2 attempts per model', () => {
  assert.match(router, /DEFAULT_RETRY_POLICY: RetryPolicy = \{\s*maxAttempts: 2,/)
})

test('§5 provider attempt budget caps total attempts at 4', () => {
  assert.match(router, /MAX_ATTEMPTS_PER_PROVIDER = 4/)
  assert.match(router, /providerAttemptsUsed >= MAX_ATTEMPTS_PER_PROVIDER/)
})

test('§5 backoff uses exponential delay with jitter', () => {
  assert.match(router, /backoffMultiplier/, 'exponential base')
  assert.match(router, /0\.75 \+ Math\.random\(\) \* 0\.5/, '±25% jitter')
})

// ---------------------------------------------------------------------------
// §6 — Gemini model registry
// ---------------------------------------------------------------------------

test('§6 Gemini registry keeps the always-current -latest aliases', () => {
  assert.match(gemini, /'gemini-flash-latest'/)
  assert.match(gemini, /'gemini-flash-lite-latest'/)
  assert.match(gemini, /'gemini-2\.5-flash'/)
})

test('§6 no retired Gemini 1.5 model ids remain', () => {
  assert.doesNotMatch(gemini, /gemini-1\.5/, '1.5 models are retired — must not be referenced')
})

test('§1 generateContent is the documented API surface with an Interactions-API decision note', () => {
  assert.match(gemini, /generateContent/)
  assert.match(gemini, /Interactions API/, 'the evaluation must be documented, not silently ignored')
})

// ---------------------------------------------------------------------------
// §7 — OpenRouter model registry (live-verified 2026-08-28)
// ---------------------------------------------------------------------------

test('§7 retired OpenRouter slugs are gone from the ACTIVE registries', () => {
  const orModels = openrouter.match(/export const OPENROUTER_MODELS = \[[\s\S]*?\] as const/)?.[0] ?? ''
  const matrix = router.match(/export const MODEL_MATRIX[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(orModels.length > 0 && matrix.length > 0, 'registries found')
  for (const block of [orModels, matrix]) {
    assert.doesNotMatch(block, /claude-3\.5-sonnet/, 'retired from the live catalog')
    assert.doesNotMatch(block, /gemini-2\.0-flash-001/, 'retired from the live catalog')
  }
})

test('§7 current OpenRouter slugs are the LIVE-verified ones', () => {
  assert.match(openrouter, /'anthropic\/claude-sonnet-4\.5'/)
  assert.match(router, /'anthropic\/claude-sonnet-4\.5'/)
  assert.match(router, /'openai\/gpt-5-mini'/)
  assert.match(router, /'google\/gemini-2\.5-flash'/)
})

// ---------------------------------------------------------------------------
// §8/§14 — quota handling + provider health
// ---------------------------------------------------------------------------

test('§8 QUOTA_EXCEEDED stops walking the exhausted provider and starts a cooldown', () => {
  assert.match(router, /aiErr\.code === 'QUOTA_EXCEEDED'\) \{\s*break/, 'breaks out of the model loop')
  assert.match(router, /entry\.state = 'quota_exhausted'/)
  assert.match(router, /QUOTA_COOLDOWN_MS/, 'cooldown exists')
})

test('§8 a quota-cooled provider is SKIPPED (zero calls), not attempted', () => {
  assert.match(router, /state === 'quota_exhausted'\) \{[\s\S]*?continue/s)
})

test('§14 repeated 5xx demotes a provider to degraded (reduced attempts)', () => {
  assert.match(router, /DEGRADED_AFTER_CONSECUTIVE_UNAVAILABLE = 4/)
  assert.match(router, /health\.state === 'degraded' \? 1 : policy\.maxAttempts/)
})

test('§14 health recovers automatically (cooldown expiry), never permanent', () => {
  assert.match(router, /Date\.now\(\) >= entry\.until/, 'lazy expiry check')
  assert.match(router, /recordProviderSuccess/, 'success resets health')
})

// ---------------------------------------------------------------------------
// §10/§12 — optional OpenAI + deterministic fallback
// ---------------------------------------------------------------------------

test('§10 unconfigured providers are skipped with a diagnostic line, not attempted', () => {
  assert.match(router, /PROVIDER_UNCONFIGURED/)
  assert.match(router, /disabled: no API key configured — skipped/)
  // The worker consumes the router taxonomy via the user-safe mapper rather
  // than re-implementing provider logic.
  assert.match(worker, /from "\.\.\/src\/services\/ai"/)
  assert.match(worker, /userSafeAiMessage/)
})

test('§12 fallback order is deterministic: GEMINI → OPENROUTER → OPENAI', () => {
  const order = router.match(/PROVIDER_FALLBACK_ORDER: ProviderId\[\] = \[[\s\S]*?\]/)
  assert.ok(order, 'fallback order is an explicit constant')
  const ids = order[0].match(/'(GEMINI|OPENROUTER|OPENAI)'/g)
  assert.deepEqual(ids, ["'GEMINI'", "'OPENROUTER'", "'OPENAI'"])
})

// ---------------------------------------------------------------------------
// §13 — request validation before any provider call
// ---------------------------------------------------------------------------

test('§13 empty prompts are rejected BEFORE any provider is called', () => {
  const gen = router.match(/async generate\([\s\S]*?const chain = this\.buildProviderChain/)?.[0] ?? ''
  assert.match(gen, /hasContent/, 'content check inside generate()')
  assert.match(gen, /INVALID_REQUEST/, 'empty prompt → INVALID_REQUEST')
  assert.match(gen, /before any provider call/i, 'documented as a pre-provider gate')
})

// ---------------------------------------------------------------------------
// §16 — user-safe messages + retained diagnostics
// ---------------------------------------------------------------------------

test('§16 userSafeAiMessage exists and never leaks provider internals', () => {
  assert.match(errors, /export function userSafeAiMessage/)
  const fn = errors.match(/export function userSafeAiMessage[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(fn.length > 0, 'function found')
  // Every RETURNED literal must be a clean user-facing sentence.
  const returned = [...fn.matchAll(/return '([^']+)'/g)].map((m) => m[1])
  assert.ok(returned.length >= 6, `covers the main categories (got ${returned.length})`)
  for (const sentence of returned) {
    assert.ok(
      !/(GEMINI|OPENROUTER|OPENAI):/.test(sentence) &&
        !/(PROVIDER_UNAVAILABLE|MODEL_NOT_FOUND|QUOTA_EXCEEDED|AUTH_FAILED|RATE_LIMITED)/.test(sentence),
      `user-safe message must not contain provider codes: ${sentence}`
    )
  }
})

test('§16 the worker stores the user-safe message and logs full diagnostics', () => {
  assert.match(worker, /userSafeAiMessage\(err\)/, 'job.error gets the clean message')
  assert.match(worker, /JSON\.stringify\(err\.attempts\)/, 'developer diagnostics keep the attempt chain')
})

test('§16 AllProvidersFailedError aggregates per-attempt detail', () => {
  assert.match(errors, /parts\.push\(`\$\{label\}\$\{detail\}`\)/)
})

// ---------------------------------------------------------------------------
// §17/§18 — Convex-runtime diagnostics (no secrets)
// ---------------------------------------------------------------------------

test('§17 admin diagnostics route exists and is admin-gated', () => {
  assert.match(aiStatusRoute, /requireAdminAccess/)
  assert.match(aiStatusRoute, /aiDiagnostics:probeAiProviders/)
})

test('§17 the Convex probe action is server-token gated (fail-closed)', () => {
  assert.match(aiDiagnostics, /"use node"/, 'probes need fetch + timers')
  assert.match(aiDiagnostics, /assertServerToken/)
  assert.match(aiDiagnostics, /FILO_SERVER_SECRET/)
})

test('§17 diagnostics never expose key material', () => {
  for (const file of [aiDiagnostics, aiStatusRoute]) {
    assert.doesNotMatch(file, /GEMINI_API_KEY.*\$\{.*key/, 'no interpolated key output')
  }
  assert.match(aiDiagnostics, /environment: "Convex"/, 'reports the runtime, per spec §2')
})

test('§17 OpenRouter probe validates key + credits without spending tokens', () => {
  assert.match(openrouter, /fetchKeyInfo/)
  assert.match(openrouter, /\/key/, 'GET /api/v1/key')
})

test('§6 Gemini probe validates the configured model registry via ListModels', () => {
  assert.match(gemini, /async diagnose\(\)/)
  assert.match(gemini, /missingConfiguredModels/, 'reports which configured models do not exist')
})

test('§17 the admin plans console renders the AI providers card', () => {
  assert.match(adminPlans, /AI providers/)
  assert.match(adminPlans, /Run live AI probe/)
})

// ---------------------------------------------------------------------------
// §21/§22 — request id + timeouts
// ---------------------------------------------------------------------------

test('§21 requestId propagates into AI logs', () => {
  assert.match(router, /generateOptions\.requestId \|\| request\.options\?\.requestId/)
  assert.match(router, /traceTag/)
})

test('§22 every provider request is timeout-bounded via AbortController', () => {
  for (const [name, file] of [['gemini', gemini], ['openrouter', openrouter]]) {
    assert.match(file, /AbortController/, `${name} uses AbortController`)
    assert.match(file, /controller\.abort\(\)/, `${name} aborts on timeout`)
  }
})

// ---------------------------------------------------------------------------
// §24 — environment hygiene
// ---------------------------------------------------------------------------

test('§24 no NEXT_PUBLIC_* AI key variables anywhere', () => {
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_(GEMINI|OPENROUTER|OPENAI)_API_KEY/)
  assert.match(envExample, /npx convex env set GEMINI_API_KEY/, 'Convex ownership documented')
})

test('§24 .env.example documents that generation runs in Convex', () => {
  assert.match(envExample, /GENERATION RUNS IN CONVEX ACTIONS/)
})

// ---------------------------------------------------------------------------
// wiring — the router exports stay stable for consumers
// ---------------------------------------------------------------------------

test('index.ts re-exports the new resilience surface', () => {
  assert.match(aiIndex, /MAX_ATTEMPTS_PER_PROVIDER/)
  assert.match(aiIndex, /providerHealthSnapshot/)
  assert.match(aiIndex, /export \* from '\.\/errors'/, 'userSafeAiMessage travels with the barrel')
})
