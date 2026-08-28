// =============================================================================
// FILO AI — Google Gemini Provider (CANONICAL PRIMARY)
// =============================================================================
// Implements the AiProvider contract against the Gemini generateContent API.
//
// Env vars:
//   GEMINI_API_KEY     (required — from Google AI Studio)
//   GEMINI_BASE_URL    (optional — default https://generativelanguage.googleapis.com/v1beta)
//   GEMINI_MODEL       (optional — default gemini-flash-latest)
//
// Notes:
//   - Keys are read lazily so a missing GEMINI_API_KEY degrades gracefully
//     (router falls through to the next provider) instead of crashing boot.
//   - Uses the REST API via fetch — no SDK dependency, no Node-only APIs,
//     so it also works inside Convex actions and edge runtimes.
//   - System messages are hoisted into Gemini's `systemInstruction` field.
//   - MODEL FALLBACK: Google retires/renames models per project (a key
//     provisioned at a different time may not see every model). When the
//     API answers 404 MODEL_NOT_FOUND, the provider transparently retries
//     the remaining models in GEMINI_MODELS before surfacing an error.
//
// API SURFACE DECISION (AI-repair spec §1 — evaluated 2026-08, do not
// migrate blindly):
//   Filo stays on generateContent (REST, v1beta). Google's Interactions API
//   targets stateful/agent-style interactions; Filo needs none of that —
//   every call is a single stateless structured-JSON completion
//   (systemInstruction + responseMimeType/responseSchema). generateContent
//   is GA, fully supported, and the request shape below maps 1:1 to it.
//   Migrating would add surface area for zero capability gain. Re-evaluate
//   ONLY if Filo adds agentic multi-turn tool flows.
// =============================================================================

import type {
  AiRequest,
  AiResponse,
  AiMessage,
  ProviderHealth,
} from './types'
import type { AiProvider } from './provider'
import {
  AiBaseError,
  ApiKeyMissingError,
  ConfigurationError,
  errorFromHttpStatus,
  MalformedResponseError,
  normalizeAiError,
} from './errors'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_MODEL = 'gemini-flash-latest'

/**
 * Normalize a configured Gemini base URL into `<origin>/<api-version>`.
 *
 * A mis-set GEMINI_BASE_URL (missing the `/v1beta` path segment, a trailing
 * slash, or a pasted full `…/v1beta/models` path) makes EVERY model return
 * HTTP 404 — which looks exactly like "every Gemini model was retired".
 * This guards against that entire failure class.
 */
export function normalizeGeminiBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  // Strip a trailing /models segment if someone pasted the full models URL.
  url = url.replace(/\/models$/i, '')
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const last = segments[segments.length - 1] ?? ''
    const isVersion = /^v\d+[a-z]*$/i.test(last)
    if (!isVersion) {
      // Default to the v1beta surface (where the -latest aliases live).
      segments.push('v1beta')
    }
    return `${parsed.origin}/${segments.join('/')}`
  } catch {
    // Not a parseable URL — return as-is; fetch will surface the error.
    return url
  }
}

/**
 * Models we're willing to route to on Gemini, tried in order until one
 * responds. The `-latest` aliases always resolve to Google's current model
 * of that family, so they survive per-project model retirements.
 */
export const GEMINI_MODELS = [
  'gemini-flash-latest', // always-current flash alias (default)
  'gemini-2.5-flash', // current generation flash
  'gemini-2.0-flash', // previous generation flash (GA)
  'gemini-flash-lite-latest', // always-current cheap alias
  'gemini-2.5-flash-lite', // cheap tier
  'gemini-2.0-flash-lite', // cheapest legacy
  'gemini-pro-latest', // always-current pro alias (reasoning-heavy)
  'gemini-2.5-pro', // reasoning-heavy work
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
    const raw = process.env.GEMINI_BASE_URL?.trim() || DEFAULT_BASE_URL;
    const normalized = normalizeGeminiBaseUrl(raw);
    // Strict validation at REQUEST time: an unparseable base URL is a
    // CONFIGURATION_ERROR (operator action needed), not a network outage.
    try {
      new URL(normalized)
    } catch {
      throw new ConfigurationError(
        'GEMINI',
        `GEMINI_BASE_URL "${raw.slice(0, 100)}" is not a valid URL`
      )
    }
    return normalized;
  }

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY)
  }

  async generate(request: AiRequest): Promise<AiResponse> {
    const apiKey = this.getApiKey()
    const requestedModel = request.options?.model || this.defaultModel
    const timeoutMs = request.options?.timeoutMs ?? 60_000
    const startedAt = Date.now()

    // Candidate models: the requested/default model first, then the rest of
    // the allowed chain. Only an explicit 404 MODEL_NOT_FOUND advances to the
    // next candidate — every other error surfaces immediately.
    const candidates = [requestedModel, ...GEMINI_MODELS.filter((m) => m !== requestedModel)]

    let lastError: unknown
    for (const model of candidates) {
      try {
        return await this.generateWithModel(request, model, apiKey, timeoutMs, startedAt)
      } catch (err) {
        lastError = err
        const isModelMissing =
          err instanceof AiBaseError &&
          err.code === 'MODEL_NOT_FOUND'
        if (isModelMissing) {
          console.warn(
            `[AI] GEMINI model not found: ${model} — trying next candidate (${candidates.filter((m) => m !== model).length} left)`
          )
          continue
        }
        throw normalizeAiError('GEMINI', err)
      }
    }
    // Every candidate 404'd. That pattern almost always means an endpoint or
    // project problem, NOT that every model was retired — surface the exact
    // endpoint so the operator can fix GEMINI_BASE_URL / the API key fast.
    const endpoint = `${this.getBaseUrl()}/models/…:generateContent`
    const lastMessage = lastError instanceof Error ? lastError.message : String(lastError)
    throw new AiBaseError(
      `GEMINI: all ${candidates.length} candidate models returned 404 on ${endpoint}. ` +
        `Check GEMINI_BASE_URL (must include /v1beta) and that the API key belongs to a project with the Generative Language API enabled. ` +
        `Last error: ${lastMessage.slice(0, 200)}`,
      'MODEL_NOT_FOUND',
      'GEMINI',
      false
    )
  }

  private async generateWithModel(
    request: AiRequest,
    model: string,
    apiKey: string,
    timeoutMs: number,
    startedAt: number
  ): Promise<AiResponse> {
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
        options: { model: 'gemini-flash-lite-latest', maxTokens: 1, timeoutMs: 10_000 },
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
   * Diagnostics-only LIVE probe (AI-repair spec §3): one minimal
   * generateContent request from the SAME runtime the caller runs in.
   * Records HTTP status, latency, model and the provider error code —
   * never the API key. Never used on the generate path.
   */
  async ping(): Promise<{
    ok: boolean
    httpStatus: number | null
    latencyMs: number
    model: string
    errorCode?: string
    error?: string
  }> {
    const startedAt = Date.now()
    const model = 'gemini-flash-lite-latest'
    try {
      await this.generate({
        messages: [{ role: 'user', content: 'ping' }],
        options: { model, maxTokens: 1, timeoutMs: 15_000 },
      })
      return { ok: true, httpStatus: 200, latencyMs: Date.now() - startedAt, model }
    } catch (err) {
      const aiErr = normalizeAiError('GEMINI', err)
      return {
        ok: false,
        httpStatus: aiErr.statusCode ?? null,
        latencyMs: Date.now() - startedAt,
        model,
        errorCode: aiErr.code,
        error: aiErr.message.slice(0, 300),
      }
    }
  }

  /**
   * Diagnostics-only probe (AI-repair spec §3/§6): ListModels against the
   * configured surface. Answers "can we reach Gemini", "is the key valid",
   * and "which of OUR configured model ids actually exist for this key" —
   * without ever exposing the key itself. Never used on the generate path.
   */
  async diagnose(): Promise<{
    reachable: boolean
    httpStatus: number | null
    latencyMs: number
    configuredModels: string[]
    availableConfiguredModels: string[]
    missingConfiguredModels: string[]
    error?: string
  }> {
    const startedAt = Date.now()
    const latencyMs = () => Date.now() - startedAt
    if (!this.isConfigured()) {
      return {
        reachable: false,
        httpStatus: null,
        latencyMs: latencyMs(),
        configuredModels: [...GEMINI_MODELS],
        availableConfiguredModels: [],
        missingConfiguredModels: [...GEMINI_MODELS],
        error: 'GEMINI_API_KEY not set',
      }
    }
    let apiKey: string
    let baseUrl: string
    try {
      apiKey = this.getApiKey()
      baseUrl = this.getBaseUrl()
    } catch (err) {
      return {
        reachable: false,
        httpStatus: null,
        latencyMs: latencyMs(),
        configuredModels: [...GEMINI_MODELS],
        availableConfiguredModels: [],
        missingConfiguredModels: [...GEMINI_MODELS],
        error: err instanceof Error ? err.message : String(err),
      }
    }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      const response = await fetch(`${baseUrl}/models?pageSize=200&key=${encodeURIComponent(apiKey)}`, {
        method: 'GET',
        signal: controller.signal,
      })
      clearTimeout(timer)
      const bodyText = await response.text().catch(() => '')
      if (!response.ok) {
        return {
          reachable: response.status < 500,
          httpStatus: response.status,
          latencyMs: latencyMs(),
          configuredModels: [...GEMINI_MODELS],
          availableConfiguredModels: [],
          missingConfiguredModels: [...GEMINI_MODELS],
          error: `HTTP ${response.status}: ${bodyText.slice(0, 200)}`,
        }
      }
      const data = JSON.parse(bodyText) as { models?: Array<{ name?: string }> }
      const names = (data.models ?? [])
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter(Boolean)
      const available = GEMINI_MODELS.filter((m) => names.includes(m))
      return {
        reachable: true,
        httpStatus: response.status,
        latencyMs: latencyMs(),
        configuredModels: [...GEMINI_MODELS],
        availableConfiguredModels: available,
        missingConfiguredModels: GEMINI_MODELS.filter((m) => !names.includes(m)),
      }
    } catch (err) {
      return {
        reachable: false,
        httpStatus: null,
        latencyMs: latencyMs(),
        configuredModels: [...GEMINI_MODELS],
        availableConfiguredModels: [],
        missingConfiguredModels: [...GEMINI_MODELS],
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
