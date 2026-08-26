// =============================================================================
// FILO Toast Notifications - Using react-hot-toast
// =============================================================================
// Clean, beautiful toasts with proper backgrounds.
//
// COMPATIBILITY NOTE — second argument ("description"):
//   The original API was `toast.error(message, description?: string)`, but
//   several call sites pass an options object: `toast.error('msg', { description: 'desc' })`.
//   To stay backward compatible with BOTH forms, the second argument is
//   now typed as `string | { description?: string } | undefined` and
//   normalized internally via `normalizeDescription()` before rendering.
//   Rendering a plain object as a React child would otherwise throw
//   "Objects are not valid as a React child" → which on Vercel surfaces as
//   the "Application error: a client-side exception" page.
// =============================================================================

import hotToast from 'react-hot-toast'

// ==================== CLEAN TOAST API ====================

/**
 * Normalize the second argument of toast.success/error/etc. into a string.
 * Accepts either a plain string OR an object `{ description?: string }`.
 */
function normalizeDescription(desc: unknown): string | undefined {
  if (desc == null) return undefined
  if (typeof desc === 'string') return desc
  if (typeof desc === 'object' && desc !== null) {
    const obj = desc as { description?: unknown }
    if (typeof obj.description === 'string') return obj.description
  }
  return undefined
}

// Build the inner content for react-hot-toast. Avoids rendering a plain
// object as a React child (which would throw "Objects are not valid as a
// React child").
function renderContent(message: string, desc: unknown) {
  const description = normalizeDescription(desc)
  return (
    <div className="flex flex-col">
      <span className="font-semibold text-sm">{message}</span>
      {description && <span className="text-xs opacity-70 mt-0.5">{description}</span>}
    </div>
  )
}

export const toast = {
  success(message: string, description?: string | { description?: string }) {
    return hotToast.success(
      renderContent(message, description),
      {
        icon: (
          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ),
        duration: 3000,
        style: {
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          color: '#166534',
        },
        iconTheme: {
          primary: '#22c55e',
          secondary: '#ffffff',
        },
      }
    )
  },

  error(message: string, description?: string | { description?: string }) {
    return hotToast.error(
      renderContent(message, description),
      {
        icon: (
          <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ),
        duration: 4000,
        style: {
          background: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#991b1b',
        },
        iconTheme: {
          primary: '#ef4444',
          secondary: '#ffffff',
        },
      }
    )
  },

  warning(message: string, description?: string | { description?: string }) {
    return hotToast(
      renderContent(message, description),
      {
        icon: (
          <svg className="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        ),
        duration: 4000,
        style: {
          background: '#fefce8',
          border: '1px solid #fef08a',
          color: '#854d0e',
        },
        iconTheme: {
          primary: '#eab308',
          secondary: '#ffffff',
        },
      }
    )
  },

  info(message: string, description?: string | { description?: string }) {
    return hotToast(
      renderContent(message, description),
      {
        icon: (
          <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        duration: 3000,
        style: {
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          color: '#1e40af',
        },
        iconTheme: {
          primary: '#3b82f6',
          secondary: '#ffffff',
        },
      }
    )
  },

  loading(message: string) {
    return hotToast.loading(message, {
      style: {
        background: 'hsl(var(--popover))',
        border: '1px solid hsl(var(--border))',
        color: 'hsl(var(--foreground))',
      },
    })
  },

  dismiss(id?: string) {
    if (id) {
      hotToast.dismiss(id)
    } else {
      hotToast.dismiss()
    }
  },

  // ==================== SPECIFIC TOASTS ====================

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
