// =============================================================================
// FILO AI — Router (retry + provider fallback + model selection)
// =============================================================================
// The single entry point for all AI generation in Filo:
//
//   import { aiRouter } from '@/services/ai'
//   const response = await aiRouter.generate({ messages, options })
//
// Responsibilities:
//   1. Pick a task-appropriate model (model selection table below).
//   2. Try the primary provider (Gemini). On retryable failure, retry with
//      exponential backoff + jitter.
//   3. After retries exhaust, fall through to the next configured provider.
//   4. Aggregate failures into AllProvidersFailedError with every attempt.
//
// Fallback order: GEMINI → OPENROUTER → OPENAI (skipping unconfigured ones).
// =============================================================================

import type {
  AiRequest,
  AiResponse,
  ProviderId,
  RetryPolicy,
  ProviderHealth,
  AiRequestOptions,
} from './types'
import {
  registerDefaultProviders,
  listProviders,
  getProvider,
} from './provider'
import {
  AiBaseError,
  AllProvidersFailedError,
  normalizeAiError,
} from './errors'

// ==================== MODEL SELECTION TABLE ====================

/** Task categories we route for. */
export type AiTask =
  | 'fast' // short, cheap, high-volume (classification, titles)
  | 'generation' // standard document content generation
  | 'reasoning' // planning, outlining, complex structure
  | 'json' // structured output / JSON schema tasks
  | 'longform' // long-document sections with big context

/**
 * Model preference per task, per provider. First entry is preferred; the
 * router walks the list on model-level failure (404 MODEL_NOT_FOUND, or a
 * retryable failure that exhausts the model's bounded attempts), then falls
 * through to the remaining provider registry entries.
 *
 * GEMINI ids verified 2026-08-28 (Google docs + runtime evidence):
 *   • 2.0 ids are DEAD (shut down June 1, 2026) — never referenced.
 *   • Pro ids are PAID-TIER ONLY since April 1, 2026 (404 on free keys) —
 *     they sit at the TAIL so free-tier deployments never waste their
 *     attempt budget on them.
 *   • Leads are the `-latest` aliases + the current GA flash model
 *     (gemini-3.5-flash); gemini-2.5-flash sunsets Oct 16, 2026.
 *
 * OPENROUTER slugs verified against the LIVE public catalog
 * (GET https://openrouter.ai/api/v1/models, 2026-08-28): the previous
 * 'anthropic/claude-3.5-sonnet' and 'google/gemini-2.0-flash-001' slugs are
 * RETIRED (404 MODEL_NOT_FOUND on every call).
 */
export const MODEL_MATRIX: Record<AiTask, Partial<Record<ProviderId, readonly string[]>>> = {
  fast: {
    GEMINI: ['gemini-flash-lite-latest', 'gemini-flash-latest'],
    OPENROUTER: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash'],
    OPENAI: ['gpt-4o-mini'],
  },
  generation: {
    GEMINI: ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-flash-lite-latest'],
    OPENROUTER: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash'],
    OPENAI: ['gpt-4o-mini', 'gpt-4o'],
  },
  reasoning: {
    // Pro ids come LAST: planning wants reasoning quality, but on the free
    // tier pro models 404 since 2026-04-01 — flash aliases carry planning
    // instead, and paid-tier keys still reach the pro alias as a tail option.
    GEMINI: ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-pro-latest'],
    OPENROUTER: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5-mini'],
    OPENAI: ['gpt-4o', 'gpt-4.1'],
  },
  json: {
    GEMINI: ['gemini-flash-latest', 'gemini-flash-lite-latest'],
    OPENROUTER: ['openai/gpt-4o-mini'],
    OPENAI: ['gpt-4o-mini', 'gpt-4o'],
  },
  longform: {
    GEMINI: ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.5-flash'],
    OPENROUTER: ['anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash'],
    OPENAI: ['gpt-4o'],
  },
}

/** Default retry policy — bounded, spec §5: attempt → short backoff →
 *  attempt → next model / fallback. Two tries per model; the provider
 *  budget below decides how many DISTINCT models get a shot. Base delay is
 *  2s because Google's 503 "high demand" spikes rarely clear in <1s. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 2,
  baseDelayMs: 2_000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
}

/** Hard cap on total attempts per provider per generate() call (all models
 *  combined) — no provider ever eats more than 6 round trips of one user
 *  request. With 2 attempts per model that is ≥3 DISTINCT models per
 *  provider; cheap non-retryable 404 advances leave more budget for live
 *  candidates. */
export const MAX_ATTEMPTS_PER_PROVIDER = 6

// ==================== PROVIDER HEALTH (short-lived, in-isolate) ====================
// Spec §14: quota exhaustion and repeated 5xx temporarily demote a provider
// instead of sending every user request into a retry storm. State is
// deliberately in-memory (per serverless isolate) and expires quickly — a
// provider is NEVER permanently disabled based on transient failures.

type ProviderHealthState = 'healthy' | 'degraded' | 'quota_exhausted'

interface ProviderHealthEntry {
  state: ProviderHealthState
  /** Epoch ms after which the entry expires back to healthy. */
  until: number
  consecutiveUnavailable: number
}

const QUOTA_COOLDOWN_MS = 10 * 60 * 1000
const DEGRADED_COOLDOWN_MS = 2 * 60 * 1000
const DEGRADED_AFTER_CONSECUTIVE_UNAVAILABLE = 4

const providerHealth = new Map<ProviderId, ProviderHealthEntry>()

function freshHealthEntry(): ProviderHealthEntry {
  return { state: 'healthy', until: 0, consecutiveUnavailable: 0 }
}

function currentHealth(id: ProviderId): ProviderHealthEntry {
  const entry = providerHealth.get(id)
  if (!entry) return freshHealthEntry()
  if (entry.state !== 'healthy' && Date.now() >= entry.until) {
    // Cooldown expired — recover, keep the consecutive counter so repeated
    // failures immediately re-demote.
    entry.state = 'healthy'
  }
  return entry
}

function recordProviderFailure(id: ProviderId, code: string): void {
  const entry = currentHealth(id)
  if (code === 'QUOTA_EXCEEDED') {
    // Account-level billing exhaustion — hammering changes nothing.
    entry.state = 'quota_exhausted'
    entry.until = Date.now() + QUOTA_COOLDOWN_MS
  } else if (
    code === 'PROVIDER_UNAVAILABLE' ||
    code === 'TIMEOUT' ||
    code === 'NETWORK_ERROR'
  ) {
    entry.consecutiveUnavailable += 1
    if (entry.consecutiveUnavailable >= DEGRADED_AFTER_CONSECUTIVE_UNAVAILABLE) {
      // Retry storm guard: reduce future attempts instead of skipping
      // outright (transient 503s must still be able to recover).
      entry.state = 'degraded'
      entry.until = Date.now() + DEGRADED_COOLDOWN_MS
    }
  } else {
    // Auth/model/request errors say nothing about availability.
    entry.consecutiveUnavailable = 0
  }
  providerHealth.set(id, entry)
}

function recordProviderSuccess(id: ProviderId): void {
  providerHealth.set(id, freshHealthEntry())
}

/** Health snapshot for admin diagnostics (no network, no secrets). */
export function providerHealthSnapshot(): Array<{
  provider: ProviderId
  state: ProviderHealthState
  cooldownRemainingMs: number
}> {
  return (['GEMINI', 'OPENROUTER', 'OPENAI'] as ProviderId[]).map((id) => {
    const entry = currentHealth(id)
    return {
      provider: id,
      state: entry.state,
      cooldownRemainingMs: entry.state === 'healthy' ? 0 : Math.max(0, entry.until - Date.now()),
    }
  })
}

/** Provider fallback order. Unconfigured providers are skipped at runtime. */
export const PROVIDER_FALLBACK_ORDER: ProviderId[] = [
  'GEMINI',
  'OPENROUTER',
  'OPENAI',
]

// ==================== ROUTER ====================

export interface GenerateOptions extends AiRequestOptions {
  /** Task hint used for model selection when `model` is not pinned. */
  task?: AiTask
  /** Override the default retry policy. */
  retryPolicy?: Partial<RetryPolicy>
}

class AiRouter {
  private booted = false

  private ensureProviders(): void {
    if (!this.booted) {
      registerDefaultProviders()
      this.booted = true
    }
  }

  /** All providers, health snapshot (does not hit the network). */
  status(): Array<{ id: ProviderId; configured: boolean; defaultModel: string }> {
    this.ensureProviders()
    return listProviders().map((p) => ({
      id: p.id,
      configured: p.isConfigured(),
      defaultModel: p.defaultModel,
    }))
  }

  /** Probe every configured provider (network round-trips). */
  async health(): Promise<ProviderHealth[]> {
    this.ensureProviders()
    return Promise.all(listProviders().map((p) => p.healthCheck()))
  }

  /** In-isolate health snapshot (no network) — admin diagnostics. */
  healthSnapshot() {
    this.ensureProviders()
    return providerHealthSnapshot()
  }

  /**
   * Generate with retry + provider fallback.
   *
   * Retry semantics:
   *   - Retryable errors (rate limit, timeout, network, 5xx) are retried on
   *     the SAME provider with exponential backoff + jitter.
   *   - Non-retryable errors (auth, quota, bad request, content filtered)
   *     skip straight to the next provider.
   *   - After all providers fail, throws AllProvidersFailedError listing
   *     every attempt.
   */
  async generate(
    request: AiRequest,
    generateOptions: GenerateOptions = {}
  ): Promise<AiResponse> {
    this.ensureProviders()

    // ---------- REQUEST VALIDATION FIRST (spec §13) ----------
    // User/request errors must NEVER be fanned out to every provider: an
    // empty prompt is invalid for Gemini AND OpenRouter AND OpenAI alike.
    const messages = Array.isArray(request?.messages) ? request.messages : []
    const hasContent = messages.some((m) => String(m?.content ?? '').trim().length > 0)
    if (!hasContent) {
      throw new AiBaseError(
        'AI request rejected before any provider call: empty prompt.',
        'INVALID_REQUEST',
        'ROUTER',
        false
      )
    }

    const policy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      ...generateOptions.retryPolicy,
    }
    const trace = generateOptions.requestId || request.options?.requestId
    const traceTag = trace ? ` trace=${trace}` : ''

    const attemptLog: Array<{
      provider: ProviderId
      code: string
      message: string
    }> = []

    // Ordered provider chain: pinned provider first (if any), then defaults.
    const chain = this.buildProviderChain(generateOptions)

    for (const providerId of chain) {
      const provider = getProvider(providerId)
      if (!provider || !provider.isConfigured()) {
        // Spec §10/§12: an unconfigured provider is DISABLED, not attempted
        // and failed. It contributes one diagnostic line, zero network calls.
        attemptLog.push({
          provider: providerId,
          code: 'PROVIDER_UNCONFIGURED',
          message: provider
            ? 'disabled: no API key configured — skipped'
            : 'provider not registered — skipped',
        })
        continue
      }

      // Spec §14/§23: honor short-lived health state.
      const health = currentHealth(providerId)
      if (health.state === 'quota_exhausted') {
        attemptLog.push({
          provider: providerId,
          code: 'QUOTA_EXCEEDED',
          message: `skipped: quota cooldown active for ${Math.ceil((health.until - Date.now()) / 1000)}s`,
        })
        continue
      }

      const models = this.buildModelChain(providerId, request, generateOptions)
      // Degraded providers get ONE attempt per model instead of the full
      // budget — enough to recover, never enough for a storm.
      const providerMaxAttempts = health.state === 'degraded' ? 1 : policy.maxAttempts
      let providerAttemptsUsed = 0

      for (const model of models) {
        if (providerAttemptsUsed >= MAX_ATTEMPTS_PER_PROVIDER) {
          console.warn(
            `[AI]${traceTag} provider=${providerId} attempt budget (${MAX_ATTEMPTS_PER_PROVIDER}) exhausted — moving to next provider`
          )
          break
        }

        for (let attempt = 1; attempt <= providerMaxAttempts; attempt++) {
          providerAttemptsUsed += 1
          try {
            const response = await provider.generate({
              messages: request.messages,
              options: {
                ...request.options,
                ...generateOptions,
                model,
              },
            })

            recordProviderSuccess(providerId)
            if (attempt > 1 || models.length > 1) {
              console.info(
                `[AI]${traceTag} success provider=${providerId} model=${model} attempt=${attempt} tokens=${response.usage.totalTokens} durationMs=${response.durationMs}`
              )
            }
            return response
          } catch (err) {
            const aiErr = normalizeAiError(providerId, err)
            attemptLog.push({
              provider: providerId,
              code: aiErr.code,
              message: aiErr.message,
            })
            recordProviderFailure(providerId, aiErr.code)

            console.warn(
              `[AI]${traceTag} attempt failed provider=${providerId} model=${model} attempt=${attempt}/${providerMaxAttempts} code=${aiErr.code}: ${aiErr.message}`
            )

            // Spec §8/§23: quota/billing exhaustion is ACCOUNT-level. Stop
            // using this provider for the rest of THIS request and put it
            // on cooldown — do not walk its remaining models.
            if (aiErr.code === 'QUOTA_EXCEEDED') {
              break
            }

            // Model-not-found → the NEXT MODEL is a genuinely different
            // option (spec §15); retrying the same dead model is not.
            // Non-retryable → advance immediately; retryable → bounded
            // backoff below.
            if (!aiErr.retryable) break

            // Last attempt for this model → next model/provider.
            if (attempt === providerMaxAttempts) break

            // Exponential backoff with jitter (±25%).
            const backoff = Math.min(
              policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1),
              policy.maxDelayMs
            )
            const jitter = backoff * (0.75 + Math.random() * 0.5)
            await this.sleep(jitter)
          }
        }

        if (attemptLog.some((a) => a.provider === providerId && a.code === 'QUOTA_EXCEEDED')) {
          break
        }
      }
    }

    const aggregated = attemptLog.map((a) => ({
      provider: a.provider,
      code: a.code as AiBaseError['code'],
      message: a.message,
    }))
    // Developer diagnostics always retain the full failure chain (spec §16).
    console.error(`[AI]${traceTag} all providers failed:`, JSON.stringify(aggregated))
    throw new AllProvidersFailedError(aggregated)
  }

  /**
   * Convenience wrapper for JSON generation: parses and returns the object.
   * Throws JsonParseFailedError if the model returns non-JSON.
   */
  async generateJson<T = unknown>(
    request: AiRequest,
    generateOptions: GenerateOptions = {}
  ): Promise<T> {
    const response = await this.generate(
      {
        messages: request.messages,
        options: {
          ...request.options,
          responseFormat: { type: 'json' },
        },
      },
      { task: 'json', ...generateOptions }
    )
    return this.parseJson<T>(response.content)
  }

  /** Parse JSON that may be wrapped in markdown fences. */
  private parseJson<T>(raw: string): T {
    const trimmed = raw.trim()
    try {
      return JSON.parse(trimmed) as T
    } catch {
      // try to extract from ```json ... ``` fences
      const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (fenceMatch) {
        try {
          return JSON.parse(fenceMatch[1]) as T
        } catch {
          /* fall through */
        }
      }
      // try to find the first { ... } or [ ... ] block
      const braceMatch = trimmed.match(/[{[][\s\S]*[}\]]/)
      if (braceMatch) {
        try {
          return JSON.parse(braceMatch[0]) as T
        } catch {
          /* fall through */
        }
      }
      throw new AiBaseError(
        `Model returned non-JSON content: ${trimmed.slice(0, 200)}...`,
        'JSON_PARSE_FAILED',
        'ROUTER',
        true
      )
    }
  }

  private buildProviderChain(opts: GenerateOptions): ProviderId[] {
    // If the request pins a model that looks provider-specific, try that
    // provider first so the pinned model gets a chance before fallback.
    const pinned = opts.model
    if (pinned) {
      for (const id of PROVIDER_FALLBACK_ORDER) {
        const provider = getProvider(id)
        if (provider?.availableModels.includes(pinned)) {
          return [id, ...PROVIDER_FALLBACK_ORDER.filter((p) => p !== id)]
        }
      }
    }
    return PROVIDER_FALLBACK_ORDER
  }

  private buildModelChain(
    providerId: ProviderId,
    request: AiRequest,
    opts: GenerateOptions
  ): string[] {
    const provider = getProvider(providerId)
    if (!provider) return []

    // 1. Explicit model pin wins (a pinned model is a deliberate choice —
    //    we do NOT silently substitute it).
    const pinned = opts.model || request.options?.model
    if (pinned) return [pinned]

    // 2. Task-based matrix first…
    const task = opts.task || 'generation'
    const matrix = MODEL_MATRIX[task]?.[providerId] ?? []
    // 3. …then the rest of the provider's registry as a tail safety net.
    //    Keys provisioned at different times see different model sets, so a
    //    stale matrix entry must never strand the provider while a valid id
    //    remains. Dedup preserves priority order.
    const tail = provider.availableModels.filter((m) => !matrix.includes(m))
    const chain = [...matrix, ...tail]
    return chain.length > 0 ? chain : [provider.defaultModel]
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/** Singleton — the ONE object the rest of the app imports. */
export const aiRouter = new AiRouter()
