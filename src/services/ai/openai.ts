// =============================================================================
// FILO AI — OpenAI Provider (SECONDARY / FALLBACK)
// =============================================================================
// Same OpenAI-compatible chat contract as OpenRouter but pointed at
// api.openai.com directly. Useful when you already have OpenAI credits and
// want to bypass the OpenRouter middleman.
//
// Env vars:
//   OPENAI_API_KEY
//   OPENAI_BASE_URL  (optional — default https://api.openai.com/v1)
// =============================================================================

import type {
  AiRequest,
  AiResponse,
  ProviderHealth,
} from './types'
import type { AiProvider } from './provider'
import { normalizeOpenAiCompatibleBaseUrl } from './provider'
import {
  ApiKeyMissingError,
  errorFromHttpStatus,
  MalformedResponseError,
  normalizeAiError,
} from './errors'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export const OPENAI_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4.1-mini',
  'gpt-4.1',
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

export class OpenAiProvider implements AiProvider {
  readonly id = 'OPENAI' as const
  readonly displayName = 'OpenAI'
  readonly defaultModel = 'gpt-4o-mini'
  readonly availableModels: readonly string[] = OPENAI_MODELS

  private getApiKey(): string {
    const key = process.env.OPENAI_API_KEY || ''
    if (!key) {
      throw new ApiKeyMissingError('OPENAI', 'OPENAI_API_KEY')
    }
    return key
  }

  /** Base URL, normalized (no trailing slash, exactly one /v1). */
  get baseUrl(): string {
    return normalizeOpenAiCompatibleBaseUrl(process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL)
  }

  private getBaseUrl(): string {
    return this.baseUrl
  }

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY)
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
        throw errorFromHttpStatus('OPENAI', response.status, errText)
      }

      const data = (await response.json()) as OpenAiChatResponse
      const choice = data.choices?.[0]
      if (!choice) {
        throw new MalformedResponseError('OPENAI', 'no choices in response')
      }

      return {
        id: data.id || `oai_${startedAt}`,
        content: choice.message?.content || '',
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
        provider: 'OPENAI',
        model,
        durationMs: Date.now() - startedAt,
        finishReason: choice.finish_reason,
      }
    } catch (err) {
      throw normalizeAiError('OPENAI', err)
    } finally {
      clearTimeout(timer)
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.isConfigured()) {
      return { provider: 'OPENAI', configured: false, error: 'OPENAI_API_KEY not set' }
    }
    const startedAt = Date.now()
    try {
      await this.generate({
        messages: [{ role: 'user', content: 'ping' }],
        options: { maxTokens: 1, timeoutMs: 10_000 },
      })
      return { provider: 'OPENAI', configured: true, latencyMs: Date.now() - startedAt }
    } catch (err) {
      return {
        provider: 'OPENAI',
        configured: true,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
