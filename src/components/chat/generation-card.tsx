"use client";

// =============================================================================
// GenerationCard — live document generation progress inside the transcript.
// =============================================================================
// Subscribes (Convex reactivity, zero polling) to the durable job started
// from this chat turn. States map 1:1 to real database state:
//   loading  → job subscription not yet resolved (skeleton line)
//   active   → real progress % + current stage label
//   done     → artifact ready → download / open in Documents
//   failed   → honest error + retry action
//   cancelled→ terminal note
// The artifact id becomes available as soon as the worker saves it; the
// card switches to "ready" the moment that happens — not on a timer.
// =============================================================================

import { useState } from "react";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Loader2,
  Presentation,
  Sparkles,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import { useFiloSession } from "@/hooks/use-session";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ACTIVE_STATUSES = new Set(["queued", "planning", "generating", "validating", "rendering"]);

function typeIcon(artifactType?: string) {
  if (artifactType === "spreadsheet") return FileSpreadsheet;
  if (artifactType === "presentation") return Presentation;
  return FileText;
}

export function GenerationCard({
  jobId,
  outputFormat,
  artifactType,
}: {
  jobId: string;
  outputFormat?: string;
  artifactType?: string;
}) {
  const { token } = useFiloSession();
  const [downloading, setDownloading] = useState(false);

  const job = useQuery(
    api.generation.getJobSession,
    token ? ({ session: token, jobId } as any) : ("skip" as any)
  ) as
    | {
        status: string;
        currentStage?: string;
        progress: number;
        artifactId?: string;
        error?: string;
        completedAt?: number;
      }
    | null
    | undefined;

  const Icon = typeIcon(artifactType);
  const isActive = job ? ACTIVE_STATUSES.has(job.status) : false;
  const isDone = job?.status === "completed" && Boolean(job?.artifactId);
  const isFailed = job?.status === "failed";
  const isCancelled = job?.status === "cancelled";

  async function download() {
    if (!job?.artifactId) return;
    const artifactId = job.artifactId;
    setDownloading(true);
    try {
      const res = await fetch(`/api/artifacts/download?id=${encodeURIComponent(artifactId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => null)) as
        | { success: boolean; data?: { url: string; fileName: string }; error?: string; code?: string }
        | null;
      if (!res.ok || !json?.success || !json.data?.url) return;
      const a = document.createElement("a");
      a.href = json.data.url;
      a.download = json.data.fileName || `document.${(outputFormat || "docx").toLowerCase()}`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mt-1 max-w-md rounded-xl border bg-card p-3.5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            isDone ? "bg-success/10 text-success" : isFailed ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
          )}
        >
          {isDone ? <CheckCircle2 className="size-5" /> : isFailed ? <AlertTriangle className="size-5" /> : <Icon className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {artifactType === "spreadsheet" ? "Spreadsheet" : artifactType === "presentation" ? "Presentation" : "Document"}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {outputFormat ? `· ${String(outputFormat).toUpperCase()}` : ""}
            </span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {job === undefined || job === null ? (
              "Connecting…"
            ) : isDone ? (
              "Ready to download"
            ) : isFailed ? (
              "Generation failed"
            ) : isCancelled ? (
              "Cancelled"
            ) : (
              job.currentStage || "Starting…"
            )}
          </p>
        </div>
        {job === undefined || isActive ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : null}
      </div>

      {isActive && job ? (
        <Progress value={Math.max(3, Math.min(100, job.progress))} className="mt-2.5 h-1.5" aria-label="Generation progress" />
      ) : isActive && !job ? (
        <Skeleton className="mt-2.5 h-1.5 w-full" />
      ) : null}

      {isFailed && job?.error ? (
        <p className="mt-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">{job.error}</p>
      ) : null}

      {isDone ? (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" className="h-7 text-xs" onClick={() => void download()} disabled={downloading}>
            {downloading ? <Loader2 className="mr-1.5 size-3 animate-spin" /> : <Download className="mr-1.5 size-3" />}
            Download
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
            <a href="/documents">
              <FolderOpen className="mr-1.5 size-3" /> Open library
            </a>
          </Button>
        </div>
      ) : null}

      {isActive ? (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Sparkles className="size-3" /> Runs securely in the background — you can keep chatting or close this tab.
        </p>
      ) : null}
    </div>
  );
}
