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
import { apiClient } from "@/lib/api-client";

interface JobLike {
  _id: string;
  status: string;
  currentStage?: string;
  progress: number;
  totalUnits: number;
  completedUnits: number;
  updatedAt?: number;
}

const ACTIVE = new Set(["queued", "planning", "generating", "validating", "rendering"]);

/** Jobs in "rendering" whose render trigger is older than this are retried
 *  from the browser (the render endpoint is idempotent — double triggers are
 *  harmless). This is the fallback that un-sticks the 97% state when the
 *  worker's server-to-server POST cannot reach the app origin (e.g. the job
 *  was created from localhost). */
const RENDER_FALLBACK_AFTER_MS = 45_000;
const MAX_BROWSER_RENDER_ATTEMPTS = 5;

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

  // ---------- BROWSER RENDER TRIGGER (97%-stuck safety net) ----------
  // If a job sits in "rendering" with no progress, hit the SAME idempotent
  // render endpoint from the browser. This is the only caller that can
  // reach a localhost-origin job from a cloud worker situation, and it
  // double-safes every other failure mode (worker POST failed, retries
  // exhausted, FILO_APP_URL unset).
  const attemptsRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!ready || !user) return;
    const interval = setInterval(async () => {
      const now = Date.now();
      for (const job of active) {
        if (job.status !== "rendering") continue;
        const idleFor = now - (job.updatedAt ?? 0);
        if (idleFor < RENDER_FALLBACK_AFTER_MS) continue;
        const used = attemptsRef.current.get(job._id) ?? 0;
        if (used >= MAX_BROWSER_RENDER_ATTEMPTS) continue;
        attemptsRef.current.set(job._id, used + 1);
        try {
          await fetch("/api/generation/render", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...apiClient.getAuthHeaders(),
            },
            body: JSON.stringify({ jobId: job._id }),
          });
        } catch {
          // Network hiccup — the next tick retries (bounded).
        }
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [active, ready, user]);

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
            {job.status === "rendering" && (job.updatedAt ?? 0) < Date.now() - 180_000 ? (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3" />
                Finishing is taking longer than usual — the file is being assembled. You can keep working; we will retry automatically.
              </p>
            ) : null}
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
