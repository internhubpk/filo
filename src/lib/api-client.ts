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
  // Payments removed: signups are "active" instantly. "suspended" is
  // admin moderation and revokes AI generation access.
  status?: 'pending_activation' | 'active' | 'suspended'
}

// Note: AuthResponse mirrors ApiResponse<{ user; sessionToken }> with no
// additional fields. We declare it as a named type alias instead of an empty
// interface to satisfy the @typescript-eslint/no-empty-object-type rule.
type AuthResponse = ApiResponse<{
  user: User
  sessionToken: string
}>

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
    // Use relative URL for same-origin requests (works in browser and on Vercel)
    // This ensures all calls go to /api/* routes
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    
    if (appUrl && typeof window !== 'undefined') {
      // In browser: use relative path to avoid CORS and ensure correct routing
      this.baseUrl = '/api'
    } else if (appUrl) {
      // Server-side: use full URL with /api prefix
      this.baseUrl = `${appUrl.replace(/\/$/, '')}/api`
    } else {
      // Default: just /api for relative requests
      this.baseUrl = '/api'
    }
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
   * Generate a new artifact using AI (legacy endpoint)
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
   * Generate a real downloadable document using Agent Router
   * Returns file data (base64) along with artifact metadata
   */
  async agentGenerate(data: {
    prompt: string
    artifactType?: string
    outputFormat?: string
    workspaceId?: string
    brandConfig?: {
      companyName?: string
      logoUrl?: string
      footerText?: string
      colors?: { primary?: string; secondary?: string; accent?: string }
      fonts?: { heading?: string; body?: string }
    }
    files?: Array<{ filename: string; content: string; mimeType: string }>
  }): Promise<ApiResponse<{
    artifact: {
      id: string
      title: string
      type: string
      format: string
      content: string
      fileData?: string
      fileSize?: number
      fileName?: string
      mimeType?: string
    }
    tokensUsed?: number
    generationTimeMs?: number
    stages?: Array<{
      id: string
      label: string
      status: 'pending' | 'active' | 'completed' | 'error'
      detail?: string
    }>
  }>> {
    return this.request('/artifacts/agent-generate', {
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
   * Get current user's account status and generation quota.
   * Reports hasActiveSubscription = !suspended (legacy field name kept),
   * plus the plan's monthly generation limit and remaining quota.
   */
  async getSubscriptionStatus(): Promise<ApiResponse<{
    hasActiveSubscription: boolean
    accountStatus: 'pending_activation' | 'active' | 'suspended'
    remainingGenerations: number
    usedGenerations?: number
    planLimit: number
    planName: string
    planStorageMb?: number
  }>> {
    return this.request('/subscription/status')
  }

  // ==================== USER ENDPOINTS ====================

  /**
   * Update user profile (PATCH /api/user/profile — real Convex mutation)
   */
  async updateProfile(data: {
    name?: string
    image?: string
  }): Promise<ApiResponse<User>> {
    return this.request('/user/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  /**
   * Change password (POST /api/user/password — verifies current password
   * inside Convex before writing the new hash)
   */
  async changePassword(data: {
    currentPassword: string
    newPassword: string
  }): Promise<ApiResponse> {
    return this.request('/user/password', {
      method: 'POST',
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

  // ==================== BILLING ENDPOINTS ====================

  /**
   * Full billing overview: subscription + plan + payment history + usage.
   * GET /api/billing/subscription (all values from Convex).
   */
  async getBillingOverview(): Promise<ApiResponse<Record<string, any>>> {
    return this.request('/billing/subscription')
  }

  /**
   * Start a Safepay checkout for a plan. Returns the hosted payment URL —
   * redirect the browser to it. The subscription activates ONLY after the
   * verified Safepay webhook lands.
   */
  async startCheckout(params: {
    planId?: string
    planTier?: string
    interval: 'monthly' | 'yearly'
  }): Promise<ApiResponse<{
    checkoutUrl: string
    paymentToken: string
    subscriptionId: string
    amount: number
    currency: string
    plan: { id: string; name: string; tier?: string }
  }>> {
    return this.request('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  /**
   * Cancel (or revert cancellation of) the active subscription at period end.
   */
  async cancelSubscription(cancel = true): Promise<ApiResponse<{ message: string; cancelAtPeriodEnd: boolean }>> {
    return this.request('/billing/cancel', {
      method: 'POST',
      body: JSON.stringify({ cancel }),
    })
  }

  // ==================== ADMIN DATA ENDPOINTS ====================

  async adminStats(): Promise<ApiResponse<Record<string, any>>> {
    return this.request('/admin/stats')
  }

  async adminAnalytics(days = 30): Promise<ApiResponse<Record<string, any>>> {
    return this.request(`/admin/analytics?days=${days}`)
  }

  async adminSubscriptions(status?: string): Promise<ApiResponse<any[]>> {
    return this.request(`/admin/subscriptions${status ? `?status=${status}` : ''}`)
  }

  async adminPayments(status?: string): Promise<ApiResponse<any[]>> {
    return this.request(`/admin/payments${status ? `?status=${status}` : ''}`)
  }

  async adminWebhookEvents(status?: string): Promise<ApiResponse<any[]>> {
    return this.request(`/admin/webhooks${status ? `?status=${status}` : ''}`)
  }

  async adminAuditLogs(action?: string): Promise<ApiResponse<any[]>> {
    return this.request(`/admin/audit${action ? `?action=${action}` : ''}`)
  }

  async adminPlans(): Promise<ApiResponse<any[]>> {
    return this.request('/admin/plans')
  }

  async adminCreatePlan(plan: Record<string, unknown>): Promise<ApiResponse<{ planId: string }>> {
    return this.request('/admin/plans', { method: 'POST', body: JSON.stringify(plan) })
  }

  async adminUpdatePlan(planId: string, updates: Record<string, unknown>): Promise<ApiResponse> {
    return this.request('/admin/plans', {
      method: 'PATCH',
      body: JSON.stringify({ planId, ...updates }),
    })
  }

  // ==================== ADMIN ENDPOINTS ====================

  /**
   * Admin: list users with plan/subscription/storage/usage stats joined in
   * Convex. Verified against the LIVE isAdmin flag on both runtimes.
   */
  async adminListUsers(): Promise<ApiResponse<Array<{
    _id: string
    name: string
    email: string
    status: 'pending_activation' | 'active' | 'suspended'
    isAdmin: boolean
    createdAt: number
    planName: string
    planTier: string
    subscriptionStatus: string | null
    storageBytes: number
    artifactCount: number
  }>>> {
    return this.request('/admin/users')
  }

  /**
   * Admin: grant or revoke a user's admin role.
   */
  async adminSetRole(userId: string, isAdmin: boolean): Promise<ApiResponse> {
    return this.request('/admin/users', {
      method: 'PATCH',
      body: JSON.stringify({ userId, isAdmin }),
    })
  }

  /**
   * Admin: activate a user account (e.g. re-activating a suspended or
   * legacy pending account). After this call, the user can generate.
   */
  async adminActivateUser(userId: string, opts?: { planId?: string; note?: string }): Promise<ApiResponse<{
    userId: string
    status: 'active'
    activatedAt: number
  }>> {
    return this.request(`/admin/users/${userId}/activate`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    })
  }

  /**
   * Admin: suspend a user account (revokes AI generation access).
   */
  async adminSuspendUser(userId: string, note?: string): Promise<ApiResponse<{
    userId: string
    status: 'suspended'
  }>> {
    return this.request(`/admin/users/${userId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    })
  }

  // ==================== UTILITY METHODS ===================

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
