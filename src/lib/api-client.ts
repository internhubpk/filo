// =============================================================================
// FILO API Client - Proxy-based Backend Communication
// =============================================================================
// All frontend calls go through Next.js API routes (not direct Convex)
// This avoids circular dependency issues and provides better error handling
// =============================================================================

import { ErrorCode } from './error-handler'

// ==================== TYPES ====================

interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  code?: string
}

interface User {
  id: string
  name: string
  email: string
  image?: string
  planId?: string
}

interface AuthResponse extends ApiResponse<{
  user: User
  sessionToken: string
}> {}

interface Artifact {
  id: string
  title: string
  type: string
  format: string
  status: string
  prompt?: string
  createdAt: string | Date
}

interface Plan {
  id: string
  name: string
  priceMonthly: number
  priceYearly: number
  maxAiGenerations: number
  features: string[]
}

// ==================== API CLIENT CLASS ====================

class ApiClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_APP_URL || '/api'
  }

  // ==================== HELPER METHODS ====================

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${endpoint}`
      
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeader(),
          ...options.headers,
        },
        ...options,
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.error || `HTTP ${response.status}`,
          code: data.code || 'HTTP_ERROR',
        }
      }

      return data as ApiResponse<T>
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
        code: 'NETWORK_ERROR',
      }
    }
  }

  private getAuthHeader(): Record<string, string> {
    if (typeof window === 'undefined') return {}

    try {
      const sessionData = localStorage.getItem('filo_session')
      if (sessionData) {
        const session = JSON.parse(sessionData)
        if (session?.token) {
          return { 'Authorization': `Bearer ${session.token}` }
        }
      }
    } catch (e) {
      // Ignore parse errors
    }

    return {}
  }

  // ==================== AUTH ENDPOINTS ====================

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<AuthResponse> {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  /**
   * Create new account
   */
  async signup(name: string, email: string, password: string): Promise<AuthResponse> {
    return this.request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    })
  }

  /**
   * Logout current user
   */
  async logout(): Promise<ApiResponse> {
    return this.request('/auth/logout', {
      method: 'POST',
    })
  }

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<ApiResponse<User>> {
    return this.request('/auth/me')
  }

  /**
   * Validate existing session token
   */
  async validateSession(token: string): Promise<ApiResponse<User>> {
    return this.request('/auth/validate', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  }

  // ==================== ARTIFACT ENDPOINTS ====================

  /**
   * Generate a new artifact using AI
   */
  async generateArtifact(data: {
    prompt: string
    artifactType?: string
    outputFormat?: string
    workspaceId?: string
  }): Promise<ApiResponse<Artifact>> {
    return this.request('/artifacts/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /**
   * List user's artifacts
   */
  async listArtifacts(params?: {
    search?: string
    type?: string
    limit?: number
    offset?: number
  }): Promise<ApiResponse<{ artifacts: Artifact[]; total: number }>> {
    const query = params 
      ? '?' + new URLSearchParams(params as any).toString()
      : ''
    
    return this.request(`/artifacts${query}`)
  }

  /**
   * Get single artifact by ID
   */
  async getArtifact(id: string): Promise<ApiResponse<Artifact>> {
    return this.request(`/artifacts/${id}`)
  }

  /**
   * Delete an artifact
   */
  async deleteArtifact(id: string): Promise<ApiResponse> {
    return this.request(`/artifacts/${id}`, {
      method: 'DELETE',
    })
  }

  // ==================== PLAN ENDPOINTS ====================

  /**
   * Get available subscription plans
   */
  async getPlans(): Promise<ApiResponse<Plan[]>> {
    return this.request('/plans')
  }

  /**
   * Get current user's subscription status
   */
  async getSubscriptionStatus(): Promise<ApiResponse<{
    hasActiveSubscription: boolean
    remainingGenerations: number
    planLimit: number
    planName: string
  }>> {
    return this.request('/subscription/status')
  }

  // ==================== USER ENDPOINTS ====================

  /**
   * Update user profile
   */
  async updateProfile(data: {
    name?: string
    image?: string
  }): Promise<ApiResponse<User>> {
    return this.request('/user/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  /**
   * Change password
   */
  async changePassword(data: {
    currentPassword: string
    newPassword: string
  }): Promise<ApiResponse> {
    return this.request('/user/password', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  // ==================== FILE ENDPOINTS ====================

  /**
   * Upload file
   */
  async uploadFile(file: File): Promise<ApiResponse<{
    id: string
    url: string
    name: string
  }>> {
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(`${this.baseUrl}/files`, {
        method: 'POST',
        headers: {
          ...this.getAuthHeader(),
        },
        body: formData,
      })

      const data = await response.json()
      return data as ApiResponse
    } catch (error) {
      return {
        success: false,
        error: 'Upload failed',
        code: 'UPLOAD_ERROR',
      }
    }
  }

  /**
   * List user's files
   */
  async listFiles(): Promise<ApiResponse<any[]>> {
    return this.request('/files')
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Check if user is authenticated (client-side check)
   */
  isAuthenticated(): boolean {
    if (typeof window === 'undefined') return false
    
    try {
      const sessionData = localStorage.getItem('filo_session')
      if (!sessionData) return false
      
      const session = JSON.parse(sessionData)
      return !!(session?.user && session?.token)
    } catch {
      return false
    }
  }

  /**
   * Get stored user data from session
   */
  getStoredUser(): User | null {
    if (typeof window === 'undefined') return null
    
    try {
      const sessionData = localStorage.getItem('filo_session')
      if (!sessionData) return null
      
      const session = JSON.parse(sessionData)
      return session?.user || null
    } catch {
      return null
    }
  }

  /**
   * Store auth session in localStorage
   */
  storeSession(user: User, token: string): void {
    if (typeof window === 'undefined') return
    
    const session = { user, token, createdAt: new Date().toISOString() }
    localStorage.setItem('filo_session', JSON.stringify(session))
    
    // Dispatch custom event for other components
    window.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user, isAuthenticated: true } }))
  }

  /**
   * Clear stored session
   */
  clearSession(): void {
    if (typeof window === 'undefined') return
    
    localStorage.removeItem('filo_session')
    window.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user: null, isAuthenticated: false } }))
  }
}

// ==================== EXPORTS ====================

// Singleton instance
export const apiClient = new ApiClient()

// Export types for use in components
export type {
  ApiResponse,
  User,
  Artifact,
  Plan,
  AuthResponse,
}

// Export class for custom instances if needed
export { ApiClient }
