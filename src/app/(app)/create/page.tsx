"use client";

// =============================================================================
// CREATE — the AI generation experience.
// =============================================================================
// Left:   artifact type + output format + prompt suggestions (real pipeline
//         options; suggestions are content, not data).
// Center: the prompt composer with drag-and-drop context files.
// Right:  live progress + recent generations (REAL artifacts from Convex).
//
// Generation runs through /api/artifacts/agent-generate — the proven
// end-to-end pipeline (quota pre-check → AI planning → section generation →
// render → save). Progress feedback is honest: the request is in-flight
// (elapsed timer + stage hints), and the completed artifact arrives with real
// download links. No fake percentages.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useFiloSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { formatBytes, timeAgo } from "@/lib/format";
import { ARTIFACT_TYPES, findType } from "@/components/generation/artifact-type";
import { PageHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StaggerContainer, StaggerItem, FadeIn } from "@/components/animations";

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

export default function CreatePage() {
  const { user, ready } = useFiloSession();
  const [typeId, setTypeId] = useState<string>("document");
  const [format, setFormat] = useState<string>("DOCX");
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{
    title: string;
    format: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    fileData: string;
    tokensUsed?: number;
    generationTimeMs?: number;
  } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Honest in-flight timer (no fabricated percentages).
  useEffect(() => {
    if (!submitting) return;
    setElapsed(0);
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [submitting]);

  // Recent generations (real artifacts), refreshed after a run.
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

  const selectedType = findType(typeId);
  const canSubmit = prompt.trim().length >= PROMPT_MIN && !submitting && !!user;

  const stageHint = useMemo(() => {
    if (elapsed < 5) return "Sending your request…";
    if (elapsed < 25) return "Planning the document structure…";
    if (elapsed < 90) return "Writing sections — long documents take a minute or two…";
    return "Rendering the final file…";
  }, [elapsed]);

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

  // ---- Generate ----
  async function generate() {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await apiClient.agentGenerate({
        prompt: prompt.trim(),
        artifactType: typeId,
        outputFormat: format,
        files: files.length > 0 ? files : undefined,
      });
      if (!res.success || !res.data?.artifact) {
        toast.error(res.error || "Generation failed", {
          description: res.code === "LIMIT_REACHED" ? "Upgrade your plan for more generations." : undefined,
          action:
            res.code === "LIMIT_REACHED"
              ? { label: "View plans", onClick: () => (window.location.href = "/billing") }
              : undefined,
        });
        return;
      }
      const a = res.data.artifact;
      setResult({
        title: a.title ?? "Untitled document",
        format: a.format ?? format,
        fileName: a.fileName ?? `document.${format.toLowerCase()}`,
        fileSize: a.fileSize ?? 0,
        mimeType: a.mimeType ?? "application/octet-stream",
        fileData: a.fileData ?? "",
        tokensUsed: res.data.tokensUsed,
        generationTimeMs: res.data.generationTimeMs,
      });
      toast.success("Document ready");
      setRecentTick((t) => t + 1);
    } catch {
      toast.error("The request failed — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Cmd/Ctrl+Enter to generate
  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void generate();
    }
  }

  if (!ready) return null;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Create with AI"
        description="Describe the outcome. Filo plans, writes, and renders a real file."
        actions={
          <Badge variant="outline" className="gap-1.5 rounded-full border-primary/30 bg-primary/5 px-3 py-1 text-primary">
            <Sparkles className="size-3" /> {selectedType.label} mode
          </Badge>
        }
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        {/* ================= LEFT: type + format ================= */}
        <aside className="space-y-5">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Artifact type</h3>
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
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output format</h3>
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

          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Generation uses your monthly plan quota. Failed generations are never counted.
            </p>
          </div>
        </aside>

        {/* ================= CENTER: composer ================= */}
        <section className="min-w-0">
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
              className="min-h-[220px] resize-y border-0 bg-transparent p-5 text-[15px] leading-relaxed focus-visible:ring-0 sm:min-h-[260px]"
              aria-label="Generation prompt"
              disabled={submitting}
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
                  disabled={submitting}
                >
                  <FileUp className="size-4" /> Attach context
                </Button>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {prompt.trim().length}/{PROMPT_MIN} min · ⌘↵ to generate
                </span>
              </div>
              {submitting ? (
                <Button className="gap-2" disabled>
                  <Loader2 className="size-4 animate-spin" /> Generating…
                </Button>
              ) : (
                <Button className="gap-1.5" onClick={generate} disabled={!canSubmit}>
                  Generate <ArrowRight className="size-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Suggestions (pipeline-safe examples) */}
          {!result && !submitting && (
            <div className="mt-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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

          {/* In-flight progress — honest state display */}
          {submitting && (
            <FadeIn className="mt-4 rounded-xl border bg-card p-5">
              <div className="flex items-center gap-3">
                <Loader2 className="size-5 animate-spin text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{stageHint}</p>
                  <p className="text-xs text-muted-foreground">
                    {elapsed < 60 ? `${elapsed}s elapsed` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`} · keep
                    this tab open until it finishes — long documents can take a couple of minutes.
                  </p>
                </div>
              </div>
              <Progress value={undefined} className="mt-4 h-1.5 animate-pulse" />
            </FadeIn>
          )}

          {/* Result */}
          {result && !submitting && (
            <FadeIn className="mt-4 overflow-hidden rounded-xl border border-emerald-500/30 bg-card">
              <div className="flex items-start justify-between gap-3 border-b border-emerald-500/20 bg-emerald-500/5 px-5 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <svg viewBox="0 0 10 8" className="size-2.5 fill-none stroke-current stroke-[1.6]" aria-hidden>
                        <path d="M1 4l2.5 2.5L9 1" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="truncate">{result.title}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {result.format} · {formatBytes(result.fileSize)}
                    {result.generationTimeMs ? ` · ${Math.round(result.generationTimeMs / 1000)}s` : ""}
                  </p>
                </div>
                <Button asChild size="sm" className="shrink-0">
                  <a
                    href={`data:${result.mimeType};base64,${result.fileData}`}
                    download={result.fileName}
                  >
                    <Download className="mr-1.5 size-4" /> Download
                  </a>
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs text-muted-foreground">
                <span>Saved to your Documents — download any time.</span>
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => { setResult(null); setPrompt(""); }}>
                  <RotateCcw className="size-3.5" /> Start another
                </Button>
              </div>
            </FadeIn>
          )}
        </section>

        {/* ================= RIGHT: recent ================= */}
        <aside className="min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent generations</h3>
          </div>
          <div className="mt-2 space-y-2">
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
    </div>
  );
}
