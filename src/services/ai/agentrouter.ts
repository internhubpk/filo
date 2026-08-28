// =============================================================================
// FILO AI — Agent Router Provider (CANONICAL PRIMARY)
// =============================================================================
// Implements the AiProvider contract against the AgentRouter.org gateway — a
// non-profit, OpenAI-compatible multi-model router serving:
//
//   deepseek-v4-flash · glm-5.3 · gpt-5.6-sol · claude-opus-4-8 · claude-opus-5
//
// Wire protocol (STANDARD OpenAI Chat Completions — verified live against
// the gateway): the OpenAI-compatible base URL is https://co.agentrouter.org/v1
//
//   POST https://co.agentrouter.org/v1/chat/completions
//   Authorization: Bearer <key>
//   Content-Type: application/json
//   { model, messages, stream: false, temperature, max_tokens, ... }
//
//   ⚠ The bare `agentrouter.org` www/docs host serves the marketing site
//   behind an Aliyun-WAF anti-bot page (HTTP 200 HTML). Only the `co.`
//   API host speaks REST — pointing this adapter anywhere else produces
//   WAF interstitials that look like success but are garbage to JSON parse.
//
//   ⚠ Historically this adapter pointed at a z.ai-internal gateway host
//   (plus a custom Z-identity header and a `thinking` body param) that never
//   resolved on the public internet, so every call died with undici
//   "fetch failed" (NETWORK_ERROR) before reaching any gateway. The z.ai
//   SDK quirks are gone for good: plain OpenAI wire format against the
//   official gateway only.
//
// Env vars (read at call time, Convex-runtime owned — never NEXT_PUBLIC_*):
//   AGENT_ROUTER_API_KEY    (required — sk-… key from agentrouter.org console)
//   AGENT_ROUTER_BASE_URL   (optional — default https://co.agentrouter.org/v1)
//
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
import { normalizeOpenAiCompatibleBaseUrl } from './provider'
import {
  AiBaseError,
  ApiKeyMissingError,
  errorFromHttpStatus,
  MalformedResponseError,
  normalizeAiError,
} from './errors'

/**
 * Official AgentRouter OpenAI-compatible API base — the `co.` host.
 *
 * VERIFIED LIVE (2026-08-29):
 *   GET  https://co.agentrouter.org/v1/models   → 401 JSON (real API)
 *   POST https://co.agentrouter.org/v1/chat/completions → 401 JSON on bad key
 *   GET  https://agentrouter.org/v1/models      → 200 Aliyun-WAF HTML (NOT API)
 * The bare www/docs host is fronted by an anti-bot page; server-side clients
 * must use the co. API host. Official portal: https://co.agentrouter.org/portal
 * ("Base URL OpenAI compatible: https://co.agentrouter.org/v1").
 * Override AGENT_ROUTER_BASE_URL only when routing through a proxy.
 */
const DEFAULT_BASE_URL = 'https://co.agentrouter.org/v1'

/**
 * Detects an Aliyun-WAF anti-bot interstitial (the gateway's edge protection).
 * When the WAF challenges a server-side datacenter/VPN egress IP, the HTTP
 * layer returns 200/405 HTML instead of JSON — retries CANNOT clear it (the
 * challenge needs an interactive browser), so this must fail fast, not burn
 * the attempt budget.
 */
function looksLikeWafChallenge(body: string): boolean {
  return (
    body.includes('aliyun_waf_aa') ||
    body.includes('aliyun_waf_bb') ||
    (body.includes('Access Verification') && body.includes('slide to')) ||
    body.includes('访问验证')
  )
}

/**
 * Agent Router models, cheapest-first (operator-designated pool).
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

  /** Base URL, normalized (no trailing slash, exactly one /v1 — the
   *  AgentRouter OpenAI-compatible contract REQUIRES the /v1 suffix). */
  get baseUrl(): string {
    return normalizeOpenAiCompatibleBaseUrl(
      process.env.AGENT_ROUTER_BASE_URL || DEFAULT_BASE_URL
    )
  }

  private getBaseUrl(): string {
    return this.baseUrl
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
        },
        signal: controller.signal,
        // Strict OpenAI Chat Completions body — AgentRouter forwards this
        // verbatim to the upstream provider, so z.ai-specific extensions
        // (e.g. `thinking`) must NOT be sent here.
        body: JSON.stringify({
          model,
          messages: request.messages,
          stream: false,
          temperature: opts?.temperature ?? 0.7,
          max_tokens: opts?.maxTokens,
          top_p: opts?.topP,
          frequency_penalty: opts?.frequencyPenalty,
          presence_penalty: opts?.presencePenalty,
          stop: opts?.stopSequences,
        }),
      })

      // WAF interstitials can arrive with any status (200/403/405). Read the
      // body BEFORE interpreting the status so the challenge is detected
      // even when the edge labels it 200 OK.
      const rawBody = await response.text().catch(() => '')
      if (looksLikeWafChallenge(rawBody)) {
        throw new AiBaseError(
          `${this.id} gateway (${new URL(this.getBaseUrl()).host}) is protected by an anti-bot verification that this network cannot pass. ` +
            `The API is unreachable from this egress IP — check AGENT_ROUTER_BASE_URL / network egress, or route through a proxy.`,
          'CONFIGURATION_ERROR',
          'AGENT_ROUTER',
          false,
          response.status
        )
      }

      if (!response.ok) {
        throw errorFromHttpStatus('AGENT_ROUTER', response.status, rawBody)
      }

      let data: AgentRouterChatResponse
      try {
        data = JSON.parse(rawBody) as AgentRouterChatResponse
      } catch {
        throw new MalformedResponseError(
          'AGENT_ROUTER',
          `non-JSON body (HTTP ${response.status}): ${rawBody.slice(0, 120)}`
        )
      }
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
