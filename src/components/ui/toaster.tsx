"use client"

// FILO TOASTER - Thin, responsive, beautiful animated toasts
// Single X button, auto-dismiss, mobile-friendly

import { Toaster as SonnerToaster } from 'sonner'

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      hotkeys={{ t: true }}
      expand={false}
      richColors
      closeButton
      offset={12}
      gap={6}
      duration={4000}
      toastOptions={{
        className: 'filo-toast-thin',
        style: {
          background: 'transparent',
          border: 'none',
          padding: 0,
          boxShadow: 'none',
        },
        descriptionClassName: 'filo-toast-desc',
      }}
      style={{
        '--normal-bg': 'hsl(var(--popover) / 0.95)',
        '--normal-border': 'hsl(var(--border) / 0.5)',
        '--normal-text': 'hsl(var(--popover-foreground))',
        '--success-bg': 'hsl(142 76% 96%)',
        '--success-text': 'hsl(142 70% 30%)',
        '--success-border': 'hsl(142 76% 60% / 0.3)',
        '--error-bg': 'hsl(0 93% 96%)',
        '--error-text': 'hsl(0 93% 30%)',
        '--error-border': 'hsl(0 93% 55% / 0.3)',
        '--warning-bg': 'hsl(48 96% 96%)',
        '--warning-text': 'hsl(48 96% 25%)',
        '--warning-border': 'hsl(48 96% 50% / 0.3)',
        '--info-bg': 'hsl(217 91% 96%)',
        '--info-text': 'hsl(217 91% 30%)',
        '--info-border': 'hsl(217 91% 50% / 0.3)',
      } as React.CSSProperties}
      theme="light"
    />
  )
}

export default Toaster
