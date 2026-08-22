// =============================================================================
// FILO Toast Notifications - Beautiful Animated Toast System
// =============================================================================
// Theme-matching, animated toasts for all user actions
// Uses Sonner under the hood with custom styling
// =============================================================================

import { toast as sonnerToast, ExternalToast } from 'sonner'

// ==================== TOAST TYPES ====================

type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading' | 'promise'

interface ToastOptions {
  duration?: number
  position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
  icon?: React.ReactNode
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  cancel?: {
    label: string
    onClick?: () => void
  }
  onDismiss?: () => void
  onComplete?: () => void
}

// ==================== ICON COMPONENTS (THIN VERSION) ====================

const Icons = {
  success: (
    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  ),
  
  error: (
    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  ),
  
  warning: (
    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    </div>
  ),
  
  info: (
    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
  ),
  
  loading: (
    <div className="flex items-center justify-center w-5 h-5">
      <div className="w-3.5 h-3.5 border-1.5 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  ),
  
  user: (
    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    </div>
  ),

  artifact: (
    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
    </div>
  ),

  logout: (
    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
    </div>
  ),
}

// ==================== MAIN TOAST FUNCTION ====================

export const toast = {
  /**
   * Success notification (green)
   */
  success(message: string, options?: ToastOptions) {
    return sonnerToast.success(message, {
      ...options,
      icon: options?.icon || Icons.success,
      className: `toast-success ${options?.className || ''}`,
      description: options?.description,
      action: options?.action,
      cancel: options?.cancel,
    } as ExternalToast)
  },

  /**
   * Error notification (red)
   */
  error(message: string, options?: ToastOptions) {
    return sonnerToast.error(message, {
      ...options,
      icon: options?.icon || Icons.error,
      className: `toast-error ${options?.className || ''}`,
      description: options?.description,
      duration: options?.duration || 5000,
      action: options?.action,
      cancel: options?.cancel,
    } as ExternalToast)
  },

  /**
   * Warning notification (yellow)
   */
  warning(message: string, options?: ToastOptions) {
    return sonnerToast.warning(message, {
      ...options,
      icon: options?.icon || Icons.warning,
      className: `toast-warning ${options?.className || ''}`,
      description: options?.description,
      action: options?.action,
      cancel: options?.cancel,
    } as ExternalToast)
  },

  /**
   * Info notification (blue)
   */
  info(message: string, options?: ToastOptions) {
    return sonnerToast.info(message, {
      ...options,
      icon: options?.icon || Icons.info,
      className: `toast-info ${options?.className || ''}`,
      description: options?.description,
      action: options?.action,
      cancel: options?.cancel,
    } as ExternalToast)
  },

  /**
   * Loading notification (spinner)
   */
  loading(message: string, options?: Omit<ToastOptions, 'icon'>) {
    return sonnerToast.loading(message, {
      ...options,
      icon: Icons.loading,
      className: `toast-loading ${options?.className || ''}`,
    } as ExternalToast)
  },

  /**
   * Dismiss a specific toast by ID or all toasts
   */
  dismiss(id?: string | number) {
    return sonnerToast.dismiss(id)
  },

  // ==================== SPECIFIC ACTION TOASTS ====================

  /**
   * Signup success
   */
  signupSuccess(name: string) {
    return this.success(`Welcome aboard, ${name}! 🎉`, {
      icon: Icons.user,
      description: 'Your account has been created successfully',
      duration: 5000,
      action: {
        label: 'Get Started',
        onClick: () => console.log('Get started clicked'),
      },
    })
  },

  /**
   * Signup error
   */
  signupError(error?: string) {
    return this.error('Signup failed', {
      icon: Icons.error,
      description: error || 'Could not create your account. Please try again.',
      duration: 5000,
      action: {
        label: 'Retry',
        onClick: () => console.log('Retry signup'),
      },
    })
  },

  /**
   * Login success
   */
  loginSuccess(name: string) {
    return this.success(`Welcome back, ${name}! 👋`, {
      icon: Icons.user,
      description: 'You have been logged in successfully',
      duration: 3000,
    })
  },

  /**
   * Login error
   */
  loginError(error?: string) {
    return this.error('Login failed', {
      icon: Icons.error,
      description: error || 'Invalid email or password. Please check and try again.',
      duration: 5000,
    })
  },

  /**
   * Logout success
   */
  logoutSuccess() {
    return this.success('Logged out successfully', {
      icon: Icons.logout,
      description: 'See you next time!',
      duration: 3000,
    })
  },

  /**
   * Artifact generation started
   */
  generationStarted(prompt: string) {
    const title = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt
    return this.loading('Creating your artifact...', {
      description: `"${title}"`,
    })
  },

  /**
   * Artifact generation success
   */
  generationSuccess(title: string) {
    return this.success('Artifact generated! ✨', {
      icon: Icons.artifact,
      description: `"${title}" is ready to download`,
      duration: 5000,
      action: {
        label: 'View',
        onClick: () => console.log('View artifact'),
      },
    })
  },

  /**
   * Artifact generation error
   */
  generationError(error?: string) {
    return this.error('Generation failed', {
      icon: Icons.error,
      description: error || 'Could not generate your artifact. Please try again.',
      duration: 6000,
      action: {
        label: 'Retry',
        onClick: () => console.log('Retry generation'),
      },
    })
  },

  /**
   * Download started
   */
  downloadStarted(format: string) {
    return this.loading(`Preparing ${format} download...`)
  },

  /**
   * Download complete
   */
  downloadComplete(filename: string) {
    return this.success('Download complete! 📥', {
      description: filename,
      duration: 3000,
    })
  },

  /**
   * Subscription required
   */
  subscriptionRequired() {
    return this.warning('Pro subscription required', {
      icon: Icons.warning,
      description: 'Upgrade to generate unlimited AI artifacts',
      duration: 5000,
      action: {
        label: 'Upgrade',
        onClick: () => console.log('Upgrade clicked'),
      },
    })
  },

  /**
   * Session expired
   */
  sessionExpired() {
    return this.error('Session expired', {
      icon: Icons.logout,
      description: 'Please login again to continue',
      duration: 5000,
      action: {
        label: 'Login',
        onClick: () => console.log('Re-login'),
      },
    })
  },

  // ==================== PROMISE TOASTS ====================

  /**
   * Promise toast for async operations
   */
  async promise<T>(
    promise: Promise<T>,
    messages: {
      loading: string
      success: string | ((data: T) => string)
      error: string | ((error: any) => string)
    },
    options?: Omit<ToastOptions, 'icon'>
  ) {
    return sonnerToast.promise(promise, {
      loading: messages.loading,
      success: messages.success,
      error: messages.error,
    }, {
      ...options,
      className: `toast-promise ${options?.className || ''}`,
    } as ExternalToast)
  },
}

// Export original sonner for advanced usage
export { sonnerToast }
export default toast
