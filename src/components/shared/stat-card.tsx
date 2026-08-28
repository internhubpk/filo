"use client";

// =============================================================================
// StatCard — dashboard/admin metric tile with optional icon and trend note.
// Values ALWAYS come from real data via props (never hardcoded upstream).
// Visuals: sheen + shadow card, gradient icon chip, count-up numbers,
// `.lift` hover raise (design-system utility in globals.css).
// =============================================================================

import { type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/animations";
import { Skeleton } from "@/components/ui/skeleton";

const ICON_CHIP = {
  default: "from-primary/15 to-primary/5 text-primary ring-primary/20",
  success: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
  warning: "from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  destructive: "from-rose-500/15 to-rose-500/5 text-rose-600 dark:text-rose-400 ring-rose-500/20",
} as const;

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
    <Card
      className={cn(
        "lift press card-sheen h-full border shadow-sm hover:border-primary/35",
        tone === "destructive" && "border-destructive/25",
        className
      )}
    >
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums tracking-tight", toneClass)}>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : typeof value === "number" ? (
              <AnimatedNumber value={value} format={format} />
            ) : (
              value
            )}
          </div>
          {hint ? <p className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {icon ? (
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset",
              ICON_CHIP[tone]
            )}
          >
            {icon}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
