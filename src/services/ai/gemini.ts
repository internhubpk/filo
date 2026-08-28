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
//     generationConfig: { temperature, maxOutputTokens, topP,
//                         responseMimeType?, thinkingBudget? }
//   }
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
} from './types'
import type { AiProvider } from './provider'
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
 *   gemini-2.5-flash-lite — cheapest, fast: mechanical volume
 *   gemini-2.5-flash      — mid: generation/longform workhorse
 *   gemini-2.5-pro        — most capable / most expensive: quality escalation
 * MODEL_NOT_FOUND (404) advances the chain, so a retired id degrades
 * gracefully instead of failing the provider.
 */
export const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
] as const

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
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
  readonly defaultModel = 'gemini-2.5-flash'
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

    // gemini-2.5 flash models think by default; thinking burns output budget
    // and routinely returns empty text at low maxOutputTokens. Disable it for
    // flash-tier models (pro requires a thinking budget — leave it dynamic).
    const thinkingConfig = /flash/i.test(model)
      ? { thinkingConfig: { thinkingBudget: 0 } }
      : {}

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(
        `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents,
            ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
            generationConfig: {
              temperature: opts?.temperature ?? 0.7,
              maxOutputTokens: opts?.maxTokens,
              topP: opts?.topP,
              stopSequences: opts?.stopSequences,
              responseMimeType:
                opts?.responseFormat?.type === 'json' ? 'application/json' : undefined,
              ...thinkingConfig,
            },
          }),
        }
      )

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw errorFromHttpStatus('GEMINI', response.status, errText)
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
