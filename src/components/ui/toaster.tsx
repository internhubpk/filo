"use client"

// FILO TOASTER - Using Sonner for beautiful animated toasts
// This REPLACES the old shadcn/radix toast system entirely

import { Toaster as SonnerToaster } from 'sonner'

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      hotkeys={{ t: true }}
      expand={false}
      richColors
      closeButton
      offset={16}
      gap={8}
      toastOptions={{
        className: 'filo-toast-notification',
        style: {
          background: 'transparent',
          border: 'none',
          padding: 0,
          boxShadow: 'none',
        },
        descriptionClassName: 'filo-toast-description',
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
