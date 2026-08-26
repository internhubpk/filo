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

test('public API surface: start, get, list, retry, cancel, finish', () => {
  const publicFns = [
    'startGenerationJob',
    'getJob',
    'getJobUnits',
    'listUserJobs',
    'retryFailedUnits',
    'cancelGenerationJob',
    'finishJob',
  ]
  for (const fn of publicFns) {
    assert.ok(
      generation.includes(`export const ${fn} = action(`) ||
        generation.includes(`export const ${fn} = query(`),
      `missing public function: ${fn}`
    )
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
  // Strip out the internalMutation/internalQuery handler bodies — those are
  // ALLOWED to use ctx.db (that's what mutations are for). Then check that
  // the remaining code (the actions + worker functions) contains no ctx.db.
  const stripped = generation.replace(
    /internalMutation\(\{[\s\S]*?\n\}\)/g,
    'internalMutation({ /* stripped */ })'
  ).replace(
    /internalQuery\(\{[\s\S]*?\n\}\)/g,
    'internalQuery({ /* stripped */ })'
  )

  const actionDbCalls = stripped.match(/^\s*await ctx\.db\./gm) || []
  assert.equal(
    actionDbCalls.length, 0,
    `action code calls ctx.db directly (${actionDbCalls.length} hits) — actions must use runMutation/runQuery`
  )
  assert.ok(
    generation.includes('internal.generation.setJobStatus'),
    'worker must transition status via internal.generation.setJobStatus'
  )
  assert.ok(
    generation.includes('internal.generation.completeUnit'),
    'worker must persist unit content via internal.generation.completeUnit'
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
  //   Direct:    const job = ...; if (!job || job.userId !== args.userId) return null
  //   Indirect:  const job = await ctx.runQuery(api.generation.getJob, {jobId, userId});
  //              if (!job) return NOT_FOUND   // getJob returns null for non-owners
  // The user-facing functions (getJob, getJobUnits, retryFailedUnits,
  // cancelGenerationJob, finishJob) must EACH do one of these before mutating.

  const directChecks = (generation.match(/job\.userId !== args\.userId/g) || []).length
  // Indirect pattern: every action that calls api.generation.getJob with the
  // caller's userId and rejects on null gets ownership enforcement for free.
  const indirectChecks = (
    generation.match(/ctx\.runQuery\(api\.generation\.getJob,[\s\S]{0,120}?userId: args\.userId/g) || []
  ).length

  assert.ok(
    directChecks >= 2,
    `expected ≥2 direct ownership checks (getJob/getJobUnits), found ${directChecks}`
  )
  assert.ok(
    directChecks + indirectChecks >= 5,
    `expected ≥5 total ownership checks (2 direct + 3 indirect), found ${directChecks}+${indirectChecks}`
  )
})

test('resumability: startGenerationJob supports resumeJobId + crash recovery', () => {
  assert.ok(
    generation.includes('resumeJobId'),
    'startGenerationJob must accept resumeJobId'
  )
  assert.ok(
    generation.includes('generatePendingUnits'),
    'worker must expose a unit-loop that can resume from pending units'
  )
  // Blueprint is persisted on the job so a resume doesn't re-plan.
  assert.ok(
    /blueprint: v\.optional\(v\.object\(\{\}\)\)/.test(schema),
    'generationJobs.blueprint must be persisted for resume-without-replan'
  )
})

test('AI calls go through the canonical aiRouter (no raw fetches)', () => {
  assert.ok(generation.includes('aiRouter.generateJson'), 'must use aiRouter.generateJson')
  assert.ok(
    !generation.includes('https://openrouter.ai') && !generation.includes('generativelanguage.googleapis.com'),
    'generation.ts must not contain raw provider URLs'
  )
})
