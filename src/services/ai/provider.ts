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
} from './types'
import { ApiKeyMissingError } from './errors'
import { AgentRouterModule } from './agentrouter'
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

  /** Lightweight reachability probe (used by health checks + fallback ordering). */
  healthCheck(): Promise<ProviderHealth>
}

// ==================== REGISTRY ====================

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
 * All three providers use static imports (required for Convex's ESM
 * bundler). A provider whose API key is absent still registers — it just
 * reports isConfigured() === false and the router skips it in the fallback
 * chain. That's what makes the OpenAI fallback a soft dependency rather than
 * hard ones.
 */
export function registerDefaultProviders(): void {
  if (defaultsRegistered) return
  defaultsRegistered = true

  // Canonical primary provider: the Agent Router (cost-optimized multi-model
  // gateway — deepseek-v4-flash / glm-5.3 / gpt-5.6-sol / claude-opus-4-8 /
  // claude-opus-5). See agentrouter.ts for the verified model registry.
  registerProvider(new AgentRouterModule())

  // Optional fallback (skipped at runtime when unconfigured). Intended as the
  // production workhorse once OPENAI_API_KEY is set.
  registerProvider(new OpenAiProvider())
}
