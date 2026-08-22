"use client"

import { Toaster as SonnerToaster } from 'sonner'

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      hotkeys
      expand={false}
      richColors
      closeButton
      offset="16"
      gap="8px"
      toastOptions={{
        className: 'filo-toast',
        style: {
          background: 'transparent',
          border: 'none',
          padding: 0,
          boxShadow: 'none',
        },
      }}
      style={{
        '--normal-bg': 'hsl(var(--popover) / 0.95)',
        '--normal-border': 'hsl(var(--border) / 0.5)',
        '--normal-text': 'hsl(var(--popover-foreground))',
        '--success-bg': 'linear-gradient(135deg, hsl(142 76% 96%) 0%, hsl(142 70% 92%) 100%)',
        '--success-text': 'hsl(142 70% 30%)',
        '--success-border': 'hsl(142 76% 60% / 0.3)',
        '--error-bg': 'linear-gradient(135deg, hsl(0 93% 96%) 0%, hsl(0 90% 92%) 100%)',
        '--error-text': 'hsl(0 93% 30%)',
        '--error-border': 'hsl(0 93% 55% / 0.3)',
        '--warning-bg': 'linear-gradient(135deg, hsl(48 96% 96%) 0%, hsl(48 90% 92%) 100%)',
        '--warning-text': 'hsl(48 96% 25%)',
        '--warning-border': 'hsl(48 96% 50% / 0.3)',
        '--info-bg': 'linear-gradient(135deg, hsl(217 91% 96%) 0%, hsl(217 85% 92%) 100%)',
        '--info-text': 'hsl(217 91% 30%)',
        '--info-border': 'hsl(217 91% 50% / 0.3)',
      } as React.CSSProperties}
      theme="light"
    />
  )
}

// Dark mode support via CSS
// Add .dark class overrides in globals.css for dark mode theming
