// =============================================================================
// FILO AI Provider Abstraction Layer
// =============================================================================
// ARCHITECTURE: All AI requests go through Convex server-side functions
//
// IMPORTANT:
// - This service is SERVER-SIDE ONLY (never call from browser)
// - API keys come from Convex environment / process.env (not NEXT_PUBLIC_*)
// - OpenRouter = Beta provider | OpenAI = Future provider
// - Provider switching requires no code changes, just config
// =============================================================================

import type {
  AiProviderInterface,
  AiGenerateRequest,
  AiResponse,
  AiStreamChunk,
  ModelDefinition,
  AiProvider,
  AiMessage,
} from '@/types'
import { getModelById, OPENROUTER_MODELS, OPENAI_MODELS, AI_CONFIG } from '@/config/ai'

// Server-side AI configuration (keys from Convex env / process.env)
const AI_SECRETS = {
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  },
}

// ==================== ERROR TYPES ====================

export class AiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider: AiProvider,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message)
    this.name = 'AiError'
  }
}

// ==================== OPENROUTER PROVIDER ====================

class OpenRouterProvider implements AiProviderInterface {
  readonly providerName: AiProvider = 'OPENROUTER'
  readonly defaultModel: string = 'openai/gpt-4o-mini'
  readonly availableModels: ModelDefinition[] = OPENROUTER_MODELS

  private getApiKey(): string {
    const key = AI_SECRETS.openrouter.apiKey
    if (!key) {
      throw new AiError(
        'OpenRouter API key not configured. Set OPENROUTER_API_KEY in Convex environment.',
        'API_KEY_MISSING',
        'OPENROUTER',
        undefined,
        false
      )
    }
    return key
  }

  private getBaseUrl(): string {
    return AI_SECRETS.openrouter.baseUrl
  }

  async generate(request: AiGenerateRequest): Promise<AiResponse> {
    const startTime = Date.now()
    
    try {
      const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getApiKey()}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'X-Title': 'Filo',
        },
        body: JSON.stringify({
          model: request.options?.model || this.defaultModel,
          messages: this.formatMessages(request.messages),
          temperature: request.options?.temperature ?? 0.7,
          max_tokens: request.options?.maxTokens,
          top_p: request.options?.topP,
          frequency_penalty: request.options?.frequencyPenalty,
          presence_penalty: request.options?.presencePenalty,
          stop: request.options?.stopSequences,
          response_format: request.options?.responseFormat === 'json_object' 
            ? { type: 'json_object' } 
            : undefined,
          tools: request.options?.tools,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw this.handleError(response.status, errorBody)
      }

      const data = await response.json()
      const choice = data.choices[0]
      
      return {
        id: data.id,
        content: choice.message.content || '',
        toolCalls: choice.message.tool_calls,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        model: data.model,
        provider: this.providerName,
        latencyMs: Date.now() - startTime,
        finishReason: choice.finish_reason,
      }
    } catch (error) {
      if (error instanceof AiError) throw error
      throw new AiError(
        error instanceof Error ? error.message : 'Unknown OpenRouter error',
        'PROVIDER_ERROR',
        this.providerName,
        undefined,
        true
      )
    }
  }

  async *generateStream(request: AiGenerateRequest): AsyncGenerator<AiStreamChunk> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getApiKey()}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'X-Title': 'Filo',
        },
        body: JSON.stringify({
          model: request.options?.model || this.defaultModel,
          messages: this.formatMessages(request.messages),
          temperature: request.options?.temperature ?? 0.7,
          max_tokens: request.options?.maxTokens,
          stream: true,
          response_format: request.options?.responseFormat === 'json_object' 
            ? { type: 'json_object' } 
            : undefined,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        yield { type: 'error', error: this.handleError(response.status, errorBody).message }
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        yield { type: 'error', error: 'No response body' }
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed === '' || trimmed === 'data: [DONE]') {
            if (trimmed === 'data: [DONE]') {
              yield { type: 'done' }
            }
            continue
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6))
              const content = data.choices[0]?.delta?.content
              if (content) {
                yield { type: 'content', content }
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Stream error',
      }
    }
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/models`, {
        headers: {
          'Authorization': `Bearer ${this.getApiKey()}`,
        },
      })
      return response.ok
    } catch {
      return false
    }
  }

  private formatMessages(messages: AiMessage[]): object[] {
    return messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : msg.content,
      name: msg.name,
      tool_calls: msg.toolCalls,
      tool_call_id: msg.toolCallId,
    }))
  }

  private handleError(statusCode: number, body: string): AiError {
    let code = 'UNKNOWN_ERROR'
    let message = 'OpenRouter API error'
    let retryable = false

    if (statusCode === 401) {
      code = 'AUTHENTICATION_ERROR'
      message = 'Invalid API key'
      retryable = false
    } else if (statusCode === 429) {
      code = 'RATE_LIMIT_ERROR'
      message = 'Rate limit exceeded'
      retryable = true
    } else if (statusCode >= 500) {
      code = 'SERVER_ERROR'
      message = 'OpenRouter server error'
      retryable = true
    } else if (statusCode === 400) {
      code = 'BAD_REQUEST'
      message = 'Invalid request'
      retryable = false
    }

    try {
      const errorData = JSON.parse(body)
      message = errorData.error?.message || message
      code = errorData.error?.code || code
    } catch {
      // Use defaults
    }

    return new AiError(message, code, this.providerName, statusCode, retryable)
  }
}

// ==================== OPENAI PROVIDER ====================

class OpenAiProvider implements AiProviderInterface {
  readonly providerName: AiProvider = 'OPENAI'
  readonly defaultModel: string = 'gpt-4o-mini'
  readonly availableModels: ModelDefinition[] = OPENAI_MODELS

  private getApiKey(): string {
    const key = AI_SECRETS.openai.apiKey
    if (!key) {
      throw new AiError(
        'OpenAI API key not configured. Set OPENAI_API_KEY in Convex environment.',
        'API_KEY_MISSING',
        'OPENAI',
        undefined,
        false
      )
    }
    return key
  }

  private getBaseUrl(): string {
    return AI_SECRETS.openai.baseUrl
  }

  async generate(request: AiGenerateRequest): Promise<AiResponse> {
    const startTime = Date.now()
    
    try {
      const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getApiKey()}`,
        },
        body: JSON.stringify({
          model: request.options?.model || this.defaultModel,
          messages: this.formatMessages(request.messages),
          temperature: request.options?.temperature ?? 0.7,
          max_tokens: request.options?.maxTokens,
          top_p: request.options?.topP,
          frequency_penalty: request.options?.frequencyPenalty,
          presence_penalty: request.options?.presencePenalty,
          stop: request.options?.stopSequences,
          response_format: request.options?.responseFormat === 'json_object' 
            ? { type: 'json_object' } 
            : undefined,
          tools: request.options?.tools,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw this.handleError(response.status, errorBody)
      }

      const data = await response.json()
      const choice = data.choices[0]
      
      return {
        id: data.id,
        content: choice.message.content || '',
        toolCalls: choice.message.tool_calls,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        model: data.model,
        provider: this.providerName,
        latencyMs: Date.now() - startTime,
        finishReason: choice.finish_reason,
      }
    } catch (error) {
      if (error instanceof AiError) throw error
      throw new AiError(
        error instanceof Error ? error.message : 'Unknown OpenAI error',
        'PROVIDER_ERROR',
        this.providerName,
        undefined,
        true
      )
    }
  }

  async *generateStream(request: AiGenerateRequest): AsyncGenerator<AiStreamChunk> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getApiKey()}`,
        },
        body: JSON.stringify({
          model: request.options?.model || this.defaultModel,
          messages: this.formatMessages(request.messages),
          temperature: request.options?.temperature ?? 0.7,
          max_tokens: request.options?.maxTokens,
          stream: true,
          response_format: request.options?.responseFormat === 'json_object' 
            ? { type: 'json_object' } 
            : undefined,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        yield { type: 'error', error: this.handleError(response.status, errorBody).message }
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        yield { type: 'error', error: 'No response body' }
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed === '' || trimmed === 'data: [DONE]') {
            if (trimmed === 'data: [DONE]') {
              yield { type: 'done' }
            }
            continue
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6))
              const content = data.choices[0]?.delta?.content
              if (content) {
                yield { type: 'content', content }
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Stream error',
      }
    }
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/models`, {
        headers: {
          'Authorization': `Bearer ${this.getApiKey()}`,
        },
      })
      return response.ok
    } catch {
      return false
    }
  }

  private formatMessages(messages: AiMessage[]): object[] {
    return messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : msg.content,
      name: msg.name,
      tool_calls: msg.toolCalls,
      tool_call_id: msg.toolCallId,
    }))
  }

  private handleError(statusCode: number, body: string): AiError {
    let code = 'UNKNOWN_ERROR'
    let message = 'OpenAI API error'
    let retryable = false

    if (statusCode === 401) {
      code = 'AUTHENTICATION_ERROR'
      message = 'Invalid API key'
      retryable = false
    } else if (statusCode === 429) {
      code = 'RATE_LIMIT_ERROR'
      message = 'Rate limit exceeded. Please retry after a cooldown.'
      retryable = true
    } else if (statusCode >= 500) {
      code = 'SERVER_ERROR'
      message = 'OpenAI server error'
      retryable = true
    } else if (statusCode === 400) {
      code = 'BAD_REQUEST'
      message = 'Invalid request parameters'
      retryable = false
    } else if (statusCode === 403) {
      code = 'FORBIDDEN'
      message = 'Access denied'
      retryable = false
    }

    try {
      const errorData = JSON.parse(body)
      message = errorData.error?.message || message
      code = errorData.error?.code || code
    } catch {
      // Use defaults
    }

    return new AiError(message, code, this.providerName, statusCode, retryable)
  }
}

// ==================== AI SERVICE (PUBLIC INTERFACE) ====================

class AiService {
  private providers: Map<AiProvider, AiProviderInterface>
  private currentProvider: AiProviderInterface

  constructor() {
    this.providers = new Map<AiProvider, AiProviderInterface>([
      ['OPENROUTER', new OpenRouterProvider()],
      ['OPENAI', new OpenAiProvider()],
    ])
    
    // Default to OpenRouter for beta (configurable via AI_CONFIG)
    const defaultProvider = AI_CONFIG.defaultProvider === 'OPENAI' ? 'OPENAI' : 'OPENROUTER'
    this.currentProvider = this.providers.get(defaultProvider) || 
                          this.providers.get('OPENROUTER')!
  }

  /**
   * Generate a completion using the current provider
   */
  async generate(request: AiGenerateRequest): Promise<AiResponse> {
    return this.currentProvider.generate(request)
  }

  /**
   * Generate a streaming completion
   */
  async *generateStream(request: AiGenerateRequest): AsyncGenerator<AiStreamChunk> {
    yield* this.currentProvider.generateStream(request)
  }

  /**
   * Generate with automatic retry on transient failures
   */
  async generateWithRetry(
    request: AiGenerateRequest,
    maxRetries: number = 3
  ): Promise<AiResponse> {
    let lastError: AiError | null = null
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.generate(request)
      } catch (error) {
        if (error instanceof AiError) {
          lastError = error
          
          if (!error.retryable || attempt === maxRetries) {
            throw error
          }
          
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000)
          await new Promise(resolve => setTimeout(resolve, delay))
        } else {
          throw error
        }
      }
    }
    
    throw lastError || new AiError('Max retries exceeded', 'MAX_RETRIES_EXCEEDED', this.currentProvider.providerName)
  }

  /**
   * Switch to a specific provider
   */
  setProvider(provider: AiProvider): void {
    const p = this.providers.get(provider)
    if (!p) {
      throw new AiError(`Provider ${provider} not found`, 'PROVIDER_NOT_FOUND', provider)
    }
    this.currentProvider = p
  }

  /**
   * Get the current provider
   */
  getCurrentProvider(): AiProvider {
    return this.currentProvider.providerName
  }

  /**
   * Get available models for current provider
   */
  getAvailableModels(): ModelDefinition[] {
    return this.currentProvider.availableModels
  }

  /**
   * Validate connection to current provider
   */
  async validateConnection(): Promise<boolean> {
    return this.currentProvider.validateConnection()
  }

  /**
   * Get a specific model definition
   */
  getModel(modelId?: string): ModelDefinition | undefined {
    if (!modelId) return undefined
    return getModelById(modelId)
  }
}

// Export singleton instance
export const aiService = new AiService()

// Export individual providers for testing
export { OpenRouterProvider, OpenAiProvider }
