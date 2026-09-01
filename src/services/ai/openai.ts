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
  // gpt-5.6 family — served DIRECTLY by api.openai.com with the operator's
  // own key (operator decision 2026-09-01: production does NOT use the
  // AgentRouter gateway; the same ids exist there but are never preferred).
  'gpt-5.6-sol',
  'gpt-5.6',
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4.1-mini',
  'gpt-4.1',
] as const

/**
 * Reasoning-family models (gpt-5.x, o-series) reject classic sampling
 * parameters: `temperature`/`top_p`/penalties must stay at their defaults
 * and `max_tokens` is replaced by `max_completion_tokens`. Sending them
 * anyway is a guaranteed 400 ("Unsupported parameter" / "Only the default
 * (1) value is supported"), so these models are detected UP FRONT and the
 * request body is built in reasoning-compat mode. Unknown future ids are
 * still healed reactively by parse400Fixes() below.
 */
function isReasoningModel(model: string): boolean {
  return /^gpt-5/i.test(model) || /^o[134](-|$)/i.test(model)
}

/** Mutable per-request compat switches for the OpenAI wire format. */
interface CompatFlags {
  /** Include web_search_options (already gated by supportsNativeWebSearch). */
  search: boolean
  /** Send maxTokens as max_completion_tokens instead of max_tokens. */
  useMaxCompletionTokens: boolean
  /** Omit temperature/top_p/penalties entirely (reasoning models). */
  dropSampling: boolean
}

/** What a 400 error message asks us to change, parsed conservatively. */
interface Parsed400Fixes {
  useMaxCompletionTokens: boolean
  dropSampling: boolean
  searchRejected: boolean
  /** At least one cause we understand was found in the message. */
  recognized: boolean
}

/** Extract the human-readable message from an OpenAI error payload. */
function openAiErrorMessage(errText: string): string {
  try {
    const parsed = JSON.parse(errText) as { error?: { message?: string }; message?: string }
    return parsed?.error?.message || parsed?.message || errText
  } catch {
    return errText
  }
}

function parse400Fixes(message: string): Parsed400Fixes {
  const useMaxCompletionTokens = /max_completion_tokens/i.test(message)
  const dropSampling =
    /(temperature|top_p|frequency_penalty|presence_penalty)/i.test(message) &&
    /(unsupported|not supported|only the default|does not support|invalid value)/i.test(message)
  const searchRejected = /web_search/i.test(message)
  return {
    useMaxCompletionTokens,
    dropSampling,
    searchRejected,
    recognized: useMaxCompletionTokens || dropSampling || searchRejected,
  }
}

/**
 * Per-isolate memory of what each model has PROVEN to reject, so the fix is
 * applied to the INITIAL body of every later request — one round trip, no
 * repeated 400 penalty across a serverless isolate's lifetime. Only
 * attributable causes are memoized (a message that clearly named the
 * parameter); generic failures are retried but never remembered.
 */
const modelCompatMemo = new Map<string, CompatFlags>()

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
   * caller's link-extraction fallback. The gpt-5 family is ALLOWED to try
   * (it may accept the parameter): a rejection is remembered per isolate by
   * the compat memo so later requests skip the failed round trip. Gate by
   * id so gateways that proxy different names keep working via the
   * self-healing retry below.
   */
  private supportsNativeWebSearch(model: string): boolean {
    if (modelCompatMemo.get(model)?.search === false) return false
    return /search-preview|gpt-4o-search|o3-search|^gpt-5/i.test(model)
  }

  /** Initial compat flags for a model (memo + reasoning detection). */
  private initialCompatFlags(model: string): CompatFlags {
    const memo = modelCompatMemo.get(model)
    return {
      search: this.supportsNativeWebSearch(model),
      useMaxCompletionTokens: isReasoningModel(model) || memo?.useMaxCompletionTokens === true,
      dropSampling: isReasoningModel(model) || memo?.dropSampling === true,
    }
  }

  /** Apply parsed 400 fixes to a flags object (mutates + returns it). */
  private static applyFixes(flags: CompatFlags, fixes: Parsed400Fixes): CompatFlags {
    if (fixes.useMaxCompletionTokens) flags.useMaxCompletionTokens = true
    if (fixes.dropSampling) flags.dropSampling = true
    if (fixes.searchRejected) flags.search = false
    return flags
  }

  /**
   * Build the chat-completions request body under the given compat flags.
   * Reasoning-compat (dropSampling + max_completion_tokens) is decided up
   * front by isReasoningModel()/memo; search is pre-gated by
   * supportsNativeWebSearch(). JSON.stringify drops undefined fields.
   */
  private buildRequestBody(
    request: AiRequest,
    model: string,
    flags: CompatFlags,
    stream: boolean,
  ): string {
    const opts = request.options
    const sampling: Record<string, unknown> = flags.dropSampling
      ? {}
      : {
          temperature: opts?.temperature ?? 0.7,
          top_p: opts?.topP,
          frequency_penalty: opts?.frequencyPenalty,
          presence_penalty: opts?.presencePenalty,
        }
    return JSON.stringify({
      model,
      messages: request.messages,
      ...sampling,
      // Reasoning depth — only for thinking models (gpt-5.x / o-series);
      // 'low' cuts seconds of silent thinking off the first token.
      ...(isReasoningModel(model) && opts?.reasoningEffort
        ? { reasoning_effort: opts.reasoningEffort }
        : {}),
      ...(flags.useMaxCompletionTokens
        ? { max_completion_tokens: opts?.maxTokens }
        : { max_tokens: opts?.maxTokens }),
      stop: opts?.stopSequences,
      response_format:
        opts?.responseFormat?.type === 'json'
          ? { type: 'json_object' }
          : undefined,
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
      ...(flags.search && opts?.webSearch ? { web_search_options: {} } : {}),
    })
  }

  /**
   * POST /chat/completions with the 400 self-heal ladder:
   *   attempt 1 — initial flags (reasoning compat + search gate + memo);
   *   on 400    — parse the error message and apply EVERY fix it names in a
   *               single retry (search off / max_completion_tokens / default
   *               sampling). Attributable fixes are memoized per model so
   *               later requests build the healed body on the FIRST attempt
   *               — no repeated 400 round trips per serverless isolate.
   * A generic unrecognized 400 with search enabled retries once without
   * grounding (legacy fail-soft); if that clears, the rejection is
   * attributed to web_search_options and memoized.
   */
  private async postChatCompletions(
    request: AiRequest,
    model: string,
    flags: CompatFlags,
    controller: AbortController,
    stream = false,
  ): Promise<Response> {
    const apiKey = this.getApiKey()
    const post = (body: string): Promise<Response> =>
      fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body,
      })

    let response = await post(this.buildRequestBody(request, model, flags, stream))
    if (response.ok || response.status !== 400) return response

    // clone(): the caller still needs the original body when nothing heals.
    const errText = await response.clone().text().catch(() => '')
    const fixes = parse400Fixes(openAiErrorMessage(errText))
    if (!fixes.recognized && !flags.search) return response

    const healed: CompatFlags = { ...flags }
    let attributed = fixes.recognized
    if (fixes.recognized) {
      OpenAiProvider.applyFixes(healed, fixes)
    } else {
      // Unrecognized 400 with search on → legacy fail-soft: retry without
      // grounding; if that clears, blame web_search_options (below).
      healed.search = false
    }
    console.warn(
      `[AI][OPENAI] 400 on ${model} — self-healing retry` +
        ` (search=${healed.search ? 'on' : 'off'}` +
        `${healed.useMaxCompletionTokens ? ', max_completion_tokens' : ''}` +
        `${healed.dropSampling ? ', default sampling' : ''})`,
    )
    response = await post(this.buildRequestBody(request, model, healed, stream))
    if (response.ok && attributed) {
      modelCompatMemo.set(model, { ...healed })
    } else if (response.ok && !attributed && flags.search) {
      // cleared without search on a generic 400 — attribute & remember
      modelCompatMemo.set(model, { ...healed })
    }
    return response
  }

  async generate(request: AiRequest): Promise<AiResponse> {
    const apiKey = this.getApiKey()
    const model = request.options?.model || this.defaultModel
    const timeoutMs = request.options?.timeoutMs ?? 60_000
    const startedAt = Date.now()

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await this.postChatCompletions(
        request,
        model,
        this.initialCompatFlags(model),
        controller,
      )

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

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    // Shared compat-aware POST (initial flags + 400 self-heal ladder). The
    // retry happens BEFORE the SSE body is ever consumed, so streaming
    // semantics are unaffected — the returned response is a clean 200.
    let response: Response
    try {
      response = await this.postChatCompletions(
        request,
        model,
        this.initialCompatFlags(model),
        controller,
        true,
      )
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
