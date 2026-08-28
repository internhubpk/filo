// =============================================================================
// FILO AI — COMPATIBILITY SHIM (DEPRECATED)
// =============================================================================
// The canonical AI abstraction now lives in src/services/ai/ (a directory).
// This file remains ONLY so existing imports of '@/services/ai' keep working
// during the migration. It re-exports the canonical API and provides the
// legacy `aiService` adapter that delegates to aiRouter.
//
// NEW CODE: import from '@/services/ai' — you'll get the same exports either
// way (this shim forwards everything), but the directory is the source of truth.
//
// TODO(Phase 22 cleanup): migrate artifact-engine.ts to import aiRouter
// directly, then delete this shim.
// =============================================================================

import { aiRouter } from './ai/index'
import type {
  AiRequest,
  AiResponse,
  AiProvider,
} from './ai/index'
import type {
  AiGenerateRequest,
  AiResponse as LegacyAiResponse,
} from '@/types'

export * from './ai/index'

// ==================== LEGACY aiService ADAPTER ====================

/**
 * Legacy interface kept for artifact-engine.ts. All methods delegate to the
 * canonical aiRouter, which adds provider fallback (Agent Router primary) that the
 * old implementation never had.
 */
class LegacyAiServiceAdapter {
  /**
   * Legacy generate — delegates to aiRouter with the default retry policy.
   */
  async generate(request: AiGenerateRequest): Promise<LegacyAiResponse> {
    const response = await aiRouter.generate(this.toCanonical(request))
    return this.toLegacy(response)
  }

  /**
   * Legacy generateWithRetry — retry now lives inside aiRouter; the
   * maxRetries argument is translated into a retry policy.
   */
  async generateWithRetry(
    request: AiGenerateRequest,
    maxRetries: number = 3
  ): Promise<LegacyAiResponse> {
    const response = await aiRouter.generate(this.toCanonical(request), {
      retryPolicy: { maxAttempts: Math.max(1, maxRetries) },
    })
    return this.toLegacy(response)
  }

  /** Legacy provider getter — reports the primary provider (Agent Router). */
  getCurrentProvider(): AiProvider {
    // The legacy @/types union predates Gemini. The canonical primary is
    // Gemini, so we widen via a cast (shim-only; new code should read
    // aiRouter.status() instead).
    return 'GEMINI' as unknown as AiProvider
  }

  /** Connection probe via the canonical health check. */
  async validateConnection(): Promise<boolean> {
    const health = await aiRouter.health()
    return health.some((h) => h.configured && !h.error)
  }

  private toCanonical(request: AiGenerateRequest): AiRequest {
    return {
      messages: request.messages.map((m) => ({
        // Legacy type allows a 'tool' role and multipart content arrays —
        // the canonical type is plain text. Collapse role to user/assistant
        // and stringify multipart content.
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content:
          typeof m.content === 'string'
            ? m.content
            : // Flatten multipart content parts into a single string.
              (m.content || [])
                  .map((p) => (typeof p === 'string' ? p : p?.text || ''))
                  .join('\n'),
      })),
      options: {
        model: request.options?.model,
        temperature: request.options?.temperature,
        maxTokens: request.options?.maxTokens,
        topP: request.options?.topP,
        frequencyPenalty: request.options?.frequencyPenalty,
        presencePenalty: request.options?.presencePenalty,
        stopSequences: request.options?.stopSequences,
        responseFormat:
          request.options?.responseFormat === 'json_object'
            ? { type: 'json' }
            : { type: 'text' },
      },
    }
  }

  private toLegacy(response: AiResponse): LegacyAiResponse {
    return {
      id: response.id,
      content: response.content,
      usage: {
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
      },
      model: response.model,
      provider: response.provider,
      createdAt: Date.now(),
      // The legacy type expects finishReason?: string
      finishReason: response.finishReason,
    } as unknown as LegacyAiResponse
  }
}

/** Legacy singleton — routes through the canonical aiRouter. */
export const aiService = new LegacyAiServiceAdapter()
