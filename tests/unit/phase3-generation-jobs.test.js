// Phase 3 tests — durable generation pipeline.
//
// Run: `node --test tests/unit/phase3-generation-jobs.test.js`
//
// Verifies (structurally, without a live Convex deployment):
//   - schema defines generationJobs + generationUnits with required fields/indexes
//   - job lifecycle status union matches the spec
//   - public vs internal function split (internalMutation/internalQuery)
//   - the worker honors cancellation between units
//   - terminal states are sticky (stale worker can't overwrite completed/failed)
//   - retry is bounded (retryCount cap)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..')

const schema = readFileSync(resolve(REPO_ROOT, 'convex', 'schema.ts'), 'utf8')
const generation = readFileSync(resolve(REPO_ROOT, 'convex', 'generation.ts'), 'utf8')
const worker = readFileSync(resolve(REPO_ROOT, 'convex', 'worker.ts'), 'utf8')

test('schema defines generationJobs table with the full spec field set', () => {
  assert.ok(schema.includes('generationJobs: defineTable'), 'generationJobs table missing')
  const requiredFields = [
    'userId', 'workspaceId', 'artifactId', 'prompt', 'artifactType', 'outputFormat',
    'status', 'currentStage', 'progress',
    'totalUnits', 'completedUnits', 'failedUnits',
    'model', 'provider', 'inputTokens', 'outputTokens',
    'estimatedCost', 'actualCost', 'retryCount',
    'error', 'createdAt', 'startedAt', 'completedAt', 'updatedAt',
    'blueprint',
  ]
  for (const f of requiredFields) {
    assert.ok(
      new RegExp(`${f}:\\s*v\\.`).test(schema),
      `generationJobs missing field: ${f}`
    )
  }
})

test('generationJobs status union covers the full lifecycle', () => {
  const statuses = [
    'queued', 'planning', 'generating', 'validating', 'rendering',
    'uploading', 'completed', 'failed', 'cancelled',
  ]
  for (const s of statuses) {
    assert.ok(
      generation.includes(`v.literal("${s}")`) || schema.includes(`v.literal("${s}")`),
      `status literal "${s}" not found`
    )
  }
})

test('schema defines generationUnits with per-unit retry tracking', () => {
  assert.ok(schema.includes('generationUnits: defineTable'), 'generationUnits table missing')
  const requiredFields = [
    'jobId', 'sequence', 'title', 'type', 'status',
    'content', 'metadata', 'attempts', 'error',
    'createdAt', 'updatedAt',
  ]
  for (const f of requiredFields) {
    assert.ok(
      new RegExp(`${f}:\\s*v\\.`).test(schema),
      `generationUnits missing field: ${f}`
    )
  }
  // Required indexes for the access patterns
  assert.ok(schema.includes('by_jobId'), 'generationUnits needs by_jobId index')
  assert.ok(schema.includes('by_jobId_status'), 'generationUnits needs by_jobId_status index')
  assert.ok(schema.includes('by_jobId_sequence'), 'generationUnits needs by_jobId_sequence index')
})

test('public API surface: enqueue, resume, cancel, get, list (durable Convex jobs)', () => {
  // The public surface changed with the durable-worker refactor: users enqueue
  // a job (mutation, schedules internal.worker.processJob), can cancel/resume,
  // and read job state via live queries. The worker — not the client — finishes
  // the job (completeJobRendered is a mutation invoked by the render route).
  const expected = [
    'export const enqueueJob = mutation(',
    'export const resumeUserJob = mutation(',
    'export const cancelUserJob = mutation(',
    'export const getJob = query(',
    'export const getJobUnits = query(',
    'export const listUserJobs = query(',
    'export const getActiveUserJob = query(',
    'export const completeJobRendered = mutation(',
  ]
  for (const decl of expected) {
    assert.ok(generation.includes(decl), `missing public function declaration: ${decl}`)
  }
})

test('internal state mutations use internalMutation (not client-callable)', () => {
  const internalFns = [
    'createJob', 'initializeUnits', 'claimUnit', 'completeUnit',
    'failUnit', 'setJobStatus', 'requeueFailedUnits', 'attachArtifact',
  ]
  for (const fn of internalFns) {
    assert.ok(
      generation.includes(`export const ${fn} = internalMutation(`),
      `${fn} must be an internalMutation`
    )
  }
  assert.ok(
    generation.includes('export const internalGetJob = internalQuery('),
    'internalGetJob must be an internalQuery'
  )
})

test('every state change routes through internal.generation.* (committed mutations)', () => {
  // ARCHITECTURE (post durable-worker refactor):
  //   - generation.ts user-facing entry points are MUTATIONS/QUERIES (ctx.db
  //     reads are legal there; writes are also legal in Convex mutations —
  //     the important guarantee is that ACTIONS never touch ctx.db, because
  //     actions are not committed atomically and can be retried).
  //   - worker.ts ("use node" ACTIONS) must therefore contain ZERO ctx.db
  //     calls and route every state change through internal.generation.*
  assert.equal(
    (worker.match(/ctx\.db\./g) || []).length,
    0,
    'worker.ts is an action module — it must never touch ctx.db directly'
  )
  for (const internal of [
    'internal.generation.createJob',
    'internal.generation.initializeUnits',
    'internal.generation.setJobStatus',
    'internal.generation.completeUnit',
  ]) {
    const used = generation.includes(internal) || worker.includes(internal)
    assert.ok(used, `state changes must route through ${internal}`)
  }
  // Enqueue schedules the durable worker instead of doing the AI work inline.
  assert.ok(
    generation.includes('ctx.scheduler.runAfter(0, internal.worker.processJob') ||
      worker.includes('ctx.scheduler.runAfter(0, internal.worker.processJob') ||
      worker.includes('runAfter(0, internal.worker.processJob'),
    'enqueue/worker must schedule internal.worker.processJob (durable continuation)'
  )
})

test('worker honors cancellation between units', () => {
  assert.ok(
    /status === "cancelled"[\s\S]{0,400}stopping worker/.test(generation) ||
      /cancelled[\s\S]{0,200}return/.test(generation),
    'generatePendingUnits must check job status and stop when cancelled'
  )
})

test('terminal states are sticky (stale workers cannot resurrect a job)', () => {
  assert.ok(
    /terminal[\s\S]{0,200}includes\(job\.status\)[\s\S]{0,100}return/.test(generation),
    'setJobStatus must refuse to overwrite terminal states'
  )
})

test('retries are bounded (max 3 per job)', () => {
  assert.ok(
    generation.includes('retryCount >= 3') || generation.includes('RETRY_LIMIT'),
    'retryFailedUnits must enforce a retry cap'
  )
})

test('job ownership is enforced on user-facing entry points', () => {
  // Two enforcement patterns are valid:
  //   Direct:    the function compares job.userId !== args.userId
  //   Server-side: the Next.js API layer resolves the session user and passes
  //              a serverToken — the mutation trusts only the server token
  //              (assertServerToken), so ownership is enforced by the userId
  //              args coming exclusively from the verified session.
  // Every user-facing entry point (enqueueJob, resumeUserJob, cancelUserJob,
  // claimRender) must be a mutation guarded by assertServerToken.
  for (const fn of ['enqueueJob', 'resumeUserJob', 'cancelUserJob', 'claimRender']) {
    const decl = `export const ${fn} = mutation(`
    assert.ok(generation.includes(decl), `missing user-facing mutation: ${fn}`)
    const body = generation.slice(generation.indexOf(decl))
    const fnSource = body.slice(0, body.indexOf('\n})'))
    assert.ok(
      fnSource.includes('assertServerToken'),
      `${fn} must verify the server token (ownership enforced server-side)`
    )
  }
  // Read paths enforce ownership directly against the query args.
  const directChecks = (generation.match(/job\.userId !== args\.userId/g) || []).length
  assert.ok(
    directChecks >= 2,
    `expected ≥2 direct ownership checks (getJob/getJobUnits), found ${directChecks}`
  )
})

test('resumability: durable jobs persist blueprint + units and can resume', () => {
  assert.ok(
    generation.includes('resumeUserJob'),
    'a resume entry point must exist (resumeUserJob)'
  )
  assert.ok(
    generation.includes('internal.worker.processJob'),
    'worker must be scheduled via internal.worker.processJob (durable, survives tab close)'
  )
  // Blueprint is persisted on the job so a resume doesn't re-plan.
  // (The validator was loosened to v.any() — v.object({}) rejects every real
  // blueprint payload in Convex, breaking initializeUnits at runtime.)
  assert.ok(
    /blueprint:\s*v\.optional\(v\./.test(schema),
    'generationJobs.blueprint must be persisted for resume-without-replan'
  )
})

test('AI calls go through the canonical aiRouter (no raw provider URLs)', () => {
  // The AI layer lives in src/services/ai and is imported by the worker.
  assert.ok(worker.includes('aiRouter'), 'worker must use the canonical aiRouter')
  assert.ok(
    !worker.includes('https://openrouter.ai') && !worker.includes('generativelanguage.googleapis.com'),
    'worker.ts must not contain raw provider URLs — the aiRouter owns endpoints'
  )
})
