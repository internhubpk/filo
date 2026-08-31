// =============================================================================
// FILO AI — Shared Types
// =============================================================================
// The canonical, provider-agnostic type system for all AI calls in Filo.
// Every provider implementation (Agent Router, OpenAI, ...) converts
// to/from these types so the rest of the application never sees
// provider-specific payloads.
// =============================================================================

/** Identifiers for every provider Filo can route to. Each id is a genuinely
 *  INDEPENDENT provider (separate company, endpoint, and credentials) — the
 *  router falls back across these, never across models of one gateway. */
export type ProviderId = 'AGENT_ROUTER' | 'GEMINI' | 'OPENAI'

/** Chat role (OpenAI-style; providers translate internally). */
export type AiRole = 'system' | 'user' | 'assistant'

/** A single message in a conversation. */
export interface AiMessage {
  role: AiRole
  content: string
}

/** Structured-output mode. */
export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json' }
  | { type: 'json_schema'; schema: unknown }

/** A web citation surfaced by a provider's native search grounding. */
export interface AiWebSource {
  title: string
  url: string
  snippet?: string
}

/** Per-request generation options (all optional — providers apply defaults). */
export interface AiRequestOptions {
  /** Provider-specific model id, e.g. 'deepseek-v4-flash'. */
  model?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
  responseFormat?: ResponseFormat
  /** Request timeout in milliseconds. */
  timeoutMs?: number
  /** Idempotency / trace id propagated into logs. */
  requestId?: string
  /** Ask the provider to ground the reply in live web results. CHAT ONLY —
   *  document generation must never ground. Supported natively by GEMINI
   *  (google_search tool → groundingMetadata) and by OPENAI search-capable
   *  models (url_citation annotations); unsupported providers/models ignore
   *  it fail-soft and the caller falls back to link extraction. */
  webSearch?: boolean
}

/** A complete generation request. */
export interface AiRequest {
  messages: AiMessage[]
  options?: AiRequestOptions
}

/** Normalized token usage. */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Normalized, provider-agnostic response. */
export interface AiResponse {
  id: string
  content: string
  usage: AiUsage
  /** Provider that served the request. */
  provider: ProviderId
  /** Model that served the request (as reported by the provider). */
  model: string
  /** Wall-clock duration in ms. */
  durationMs: number
  finishReason?: string
  /** Native web citations from the provider's search grounding — present
   *  only when the request enabled webSearch AND the provider served
   *  results. Absent/empty ⇒ caller falls back to link extraction. */
  sources?: AiWebSource[]
}

/**
 * Streaming generation handle (SSE under the hood for both Gemini and
 * OpenAI). `textStream` yields incremental text deltas as they arrive;
 * `finished` resolves once the upstream stream completes with the FULL
 * normalized response (content = concatenation of every delta, real usage
 * numbers included). `finished` rejects if the stream fails mid-flight.
 */
export interface AiStreamResult {
  textStream: AsyncIterable<string>
  finished: Promise<AiResponse>
}

/** Retry policy for a generation attempt. */
export interface RetryPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  /** Status codes / error codes that are safe to retry. */
  retryableCodes?: string[]
}

/** Health probe result for a provider. */
export interface ProviderHealth {
  provider: ProviderId
  configured: boolean
  latencyMs?: number
  error?: string
}
