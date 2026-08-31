// =============================================================================
// FILO AI — Provider Interface & Registry
// =============================================================================
// The ONE contract every AI provider must satisfy. The rest of Filo imports
// `aiRouter` from './router' and never talks to a provider directly.
//
// Adding a provider:
//   1. Implement `AiProvider` below (see agentrouter.ts for the reference impl).
//   2. Register it in `registerDefaultProviders()` below.
//   3. Add its env vars to .env.example.
// =============================================================================

import type {
  AiRequest,
  AiResponse,
  ProviderHealth,
  ProviderId,
  AiStreamResult,
} from './types'
import { ApiKeyMissingError } from './errors'
import { AgentRouterModule } from './agentrouter'
import { GeminiProvider } from './gemini'
import { OpenAiProvider } from './openai'

/**
 * The canonical provider contract.
 *
 * Implementations MUST:
 *   - Throw subclasses of AiBaseError (see ./errors.ts) — never raw Errors.
 *   - Normalize usage/pricing into the standard AiResponse shape.
 *   - Apply their own per-request timeout (options.timeoutMs) via AbortController.
 *   - Read secrets lazily (at call time), NOT at module load — so a missing
 *     key for a non-primary provider never crashes boot.
 */
export interface AiProvider {
  /** Stable provider id, e.g. 'AGENT_ROUTER'. */
  readonly id: ProviderId
  /** Human-readable name for logs and error messages. */
  readonly displayName: string
  /** Default model when a request doesn't pin one. */
  readonly defaultModel: string
  /** All model ids this provider can serve. */
  readonly availableModels: readonly string[]

  /** True when the provider has the credentials it needs. */
  isConfigured(): boolean

  /** Run a single generation. */
  generate(request: AiRequest): Promise<AiResponse>

  /**
   * Stream a generation as text deltas over SSE. Providers that support
   * streaming implement this; the router's streaming path uses it directly.
   * Implementations MUST reject the returned promise (and `finished`) with
   * an AiBaseError subclass on auth/config/HTTP failure.
   */
  stream?(request: AiRequest): Promise<AiStreamResult>

  /** Lightweight reachability probe (used by health checks + fallback ordering). */
  healthCheck(): Promise<ProviderHealth>
}

// ==================== SHARED SSE HELPERS ====================

/**
 * Parse an SSE byte stream into `data:` payload strings. Handles multi-line
 * events (joins data lines), CRLF, comment lines (`:` prefix) and the
 * `[DONE]` sentinel used by OpenAI-compatible APIs. Used by both streaming
 * provider implementations — one parser, one set of edge-case fixes.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<string, void, undefined> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE events are separated by a blank line.
      let separator = buffer.search(/\r?\n\r?\n/)
      while (separator !== -1) {
        const rawEvent = buffer.slice(0, separator)
        buffer = buffer.slice(separator + (buffer[separator] === '\r' ? 4 : 2))
        const dataLines = rawEvent
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
        if (dataLines.length > 0) {
          yield dataLines.join('\n')
        }
        separator = buffer.search(/\r?\n\r?\n/)
      }
    }
    // Flush a trailing event that lacks the final blank line.
    const tail = buffer
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
    if (tail.length > 0) yield tail.join('\n')
  } finally {
    reader.releaseLock()
  }
}

// ==================== REGISTRY ====================

/**
 * Normalizes an OpenAI-compatible base URL (shared by every OpenAI-format
 * adapter): strips trailing slashes, appends exactly one `/v1` when missing,
 * and collapses accidental `/v1/v1` double prefixes. Keeps request
 * construction honest — `${base}/chat/completions` is always the right URL.
 */
export function normalizeOpenAiCompatibleBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  if (!url) return url
  // Collapse a double /v1/vN prefix first (e.g. user pasted …/v1 + code adds /v1).
  url = url.replace(/(\/v\d+)\/v\d+$/, '$1')
  // If someone configured the bare host (or a proxy root), add /v1 once.
  if (!/\/v\d+$/.test(url)) url = `${url}/v1`
  return url
}

const registry = new Map<ProviderId, AiProvider>()

/** Register a provider implementation. Last write wins. */
export function registerProvider(provider: AiProvider): void {
  registry.set(provider.id, provider)
}

/** Look up a registered provider. */
export function getProvider(id: ProviderId): AiProvider | undefined {
  return registry.get(id)
}

/** All registered providers (insertion order). */
export function listProviders(): AiProvider[] {
  return Array.from(registry.values())
}

/** Require a registered provider or throw a clear error. */
export function requireProvider(id: ProviderId): AiProvider {
  const p = registry.get(id)
  if (!p) {
    throw new ApiKeyMissingError(id, '(provider not registered)')
  }
  return p
}

// ==================== DEFAULT REGISTRATION ====================

let defaultsRegistered = false

/**
 * Register the built-in providers. Called lazily by the router so that
 * importing this module stays side-effect-free (important for tests).
 *
 * All providers use static imports (required for Convex's ESM bundler).
 * A provider whose API key is absent still registers — it just reports
 * isConfigured() === false and the router skips it in the fallback chain.
 * That's what keeps Gemini/OpenAI soft dependencies rather than hard ones.
 *
 * The three ids are genuinely INDEPENDENT backends (different companies,
 * hosts, and credentials). The router's fallback walks THIS list, so an
 * AgentRouter gateway outage can never take Gemini/OpenAI down with it.
 */
export function registerDefaultProviders(): void {
  if (defaultsRegistered) return
  defaultsRegistered = true

  // Canonical primary: the AgentRouter gateway (cost-optimized multi-model
  // pool — deepseek-v4-flash / glm-5.3 / gpt-5.6-sol / claude-opus-4-8 /
  // claude-opus-5). See agentrouter.ts for the live-verified contract.
  registerProvider(new AgentRouterModule())

  // Independent direct fallback #1: Google's Generative Language API.
  registerProvider(new GeminiProvider())

  // Independent direct fallback #2 (skipped at runtime when unconfigured).
  registerProvider(new OpenAiProvider())
}
