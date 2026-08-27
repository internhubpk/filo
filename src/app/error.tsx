'use client'

// =============================================================================
// app/error.tsx — Route-segment error boundary
// =============================================================================
// Catches unhandled exceptions thrown while rendering any route (including
// hydration failures that escalate) and shows a useful recovery UI instead
// of Next.js' generic "Application error: a client-side exception has
// occurred" screen. The `reset()` function re-renders the segment, giving
// transient errors (network hiccup, stale chunk) a chance to recover.
//
// Nothing sensitive is rendered here: only the digested message + console
// details for debugging.
// =============================================================================

import React, { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Full details go to the browser console so support/developers can debug.
    console.error('[Filo] Unhandled application error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="mx-auto max-w-md space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <svg
            className="h-7 w-7 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          An unexpected error occurred while loading this page. Your data is safe —
          try again, or head back to the dashboard.
        </p>
        {error?.digest && (
          <p className="font-mono text-xs text-muted-foreground select-all">
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button onClick={reset} className="gap-2">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Try again
          </Button>
          <Button variant="outline" asChild>
            <a href="/">Go to dashboard</a>
          </Button>
        </div>
      </div>
    </div>
  )
}
