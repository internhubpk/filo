// =============================================================================
// FILO Toast Notifications - Clean, Minimal, No Buttons
// =============================================================================
// Just beautiful notifications that auto-dismiss. No shitty buttons.
// =============================================================================

import { toast as sonnerToast } from 'sonner'

// ==================== CLEAN ICONS ====================

const Icons = {
  success: (
    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  
  error: (
    <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  
  warning: (
    <svg className="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  
  info: (
    <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  
  loading: (
    <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
  ),

  user: (
    <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),

  artifact: (
    <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>
  ),

  logout: (
    <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
}

// ==================== CLEAN TOAST API ====================

export const toast = {
  success(message: string, description?: string) {
    return sonnerToast.success(message, {
      description,
      icon: Icons.success,
      duration: 3000,
    })
  },

  error(message: string, description?: string) {
    return sonnerToast.error(message, {
      description,
      icon: Icons.error,
      duration: 4000,
    })
  },

  warning(message: string, description?: string) {
    return sonnerToast.warning(message, {
      description,
      icon: Icons.warning,
      duration: 4000,
    })
  },

  info(message: string, description?: string) {
    return sonnerToast.info(message, {
      description,
      icon: Icons.info,
      duration: 3000,
    })
  },

  loading(message: string) {
    return sonnerToast.loading(message, {
      icon: Icons.loading,
    })
  },

  dismiss(id?: string | number) {
    return sonnerToast.dismiss(id)
  },

  // ==================== SPECIFIC TOASTS (NO BUTTONS) ====================

  signupSuccess(name: string) {
    return this.success(`Welcome, ${name}!`, 'Account created successfully')
  },

  signupError(error?: string) {
    return this.error('Signup failed', error || 'Could not create account')
  },

  loginSuccess(name: string) {
    return this.success(`Welcome back, ${name}!`, 'Logged in successfully')
  },

  loginError(error?: string) {
    return this.error('Login failed', error || 'Invalid credentials')
  },

  logoutSuccess() {
    return this.success('Logged out', 'See you next time!')
  },

  generationStarted(prompt: string) {
    const title = prompt.length > 40 ? prompt.substring(0, 40) + '...' : prompt
    return this.loading(`Creating "${title}"...`)
  },

  generationSuccess(title: string) {
    return this.success('Artifact ready!', `"${title}" generated`)
  },

  generationError(error?: string) {
    return this.error('Generation failed', error || 'Please try again')
  },

  downloadComplete(filename: string) {
    return this.success('Downloaded', filename)
  },

  subscriptionRequired() {
    return this.warning('Pro required', 'Upgrade for unlimited generations')
  },

  sessionExpired() {
    return this.error('Session expired', 'Please login again')
  },
}

export default toast
