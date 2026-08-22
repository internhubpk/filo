"use client"

// FILO TOASTER - Using react-hot-toast
import { Toaster as HotToaster } from 'react-hot-toast'

export function Toaster() {
  return (
    <HotToaster
      position="top-right"
      gutter={8}
      containerStyle={{
        top: 16,
        right: 16,
        left: 16, // for mobile
      }}
      toastOptions={{
        duration: 3500,
        style: {
          background: 'hsl(var(--popover))',
          color: 'hsl(var(--foreground))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '10px',
          padding: '12px 16px',
          fontSize: '14px',
          boxShadow: '0 4px 20px -4px rgba(0,0,0,0.1), 0 2px 8px -2px rgba(0,0,0,0.05)',
        },
        success: {
          iconTheme: {
            primary: '#22c55e',
            secondary: '#ffffff',
          },
        },
        error: {
          iconTheme: {
            primary: '#ef4444',
            secondary: '#ffffff',
          },
        },
      }}
    />
  )
}

export default Toaster
