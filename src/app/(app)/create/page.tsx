"use client";

// =============================================================================
// CREATE — the AI generation experience (BACKGROUND JOBS)
// =============================================================================
// Describe the outcome → Filo plans, writes, and renders a REAL file.
//
// The request returns a jobId in milliseconds; the document is generated in
// Convex (survives tab close, logout, and network drops) and saved to the
// user's library. Progress streams live via Convex reactivity: percentage,
// stage label, sections completed, elapsed time and an ETA estimate — plus
// cancel / retry controls.
//
// PLAN GATING: AI generation is a PAID feature. Free accounts see an upgrade
// panel instead of the composer. The server enforces this on every request
// (PLAN_UPGRADE_REQUIRED); the UI mirrors it from the billing overview.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import {
  Sparkles,
  ArrowRight,
  Paperclip,
  X,
  FileUp,
  Download,
  Clock,
  Loader2,
  RotateCcw,
  Lightbulb,
  Info,
  Crown,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Timer,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useFiloSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { formatBytes, timeAgo } from "@/lib/format";
import { ARTIFACT_TYPES, findType } from "@/components/generation/artifact-type";
import { PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FadeIn } from "@/components/animations";

const PROMPT_MIN = 10;

interface AttachedFile {
  filename: string;
  mimeType: string;
  size: number;
  content: string; // base64
}

interface RecentArtifact {
  _id: string;
  title: string;
  type: string;
  format: string;
  status: string;
  createdAt: number;
}

interface JobDoc {
  _id: string;
  status: string;
  currentStage?: string;
  progress: number;
  totalUnits: number;
  completedUnits: number;
  failedUnits: number;
  error?: string;
  artifactId?: string;
  renderStartedAt?: number;
  createdAt: number;
  updatedAt: number;
}

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function CreatePage() {
  const { user, ready } = useFiloSession();
  const [typeId, setTypeId] = useState<string>("document");
  const [format, setFormat] = useState<string>("DOCX");
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Per-job render-fallback attempt counter (bounded retries, see effect below).
  const renderNudgedRef = useRef<Map<string, number>>(new Map());
  // Deterministic render failure reason surfaced from the render endpoint
  // (e.g. SERVER_SECRET_MISSING) — shown on the progress card instead of an
  // eternal silent 97%.
  const [renderHint, setRenderHint] = useState<string | null>(null);

  // URL params: ?type=presentation or ?prompt=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("type");
    if (t) {
      const found = findType(t);
      setTypeId(found.id);
      setFormat(found.suggestedFormat);
    }
    const p = params.get("prompt");
    if (p) setPrompt(p);
  }, []);

  // ---- Plan entitlement (client mirror; the server enforces the truth) ----
  const billing = useApi<Record<string, any>>(
    ready && user
      ? () => apiClient.getBillingOverview().then((r) => (r.success ? (r.data as any) : null))
      : null,
    { enabled: ready && !!user }
  );
  const planTier = String(billing.data?.planTier ?? "free").toLowerCase();
  const planName = String(billing.data?.planName ?? "Free");
  const aiAllowed = planTier !== "" && planTier !== "free";

  // ---- Live job subscription (Convex reactivity — no polling) ----
  const job = useQuery(
    api.generation.getJob,
    jobId && user ? { jobId: jobId as any, userId: user.id as any } : ("skip" as any)
  ) as JobDoc | null | undefined;

  // Pick up a job that is already running (user closed the tab earlier).
  const activeJob = useQuery(
    api.generation.getActiveUserJob,
    user ? { userId: user.id as any } : ("skip" as any)
  ) as JobDoc | null | undefined;

  useEffect(() => {
    if (!jobId && activeJob?._id) {
      setJobId(activeJob._id);
    }
  }, [jobId, activeJob]);

  // Elapsed timer while a job is running.
  const jobActive = !!job && !["completed", "failed", "cancelled"].includes(job.status);
  useEffect(() => {
    if (!job || !jobActive) return;
    const started = job.createdAt;
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [job, jobActive]);

  // ---- Recent generations, refreshed when a job completes ----
  const [recentTick, setRecentTick] = useState(0);
  const recent = useApi<{ artifacts?: RecentArtifact[] }>(
    ready && user
      ? () => apiClient.listArtifacts({ limit: 5 }).then((r) => (r.success ? (r.data as any) : { artifacts: [] }))
      : null,
    { enabled: ready && !!user }
  );
  useEffect(() => {
    if (recentTick > 0) void recent.refresh();
  }, [recentTick]);

  // ---- Safety net: the Convex CLOUD worker can never reach a localhost
  //      app origin, so localhost jobs DEPEND on this page to trigger the
  //      idempotent render endpoint. The previous implementation nudged
  //      exactly ONCE per visit and swallowed every failure — one 503/500
  //      or claim race and the job sat in "rendering" at 97% forever with
  //      no explanation (the "stuck at 97%" bug). This loop:
  //        • retries on a short interval while the job stays in rendering
  //          (bounded per job — the endpoint is idempotent, double triggers
  //          are harmless);
  //        • fires immediately when the job looks idle (no updatedAt bump);
  //        • surfaces DETERMINISTIC configuration failures (e.g. missing
  //          FILO_SERVER_SECRET) on the card instead of retrying blindly. ----
  useEffect(() => {
    if (!job || job.status !== "rendering" || !jobId) {
      setRenderHint(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const idleMs = Date.now() - (job.updatedAt ?? job.renderStartedAt ?? 0);
      if (idleMs < 8_000) return; // render claim is fresh — let it work
      const used = renderNudgedRef.current.get(jobId) ?? 0;
      if (used >= 12) return; // bounded; manual Retry remains available
      renderNudgedRef.current.set(jobId, used + 1);
      try {
        const res = await apiClient.triggerGenerationRender(jobId);
        if (cancelled) return;
        if (res.success) {
          setRenderHint(null);
          return;
        }
        if (res.code === "SERVER_SECRET_MISSING") {
          // Deterministic — retrying cannot fix it; tell the operator.
          setRenderHint(
            "File assembly is blocked: FILO_SERVER_SECRET is missing on this server. Add it to .env.local (same value as the Convex env) and restart the dev server."
          );
          return;
        }
        setRenderHint(
          `File assembly attempt ${used + 1} failed: ${res.error || res.code || "unknown error"} — retrying automatically.`
        );
      } catch {
        if (!cancelled) {
          setRenderHint(
            `File assembly attempt ${used + 1} failed (network) — retrying automatically.`
          );
        }
      }
    };
    void tick();
    const interval = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [job?._id, job?.status, job?.updatedAt, job?.renderStartedAt, jobId]);

  const selectedType = findType(typeId);
  const canSubmit = prompt.trim().length >= PROMPT_MIN && !starting && !jobActive && !!user && aiAllowed;

  // ---- ETA estimate (planning ≈ 1 min; per-section rate once started) ----
  const etaSeconds = useMemo(() => {
    if (!job) return null;
    if (job.status === "planning" || job.status === "queued") return 60;
    if (job.status === "rendering") return 15;
    if (job.status !== "generating" && job.status !== "validating") return null;
    const done = job.completedUnits;
    const remaining = Math.max(0, job.totalUnits - done);
    if (done < 1 || remaining === 0) return Math.min(remaining * 45, 240) || null;
    const secPerUnit = Math.max(5, (elapsed - 45) / done);
    return Math.round(remaining * secPerUnit);
  }, [job, elapsed]);

  // ---- Attachments ----
  const addFiles = useCallback(async (list: FileList | File[]) => {
    const maxFiles = 5;
    const maxSize = 8 * 1024 * 1024;
    const incoming = Array.from(list).slice(0, maxFiles);
    const encoded: AttachedFile[] = [];
    for (const f of incoming) {
      if (f.size > maxSize) {
        toast.error(`${f.name} is larger than 8MB`);
        continue;
      }
      const buf = await f.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      encoded.push({
        filename: f.name.slice(0, 255),
        mimeType: f.type || "application/octet-stream",
        size: f.size,
        content: btoa(binary),
      });
    }
    setFiles((prev) => [...prev, ...encoded].slice(0, maxFiles));
  }, []);

  // ---- Start generation (returns instantly with a jobId) ----
  async function generate() {
    if (!canSubmit) return;
    setStarting(true);
    try {
      const res = await apiClient.startGeneration({
        prompt: prompt.trim(),
        artifactType: typeId,
        outputFormat: format,
        files: files.length > 0 ? files : undefined,
      });
      if (!res.success || !res.data?.jobId) {
        if (res.code === "PLAN_UPGRADE_REQUIRED") {
          toast.error("AI generation is a premium feature", {
            description: "Upgrade your plan to create documents with AI.",
            action: { label: "View plans", onClick: () => (window.location.href = "/billing") },
          });
          return;
        }
        if (res.code === "GENERATION_IN_PROGRESS" && res.data && (res.data as any).jobId) {
          setJobId((res.data as any).jobId as string);
          toast.info("You already have a generation running — showing its progress.");
          return;
        }
        toast.error(res.error || "Could not start the generation", {
          description:
            res.code === "LIMIT_REACHED"
              ? "Upgrade your plan for more generations."
              : undefined,
          action:
            res.code === "LIMIT_REACHED"
              ? { label: "View plans", onClick: () => (window.location.href = "/billing") }
              : undefined,
        });
        return;
      }
      setJobId(res.data.jobId);
      toast.success("Generation started", {
        description: "You can leave this page — it continues in the background.",
      });
    } catch {
      toast.error("The request failed — check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  async function cancelJob() {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try {
      const res = await apiClient.cancelGeneration(jobId);
      if (res.success) {
        toast.info("Generation cancelled");
      } else {
        toast.error(res.error || "Could not cancel");
      }
    } finally {
      setCancelling(false);
    }
  }

  async function retryJob() {
    if (!jobId || retrying) return;
    setRetrying(true);
    try {
      const res = await apiClient.retryGeneration(jobId);
      if (res.success) {
        toast.success("Resumed — picking up where it left off");
        renderNudgedRef.current.delete(jobId);
      } else {
        toast.error(res.error || "Could not retry");
      }
    } finally {
      setRetrying(false);
    }
  }

  function resetForNew() {
    setJobId(null);
    setPrompt("");
    setElapsed(0);
    renderNudgedRef.current.clear();
    textRef.current?.focus();
  }

  // Refresh recents automatically the moment a job completes.
  const jobCompleted = job?.status === "completed";
  const jobFailed = job?.status === "failed";
  const completedArtifactRef = useRef<string | null>(null);
  useEffect(() => {
    if (jobCompleted && job?.artifactId && completedArtifactRef.current !== job.artifactId) {
      completedArtifactRef.current = job.artifactId;
      setRecentTick((t) => t + 1);
      toast.success("Document ready", {
        description: "Saved to your library — download it any time.",
      });
    }
    if (jobFailed) {
      completedArtifactRef.current = null;
    }
  }, [jobCompleted, jobFailed, job?.artifactId]);

  // Cmd/Ctrl+Enter to generate
  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void generate();
    }
  }

  if (!ready) return null;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Create with AI"
        description="Describe the outcome. Filo plans, writes, and renders a real file — even if you close this page."
        actions={
          aiAllowed ? (
            <Badge variant="outline" className="gap-1.5 rounded-full border-primary/30 bg-primary/5 px-3 py-1 text-primary">
              <Sparkles className="size-3" /> {selectedType.label} mode
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 rounded-full border-amber-500/30 bg-amber-500/5 px-3 py-1 text-amber-600 dark:text-amber-500">
              <Crown className="size-3" /> {planName} plan
            </Badge>
          )
        }
      />

      {!aiAllowed ? (
        /* ================= FREE PLAN: upgrade panel ================= */
        <FadeIn className="mt-6">
          <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 py-8 text-center sm:px-10">
              <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Crown className="size-6" />
              </span>
              <h2 className="text-xl font-semibold tracking-tight">AI generation is a premium feature</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Your {planName} plan can upload and organize files, but creating documents with AI
                requires a paid plan. Upgrade to Pro to unlock unlimited-quality documents,
                spreadsheets and presentations.
              </p>
            </div>
            <div className="grid gap-3 px-6 py-6 sm:grid-cols-3 sm:px-10">
              {[
                "500 AI generations / month",
                "All formats — DOCX, PDF, XLSX, PPTX",
                "Background generation + cloud library",
              ].map((f) => (
                <div key={f} className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="text-xs font-medium leading-relaxed">{f}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col items-center gap-2 border-t bg-muted/30 px-6 py-5 sm:flex-row sm:justify-center sm:px-10">
              <Button asChild className="w-full gap-2 sm:w-auto">
                <Link href="/billing">
                  <Crown className="size-4" /> Upgrade to Pro
                </Link>
              </Button>
              <Button asChild variant="ghost" className="w-full sm:w-auto">
                <Link href="/pricing">Compare plans</Link>
              </Button>
            </div>
          </div>
        </FadeIn>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
          {/* ================= LEFT: type + format ================= */}
          <aside className="min-w-0 space-y-6">
            <div>
              <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Artifact type</h3>
              <div className="space-y-1.5">
                {ARTIFACT_TYPES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTypeId(t.id);
                      setFormat(t.suggestedFormat);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      t.id === typeId
                        ? "border-primary/50 bg-primary/5"
                        : "border-transparent hover:border-border hover:bg-accent/40"
                    )}
                    aria-pressed={t.id === typeId}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg",
                        t.id === typeId ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                      )}
                    >
                      <t.icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{t.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{t.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output format</h3>
              <div className="flex flex-wrap gap-1.5">
                {selectedType.formats.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors",
                      f === format
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                    aria-pressed={f === format}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3.5">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Generation uses your monthly plan quota. Failed generations are never counted.
              </p>
            </div>
          </aside>

          {/* ================= CENTER: composer ================= */}
          <section className="min-w-0">
            {!jobActive && (
              <div
                className={cn(
                  "relative rounded-xl border bg-card transition-colors",
                  dragOver && "border-primary/60 bg-primary/5"
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
                }}
              >
                <Textarea
                  ref={textRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={`Describe the ${selectedType.label.toLowerCase()} you need — audience, length, tone, must-have sections…`}
                  className="min-h-[200px] resize-y border-0 bg-transparent p-5 text-[15px] leading-relaxed focus-visible:ring-0 sm:min-h-[240px]"
                  aria-label="Generation prompt"
                  disabled={starting}
                />

                {/* attachments */}
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t px-4 py-3">
                    {files.map((f, i) => (
                      <span key={i} className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/60 py-1 pl-2 pr-1 text-xs">
                        <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                        <span className="max-w-[160px] truncate font-medium">{f.filename}</span>
                        <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
                        <button
                          onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="rounded p-0.5 hover:bg-background"
                          aria-label={`Remove ${f.filename}`}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* toolbar */}
                <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length) void addFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={starting || jobActive}
                    >
                      <FileUp className="size-4" /> Attach context
                    </Button>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {prompt.trim().length}/{PROMPT_MIN} min · ⌘↵ to generate
                    </span>
                  </div>
                  {starting ? (
                    <Button className="gap-2" disabled>
                      <Loader2 className="size-4 animate-spin" /> Starting…
                    </Button>
                  ) : (
                    <Button className="press gap-1.5 shadow-lg shadow-primary/25" onClick={generate} disabled={!canSubmit}>
                      Generate <ArrowRight className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Suggestions */}
            {!resultVisible(job) && !jobActive && (
              <div className="mt-5">
                <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Lightbulb className="size-3.5" /> Try an example
                </h3>
                <div className="flex flex-col gap-2">
                  {selectedType.examples.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => {
                        setPrompt(ex);
                        textRef.current?.focus();
                      }}
                      className="rounded-lg border px-3.5 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/40 hover:text-foreground"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ================= LIVE JOB PROGRESS ================= */}
            {job && (
              <JobProgressCard
                job={job}
                elapsed={elapsed}
                etaSeconds={etaSeconds}
                cancelling={cancelling}
                retrying={retrying}
                renderHint={renderHint}
                onCancel={cancelJob}
                onRetry={retryJob}
                onReset={resetForNew}
              />
            )}

            {starting && !job && (
              <FadeIn className="mt-5 rounded-xl border bg-card p-5">
                <div className="flex items-center gap-3">
                  <Loader2 className="size-5 animate-spin text-primary" />
                  <p className="text-sm font-medium">Starting generation…</p>
                </div>
              </FadeIn>
            )}
          </section>

          {/* ================= RIGHT: recent ================= */}
          <aside className="min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent generations</h3>
            </div>
            <div className="mt-2.5 space-y-2">
              {(recent.data?.artifacts ?? []).length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                  Nothing yet — your finished documents will appear here.
                </p>
              ) : (
                (recent.data?.artifacts ?? []).map((a) => (
                  <Link
                    key={a._id}
                    href={`/documents?artifact=${a._id}`}
                    className="block rounded-lg border px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent/40"
                  >
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-semibold">{a.format}</span>
                      <Clock className="size-3" /> {timeAgo(a.createdAt)}
                    </p>
                  </Link>
                ))
              )}
            </div>
            <Button asChild variant="outline" size="sm" className="mt-3 w-full">
              <Link href="/documents">Open library</Link>
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}

function resultVisible(job: JobDoc | null | undefined): boolean {
  return !!job && ["completed", "failed", "cancelled"].includes(job.status);
}

// =============================================================================
// Live progress card — percentage, stage, sections, elapsed, ETA, controls
// =============================================================================
async function downloadArtifact(artifactId: string, fallbackName = "document") {
  try {
    const res = await fetch(`/api/artifacts/download?id=${encodeURIComponent(artifactId)}`, {
      headers: apiClient.getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      toast.error(json?.error || "Download failed");
      return;
    }
    const a = document.createElement("a");
    a.href = json.data.url;
    a.download = json.data.fileName || `${fallbackName}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    toast.error("Download failed — please try again.");
  }
}

function JobProgressCard({
  job,
  elapsed,
  etaSeconds,
  cancelling,
  retrying,
  renderHint,
  onCancel,
  onRetry,
  onReset,
}: {
  job: JobDoc;
  elapsed: number;
  etaSeconds: number | null;
  cancelling: boolean;
  retrying: boolean;
  renderHint?: string | null;
  onCancel: () => void;
  onRetry: () => void;
  onReset: () => void;
}) {
  const terminal = ["completed", "failed", "cancelled"].includes(job.status);

  if (job.status === "completed" && job.artifactId) {
    return (
      <FadeIn className="mt-5 overflow-hidden rounded-xl border border-emerald-500/30 bg-card">
        <div className="flex items-start justify-between gap-3 border-b border-emerald-500/20 bg-emerald-500/5 px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
              Document ready
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Generated in {fmtDuration(elapsed)} · saved to your library permanently
            </p>
          </div>
          <Button size="sm" className="shrink-0 gap-1.5" onClick={() => void downloadArtifact(job.artifactId!)}>
            <Download className="size-4" /> Download
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-xs text-muted-foreground">
          <span>Also available in Documents — download any time, from any device.</span>
          <div className="flex gap-2">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href={`/documents?artifact=${job.artifactId}`}>View in library</Link>
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={onReset}>
              <RotateCcw className="size-3.5" /> Start another
            </Button>
          </div>
        </div>
      </FadeIn>
    );
  }

  if (job.status === "failed") {
    return (
      <FadeIn className="mt-5 rounded-xl border border-destructive/30 bg-card p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Generation failed</p>
            <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
              {job.error || "Something went wrong while generating your document."}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" className="gap-1.5" onClick={onRetry} disabled={retrying}>
            {retrying ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Try again
          </Button>
          <Button size="sm" variant="ghost" onClick={onReset}>
            Start over
          </Button>
        </div>
      </FadeIn>
    );
  }

  if (job.status === "cancelled") {
    return (
      <FadeIn className="mt-5 rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <Ban className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Generation cancelled</p>
            <p className="mt-1 text-xs text-muted-foreground">No quota was used for this job.</p>
          </div>
        </div>
        <div className="mt-4">
          <Button size="sm" variant="outline" onClick={onReset}>
            Start a new one
          </Button>
        </div>
      </FadeIn>
    );
  }

  // ---------- ACTIVE (queued / planning / generating / validating / rendering) ----------
  const pct = Math.min(99, Math.max(2, job.progress ?? 0));
  const isRendering = job.status === "rendering";

  return (
    <FadeIn className="mt-5 rounded-xl border bg-card p-5 sm:p-6">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Loader2 className="size-5 animate-spin" />
            <span className="absolute inset-0 animate-ping rounded-xl bg-primary/10" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{job.currentStage || "Working…"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              You can close this tab — generation continues in the background and is saved to your library.
            </p>
          </div>
        </div>
        <span className="shrink-0 text-2xl font-bold tabular-nums tracking-tight text-primary">
          {pct}
          <span className="text-sm font-semibold text-muted-foreground">%</span>
        </span>
      </div>

      {/* Progress bar (value animates; shimmer conveys liveness) */}
      <div className="relative mt-4">
        <Progress value={pct} className="h-2.5" aria-label="Generation progress" />
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full" aria-hidden>
          <div className="h-full w-1/3 animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-primary/25 to-transparent" />
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border bg-muted/30 px-2 py-2">
          <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
            <Layers className="size-3" /> Sections
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">
            {job.completedUnits}/{job.totalUnits || "…"}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 px-2 py-2">
          <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="size-3" /> Elapsed
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">{fmtDuration(elapsed)}</p>
        </div>
        <div className="rounded-lg border bg-muted/30 px-2 py-2">
          <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
            <Timer className="size-3" /> {isRendering ? "Almost done" : "Est. remaining"}
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">
            {isRendering ? "Finalizing" : etaSeconds !== null ? `~${fmtDuration(etaSeconds)}` : "…"}
          </p>
        </div>
      </div>

      {/* Render-stage diagnosis: the endpoint told us WHY assembly cannot
          finish (config problem or repeated failure). Never show this for
          healthy renders — only when the fallback loop observed a failure. */}
      {isRendering && renderHint ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{renderHint}</span>
        </p>
      ) : null}

      {/* Controls */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          {job.failedUnits > 0
            ? `${job.failedUnits} section(s) failed — they will be retried automatically.`
            : "Typical documents finish in 1–3 minutes."}
        </p>
        {!terminal && (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground hover:text-destructive"
            onClick={onCancel}
            disabled={cancelling}
          >
            {cancelling ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
            Cancel
          </Button>
        )}
      </div>
    </FadeIn>
  );
}
