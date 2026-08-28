// =============================================================================
// FILO AI — OpenRouter Provider (SECONDARY / FALLBACK)
// =============================================================================
// NOT a hard dependency for core generation. If OPENROUTER_API_KEY is absent
// the provider registers but reports isConfigured() === false and the router
// skips it. Kept because it's a convenient single-key gateway to many models
// during development and as an emergency fallback in production.
//
// Env vars:
//   OPENROUTER_API_KEY
//   OPENROUTER_BASE_URL  (optional — default https://openrouter.ai/api/v1)
// =============================================================================

import type {
  AiRequest,
  AiResponse,
  ProviderHealth,
} from './types'
import type { AiProvider } from './provider'
import {
  ApiKeyMissingError,
  errorFromHttpStatus,
  MalformedResponseError,
  normalizeAiError,
} from './errors'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

// Slugs verified against the LIVE public catalog
// (GET https://openrouter.ai/api/v1/models, 2026-08-28). Retired slugs
// ('anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-001') removed —
// they 404 MODEL_NOT_FOUND on every call.
export const OPENROUTER_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-sonnet-4.5',
  'google/gemini-2.5-flash',
  'meta-llama/llama-3.1-70b-instruct',
] as const

interface OpenAiChatResponse {
  id?: string
  choices?: Array<{
    message?: { content?: string }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export class OpenRouterProvider implements AiProvider {
  readonly id = 'OPENROUTER' as const
  readonly displayName = 'OpenRouter'
  readonly defaultModel = 'openai/gpt-4o-mini'
  readonly availableModels: readonly string[] = OPENROUTER_MODELS

  private getApiKey(): string {
    const key = process.env.OPENROUTER_API_KEY || ''
    if (!key) {
      throw new ApiKeyMissingError('OPENROUTER', 'OPENROUTER_API_KEY')
    }
    return key
  }

  private getBaseUrl(): string {
    return process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL
  }

  isConfigured(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY)
  }

  async generate(request: AiRequest): Promise<AiResponse> {
    const apiKey = this.getApiKey()
    const model = request.options?.model || this.defaultModel
    const timeoutMs = request.options?.timeoutMs ?? 60_000
    const startedAt = Date.now()

    const opts = request.options
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'X-Title': 'Filo',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: request.messages,
          temperature: opts?.temperature ?? 0.7,
          max_tokens: opts?.maxTokens,
          top_p: opts?.topP,
          frequency_penalty: opts?.frequencyPenalty,
          presence_penalty: opts?.presencePenalty,
          stop: opts?.stopSequences,
          response_format:
            opts?.responseFormat?.type === 'json'
              ? { type: 'json_object' }
              : undefined,
        }),
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw errorFromHttpStatus('OPENROUTER', response.status, errText)
      }

      const data = (await response.json()) as OpenAiChatResponse
      const choice = data.choices?.[0]
      if (!choice) {
        throw new MalformedResponseError('OPENROUTER', 'no choices in response')
      }

      return {
        id: data.id || `or_${startedAt}`,
        content: choice.message?.content || '',
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
        provider: 'OPENROUTER',
        model,
        durationMs: Date.now() - startedAt,
        finishReason: choice.finish_reason,
      }
    } catch (err) {
      throw normalizeAiError('OPENROUTER', err)
    } finally {
      clearTimeout(timer)
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.isConfigured()) {
      return { provider: 'OPENROUTER', configured: false, error: 'OPENROUTER_API_KEY not set' }
    }
    const startedAt = Date.now()
    try {
      await this.generate({
        messages: [{ role: 'user', content: 'ping' }],
        options: { maxTokens: 1, timeoutMs: 10_000 },
      })
      return { provider: 'OPENROUTER', configured: true, latencyMs: Date.now() - startedAt }
    } catch (err) {
      return {
        provider: 'OPENROUTER',
        configured: true,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
