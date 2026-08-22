"use client"

// FILO TOASTER - Ultra clean, no buttons, auto-dismiss
import { Toaster as SonnerToaster } from 'sonner'

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      expand={false}
      richColors
      closeButton={false}
      offset={16}
      gap={8}
      duration={3500}
      toastOptions={{
        className: 'filo-clean-toast',
        style: {
          background: 'transparent',
          border: 'none',
          padding: 0,
          boxShadow: 'none',
        },
        descriptionClassName: 'filo-toast-desc',
      }}
      style={{
        '--normal-bg': 'hsl(var(--popover))',
        '--normal-text': 'hsl(var(--popover-foreground))',
        '--success-bg': 'hsl(142 70% 96%)',
        '--success-text': 'hsl(142 70% 25%)',
        '--success-border': 'hsl(142 70% 80%)',
        '--error-bg': 'hsl(0 93% 96%)',
        '--error-text': 'hsl(0 93% 25%)',
        '--error-border': 'hsl(0 93% 85%)',
        '--warning-bg': 'hsl(48 96% 96%)',
        '--warning-text': 'hsl(48 96% 20%)',
        '--warning-border': 'hsl(48 96% 85%)',
        '--info-bg': 'hsl(217 91% 97%)',
        '--info-text': 'hsl(217 91% 25%)',
        '--info-border': 'hsl(217 91% 88%)',
      } as React.CSSProperties}
      theme="light"
    />
  )
}

export default Toaster
