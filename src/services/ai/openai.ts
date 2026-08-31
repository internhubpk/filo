// =============================================================================
// FILO AI — OpenAI Provider (PRODUCTION PRIMARY)
// =============================================================================
// Direct OpenAI chat contract (api.openai.com or any OpenAI-compatible
// gateway via OPENAI_BASE_URL). Selected as the PRODUCTION provider by the
// router's strategy (AI_PROVIDER=openai or NODE_ENV=production).
//
// Env vars (server-side ONLY — never exposed to the browser):
//   OPENAI_API_KEY
//   OPENAI_BASE_URL  (optional — default https://api.openai.com/v1)
// =============================================================================

import type {
  AiRequest,
  AiResponse,
  ProviderHealth,
  AiStreamResult,
} from './types'
import type { AiProvider } from './provider'
import { normalizeOpenAiCompatibleBaseUrl, parseSseStream } from './provider'
import {
  AiBaseError,
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

  /**
   * Streaming generation (OpenAI-compatible SSE, `stream: true`). Each SSE
   * `data:` event is a JSON chunk with choices[0].delta.content carrying the
   * incremental text; the final chunk (before [DONE]) carries usage when
   * `stream_options: { include_usage: true }` is set.
   */
  async stream(request: AiRequest): Promise<AiStreamResult> {
    const apiKey = this.getApiKey()
    const model = request.options?.model || this.defaultModel
    const timeoutMs = request.options?.timeoutMs ?? 120_000
    const startedAt = Date.now()
    const opts = request.options

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
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
          stream: true,
          stream_options: { include_usage: true },
        }),
      })
    } catch (err) {
      clearTimeout(timer)
      throw normalizeAiError('OPENAI', err)
    }

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '')
      clearTimeout(timer)
      throw errorFromHttpStatus('OPENAI', response.status, errText)
    }

    const sse = parseSseStream(response.body)

    async function* deltas(): AsyncGenerator<string, void, undefined> {
      for await (const payload of sse) {
        if (payload === '[DONE]') return
        let chunk: {
          choices?: Array<{ delta?: { content?: string } }>
        }
        try {
          chunk = JSON.parse(payload)
        } catch {
          continue // keep-alive / partial event — skip, not fatal
        }
        const text = chunk.choices?.[0]?.delta?.content
        if (text) yield text
      }
    }

    const finished = (async (): Promise<AiResponse> => {
      let content = ''
      let finishReason: string | undefined
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      try {
        for await (const payload of sse) {
          if (payload === '[DONE]') break
          let chunk: {
            choices?: Array<{
              delta?: { content?: string }
              finish_reason?: string | null
            }>
            usage?: OpenAiChatResponse['usage']
          }
          try {
            chunk = JSON.parse(payload)
          } catch {
            continue
          }
          const delta = chunk.choices?.[0]?.delta?.content
          if (delta) content += delta
          const fr = chunk.choices?.[0]?.finish_reason
          if (fr) finishReason = fr
          if (chunk.usage) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            }
          }
        }
        if (!content) {
          throw new MalformedResponseError('OPENAI', 'stream produced no content')
        }
        return {
          id: `oai_${startedAt}`,
          content,
          usage,
          provider: 'OPENAI',
          model,
          durationMs: Date.now() - startedAt,
          finishReason,
        }
      } catch (err) {
        if (err instanceof AiBaseError) throw err
        throw normalizeAiError('OPENAI', err)
      } finally {
        clearTimeout(timer)
      }
    })()

    return { textStream: deltas(), finished }
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
