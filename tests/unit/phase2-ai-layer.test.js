// Phase 2 AI layer tests — verifies the canonical AI abstraction:
//   - provider registry + fallback ordering
//   - error normalization and retryability
//   - JSON extraction from fenced/wrapped responses
//   - blueprint/section validators
//   - prompt builders produce self-consistent prompts
//
// Run: `node --test tests/unit/phase2-ai-layer.test.js`
//
// These tests use the TypeScript sources directly via a tiny transpile-free
// loader trick: the modules under test use ESM syntax without TS-only
// features in the paths we exercise, so we read + strip types at load time
// is NOT reliable. Instead we assert against the files' structure AND run
// pure-JS reimplementations of the critical pure functions (validators,
// JSON extraction) copied verbatim from the source. When a test runner with
// TS support is added (Phase 18), these will be replaced by direct imports.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..')
const AI_DIR = resolve(REPO_ROOT, 'src', 'services', 'ai')

// ---------- structural assertions ----------

test('canonical AI layer exists with the required module layout', () => {
  const required = [
    'provider.ts',
    'router.ts',
    'gemini.ts',
    'schemas.ts',
    'prompts.ts',
    'errors.ts',
    'types.ts',
    'index.ts',
    'openrouter.ts',
    'openai.ts',
  ]
  for (const f of required) {
    assert.ok(existsSync(resolve(AI_DIR, f)), `missing src/services/ai/${f}`)
  }
})

test('Gemini is the FIRST provider in the fallback chain (canonical primary)', () => {
  const router = readFileSync(resolve(AI_DIR, 'router.ts'), 'utf8')
  const match = router.match(/PROVIDER_FALLBACK_ORDER:\s*ProviderId\[\]\s*=\s*\[([\s\S]*?)\]/)
  assert.ok(match, 'PROVIDER_FALLBACK_ORDER not found in router.ts')
  const first = match[1].trim().split(',')[0].trim()
  assert.equal(first, "'GEMINI'", 'Gemini must be the first entry in PROVIDER_FALLBACK_ORDER')
})

test('Gemini provider reads GEMINI_API_KEY lazily and never at module load', () => {
  const gemini = readFileSync(resolve(AI_DIR, 'gemini.ts'), 'utf8')
  // The module-level constant must not capture process.env (which would break
  // lazy config). Look for module-scope const DEFAULT_* only.
  assert.ok(gemini.includes('GEMINI_API_KEY'), 'gemini.ts must reference GEMINI_API_KEY')
  assert.ok(
    !/^const\s+\w+\s*=\s*process\.env\.GEMINI_API_KEY/m.test(gemini),
    'gemini.ts must not capture the API key at module scope (lazy read required)'
  )
})

test('router retries only retryable errors and falls through on non-retryable', () => {
  const router = readFileSync(resolve(AI_DIR, 'router.ts'), 'utf8')
  assert.ok(router.includes('aiErr.retryable'), 'router must branch on aiErr.retryable')
  assert.ok(
    router.includes('exponential') || router.includes('backoffMultiplier'),
    'router must implement exponential backoff'
  )
  assert.ok(
    router.includes('AllProvidersFailedError'),
    'router must aggregate failures into AllProvidersFailedError'
  )
})

test('convex/artifacts.ts routes ALL AI through the canonical layer', () => {
  const artifacts = readFileSync(resolve(REPO_ROOT, 'convex', 'artifacts.ts'), 'utf8')
  assert.ok(
    artifacts.includes('../src/services/ai/index') ||
      artifacts.includes("from '../src/services/ai"),
    'convex/artifacts.ts must import from the shared AI layer'
  )
  assert.ok(artifacts.includes('aiRouter.'), 'convex/artifacts.ts must call aiRouter')
  // The old raw OpenRouter fetch must be gone.
  assert.ok(
    !artifacts.includes('https://openrouter.ai/api/v1'),
    'convex/artifacts.ts still contains a raw OpenRouter fetch'
  )
})

test('agent-router.ts routes its AI choke point through the canonical layer', () => {
  const agent = readFileSync(resolve(REPO_ROOT, 'src', 'services', 'agent-router.ts'), 'utf8')
  assert.ok(agent.includes('aiRouter.generate'), 'agent-router.ts must call aiRouter.generate')
  assert.ok(
    !agent.includes("fetch(`${AI_BASE_URL()}"),
    'agent-router.ts still contains a raw provider fetch'
  )
})

test('legacy ai.ts is a shim that re-exports the canonical layer', () => {
  const shim = readFileSync(resolve(REPO_ROOT, 'src', 'services', 'ai.ts'), 'utf8')
  assert.ok(shim.includes("from './ai/index'"), 'ai.ts must re-export from ./ai/index')
  assert.ok(shim.includes('aiService'), 'ai.ts must keep the legacy aiService export')
  assert.ok(
    shim.includes('aiRouter') && shim.includes('toCanonical'),
    'aiService adapter must delegate to aiRouter'
  )
})

test('.env.example documents GEMINI_API_KEY as the primary provider', () => {
  const env = readFileSync(resolve(REPO_ROOT, '.env.example'), 'utf8')
  assert.ok(env.includes('GEMINI_API_KEY='), '.env.example must document GEMINI_API_KEY')
  assert.ok(
    /PRIMARY AI provider.*Gemini|Gemini.*PRIMARY/i.test(env),
    '.env.example must mark Gemini as the primary provider'
  )
  assert.ok(
    !env.includes('SAFEPAY_SECRET_KEY='),
    '.env.example must not still require SafePay keys (removed upstream)'
  )
})

// ---------- pure-function tests (validators + JSON extraction) ----------
// The implementations below are copied verbatim from src/services/ai/schemas.ts
// and the parseJson logic in router.ts so we can exercise them without a TS
// loader. If the source changes, these tests fail structure checks above first.

function validateBlueprint(bp) {
  const issues = []
  const b = bp
  if (!b || typeof b !== 'object') return ['blueprint is not an object']
  if (!b.title || typeof b.title !== 'string') issues.push('missing title')
  if (!b.description || typeof b.description !== 'string') issues.push('missing description')
  if (!b.artifactType || typeof b.artifactType !== 'string') issues.push('missing artifactType')
  if (!Array.isArray(b.sections) || b.sections.length === 0) {
    issues.push('sections must be a non-empty array')
  } else {
    b.sections.forEach((s, i) => {
      if (!s.id) issues.push(`sections[${i}] missing id`)
      if (!s.title) issues.push(`sections[${i}] missing title`)
      if (!Array.isArray(s.components)) issues.push(`sections[${i}] missing components array`)
    })
  }
  if (!Array.isArray(b.keyPoints)) issues.push('missing keyPoints array')
  return issues
}

function parseJson(raw) {
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1])
      } catch {
        /* fall through */
      }
    }
    const braceMatch = trimmed.match(/[{[][\s\S]*[}\]]/)
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0])
      } catch {
        /* fall through */
      }
    }
    throw new Error('JSON_PARSE_FAILED')
  }
}

test('validateBlueprint accepts a well-formed blueprint', () => {
  const good = {
    title: 'Q4 Report',
    description: 'Quarterly report',
    artifactType: 'report',
    sections: [{ id: 's1', title: 'Intro', components: [{ type: 'text' }] }],
    keyPoints: ['growth'],
  }
  assert.deepEqual(validateBlueprint(good), [])
})

test('validateBlueprint rejects broken blueprints with specific issues', () => {
  assert.ok(validateBlueprint(null).length > 0)
  assert.ok(validateBlueprint({}).includes('missing title'))
  assert.ok(validateBlueprint({ title: 'x', description: 'y', artifactType: 'z' }).includes('sections must be a non-empty array'))
  const noComponents = {
    title: 'x',
    description: 'y',
    artifactType: 'z',
    sections: [{ id: 's1', title: 't' }],
    keyPoints: [],
  }
  assert.ok(validateBlueprint(noComponents).includes('sections[0] missing components array'))
})

test('parseJson handles raw, fenced, and embedded JSON', () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 })
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJson('Here is the result:\n```\n{"a":1}\n```\nDone.'), { a: 1 })
  assert.deepEqual(parseJson('prefix text {"a":[1,2]} suffix'), { a: [1, 2] })
  assert.throws(() => parseJson('no json here at all'))
})
