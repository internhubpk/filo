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
//   2. Try the primary provider (Agent Router gateway). On retryable failure,
//      retry with exponential backoff + jitter.
//   3. On provider-fatal failure (auth / config / quota) or a dead gateway
//      (repeat network errors), abandon the provider immediately.
//   4. Fall through to the next INDEPENDENT provider in the chain.
//   5. Aggregate failures into AllProvidersFailedError with every attempt.
//
// Fallback order: AGENT_ROUTER → GEMINI → OPENAI (skipping unconfigured).
// Each id is a different company + endpoint + credential: AgentRouter being
// unreachable can never take Gemini or OpenAI down with it.
// =============================================================================

import type {
  AiRequest,
  AiResponse,
  ProviderId,
  RetryPolicy,
  ProviderHealth,
  AiRequestOptions,
  AiStreamResult,
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
import { extractJsonObject } from '../artifact-planning'

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
 * AGENT_ROUTER ids are the operator-designated pool served by the
 * AgentRouter gateway (OpenAI-compatible, https://co.agentrouter.org/v1):
 * deepseek-v4-flash, glm-5.3, gpt-5.6-sol, claude-opus-4-8, claude-opus-5.
 * GEMINI ids are Google's Generative Language API models (DIRECT — not
 * reachable through any gateway), cost-ordered flash-lite → flash → pro.
 * Gemini family is the 3.x line (gemini-3.5-flash-lite, gemini-3.6-flash,
 * gemini-3.1-pro-preview) — Google retired the 2.5 family for new
 * deployments on 2026-08-29 (404 MODEL_NOT_FOUND with replacement ids).
 *
 * Selection is COST-OPTIMIZED FOR THE OPERATOR ("budget to me, not the
 * users"): the cheapest capable model leads every task; premium models are
 * reached only as quality escalation after bounded failures.
 */
export const MODEL_MATRIX: Record<AiTask, Partial<Record<ProviderId, readonly string[]>>> = {
  fast: {
    AGENT_ROUTER: ['deepseek-v4-flash', 'glm-5.3'],
    GEMINI: ['gemini-3.5-flash-lite', 'gemini-3.6-flash'],
    OPENAI: ['gpt-4o-mini'],
  },
  generation: {
    AGENT_ROUTER: ['deepseek-v4-flash', 'glm-5.3', 'gpt-5.6-sol'],
    GEMINI: ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.1-pro-preview'],
    OPENAI: ['gpt-4o-mini', 'gpt-4o'],
  },
  reasoning: {
    // Planning wants structure quality; the mid-tier model leads, premium
    // models escalate only after bounded failures.
    AGENT_ROUTER: ['glm-5.3', 'gpt-5.6-sol', 'claude-opus-4-8'],
    GEMINI: ['gemini-3.6-flash', 'gemini-3.1-pro-preview'],
    OPENAI: ['gpt-4o', 'gpt-4.1'],
  },
  json: {
    AGENT_ROUTER: ['deepseek-v4-flash', 'glm-5.3'],
    GEMINI: ['gemini-3.5-flash-lite', 'gemini-3.6-flash'],
    OPENAI: ['gpt-4o-mini', 'gpt-4o'],
  },
  longform: {
    AGENT_ROUTER: ['glm-5.3', 'deepseek-v4-flash', 'gpt-5.6-sol'],
    GEMINI: ['gemini-3.6-flash', 'gemini-3.1-pro-preview'],
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
 *  candidates. Provider-fatal errors (see PROVIDER_FATAL_CODES) and the
 *  network-failure cap below usually end a provider far earlier. */
export const MAX_ATTEMPTS_PER_PROVIDER = 6

/**
 * Errors that are FATAL FOR THE WHOLE PROVIDER (not just the current model):
 * retrying another model on the same provider provably cannot succeed.
 *   AUTH_FAILED / API_KEY_MISSING → the credential is broken account-wide
 *   CONFIGURATION_ERROR           → wrong base URL / WAF-blocked host
 *   QUOTA_EXCEEDED                → account-level billing exhaustion
 * The router abandons the provider on the FIRST such error and moves on.
 */
export const PROVIDER_FATAL_CODES: ReadonlySet<string> = new Set([
  'AUTH_FAILED',
  'API_KEY_MISSING',
  'CONFIGURATION_ERROR',
  'QUOTA_EXCEEDED',
])

/** Consecutive NETWORK_ERROR/TIMEOUT failures allowed per provider per
 *  generate() call. Two failed round trips against the same host mean the
 *  network path itself is down — walking the remaining models of the SAME
 *  unreachable gateway is a retry storm, so the router skips straight to the
 *  next independent provider. A single transient blip still recovers via the
 *  normal same-model retry. */
export const MAX_CONSECUTIVE_NETWORK_FAILURES = 2

// ==================== PROVIDER HEALTH (short-lived, in-isolate) ====================
// Spec §14: quota exhaustion and repeated 5xx temporarily demote a provider
// instead of sending every user request into a retry storm. State is
// deliberately in-memory (per serverless isolate) and expires quickly — a
// provider is NEVER permanently disabled based on transient failures.

type ProviderHealthState = 'healthy' | 'degraded' | 'quota_exhausted' | 'auth_invalid'

interface ProviderHealthEntry {
  state: ProviderHealthState
  /** Epoch ms after which the entry expires back to healthy. */
  until: number
  consecutiveUnavailable: number
}

const QUOTA_COOLDOWN_MS = 10 * 60 * 1000
const DEGRADED_COOLDOWN_MS = 2 * 60 * 1000
const AUTH_COOLDOWN_MS = 10 * 60 * 1000
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
  } else if (code === 'AUTH_FAILED' || code === 'CONFIGURATION_ERROR') {
    // Broken credential / wrong base URL: DETERMINISTIC account-wide
    // failure. Without a cooldown every AI call re-burns a doomed round
    // trip (observed: AGENT_ROUTER 401 'Invalid API Key' before EVERY
    // fallback call). 10-minute cooldown self-heals once the operator
    // fixes the key; recordProviderSuccess clears it immediately.
    entry.state = 'auth_invalid'
    entry.until = Date.now() + AUTH_COOLDOWN_MS
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
  return (['AGENT_ROUTER', 'GEMINI', 'OPENAI'] as ProviderId[]).map((id) => {
    const entry = currentHealth(id)
    return {
      provider: id,
      state: entry.state,
      cooldownRemainingMs: entry.state === 'healthy' ? 0 : Math.max(0, entry.until - Date.now()),
    }
  })
}

/** Provider fallback order. Genuinely independent backends; unconfigured
 *  providers are skipped at runtime. A failure of one can never imply a
 *  failure of another.
 *
 *  NOTE: this full list is used for DIAGNOSTICS and pinned-model lookup
 *  only. The ACTIVE serving chain is the single-provider strategy returned
 *  by `activeProviderChain()` (see below) — production runs exactly ONE
 *  provider with no cross-provider fallback. */
export const PROVIDER_FALLBACK_ORDER: ProviderId[] = [
  'AGENT_ROUTER',
  'GEMINI',
  'OPENAI',
]

// ==================== PROVIDER STRATEGY ====================
// Filo runs ONE provider per environment — no cross-provider fallback
// chains. This keeps cost/behavior predictable and secrets scoped:
//
//   AI_PROVIDER env (GEMINI | OPENAI | AGENT_ROUTER) — explicit, wins.
//   Otherwise: exactly one key configured → that provider.
//   Otherwise: NODE_ENV=production → OPENAI, development → GEMINI.
//
// Keys are read server-side only (provider implementations read env lazily
// at call time) and never reach the browser. Switching providers is a
// single env change — no code edits.
export type AiProviderStrategy = ProviderId

/**
 * Resolve the provider this environment should serve AI with.
 * `isConfiguredLookup` lets callers (e.g. the Convex worker, whose registry
 * may not be booted yet) supply their own configured-check.
 *
 * Resolution order:
 *   1. Explicit AI_PROVIDER env — ABSOLUTE (operator's pin, never rerouted).
 *   2. Exactly one provider with credentials → that provider.
 *   3. NODE_ENV default (production → OPENAI, development → GEMINI) — but
 *      ONLY when that default actually has credentials. A dead default
 *      (e.g. NODE_ENV=production with only a Gemini key deployed) used to
 *      resolve to a guaranteed PROVIDER_UNCONFIGURED — every document
 *      generation failed with "all providers failed" while a perfectly
 *      valid key sat in the environment. Now the first CONFIGURED provider
 *      in preference order serves instead.
 */
export function resolveProviderStrategy(
  isConfiguredLookup?: (id: ProviderId) => boolean
): AiProviderStrategy {
  const explicit = (process.env.AI_PROVIDER ?? '').trim().toUpperCase()
  if (
    explicit === 'GEMINI' ||
    explicit === 'OPENAI' ||
    explicit === 'AGENT_ROUTER'
  ) {
    return explicit
  }
  const configured = (id: ProviderId): boolean => {
    if (isConfiguredLookup) return isConfiguredLookup(id)
    const p = getProvider(id)
    return Boolean(p?.isConfigured())
  }
  const preference: ProviderId[] =
    process.env.NODE_ENV === 'production'
      ? ['OPENAI', 'GEMINI', 'AGENT_ROUTER']
      : ['GEMINI', 'OPENAI', 'AGENT_ROUTER']
  const configuredIds = preference.filter(configured)
  if (configuredIds.length === 1) return configuredIds[0]
  if (configuredIds.length > 1) {
    // Environment default first when usable; otherwise the best configured
    // provider (never a guaranteed-dead resolution).
    if (configured(preference[0])) return preference[0]
    return configuredIds[0]
  }
  // Nothing configured — keep the environment default so diagnostics and
  // error messages name the provider the operator is expected to configure.
  return preference[0]
}

/**
 * The ACTIVE provider chain: exactly ONE provider (the resolved strategy),
 * never a fallback chain. Production behavior is deterministic — every AI
 * call goes to the strategy provider and surfaces its real errors.
 */
export function activeProviderChain(): ProviderId[] {
  return [resolveProviderStrategy()]
}

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
      // One-time, per-isolate config diagnostics (AI-repair spec §10).
      // NEVER logs key values or Authorization material — configuration
      // booleans and base URLs only. A base URL contains no secret.
      const lines = PROVIDER_FALLBACK_ORDER.map((id) => {
        const p = getProvider(id)
        if (!p) return `${id}: not registered`
        const configured = p.isConfigured()
        const base =
          typeof (p as { baseUrl?: string }).baseUrl === 'string'
            ? ` (base: ${(p as { baseUrl?: string }).baseUrl})`
            : ''
        return configured
          ? `${id}: configured${base} [${p.availableModels.length} models]`
          : `${id}: NOT configured — set its API key to enable`
      })
      console.info(
        `[AI] provider diagnostics\n[AI]   ${lines.join('\n[AI]   ')}\n[AI]   strategy: ${resolveProviderStrategy()} (single provider, no fallback chain)`
      )
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
    // empty prompt is invalid for the Agent Router AND OpenAI alike.
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
      if (health.state === 'auth_invalid') {
        attemptLog.push({
          provider: providerId,
          code: 'AUTH_FAILED',
          message: `skipped: credentials were rejected — cooldown ${Math.ceil((health.until - Date.now()) / 1000)}s (fix the API key or wait for the cooldown to re-probe)`,
        })
        continue
      }

      const models = this.buildModelChain(providerId, request, generateOptions)
      // Degraded providers get ONE attempt per model instead of the full
      // budget — enough to recover, never enough for a storm.
      const providerMaxAttempts = health.state === 'degraded' ? 1 : policy.maxAttempts
      let providerAttemptsUsed = 0
      let consecutiveNetworkFailures = 0

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

            // ---------- STORM GUARD 1: provider-fatal errors ----------
            // A broken credential, a misconfigured/WAF-blocked base URL, or
            // account-level billing exhaustion applies to EVERY model on
            // this provider. Advancing to the next model of the SAME
            // provider is a guaranteed waste of requests — switch to the
            // next INDEPENDENT provider now.
            if (PROVIDER_FATAL_CODES.has(aiErr.code)) {
              console.warn(
                `[AI]${traceTag} provider=${providerId} is fatally unavailable (${aiErr.code}) — skipping remaining ${providerId} models, next provider`
              )
              break
            }

            // ---------- STORM GUARD 2: dead network path ----------
            if (aiErr.code === 'NETWORK_ERROR' || aiErr.code === 'TIMEOUT') {
              consecutiveNetworkFailures += 1
              if (consecutiveNetworkFailures >= MAX_CONSECUTIVE_NETWORK_FAILURES) {
                console.warn(
                  `[AI]${traceTag} provider=${providerId} network path down after ${consecutiveNetworkFailures} consecutive network failures — skipping remaining ${providerId} models, next provider`
                )
                break
              }
            } else {
              consecutiveNetworkFailures = 0
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

        // Fatal error / dead network path → leave the model loop entirely.
        const last = attemptLog[attemptLog.length - 1]
        if (
          last &&
          last.provider === providerId &&
          (PROVIDER_FATAL_CODES.has(last.code) ||
            (last.code === 'NETWORK_ERROR' &&
              consecutiveNetworkFailures >= MAX_CONSECUTIVE_NETWORK_FAILURES) ||
            (last.code === 'TIMEOUT' &&
              consecutiveNetworkFailures >= MAX_CONSECUTIVE_NETWORK_FAILURES))
        ) {
          break
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
   * Stream a chat completion from the STRATEGY provider (no fallback — a
   * streaming failure surfaces the real provider error so the caller can
   * render an honest error state). Requires the active provider to implement
   * `stream()`; falls back to a single non-streaming generate() wrapped into
   * a one-delta stream when it does not.
   */
  async stream(
    request: AiRequest,
    generateOptions: GenerateOptions = {}
  ): Promise<AiStreamResult> {
    this.ensureProviders()

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

    const chain = this.buildProviderChain(generateOptions)
    const providerId = chain[0]
    const provider = getProvider(providerId)
    if (!provider || !provider.isConfigured()) {
      throw new AiBaseError(
        provider
          ? `${providerId} is not configured — set its API key to enable AI`
          : `${providerId} is not registered`,
        'PROVIDER_UNCONFIGURED',
        'ROUTER',
        false
      )
    }

    const model =
      generateOptions.model || request.options?.model || provider.defaultModel
    const mergedOptions = {
      ...request.options,
      ...generateOptions,
      model,
    }

    // Preferred path: true streaming.
    if (typeof provider.stream === 'function') {
      return provider.stream({
        messages: request.messages,
        options: mergedOptions,
      })
    }

    // Fallback: single non-streaming call exposed as a one-delta stream.
    const response = await this.generate(request, generateOptions)
    const textStream = (async function* oneShot() {
      yield response.content
    })()
    return { textStream, finished: Promise.resolve(response) }
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
      // Last resort: the shared bulletproof extractor (brace-balanced scan,
      // trailing-comma / control-char repair, truncation auto-close).
      try {
        return extractJsonObject(trimmed) as T
      } catch {
        /* fall through */
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
    // Single-provider strategy: production/dev each serve with exactly ONE
    // provider (AI_PROVIDER env → GEMINI in dev, OPENAI in prod). No
    // cross-provider fallback chains.
    const chain = activeProviderChain()
    const strategy = chain[0]

    // 1. An EXPLICIT AI_PROVIDER pin is absolute: every request — including
    //    a pinned model id — is served by the strategy provider DIRECTLY.
    //    Operator decision (2026-09-01): production talks to OpenAI directly
    //    with the operator's own key; a shared gateway that happens to list
    //    the same model id (e.g. gpt-5.6-sol in the AgentRouter pool) must
    //    NEVER hijack the request.
    if ((process.env.AI_PROVIDER ?? '').trim()) return chain

    const pinned = opts.model
    if (pinned) {
      // 2. The strategy provider's own registry claims this id → serve it
      //    there directly. (gpt-5.6-sol is listed by BOTH the OpenAI
      //    registry and the AgentRouter gateway pool; the strategy provider
      //    wins so the operator's direct credential is always preferred.)
      if (getProvider(strategy)?.availableModels.includes(pinned)) return chain
      // 3. Otherwise honor the pin on a DIFFERENT, CONFIGURED provider
      //    (e.g. a Gemini model pinned while serving from OpenAI). An
      //    unconfigured owner is skipped — the strategy provider's model
      //    chain degrades an unknown pinned id to its own defaults instead
      //    of stranding on a guaranteed MODEL_NOT_FOUND / UNCONFIGURED.
      const owner = PROVIDER_FALLBACK_ORDER.find(
        (id) =>
          id !== strategy &&
          getProvider(id)?.isConfigured() &&
          getProvider(id)?.availableModels.includes(pinned)
      )
      if (owner) return [owner]
    }
    return chain
  }

  private buildModelChain(
    providerId: ProviderId,
    request: AiRequest,
    opts: GenerateOptions
  ): string[] {
    const provider = getProvider(providerId)
    if (!provider) return []

    // 1. Explicit model pin wins — it is a deliberate choice, so it is
    //    attempted first. If the provider doesn't recognize the pinned id,
    //    its own defaults follow as a tail safety net: a stale pin then
    //    degrades to the provider's best known model instead of stranding
    //    the provider on a guaranteed MODEL_NOT_FOUND.
    const pinned = opts.model || request.options?.model
    if (pinned) {
      const rest = provider.availableModels.filter((m) => m !== pinned)
      return rest.length > 0 ? [pinned, ...rest] : [pinned]
    }

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
