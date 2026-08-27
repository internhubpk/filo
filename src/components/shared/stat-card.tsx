"use client";

// =============================================================================
// StatCard — dashboard/admin metric tile with optional icon and trend note.
// Values ALWAYS come from real data via props (never hardcoded upstream).
// =============================================================================

import { type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AnimatedNumber, HoverLift } from "@/components/animations";
import { Skeleton } from "@/components/ui/skeleton";

export function StatCard({
  label,
  value,
  format,
  icon,
  hint,
  tone = "default",
  loading = false,
  className,
}: {
  label: string;
  value: number | string;
  format?: (n: number) => string;
  icon?: ReactNode;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive";
  loading?: boolean;
  className?: string;
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "destructive"
          ? "text-destructive"
          : "";

  return (
    <HoverLift className={className}>
      <Card className="card-sheen h-full">
        <CardContent className="flex items-start justify-between gap-3 p-5">
          <div className="min-w-0">
            <p className="truncate text-sm text-muted-foreground">{label}</p>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", toneClass)}>
              {loading ? (
                <Skeleton className="h-8 w-20" />
              ) : typeof value === "number" ? (
                <AnimatedNumber value={value} format={format} />
              ) : (
                value
              )}
            </div>
            {hint ? <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p> : null}
          </div>
          {icon ? (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {icon}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </HoverLift>
  );
}
