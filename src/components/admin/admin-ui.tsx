"use client";

// =============================================================================
// Admin section helpers: page header, filter chips, data table shell,
// loading skeleton, empty/error states — one consistent admin language.
// =============================================================================

import { type ReactNode } from "react";
import { Search, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared";
import { FadeIn } from "@/components/animations";

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <FadeIn className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </FadeIn>
  );
}

export function FilterChip({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted"
      )}
      aria-pressed={active}
    >
      {label}
      {count !== undefined && (
        <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active ? "bg-primary/20" : "bg-muted")}>
          {count}
        </span>
      )}
    </button>
  );
}

export function AdminTable({
  columns,
  children,
  loading,
  error,
  onRetry,
  rowsCount,
  search,
  onSearch,
  searchPlaceholder = "Search…",
  toolbar,
  emptyTitle = "Nothing here yet",
  emptyDescription = "Records appear here automatically as the platform is used.",
}: {
  columns: string[];
  children: ReactNode;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  rowsCount: number;
  search?: string;
  onSearch?: (v: string) => void;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  /** Shown when rowsCount === 0 (e.g. "No payments match this filter"). */
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }
  if (rowsCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center">
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Inbox className="size-5" />
        </div>
        <p className="text-sm font-medium">{emptyTitle}</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{emptyDescription}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {(onSearch || toolbar) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {onSearch && (
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9"
                aria-label={searchPlaceholder}
              />
            </div>
          )}
          {toolbar}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              {columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-4 py-2.5 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function TableActions({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-1">{children}</div>;
}

export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      Retry
    </Button>
  );
}
