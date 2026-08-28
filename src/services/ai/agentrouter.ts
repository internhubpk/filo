// =============================================================================
// FILO AI — Agent Router Provider (CANONICAL PRIMARY)
// =============================================================================
// Implements the AiProvider contract against the Agent Router gateway — an
// OpenAI-compatible multi-model router serving:
//
//   deepseek-v4-flash · glm-5.3 · gpt-5.6-sol · claude-opus-4-8 · claude-opus-5
//
// Wire protocol (mirrors z-ai-web-dev-sdk, which cannot run on Convex because
// it loads a config FILE from disk — Convex actions have no such filesystem):
//
//   POST {AGENT_ROUTER_BASE_URL}/chat/completions
//   Authorization: Bearer <key>
//   X-Z-AI-From: Z
//   { model, messages, stream: false, thinking: { type: 'disabled' }, ... }
//
// Env vars (read at call time, Convex-runtime owned — never NEXT_PUBLIC_*):
//   AGENT_ROUTER_API_KEY    (required)
//   AGENT_ROUTER_BASE_URL   (optional — default https://internal-api.z.ai/v1)
//
// All five model ids verified LIVE against the gateway (2026-08-28):
// 200 OK, OpenAI-style usage {prompt_tokens, completion_tokens, total_tokens}.
// Model selection is COST-OPTIMIZED FOR THE OPERATOR (spec: "select for
// budget to me, not the users"): cheap flash-tier models carry mechanical
// volume; premium models are reached only as quality escalation.
// =============================================================================

import type {
  AiRequest,
  AiResponse,
  ProviderHealth,
} from './types'
import type { AiProvider } from './provider'
import {
  ApiKeyMissingError,
  errorFromHttpStatus,
  MalformedResponseError,
  normalizeAiError,
} from './errors'

const DEFAULT_BASE_URL = 'https://internal-api.z.ai/v1'

/**
 * Agent Router models, cheapest-first. Verified live 2026-08-28.
 * Cost tiers (operator budget optimization):
 *   deepseek-v4-flash  — cheapest, fast: mechanical volume (fast/json/first generation try)
 *   glm-5.3            — mid: longform + reasoning lead
 *   gpt-5.6-sol        — premium: quality escalation
 *   claude-opus-4-8    — premium: reasoning escalation
 *   claude-opus-5      — most capable / most expensive: LAST resort only
 */
export const AGENT_ROUTER_MODELS = [
  'deepseek-v4-flash',
  'glm-5.3',
  'gpt-5.6-sol',
  'claude-opus-4-8',
  'claude-opus-5',
] as const

interface AgentRouterChatResponse {
  id?: string
  choices?: Array<{
    message?: { content?: string }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export class AgentRouterModule implements AiProvider {
  readonly id = 'AGENT_ROUTER' as const
  readonly displayName = 'Agent Router'
  readonly defaultModel = 'deepseek-v4-flash'
  readonly availableModels: readonly string[] = AGENT_ROUTER_MODELS

  private getApiKey(): string {
    const key = process.env.AGENT_ROUTER_API_KEY || ''
    if (!key) {
      throw new ApiKeyMissingError('AGENT_ROUTER', 'AGENT_ROUTER_API_KEY')
    }
    return key
  }

  private getBaseUrl(): string {
    return (process.env.AGENT_ROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  }

  isConfigured(): boolean {
    return Boolean(process.env.AGENT_ROUTER_API_KEY)
  }

  async generate(request: AiRequest): Promise<AiResponse> {
    const apiKey = this.getApiKey()
    const model = request.options?.model || this.defaultModel
    const timeoutMs = request.options?.timeoutMs ?? 90_000
    const startedAt = Date.now()

    const opts = request.options
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Z-AI-From': 'Z',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: request.messages,
          stream: false,
          thinking: { type: 'disabled' },
          temperature: opts?.temperature ?? 0.7,
          max_tokens: opts?.maxTokens,
          top_p: opts?.topP,
          frequency_penalty: opts?.frequencyPenalty,
          presence_penalty: opts?.presencePenalty,
          stop: opts?.stopSequences,
        }),
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw errorFromHttpStatus('AGENT_ROUTER', response.status, errText)
      }

      const data = (await response.json()) as AgentRouterChatResponse
      const choice = data.choices?.[0]
      if (!choice) {
        throw new MalformedResponseError('AGENT_ROUTER', 'no choices in response')
      }

      return {
        id: data.id || `ar_${startedAt}`,
        content: choice.message?.content || '',
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
        provider: 'AGENT_ROUTER',
        model,
        durationMs: Date.now() - startedAt,
        finishReason: choice.finish_reason,
      }
    } catch (err) {
      throw normalizeAiError('AGENT_ROUTER', err)
    } finally {
      clearTimeout(timer)
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.isConfigured()) {
      return { provider: 'AGENT_ROUTER', configured: false, error: 'AGENT_ROUTER_API_KEY not set' }
    }
    const startedAt = Date.now()
    try {
      await this.generate({
        messages: [{ role: 'user', content: 'ping' }],
        options: { maxTokens: 8, timeoutMs: 15_000 },
      })
      return { provider: 'AGENT_ROUTER', configured: true, latencyMs: Date.now() - startedAt }
    } catch (err) {
      return {
        provider: 'AGENT_ROUTER',
        configured: true,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Diagnostics-only probe (AI-repair spec §3): ONE minimal chat call from
   * the same runtime generation runs in. Records HTTP status, latency, model
   * and error code — never the API key. Never used on the generate path.
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
      const aiErr = normalizeAiError('AGENT_ROUTER', err)
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
