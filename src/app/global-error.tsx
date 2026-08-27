'use client'

// =============================================================================
// app/global-error.tsx — Root-level error boundary (last resort)
// =============================================================================
// Next.js renders this when an error escapes app/error.tsx (e.g. a crash in
// the root layout itself). It must render its own <html>/<body>. Without it,
// such errors produce the opaque "Application error: a client-side exception
// has occurred" screen with no recovery path.
// =============================================================================

import React, { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Filo] Global application error:', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          background: '#ffffff',
          color: '#18181b',
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: 14,
              color: '#71717a',
              lineHeight: 1.6,
              marginBottom: 16,
            }}
          >
            Filo ran into an unexpected error. Reloading usually fixes it.
          </p>
          {error?.digest && (
            <p
              style={{
                fontSize: 12,
                color: '#a1a1aa',
                fontFamily: 'ui-monospace, monospace',
                marginBottom: 16,
              }}
            >
              Error ID: {error.digest}
            </p>
          )}
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'center',
              flexWrap: 'wrap' as const,
            }}
          >
            <button
              onClick={reset}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: '#18181b',
                color: '#ffffff',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: '1px solid #e4e4e7',
                background: 'transparent',
                color: '#18181b',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
