"use client";

// =============================================================================
// Shared building blocks: PageHeader, EmptyState, ErrorState, Loading,
// StatusBadge, StatCard, UsageBar, ConfirmDialog.
// Every list/table/section across the app uses these so loading, empty,
// and error states are consistent everywhere.
// =============================================================================

import { type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusMetaFor } from "@/lib/billing-shared";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FadeIn } from "@/components/animations";

// ---- PageHeader ----
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <FadeIn className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </FadeIn>
  );
}

// ---- EmptyState ----
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center", className)}>
      {icon ? <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div> : null}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

// ---- ErrorState ----
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center", className)}>
      <h3 className="text-sm font-semibold text-destructive">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {message || "An unexpected error occurred. You can retry — your data is safe."}
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

// ---- Loading (skeleton block + spinner variants) ----
export function SkeletonCards({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-shimmer h-24 rounded-xl border bg-card" />
      ))}
    </div>
  );
}

export function InlineSpinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground", className)}>
      <Loader2 className="size-4 animate-spin" />
      {label || "Loading…"}
    </div>
  );
}

// ---- StatusBadge ----
export function StatusBadge({
  kind,
  status,
  className,
}: {
  kind: "subscription" | "payment" | "webhook";
  status: string;
  className?: string;
}) {
  const meta = statusMetaFor(kind, status);
  return (
    <span
      title={meta.description}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        meta.className,
        className
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}

// ---- UsageBar ----
export function UsageBar({
  used,
  limit,
  label,
  hint,
  className,
}: {
  used: number;
  limit: number;
  label?: string;
  hint?: string;
  className?: string;
}) {
  const unlimited = limit === -1 || limit === 0 && used === 0 ? false : limit === -1;
  const pct = unlimited ? 0 : Math.min(100, limit > 0 ? (used / limit) * 100 : 0);
  const tone =
    pct >= 95 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-primary";
  return (
    <div className={cn("w-full", className)}>
      {label || !unlimited ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
          {label ? <span className="text-muted-foreground">{label}</span> : <span />}
          <span className="font-medium tabular-nums">
            {unlimited ? "Unlimited" : `${used.toLocaleString()} / ${limit.toLocaleString()}`}
          </span>
        </div>
      ) : null}
      {unlimited ? (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full rounded-full bg-emerald-500/40" />
        </div>
      ) : (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <div className={cn("h-full rounded-full transition-all duration-500", tone)} style={{ width: `${pct}%` }} />
        </div>
      )}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ---- ConfirmDialog ----
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  loading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={loading}
            className={destructive ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
          >
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---- ActiveGenerations (re-exported from its own module for ergonomics) ----
export { ActiveGenerations } from "@/components/shared/active-generations";
