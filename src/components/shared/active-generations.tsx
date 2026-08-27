"use client";

// =============================================================================
// ActiveGenerations — live banner showing in-flight background generations
// =============================================================================
// Subscribes (Convex reactivity, no polling) to the signed-in user's active
// generation jobs and renders a compact progress list. Render it on any page:
// users see their documents being created even after navigating away from
// /create — reinforcing that generation survives tab closes and logouts.
//
// `onSettled` fires when an active job transitions to a terminal state, so
// pages can refresh their lists at exactly the right moment.
// =============================================================================

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Loader2, Sparkles, ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useFiloSession } from "@/hooks/use-session";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface JobLike {
  _id: string;
  status: string;
  currentStage?: string;
  progress: number;
  totalUnits: number;
  completedUnits: number;
}

const ACTIVE = new Set(["queued", "planning", "generating", "validating", "rendering"]);

export function ActiveGenerations({
  className,
  onSettled,
}: {
  className?: string;
  /** Called when a previously-active job completes/fails (refresh signals). */
  onSettled?: () => void;
}) {
  const { user, ready } = useFiloSession();

  const jobs = useQuery(
    api.generation.listUserJobs,
    ready && user ? { userId: user.id as any, limit: 6 } : ("skip" as any)
  ) as Array<JobLike> | undefined;

  const active = (jobs ?? []).filter((j) => ACTIVE.has(j.status));

  // Fire onSettled exactly once per transition from active → terminal.
  const hadActiveRef = useRef(false);
  useEffect(() => {
    const had = hadActiveRef.current;
    const has = active.length > 0;
    if (had && !has && onSettled) {
      onSettled();
    }
    hadActiveRef.current = has;
  }, [active.length, onSettled]);

  if (!ready || !user || active.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-primary/25 bg-primary/[0.04] p-4",
        className
      )}
      role="status"
      aria-label="Background generations in progress"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="size-3.5" />
          {active.length === 1 ? "Generating in background" : `${active.length} generations in background`}
        </p>
        <Link
          href="/create"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open <ArrowRight className="size-3" />
        </Link>
      </div>
      <div className="mt-3 space-y-3">
        {active.map((job) => (
          <div key={job._id}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
                <span className="truncate">{job.currentStage || "Working…"}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-primary">
                {Math.max(2, Math.min(99, job.progress ?? 0))}%
              </span>
            </div>
            <Progress value={Math.max(2, Math.min(99, job.progress ?? 0))} className="mt-1.5 h-1.5" />
          </div>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
        <CheckCircle2 className="size-3" />
        Safe to close the tab — finished files land in your library automatically.
        <AlertTriangle className="ml-1 hidden size-3" aria-hidden />
      </p>
    </div>
  );
}
