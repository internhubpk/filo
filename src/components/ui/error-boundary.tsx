'use client'

import React from 'react'
import { AlertCircle, RefreshCw, Home, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AppError, ErrorCode, getErrorDisplay, parseError } from '@/lib/error-handler'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<ErrorBoundaryFallbackProps>
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

interface ErrorBoundaryFallbackProps {
  error: AppError
  resetErrorBoundary: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: AppError | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const appError = parseError(error)
    return { hasError: true, error: appError }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to console in development
    console.error('ErrorBoundary caught:', error, errorInfo)
    
    // Call custom onError handler if provided
    this.props.onError?.(error, errorInfo)
    
    // In production, you could send this to your error tracking service
    // e.g., Sentry, LogRocket, etc.
  }

  resetErrorBoundary = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError && this.state.error) {
      const Fallback = this.props.fallback || DefaultErrorFallback
      return (
        <Fallback 
          error={this.state.error} 
          resetErrorBoundary={this.resetErrorBoundary} 
        />
      )
    }

    return this.props.children
  }
}

// ==================== DEFAULT ERROR FALLBACK ====================

function DefaultErrorFallback({ error, resetErrorBoundary }: ErrorBoundaryFallbackProps) {
  const display = getErrorDisplay(error)
  
  return (
    <div className="min-h-[400px] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center space-y-4">
            {/* Error Icon */}
            <div className="rounded-full bg-destructive/10 p-3">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            
            {/* Error Title */}
            <h2 className="text-xl font-semibold">{display.title}</h2>
            
            {/* Error Message */}
            <p className="text-muted-foreground text-sm leading-relaxed">
              {display.message}
            </p>
            
            {/* Suggestion (if available) */}
            {display.suggestion && (
              <div className="bg-muted/50 rounded-lg p-3 w-full">
                <p className="text-xs text-muted-foreground">
                  TIP: {display.suggestion}
                </p>
              </div>
            )}
            
            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 w-full pt-2">
              {display.retryable && (
                <Button 
                  onClick={resetErrorBoundary}
                  variant="default"
                  className="flex-1"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Try Again
                </Button>
              )}
              
              <Button 
                onClick={() => window.location.reload()} 
                variant="outline"
                className="flex-1"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Reload Page
              </Button>
            </div>
            
            {/* Go Home */}
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => window.location.href = '/'}
            >
              <Home className="mr-2 h-4 w-4" />
              Go to Homepage
            </Button>
            
            {/* Error Code (for debugging) */}
            {process.env.NODE_ENV === 'development' && (
              <details className="w-full text-left">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  Technical Details (Development)
                </summary>
                <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-32">
                  {JSON.stringify({
                    code: error.code,
                    timestamp: new Date(error.timestamp).toISOString(),
                    originalError: error.originalError,
                  }, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ==================== HOOK FOR FUNCTIONAL COMPONENTS ====================

/**
 * Hook to handle errors in functional components with proper user feedback
 */
export function useErrorHandler() {
  const [error, setError] = React.useState<AppError | null>(null)
  
  const handleError = React.useCallback((err: unknown, overrides?: Partial<Pick<AppError, 'message' | 'suggestion'>>) => {
    const appError = parseError(err)
    if (overrides) {
      Object.assign(appError, overrides)
    }
    setError(appError)
  }, [])
  
  const clearError = React.useCallback(() => {
    setError(null)
  }, [])
  
  const retry = React.useCallback(async (fn: () => Promise<void> | void) => {
    clearError()
    try {
      await fn()
    } catch (err) {
      handleError(err)
    }
  }, [handleError, clearError])
  
  return {
    error,
    setError: handleError,
    clearError,
    retry,
    hasError: error !== null,
    display: error ? getErrorDisplay(error) : null,
  }
}

// ==================== SPECIALIZED ERROR COMPONENTS ====================

/**
 * Inline error display component
 */
export function ErrorDisplay({ 
  error, 
  onRetry, 
  onDismiss,
  compact = false 
}: { 
  error: AppError | ErrorCode | unknown
  onRetry?: () => void
  onDismiss?: () => void
  compact?: boolean
}) {
  const display = getErrorDisplay(error)
  
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-destructive text-sm p-2 bg-destructive/10 rounded-md">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="flex-1">{display.message}</span>
        {display.retryable && onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            X
          </Button>
        )}
      </div>
    )
  }
  
  return (
    <div className="border border-destructive/20 bg-destructive/5 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm">{display.title}</h4>
          <p className="text-sm text-muted-foreground mt-1">{display.message}</p>
          
          {display.suggestion && (
            <p className="text-xs text-muted-foreground mt-2 italic">
              TIP: {display.suggestion}
            </p>
          )}
        </div>
        
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss} className="shrink-0">
            ✕
          </Button>
        )}
      </div>
      
      {display.retryable && onRetry && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-2 h-3 w-3" />
            Try Again
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Loading state with error handling
 */
export function LoadingWithError({
  isLoading,
  error,
  onRetry,
  children,
  loadingText = 'Loading...',
  emptyText = 'No data available',
  isEmpty = false,
}: {
  isLoading: boolean
  error?: AppError | ErrorCode | unknown
  onRetry?: () => void
  children: React.ReactNode
  loadingText?: string
  emptyText?: string
  isEmpty?: boolean
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <RefreshCw className="h-6 w-6 animate-spin" />
          <p className="text-sm">{loadingText}</p>
        </div>
      </div>
    )
  }
  
  if (error) {
    return <ErrorDisplay error={error} onRetry={onRetry} />
  }
  
  if (isEmpty) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <p className="text-sm">{emptyText}</p>
      </div>
    )
  }
  
  return <>{children}</>
}

// Export types
export type { ErrorBoundaryProps, ErrorBoundaryFallbackProps }
