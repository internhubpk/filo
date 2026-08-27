import Link from 'next/link'

// =============================================================================
// app/not-found.tsx — Friendly 404 page
// =============================================================================
// Previously, unknown URLs fell through to the framework default. This gives
// users a clear path back into the product.
// =============================================================================

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="mx-auto max-w-md space-y-4">
        <p className="text-6xl font-bold tracking-tight text-primary">404</p>
        <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The page you are looking for doesn&apos;t exist or may have been moved.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Go to dashboard
          </Link>
          <Link
            href="/pricing"
            className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-6 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            View pricing
          </Link>
        </div>
      </div>
    </div>
  )
}
