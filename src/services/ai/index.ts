// =============================================================================
// FILO AI — Public API
// =============================================================================
// The ONE import the rest of the codebase uses for AI:
//
//   import { aiRouter, buildBlueprintPrompt, BLUEPRINT_SCHEMA } from '@/services/ai'
//
// Direct imports of provider files (./agentrouter, ./openai) are
// internal implementation details — do NOT import them from app code.
// =============================================================================

export {
  aiRouter,
  MODEL_MATRIX,
  PROVIDER_FALLBACK_ORDER,
  DEFAULT_RETRY_POLICY,
  MAX_ATTEMPTS_PER_PROVIDER,
  providerHealthSnapshot,
} from './router'
export type { GenerateOptions, AiTask } from './router'

export {
  registerProvider,
  getProvider,
  listProviders,
  requireProvider,
  registerDefaultProviders,
} from './provider'
export type { AiProvider } from './provider'

export { AgentRouterModule, AGENT_ROUTER_MODELS } from './agentrouter'
export { OpenAiProvider, OPENAI_MODELS } from './openai'

export * from './errors'
export type {
  ProviderId,
  AiRole,
  AiMessage,
  AiRequest,
  AiRequestOptions,
  AiResponse,
  AiUsage,
  RetryPolicy,
  ProviderHealth,
  ResponseFormat,
} from './types'

export {
  BLUEPRINT_SCHEMA,
  SECTION_SCHEMA,
  validateBlueprint,
  validateSection,
} from './schemas'
export type {
  Blueprint,
  BlueprintSectionSpec,
  BlueprintComponentSpec,
  GeneratedSection,
  GeneratedSectionComponent,
} from './schemas'

export {
  PROMPT_VERSIONS,
  buildBlueprintPrompt,
  buildSectionPrompt,
  buildConsistencyCheckPrompt,
} from './prompts'
export type {
  BlueprintPromptInput,
  SectionPromptInput,
} from './prompts'
