// =============================================================================
// FILO AI — Shared Types
// =============================================================================
// The canonical, provider-agnostic type system for all AI calls in Filo.
// Every provider implementation (Agent Router, OpenAI, ...) converts
// to/from these types so the rest of the application never sees
// provider-specific payloads.
// =============================================================================

/** Identifiers for every provider Filo can route to. */
export type ProviderId = 'AGENT_ROUTER' | 'OPENAI'

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
