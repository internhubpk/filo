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
//   - MODEL FALLBACK lives in the ROUTER (single source of truth): this
//     adapter performs EXACTLY ONE model call per generate() and throws on
//     any failure. Walking candidates inside the adapter hid the real
//     attempt count from the router's bounded budget — an earlier version
//     silently walked up to 8 models per "attempt" and aborted the walk on
//     the first non-404 error, stranding healthy cheaper models whenever
//     the lead alias returned 503 high-demand.
//
// MODEL REGISTRY — verified 2026-08-28 against Google's docs + runtime
// evidence (Convex logs + Admin AI probe):
//   • Gemini 2.0 Flash / 2.0 Flash-Lite: SHUT DOWN June 1, 2026 — removed.
//   • Pro-tier models (2.5 Pro, pro-latest): BLOCKED on the Gemini API free
//     tier since April 1, 2026 — they 404 for free-tier keys. Kept at the
//     TAIL of the registry for paid-tier keys only.
//   • gemini-2.5-flash / gemini-2.5-flash-lite: scheduled shutdown Oct 16,
//     2026; already 404 for some newer keys — kept near the tail.
//   • gemini-3.5-flash is the current GA flash model.
//   • The `-latest` aliases always resolve to the current model of their
//     family and are verified live (HTTP 200/503-model-level, never 404).
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
 * Models we're willing to route to on Gemini, in priority order. The router
 * walks this list (task matrix first, then the remaining ids below) with
 * bounded attempts — see router.ts buildModelChain().
 *
 * The `-latest` aliases always resolve to Google's current model of that
 * family, so they survive per-project model retirements. 2.0 ids are DEAD
 * (shut down June 1, 2026) and must not be re-added.
 */
export const GEMINI_MODELS = [
  'gemini-flash-latest', // always-current flash alias (verified live 2026-08-28)
  'gemini-3.5-flash', // current GA flash generation
  'gemini-flash-lite-latest', // always-current cheap alias (separate capacity pool)
  'gemini-2.5-flash', // legacy flash — shutdown Oct 16, 2026; 404s on newer keys
  'gemini-2.5-flash-lite', // legacy cheap tier — same Oct 16, 2026 sunset
  'gemini-pro-latest', // pro alias — PAID TIER ONLY since 2026-04-01
  'gemini-2.5-pro', // legacy pro — paid tier only; shutdown ≥ Oct 16, 2026
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

  /**
   * ONE model call per invocation — no hidden candidate walk. Model-level
   * fallback (404 → next id, 503 → next id) is the ROUTER's job so that
   * every HTTP round trip is counted against the provider's bounded attempt
   * budget and every log line names the model that was actually called.
   */
  async generate(request: AiRequest): Promise<AiResponse> {
    const apiKey = this.getApiKey()
    const model = request.options?.model || this.defaultModel
    const timeoutMs = request.options?.timeoutMs ?? 60_000
    const startedAt = Date.now()
    return this.generateWithModel(request, model, apiKey, timeoutMs, startedAt)
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
