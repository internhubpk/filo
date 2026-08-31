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
  AiWebSource,
} from './types'
import type { AiProvider } from './provider'
import { normalizeOpenAiCompatibleBaseUrl, parseSseStream } from './provider'
import { mapOpenAiCitations, type OpenAiUrlCitation } from './grounding'
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

interface OpenAiAnnotation {
  type?: string
  url_citation?: {
    url?: string
    title?: string
    content?: string
  }
}

interface OpenAiChatResponse {
  id?: string
  choices?: Array<{
    message?: {
      content?: string
      // url_citation annotations ride on search-capable models
      // (web_search_options) — they are the NATIVE citations.
      annotations?: OpenAiAnnotation[]
    }
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

  /**
   * Native web search is only accepted by OpenAI's search-capable models
   * (chat-completions `web_search_options`). Sending it to any other model
   * is a 400, so it is gated strictly by name; other models degrade to the
   * caller's link-extraction fallback. Gate by id so gateways that proxy
   * different names keep working via the self-healing retry below.
   */
  private supportsNativeWebSearch(model: string): boolean {
    return /search-preview|gpt-4o-search|o3-search/i.test(model)
  }

  async generate(request: AiRequest): Promise<AiResponse> {
    const apiKey = this.getApiKey()
    const model = request.options?.model || this.defaultModel
    const timeoutMs = request.options?.timeoutMs ?? 60_000
    const startedAt = Date.now()
    const opts = request.options

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const buildBody = (includeSearch: boolean): string =>
      JSON.stringify({
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
        ...(includeSearch && opts?.webSearch && this.supportsNativeWebSearch(model)
          ? { web_search_options: {} }
          : {}),
      })

    try {
      let response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: buildBody(true),
      })

      // Self-healing search retry: model/gateway rejected web_search_options
      // → retry once without it; chat keeps working, citations fall back to
      // link extraction.
      if (!response.ok && opts?.webSearch && response.status === 400) {
        console.warn(
          `[AI][OPENAI] web_search_options rejected on ${model} — retrying without grounding`,
        )
        response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          signal: controller.signal,
          body: buildBody(false),
        })
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw errorFromHttpStatus('OPENAI', response.status, errText)
      }

      const data = (await response.json()) as OpenAiChatResponse
      const choice = data.choices?.[0]
      if (!choice) {
        throw new MalformedResponseError('OPENAI', 'no choices in response')
      }

      const nativeSources: AiWebSource[] = mapOpenAiCitations(
        choice.message?.annotations ?? [],
      )

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
        ...(nativeSources.length > 0 ? { sources: nativeSources } : {}),
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

    const buildBody = (includeSearch: boolean): string =>
      JSON.stringify({
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
        ...(includeSearch && opts?.webSearch && this.supportsNativeWebSearch(model)
          ? { web_search_options: {} }
          : {}),
      })

    let response: Response
    try {
      response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: buildBody(true),
      })

      // Self-healing search retry — see generate().
      if (!response.ok && opts?.webSearch && response.status === 400) {
        const errText = await response.text().catch(() => '')
        console.warn(
          `[AI][OPENAI] web_search_options rejected on ${model} — retrying without grounding`,
        )
        response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          signal: controller.signal,
          body: buildBody(false),
        })
      }
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

    // ---- SINGLE-PASS STREAM DISTRIBUTION ----
    // Same contract as the Gemini adapter (see gemini.ts): the SSE generator
    // is consumed EXACTLY ONCE by the background pump; the pump accumulates
    // the full response AND forwards every text delta to `deltas()` via a
    // wakeup queue. (Bug history: two concurrent consumers of one
    // AsyncGenerator raced per chunk — replies streamed with random words
    // missing and the persisted message was a different random half.)
    //
    // Note: reasoning models that stream `delta.reasoning_content` are
    // handled by ONLY reading `delta.content` — thinking traces are dropped,
    // never mixed into the visible reply.
    const pending: string[] = []
    let pumpDone = false
    let pumpError: unknown = null
    let wake: (() => void) | null = null
    const kick = () => {
      const w = wake
      wake = null
      w?.()
    }

    const finished = (async (): Promise<AiResponse> => {
      let content = ''
      let finishReason: string | undefined
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      const citations: OpenAiUrlCitation[] = []
      try {
        for await (const payload of sse) {
          if (payload === '[DONE]') break
          let chunk: {
            choices?: Array<{
              delta?: {
                content?: string
                // url_citation annotations arrive on deltas of search-capable
                // models; the final chunk may also carry message.annotations.
                annotations?: OpenAiAnnotation[]
              }
              message?: { annotations?: OpenAiAnnotation[] }
              finish_reason?: string | null
            }>
            usage?: OpenAiChatResponse['usage']
          }
          try {
            chunk = JSON.parse(payload)
          } catch {
            continue
          }
          const choice = chunk.choices?.[0]
          const delta = choice?.delta?.content
          if (delta) {
            content += delta
            pending.push(delta)
            kick()
          }
          const anns = choice?.delta?.annotations ?? choice?.message?.annotations
          if (anns?.length) citations.push(...anns)
          const fr = choice?.finish_reason
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
          pumpError = new MalformedResponseError('OPENAI', 'stream produced no content')
          throw pumpError
        }
        const nativeSources: AiWebSource[] = mapOpenAiCitations(citations)
        return {
          id: `oai_${startedAt}`,
          content,
          usage,
          provider: 'OPENAI',
          model,
          durationMs: Date.now() - startedAt,
          finishReason,
          ...(nativeSources.length > 0 ? { sources: nativeSources } : {}),
        }
      } catch (err) {
        pumpError = err
        if (err instanceof AiBaseError) throw err
        throw normalizeAiError('OPENAI', err)
      } finally {
        pumpDone = true
        kick()
        clearTimeout(timer)
      }
    })()

    // If the caller bails out via the textStream error path it never awaits
    // `finished` — swallow that rejection here to avoid unhandledRejection.
    finished.catch(() => {})

    async function* deltas(): AsyncGenerator<string, void, undefined> {
      while (true) {
        if (pending.length) {
          yield pending.shift() as string
          continue
        }
        if (pumpDone) {
          if (pumpError) throw pumpError
          return
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    }

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
