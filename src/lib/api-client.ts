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
  // Manual activation flow: new signups are "pending_activation",
  // admin flips to "active" after verifying payment, "suspended"
  // revokes access.
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
   * Get current user's subscription status (manual activation model).
   * Returns hasActiveSubscription based on the user's status field:
   *   - status === "active"             -> hasActiveSubscription = true
   *   - status === "pending_activation" -> hasActiveSubscription = false
   *   - status === "suspended"          -> hasActiveSubscription = false
   */
  async getSubscriptionStatus(): Promise<ApiResponse<{
    hasActiveSubscription: boolean
    accountStatus: 'pending_activation' | 'active' | 'suspended'
    remainingGenerations: number
    planLimit: number
    planName: string
    latestVerification?: {
      id: string
      status: 'pending' | 'approved' | 'rejected'
      amount: number
      currency: string
      paymentMethod: string
      transactionId: string
      adminNote: string | null
      createdAt: number
      reviewedAt: number | null
    } | null
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

  // ==================== PAYMENT ENDPOINTS (MANUAL VERIFICATION) ====================

  /**
   * Submit a manual payment for admin review.
   * Replaces the old SafePay createCheckout call. The user pays externally
   * (bank transfer, EasyPaisa, JazzCash, etc.) and submits the transaction
   * details here. An admin reviews the submission and either approves
   * (which activates the user account) or rejects (with a reason).
   */
  async submitPayment(data: {
    planId?: string
    isYearly?: boolean
    amount?: number
    paymentMethod: 'bank_transfer' | 'easypaisa' | 'jazzcash' | 'other'
    transactionId: string
    proofUrl?: string
    notes?: string
  }): Promise<ApiResponse<{
    verificationId: string
    status: 'pending'
    amount: number
    currency: string
    planName: string
    isYearly: boolean
    message: string
  }>> {
    return this.request('/payments/submit', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /**
   * Get the user's latest payment verification status. Used by the billing
   * page to show "pending review" / "approved" / "rejected: <reason>".
   */
  async getPaymentStatus(): Promise<ApiResponse<{
    paymentStatus: 'none' | 'pending' | 'approved' | 'rejected'
    subscriptionActivated: boolean
    verificationId?: string
    amount?: number
    currency?: string
    paymentMethod?: string
    transactionId?: string
    adminNote?: string | null
    createdAt?: number
    reviewedAt?: number | null
    message?: string
  }>> {
    return this.request('/payments/verify', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  /**
   * Legacy alias kept for backward compatibility with older client code that
   * called `createCheckout`. Internally delegates to submitPayment.
   */
  async createCheckout(data: {
    planId: string
    isYearly?: boolean
    userEmail?: string
    userName?: string
    paymentMethod?: 'bank_transfer' | 'easypaisa' | 'jazzcash' | 'other'
    transactionId?: string
    amount?: number
    notes?: string
    proofUrl?: string
  }): Promise<ApiResponse<{
    verificationId: string
    status: 'pending'
    amount: number
    currency: string
    planName: string
    isYearly: boolean
    message: string
  }>> {
    if (!data.paymentMethod || !data.transactionId) {
      return {
        success: false,
        error: 'paymentMethod and transactionId are required for manual payment submission',
        code: 'MISSING_PARAMS',
      }
    }
    return this.submitPayment({
      planId: data.planId,
      isYearly: data.isYearly,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      transactionId: data.transactionId,
      proofUrl: data.proofUrl,
      notes: data.notes,
    })
  }

  /**
   * Verify a payment after redirect (legacy alias).
   * In the new manual flow this just returns the latest verification status.
   */
  async verifyPayment(data: {
    reference?: string
    paymentId?: string
  } = {}): Promise<ApiResponse<{
    paymentStatus: string
    subscriptionActivated: boolean
    verificationId?: string
    amount?: number
    currency?: string
    paymentMethod?: string
    transactionId?: string
    adminNote?: string | null
    message?: string
  }>> {
    return this.request('/payments/verify', {
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

  // ==================== ADMIN ENDPOINTS ====================

  /**
   * Admin: list all users (split by status: pending / active / suspended).
   * Requires admin session cookie (set by /api/auth/admin/login).
   */
  async adminListUsers(): Promise<ApiResponse<{
    all: Array<{
      id: string
      name: string
      email: string
      status: 'pending_activation' | 'active' | 'suspended'
      planId: string | null
      activatedAt: number | null
      activationNote: string | null
      createdAt: number
      updatedAt: number
    }>
    pending: Array<any>
    active: Array<any>
    counts: { total: number; pending: number; active: number; suspended: number }
  }>> {
    return this.request('/admin/users')
  }

  /**
   * Admin: activate a user account (verifies their payment manually).
   * After this call, the user can perform AI generation.
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

  /**
   * Admin: list payment verifications. status='pending' (default) or 'all'.
   */
  async adminListVerifications(status: 'pending' | 'all' = 'pending'): Promise<ApiResponse<Array<{
    _id: string
    userId: string
    planId?: string
    amount: number
    currency: string
    paymentMethod: string
    transactionId: string
    proofUrl?: string
    notes?: string
    status: 'pending' | 'approved' | 'rejected'
    reviewedBy?: string
    reviewedAt?: number
    adminNote?: string
    createdAt: number
    updatedAt: number
  }>>> {
    return this.request(`/admin/verifications?status=${status}`)
  }

  /**
   * Admin: approve a payment verification. This activates the user.
   */
  async adminApproveVerification(verificationId: string, adminNote?: string): Promise<ApiResponse<{
    verificationId: string
    userId: string
    activated: true
  }>> {
    return this.request(`/admin/verifications/${verificationId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ adminNote }),
    })
  }

  /**
   * Admin: reject a payment verification with a reason shown to the user.
   */
  async adminRejectVerification(verificationId: string, adminNote: string): Promise<ApiResponse<{
    verificationId: string
    userId: string
    activated: false
  }>> {
    return this.request(`/admin/verifications/${verificationId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ adminNote }),
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
