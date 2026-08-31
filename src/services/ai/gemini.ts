// =============================================================================
// FILO AI — Google Gemini Provider (DIRECT / INDEPENDENT FALLBACK)
// =============================================================================
// Talks to Google's Generative Language API directly (no gateway in between),
// which makes it a genuinely INDEPENDENT fallback: an AgentRouter outage (or
// WAF challenge, or billing problem) can never take Gemini down with it.
//
// Wire protocol (Google Generative Language REST — generateContent):
//
//   POST {GEMINI_BASE_URL}/models/{model}:generateContent
//   x-goog-api-key: <GEMINI_API_KEY>          ← header; the key NEVER
//                                               travels in a URL query string
//   Content-Type: application/json
//   {
//     systemInstruction?: { parts: [{ text }] },
//     contents: [{ role: 'user'|'model', parts: [{ text }] }],
//     generationConfig: { temperature?, maxOutputTokens, topP?,
//                         stopSequences?, responseMimeType?,
//                         thinkingConfig?: { thinkingLevel } }
//   }
//   Gemini 3.x: thinkingLevel ∈ minimal|low|medium|high (CANNOT be disabled;
//   unset ⇒ high). The 2.5-era budget-0 disable flag is a 400 on 3.x models.
//
//   → 200 { candidates: [{ content: { parts: [{ text }] }, finishReason }],
//           usageMetadata: { promptTokenCount, candidatesTokenCount,
//                            totalTokenCount },
//           promptFeedback?: { blockReason } }
//
// Env vars (read at call time, Convex-runtime owned — never NEXT_PUBLIC_*):
//   GEMINI_API_KEY    (required — from aistudio.google.com/apikey)
//   GEMINI_BASE_URL   (optional — default
//                      https://generativelanguage.googleapis.com/v1beta)
//
// Error classification notes (verified against Google's actual behavior):
//   400 "API key not valid"            → AUTH_FAILED (mapped in errors.ts)
//   429 RESOURCE_EXHAUSTED             → RATE_LIMITED (retryable)
//   404 model/endpoint unknown         → MODEL_NOT_FOUND (next model)
//   503 "model is overloaded"          → PROVIDER_UNAVAILABLE (retryable)
//   promptFeedback.blockReason / SAFETY → CONTENT_FILTERED (never retried)
// =============================================================================

import type {
  AiRequest,
  AiResponse,
  ProviderHealth,
  AiStreamResult,
  AiWebSource,
} from './types'
import type { AiProvider } from './provider'
import { parseSseStream } from './provider'
import { mapGeminiGrounding, type GeminiGroundingChunk } from './grounding'
import {
  AiBaseError,
  ApiKeyMissingError,
  ContentFilteredError,
  errorFromHttpStatus,
  MalformedResponseError,
  normalizeAiError,
} from './errors'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Gemini models, cheapest-first (operator budget optimization):
 *   gemini-3.5-flash-lite  — cheapest, fast: mechanical volume
 *   gemini-3.6-flash       — mid: generation/longform workhorse
 *   gemini-3.1-pro-preview — most capable / most expensive: quality escalation
 * Migrated from Google's retired 2.5 family on 2026-08-29: those ids stopped
 * being served to new deployments (404 "no longer available to new users")
 * and the deprecation error message names these exact replacements.
 * MODEL_NOT_FOUND (404) advances the chain, so a retired id (e.g. the
 * -preview suffix) degrades gracefully instead of failing the provider.
 */
export const GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.1-pro-preview',
] as const

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
    // Native search grounding (request.tools: [{ google_search: {} }]):
    // groundingMetadata arrives on stream chunks — text parts carry the
    // answer, groundingChunks carry the actual citations.
    groundingMetadata?: {
      groundingChunks?: GeminiGroundingChunk[]
      webSearchQueries?: string[]
    }
  }>
  promptFeedback?: { blockReason?: string }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

export class GeminiProvider implements AiProvider {
  readonly id = 'GEMINI' as const
  readonly displayName = 'Google Gemini'
  readonly defaultModel = 'gemini-3.6-flash'
  readonly availableModels: readonly string[] = GEMINI_MODELS

  private getApiKey(): string {
    const key = process.env.GEMINI_API_KEY || ''
    if (!key) {
      throw new ApiKeyMissingError('GEMINI', 'GEMINI_API_KEY')
    }
    return key
  }

  /** Base URL without a trailing slash (guards against `…//models/…`). */
  get baseUrl(): string {
    return (process.env.GEMINI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  }

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY)
  }

  async generate(request: AiRequest): Promise<AiResponse> {
    const apiKey = this.getApiKey()
    const model = request.options?.model || this.defaultModel
    const timeoutMs = request.options?.timeoutMs ?? 90_000
    const startedAt = Date.now()
    const opts = request.options

    // ---- Translate the OpenAI-style message list into Gemini's shape ----
    const systemText = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        // Gemini roles are 'user' | 'model'; anything non-assistant maps to user.
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    // Gemini 3.x thinking control (verified via ai.google.dev/gemini-api/docs
    // /gemini-3 + live 400s on 2026-08-29):
    //   • thinking CANNOT be disabled on 3.x — the 2.5-era disable flag
    //     (budget: 0) returns 400 INVALID_ARGUMENT;
    //   • the supported knob is `thinkingConfig.thinkingLevel`
    //     (minimal | low | medium | high) inside generationConfig;
    //   • leaving it unset defaults to HIGH thinking — slow and expensive —
    //     so always pin it explicitly.
    // Per-model supported levels: 3.5-flash-lite / 3.6-flash → minimal;
    // gemini-3.1-pro-preview → low is the minimum (minimal NOT supported).
    const thinkingLevel = /pro/i.test(model) ? 'low' : 'minimal'

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`
      const headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      }
      // buildBody(true)  — full config incl. thinkingLevel (preferred).
      // buildBody(false) — bare config, no thinkingConfig (self-healing retry:
      //     if Google ever 400s our optional params again, retry once with the
      //     minimal body before letting the router move to the next model).
      // includeTools — attach the google_search grounding tool when the
      //     caller asked for chat-mode web search (opts.webSearch).
      // NOTE: JSON.stringify drops undefined fields, so unset temperature/topP
      // are genuinely omitted — Google then applies ITS defaults (temp 1.0 is
      // the strongly recommended default for all Gemini 3 models).
      const buildBody = (includeThinking: boolean, includeTools: boolean): string =>
        JSON.stringify({
          contents,
          ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
          ...(includeTools && opts?.webSearch ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: {
            temperature: opts?.temperature,
            maxOutputTokens: opts?.maxTokens,
            topP: opts?.topP,
            stopSequences: opts?.stopSequences,
            responseMimeType:
              opts?.responseFormat?.type === 'json' ? 'application/json' : undefined,
            ...(includeThinking ? { thinkingConfig: { thinkingLevel } } : {}),
          },
        })

      let response = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: buildBody(true, true),
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        const aiErr = errorFromHttpStatus('GEMINI', response.status, errText)
        // One self-healing retry for shape errors: a 400 that is NOT auth
        // means the model rejected a request parameter. Strip thinkingConfig
        // and try once more — if the optional param was the culprit the call
        // now succeeds; otherwise the second 400 propagates to the router,
        // which advances to the next model as usual.
        if (aiErr.code === 'INVALID_REQUEST' && /API key not valid/i.test(errText) === false) {
          response = await fetch(url, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: buildBody(false, false),
          })
          if (!response.ok) {
            const retryErrText = await response.text().catch(() => '')
            throw errorFromHttpStatus('GEMINI', response.status, retryErrText)
          }
        } else {
          throw aiErr
        }
      }

      let data: GeminiGenerateContentResponse
      try {
        data = (await response.json()) as GeminiGenerateContentResponse
      } catch {
        throw new MalformedResponseError('GEMINI', 'non-JSON body from generateContent')
      }

      // Safety blocks arrive as HTTP 200 with a blockReason — classify them
      // as CONTENT_FILTERED so the router never retries or blames the model.
      const blockReason = data.promptFeedback?.blockReason
      const finishReason = data.candidates?.[0]?.finishReason
      if (blockReason && blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
        throw new ContentFilteredError('GEMINI', `prompt blocked: ${blockReason}`)
      }
      if (finishReason === 'SAFETY') {
        throw new ContentFilteredError('GEMINI', 'candidate finishReason=SAFETY')
      }

      const parts = data.candidates?.[0]?.content?.parts ?? []
      const content = parts
        .map((p) => p.text || '')
        .join('')
        .trim()
      if (!content && !parts.length) {
        throw new MalformedResponseError('GEMINI', 'no candidate parts in response')
      }

      const nativeSources: AiWebSource[] = mapGeminiGrounding(
        data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [],
      )

      return {
        id: `gem_${startedAt}`,
        content,
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
        },
        provider: 'GEMINI',
        model,
        durationMs: Date.now() - startedAt,
        finishReason,
        ...(nativeSources.length > 0 ? { sources: nativeSources } : {}),
      }
    } catch (err) {
      // Our own AiBaseError subclasses pass through unchanged; raw
      // TypeError/AbortError become NETWORK_ERROR/TIMEOUT with diagnostics.
      if (err instanceof AiBaseError) throw err
      throw normalizeAiError('GEMINI', err)
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Streaming generation (SSE). Wire protocol: the same request body as
   * generateContent, POSTed to `:streamGenerateContent?alt=sse`. Every SSE
   * `data:` event is a JSON chunk shaped like the non-streaming response —
   * text lives in candidates[0].content.parts[].text and the FINAL chunk
   * carries usageMetadata. Safety blocks arrive as promptFeedback.blockReason.
   */
  async stream(request: AiRequest): Promise<AiStreamResult> {
    const apiKey = this.getApiKey()
    const model = request.options?.model || this.defaultModel
    const timeoutMs = request.options?.timeoutMs ?? 120_000
    const startedAt = Date.now()
    const opts = request.options

    const systemText = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    const thinkingLevel = /pro/i.test(model) ? 'low' : 'minimal'

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
    const headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    }
    const buildBody = (includeTools: boolean): string =>
      JSON.stringify({
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...(includeTools && opts?.webSearch ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: {
          temperature: opts?.temperature,
          maxOutputTokens: opts?.maxTokens,
          topP: opts?.topP,
          stopSequences: opts?.stopSequences,
          thinkingConfig: { thinkingLevel },
        },
      })

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: buildBody(true),
      })

      // Self-healing grounding retry: if the model/gateway rejects the
      // google_search tool (400 INVALID_ARGUMENT family), retry ONCE without
      // it — chat keeps working, the caller falls back to link extraction.
      if (!response.ok && opts?.webSearch && response.status === 400) {
        const errText = await response.text().catch(() => '')
        console.warn(
          `[AI][GEMINI] google_search tool rejected on ${model} — retrying without grounding`,
        )
        response = await fetch(url, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: buildBody(false),
        })
        if (!response.ok) {
          const retryErrText = await response.text().catch(() => '')
          throw errorFromHttpStatus('GEMINI', response.status, retryErrText)
        }
      }
    } catch (err) {
      clearTimeout(timer)
      throw normalizeAiError('GEMINI', err)
    }

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '')
      clearTimeout(timer)
      throw errorFromHttpStatus('GEMINI', response.status, errText)
    }

    const sse = parseSseStream(response.body)

    // ---- SINGLE-PASS STREAM DISTRIBUTION ----
    // The SSE generator is consumed EXACTLY ONCE by the background pump
    // below. The pump accumulates the full response AND forwards every text
    // delta to `deltas()` through a wakeup queue, so the client-visible
    // stream and the persisted `finished.content` are guaranteed to contain
    // the SAME bytes.
    //
    // Bug history (2026-08-31): `deltas()` and `finished` each iterated the
    // same AsyncGenerator concurrently. An async generator hands each event
    // to exactly ONE awaiter, so every SSE chunk went to either the live
    // stream or the accumulator — never both. Replies reached users with
    // random words/fragments missing (orphaned `**` markers, scrambled
    // lists) and the persisted message was a different random half.
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
      const groundingChunks: GeminiGroundingChunk[] = []
      try {
        for await (const payload of sse) {
          if (payload === '[DONE]') break
          let chunk: GeminiGenerateContentResponse
          try {
            chunk = JSON.parse(payload) as GeminiGenerateContentResponse
          } catch {
            continue
          }
          const block = chunk.promptFeedback?.blockReason
          if (block && block !== 'BLOCK_REASON_UNSPECIFIED') {
            throw new ContentFilteredError('GEMINI', `prompt blocked: ${block}`)
          }
          const parts = chunk.candidates?.[0]?.content?.parts ?? []
          for (const p of parts) {
            if (p.text) {
              content += p.text
              pending.push(p.text)
              kick()
            }
          }
          // Grounding citations can arrive on ANY chunk — accumulate all.
          const gm = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks
          if (gm?.length) groundingChunks.push(...gm)
          const fr = chunk.candidates?.[0]?.finishReason
          if (fr && fr !== 'FINISH_REASON_UNSPECIFIED') finishReason = fr
          if (chunk.usageMetadata) {
            usage = {
              promptTokens: chunk.usageMetadata.promptTokenCount ?? usage.promptTokens,
              completionTokens: chunk.usageMetadata.candidatesTokenCount ?? usage.completionTokens,
              totalTokens: chunk.usageMetadata.totalTokenCount ?? usage.totalTokens,
            }
          }
        }
      } catch (err) {
        pumpError = err
        throw err
      } finally {
        pumpDone = true
        kick()
        clearTimeout(timer)
      }
      if (!content && !finishReason) {
        pumpError = new MalformedResponseError('GEMINI', 'stream produced no content')
        throw pumpError
      }
      const nativeSources: AiWebSource[] = mapGeminiGrounding(groundingChunks)
      return {
        id: `gem_${startedAt}`,
        content,
        usage,
        provider: 'GEMINI',
        model,
        durationMs: Date.now() - startedAt,
        finishReason,
        ...(nativeSources.length > 0 ? { sources: nativeSources } : {}),
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
      return { provider: 'GEMINI', configured: false, error: 'GEMINI_API_KEY not set' }
    }
    const startedAt = Date.now()
    try {
      await this.generate({
        messages: [{ role: 'user', content: 'ping' }],
        options: { maxTokens: 8, timeoutMs: 15_000 },
      })
      return { provider: 'GEMINI', configured: true, latencyMs: Date.now() - startedAt }
    } catch (err) {
      return {
        provider: 'GEMINI',
        configured: true,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Diagnostics-only probe (one minimal generateContent call from the same
   * runtime generation runs in). Never used on the generate path; never
   * returns the API key.
   */
  async ping(model?: string): Promise<{
    ok: boolean
    httpStatus: number | null
    latencyMs: number
    model: string
    errorCode?: string
    error?: string
  }> {
    const startedAt = Date.now()
    const target = model || this.defaultModel
    try {
      await this.generate({
        messages: [{ role: 'user', content: 'ping' }],
        options: { model: target, maxTokens: 8, timeoutMs: 20_000 },
      })
      return { ok: true, httpStatus: 200, latencyMs: Date.now() - startedAt, model: target }
    } catch (err) {
      const aiErr = normalizeAiError('GEMINI', err)
      return {
        ok: false,
        httpStatus: aiErr.statusCode ?? null,
        latencyMs: Date.now() - startedAt,
        model: target,
        errorCode: aiErr.code,
        error: aiErr.message.slice(0, 300),
      }
    }
  }
}
