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
 * router walks the list only if a model 404s.
 *
 * OPENROUTER slugs verified against the LIVE public catalog
 * (GET https://openrouter.ai/api/v1/models, 2026-08-28): the previous
 * 'anthropic/claude-3.5-sonnet' and 'google/gemini-2.0-flash-001' slugs are
 * RETIRED (404 MODEL_NOT_FOUND on every call).
 */
export const MODEL_MATRIX: Record<AiTask, Partial<Record<ProviderId, readonly string[]>>> = {
  fast: {
    GEMINI: ['gemini-2.0-flash-lite', 'gemini-2.0-flash'],
    OPENROUTER: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash'],
    OPENAI: ['gpt-4o-mini'],
  },
  generation: {
    GEMINI: ['gemini-2.0-flash', 'gemini-2.5-flash'],
    OPENROUTER: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash'],
    OPENAI: ['gpt-4o-mini', 'gpt-4o'],
  },
  reasoning: {
    GEMINI: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    OPENROUTER: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5-mini'],
    OPENAI: ['gpt-4o', 'gpt-4.1'],
  },
  json: {
    GEMINI: ['gemini-2.0-flash', 'gemini-2.5-flash'],
    OPENROUTER: ['openai/gpt-4o-mini'],
    OPENAI: ['gpt-4o-mini', 'gpt-4o'],
  },
  longform: {
    GEMINI: ['gemini-2.5-flash', 'gemini-flash-latest'], // 1.5 models are retired
    OPENROUTER: ['anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash'],
    OPENAI: ['gpt-4o'],
  },
}

/** Default retry policy — mirrors the documented production defaults. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
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

    const policy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      ...generateOptions.retryPolicy,
    }

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
        attemptLog.push({
          provider: providerId,
          code: 'PROVIDER_UNCONFIGURED',
          message: provider
            ? 'no API key configured — skipped'
            : 'provider not registered — skipped',
        })
        continue
      }

      const models = this.buildModelChain(providerId, request, generateOptions)

      for (const model of models) {
        const maxAttempts = policy.maxAttempts
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const response = await provider.generate({
              messages: request.messages,
              options: {
                ...request.options,
                ...generateOptions,
                model,
              },
            })

            if (attempt > 1 || models.length > 1) {
              console.info(
                `[AI] success provider=${providerId} model=${model} attempt=${attempt} tokens=${response.usage.totalTokens} durationMs=${response.durationMs}`
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

            console.warn(
              `[AI] attempt failed provider=${providerId} model=${model} attempt=${attempt}/${maxAttempts} code=${aiErr.code}: ${aiErr.message}`
            )

            // Non-retryable → move to the next model/provider immediately.
            if (!aiErr.retryable) break

            // Last attempt overall → let the outer loops move on.
            if (attempt === maxAttempts) break

            // Exponential backoff with jitter (±25%).
            const backoff = Math.min(
              policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1),
              policy.maxDelayMs
            )
            const jitter = backoff * (0.75 + Math.random() * 0.5)
            await this.sleep(jitter)
          }
        }
      }
    }

    throw new AllProvidersFailedError(
      attemptLog.map((a) => ({
        provider: a.provider,
        code: a.code as AiBaseError['code'],
        message: a.message,
      }))
    )
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

    // 1. Explicit model pin wins.
    const pinned = opts.model || request.options?.model
    if (pinned) return [pinned]

    // 2. Task-based matrix.
    const task = opts.task || 'generation'
    const matrix = MODEL_MATRIX[task]?.[providerId]
    if (matrix && matrix.length > 0) return [...matrix]

    // 3. Provider default.
    return [provider.defaultModel]
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/** Singleton — the ONE object the rest of the app imports. */
export const aiRouter = new AiRouter()
