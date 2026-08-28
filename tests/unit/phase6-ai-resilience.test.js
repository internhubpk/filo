// Phase 6 — AI provider resilience & diagnostics (AI-repair spec).
//
// Pins the contract that keeps generation reliable and honest:
//   §4  Error classification — 401/403→AUTH, 402→QUOTA, 404→MODEL_NOT_FOUND,
//       429→RATE_LIMITED, 5xx→PROVIDER_UNAVAILABLE, Google's 400
//       "API key not valid" → AUTH (never UNAVAILABLE for all of these).
//   §5  Bounded retry: 2 attempts per model, hard cap of 4 per provider.
//   §6  Agent Router model registry lives in ONE place, LIVE-verified, and
//       is cost-ordered (operator budget optimization).
//   §7  Retired provider adapters (gemini.ts, openrouter.ts) are DELETED.
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
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..')

const read = (...p) => readFileSync(resolve(REPO_ROOT, ...p), 'utf8')

const errors = read('src', 'services', 'ai', 'errors.ts')
const router = read('src', 'services', 'ai', 'router.ts')
const agentrouter = read('src', 'services', 'ai', 'agentrouter.ts')
const openai = read('src', 'services', 'ai', 'openai.ts')
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

test('§4 CONFIGURATION_ERROR exists for bad server-side config', () => {
  assert.match(errors, /'CONFIGURATION_ERROR'/, 'code registered in the union')
  assert.match(errors, /class ConfigurationError extends AiBaseError/)
})

// ---------------------------------------------------------------------------
// §5 — bounded retry
// ---------------------------------------------------------------------------

test('§5 retry policy is bounded: 2 attempts per model', () => {
  assert.match(router, /DEFAULT_RETRY_POLICY: RetryPolicy = \{\s*maxAttempts: 2,/)
})

test('§5 provider attempt budget caps total attempts at 6', () => {
  assert.match(router, /MAX_ATTEMPTS_PER_PROVIDER = 6/)
  assert.match(router, /providerAttemptsUsed >= MAX_ATTEMPTS_PER_PROVIDER/)
})

test('§5 backoff uses exponential delay with jitter', () => {
  assert.match(router, /backoffMultiplier/, 'exponential base')
  assert.match(router, /0\.75 \+ Math\.random\(\) \* 0\.5/, '±25% jitter')
})

// ---------------------------------------------------------------------------
// §6 — Agent Router model registry (LIVE-verified 2026-08-28)
// ---------------------------------------------------------------------------

test('§6 Agent Router registry is the live-verified, cost-ordered set', () => {
  const registry = agentrouter.match(/export const AGENT_ROUTER_MODELS = \[[\s\S]*?\] as const/)?.[0] ?? ''
  assert.ok(registry.length > 0, 'AGENT_ROUTER_MODELS registry found')
  const ids = [...registry.matchAll(/'([a-z0-9.-]+)'/g)].map((m) => m[1])
  assert.deepEqual(ids, [
    'deepseek-v4-flash',
    'glm-5.3',
    'gpt-5.6-sol',
    'claude-opus-4-8',
    'claude-opus-5',
  ], 'registry must be exactly the 5 verified ids in cost order')
})

test('§6 task matrices lead with cheap models (operator budget optimization)', () => {
  const matrix = router.match(/export const MODEL_MATRIX[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(matrix.length > 0, 'MODEL_MATRIX found')
  const agentRows = matrix.match(/AGENT_ROUTER: \[[^\]]*\]/g) ?? []
  assert.ok(agentRows.length >= 5, 'all five task rows have AGENT_ROUTER chains')
  for (const row of agentRows) {
    const first = row.match(/\['([a-z0-9.-]+)'/)?.[1]
    assert.ok(
      first === 'deepseek-v4-flash' || first === 'glm-5.3',
      `task chains must lead with a cheap-tier model (got ${first})`
    )
  }
})

test('§7 retired provider adapters are deleted from the codebase', () => {
  assert.equal(existsSync(resolve(REPO_ROOT, 'src', 'services', 'ai', 'gemini.ts')), false, 'gemini.ts removed')
  assert.equal(existsSync(resolve(REPO_ROOT, 'src', 'services', 'ai', 'openrouter.ts')), false, 'openrouter.ts removed')
})

test('§1 generateContent-era adapters are gone; the gateway is OpenAI-style chat', () => {
  assert.match(agentrouter, /chat\/completions/)
  // Official AgentRouter.org gateway (the old internal-api.z.ai default never
  // resolved publicly and failed every call with "fetch failed").
  assert.match(agentrouter, /agentrouter\.org\/v1/)
  assert.doesNotMatch(agentrouter, /internal-api\.z\.ai/, 'dead z.ai host must not come back')
  assert.doesNotMatch(agentrouter, /X-Z-AI-From/, 'z.ai SDK headers must not leak to AgentRouter')
  assert.doesNotMatch(agentrouter, /thinking:/, 'z.ai-only body extensions must not be sent')
  assert.match(agentrouter, /looksLikeWafChallenge/, 'WAF interstitials must be detected, not retried')
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

test('§12 fallback order is deterministic: AGENT_ROUTER → OPENAI', () => {
  const order = router.match(/PROVIDER_FALLBACK_ORDER: ProviderId\[\] = \[[\s\S]*?\]/)
  assert.ok(order, 'fallback order is an explicit constant')
  const ids = order[0].match(/'(AGENT_ROUTER|OPENAI)'/g)
  assert.deepEqual(ids, ["'AGENT_ROUTER'", "'OPENAI'"])
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
      !/(AGENT_ROUTER|OPENAI):/.test(sentence) &&
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
    assert.doesNotMatch(file, /(GEMINI|AGENT_ROUTER)_API_KEY.*\$\{.*key/, 'no interpolated key output')
  }
  assert.match(aiDiagnostics, /environment: "Convex"/, 'reports the runtime, per spec §2')
})

test('§17 Agent Router probe verifies every configured model id', () => {
  assert.match(aiDiagnostics, /modelProbes/, 'per-model probes are reported')
  assert.match(agentrouter, /async ping\(/)
})

test('§6 the admin surface reports the Agent Router model registry', () => {
  assert.match(aiDiagnostics, /models: agentRouter\.availableModels/)
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

// ---------------------------------------------------------------------------
// §5/§23 — job-level transient-outage auto-retry (worker)
// ---------------------------------------------------------------------------

test('§23 planning-phase transient outages auto-retry with backoff instead of failing', () => {
  assert.match(worker, /bumpAutoRetry/, 'rolls the job back to queued')
  assert.match(worker, /transientCodes/, 'explicit retryable-code allowlist')
  assert.match(worker, /!job\.blueprint/, 'planning phase only — nothing to duplicate')
  assert.match(worker, /\(job\.autoRetries \?\? 0\) < 2/, 'bounded to 2 automatic retries')
  assert.match(worker, /runAfter\(delayMs, internal\.worker\.processJob/, 're-invokes the worker after a delay')
})

test('§23 transient unit failures requeue on a delay, not instantly', () => {
  assert.match(worker, /transientRequeue \? 45_000 : 0/, '45s delay on transient unit requeue')
  assert.match(worker, /async function scheduleNext\([\s\S]*?delayMs = 0/, 'scheduleNext takes a delay')
})

test('§23 autoRetries is a distinct, optional job field (not user retryCount)', () => {
  const schema = read('convex', 'schema.ts')
  assert.match(schema, /autoRetries: v\.optional\(v\.number\(\)\)/)
})

test('§22 every provider request is timeout-bounded via AbortController', () => {
  for (const [name, file] of [['agentrouter', agentrouter], ['openai', openai]]) {
    assert.match(file, /AbortController/, `${name} uses AbortController`)
    assert.match(file, /controller\.abort\(\)/, `${name} aborts on timeout`)
  }
})

// ---------------------------------------------------------------------------
// §24 — environment hygiene
// ---------------------------------------------------------------------------

test('§24 no NEXT_PUBLIC_* AI key variables anywhere', () => {
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_(AGENT_ROUTER|OPENAI)_API_KEY/)
  assert.match(envExample, /npx convex env set AGENT_ROUTER_API_KEY/, 'Convex ownership documented')
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
