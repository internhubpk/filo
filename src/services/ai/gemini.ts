// =============================================================================
// FILO AI — Google Gemini Provider (CANONICAL PRIMARY)
// =============================================================================
// Implements the AiProvider contract against the Gemini generateContent API.
//
// Env vars:
//   GEMINI_API_KEY     (required — from Google AI Studio)
//   GEMINI_BASE_URL    (optional — default https://generativelanguage.googleapis.com/v1beta)
//   GEMINI_MODEL       (optional — default gemini-2.0-flash)
//
// Notes:
//   - Keys are read lazily so a missing GEMINI_API_KEY degrades gracefully
//     (router falls through to the next provider) instead of crashing boot.
//   - Uses the REST API via fetch — no SDK dependency, no Node-only APIs,
//     so it also works inside Convex actions and edge runtimes.
//   - System messages are hoisted into Gemini's `systemInstruction` field.
// =============================================================================

import type {
  AiRequest,
  AiResponse,
  AiMessage,
  ProviderHealth,
} from './types'
import type { AiProvider } from './provider'
import {
  ApiKeyMissingError,
  errorFromHttpStatus,
  MalformedResponseError,
  normalizeAiError,
} from './errors'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_MODEL = 'gemini-2.0-flash'

/** Models we're willing to route to on Gemini, cheapest first. */
export const GEMINI_MODELS = [
  'gemini-2.0-flash', // fast + cheap default
  'gemini-2.0-flash-lite', // cheapest
  'gemini-2.5-flash', // newer flash
  'gemini-2.5-pro', // reasoning-heavy work
  'gemini-1.5-flash', // legacy fallback
  'gemini-1.5-pro', // legacy fallback
] as const

interface GeminiPart {
  text?: string
}

interface GeminiContent {
  role?: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiGenerateRequest {
  systemInstruction?: { parts: GeminiPart[] }
  contents: GeminiContent[]
  generationConfig?: {
    temperature?: number
    maxOutputTokens?: number
    topP?: number
    frequencyPenalty?: number
    presencePenalty?: number
    stopSequences?: string[]
    responseMimeType?: 'application/json' | 'text/plain'
  }
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[]; role?: string }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  error?: { code?: number; message?: string; status?: string }
}

export class GeminiProvider implements AiProvider {
  readonly id = 'GEMINI' as const
  readonly displayName = 'Google Gemini'
  readonly defaultModel = process.env.GEMINI_MODEL || DEFAULT_MODEL
  readonly availableModels: readonly string[] = GEMINI_MODELS

  private getApiKey(): string {
    const key = process.env.GEMINI_API_KEY || ''
    if (!key) {
      throw new ApiKeyMissingError('GEMINI', 'GEMINI_API_KEY')
    }
    return key
  }

  private getBaseUrl(): string {
    return process.env.GEMINI_BASE_URL || DEFAULT_BASE_URL
  }

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY)
  }

  async generate(request: AiRequest): Promise<AiResponse> {
    const apiKey = this.getApiKey()
    const model = request.options?.model || this.defaultModel
    const timeoutMs = request.options?.timeoutMs ?? 60_000
    const startedAt = Date.now()

    const body = this.buildRequestBody(request, model)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(
        `${this.getBaseUrl()}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      )

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw errorFromHttpStatus('GEMINI', response.status, errText)
      }

      const data = (await response.json()) as GeminiGenerateResponse

      // Safety block — surface as a non-retryable error.
      if (data.promptFeedback?.blockReason) {
        throw new MalformedResponseError(
          'GEMINI',
          `content blocked (${data.promptFeedback.blockReason})`
        )
      }

      const candidate = data.candidates?.[0]
      const content = (candidate?.content?.parts || [])
        .map((p) => p.text || '')
        .join('')

      if (!candidate) {
        throw new MalformedResponseError(
          'GEMINI',
          'response contained no candidates'
        )
      }

      return {
        id: `gemini_${startedAt}_${Math.random().toString(36).slice(2, 8)}`,
        content,
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
        },
        provider: 'GEMINI',
        model,
        durationMs: Date.now() - startedAt,
        finishReason: candidate.finishReason,
      }
    } catch (err) {
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
      // Cheapest possible probe: 1-token generation on the cheapest model.
      await this.generate({
        messages: [{ role: 'user', content: 'ping' }],
        options: { model: 'gemini-2.0-flash-lite', maxTokens: 1, timeoutMs: 10_000 },
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
   * Convert our normalized request into Gemini's generateContent payload.
   * Gemini has no system role — we hoist system messages into
   * `systemInstruction` and map assistant → model.
   */
  private buildRequestBody(request: AiRequest, model: string): GeminiGenerateRequest {
    const systemParts: GeminiPart[] = []
    const contents: GeminiContent[] = []

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemParts.push({ text: msg.content })
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        })
      }
    }

    const opts = request.options
    const wantsJson =
      opts?.responseFormat?.type === 'json' ||
      opts?.responseFormat?.type === 'json_schema'

    const payload: GeminiGenerateRequest = {
      contents,
      generationConfig: {
        temperature: opts?.temperature,
        maxOutputTokens: opts?.maxTokens,
        topP: opts?.topP,
        frequencyPenalty: opts?.frequencyPenalty,
        presencePenalty: opts?.presencePenalty,
        stopSequences: opts?.stopSequences,
        responseMimeType: wantsJson ? 'application/json' : undefined,
      },
    }

    if (systemParts.length > 0) {
      payload.systemInstruction = { parts: systemParts }
    }

    // json_schema mode: Gemini supports a subset of JSON schema via
    // generationConfig.responseSchema. We pass it through as-is; the schema
    // is authored against Gemini's subset in schemas.ts.
    if (opts?.responseFormat?.type === 'json_schema') {
      const schema = (opts.responseFormat as { schema: unknown }).schema
      if (schema && typeof schema === 'object') {
        ;(payload.generationConfig as Record<string, unknown>).responseSchema =
          schema
      }
    }

    return payload
  }
}
