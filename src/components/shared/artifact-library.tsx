"use client";

// =============================================================================
// ArtifactLibrary — shared library view for documents / spreadsheets /
// presentations. Data is REAL (artifacts from Convex via /api/artifacts),
// filtered by artifact type. Grid/list toggle, search, sort, download,
// delete (with confirm + R2 cleanup server-side), status badges, empty and
// loading states.
// =============================================================================

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  Search,
  LayoutGrid,
  List,
  Download,
  Trash2,
  Clock,
  Sparkles,
  RotateCcw,
  History,
  Share2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useFiloSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, SkeletonCards, ConfirmDialog, ActiveGenerations } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StaggerContainer, StaggerItem } from "@/components/animations";
import type { DocumentTypeMeta } from "@/components/generation/artifact-type";

// Format-aware export options per artifact type (spec §43 — never show
// irrelevant formats; only genuinely renderable conversions are exposed).
const EXPORT_FORMATS: Record<string, string[]> = {
  document: ["DOCX", "PDF", "TXT"],
  report: ["DOCX", "PDF", "TXT"],
  proposal: ["DOCX", "PDF", "TXT"],
  contract: ["DOCX", "PDF", "TXT"],
  invoice: ["PDF", "XLSX"],
  resume: ["PDF", "DOCX"],
  lesson_plan: ["PDF", "DOCX"],
  email: ["DOCX", "PDF", "TXT"],
  spreadsheet: ["XLSX", "CSV", "PDF"],
  presentation: ["PPTX", "PDF"],
  csv: ["CSV", "XLSX"],
  custom: ["DOCX", "PDF"],
};

interface VersionRow {
  version: number;
  operation: string;
  sourceVersion?: number;
  format: string;
  filename: string;
  r2Key: string;
  size: number;
  qaReport?: { score?: number; repaired?: number; issueCount?: number };
  createdAt: number;
}

export interface ArtifactRow {
  _id: string;
  title: string;
  type: string;
  format: string;
  status: string;
  prompt?: string;
  createdAt: number;
  updatedAt?: number;
  fileId?: string | null;
  versionCount?: number;
}

export function ArtifactLibrary({
  title,
  description,
  artifactType,
  typeMeta,
  createHref,
  createLabel,
}: {
  title: string;
  description: string;
  artifactType: string;
  typeMeta: DocumentTypeMeta;
  createHref: string;
  createLabel: string;
}) {
  const { user, ready } = useFiloSession();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "title">("newest");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [toDelete, setToDelete] = useState<ArtifactRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [historyFor, setHistoryFor] = useState<ArtifactRow | null>(null);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<ArtifactRow | null>(null);
  const [editInstruction, setEditInstruction] = useState("");
  const [editing, setEditing] = useState(false);

  const list = useApi<{ artifacts?: ArtifactRow[]; total?: number }>(
    ready && user
      ? () => apiClient.listArtifacts({ limit: 500 }).then((r) => (r.success ? (r.data as any) : null))
      : null,
    { pollMs: 45_000 }
  );

  const rows = useMemo(() => {
    const all = (list.data?.artifacts ?? []).filter((a) => a.type === artifactType);
    const q = query.trim().toLowerCase();
    const filtered = all.filter(
      (a) =>
        (!q || a.title.toLowerCase().includes(q) || (a.prompt ?? "").toLowerCase().includes(q)) &&
        (statusFilter === "all" || a.status === statusFilter)
    );
    return filtered.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "oldest") return a.createdAt - b.createdAt;
      return b.createdAt - a.createdAt;
    });
  }, [list.data, artifactType, query, sort, statusFilter]);

  const download = useCallback(async (row: ArtifactRow) => {
    try {
      const token = JSON.parse(localStorage.getItem("filo_session") || "{}").token;
      const res = await fetch(`/api/artifacts/download?id=${encodeURIComponent(row._id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => null)) as
        | { success: boolean; data?: { url: string; fileName: string }; error?: string; code?: string }
        | null;
      if (!res.ok || !json?.success || !json.data?.url) {
        if (json?.code === "NO_PERSISTED_FILE") {
          toast.error("No stored file", { description: json.error });
          return;
        }
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      // Presigned R2 URL — let the browser download natively.
      const a = document.createElement("a");
      a.href = json.data.url;
      a.download = json.data.fileName || `${row.title}.${(row.format || "docx").toLowerCase()}`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.error("Download failed", {
        description: err instanceof Error ? err.message.slice(0, 140) : "The file could not be retrieved.",
      });
    }
  }, []);

  // ---- Export to another format (spec §42/§43) → downloads as new version ----
  const exportAs = useCallback(
    async (row: ArtifactRow, format: string) => {
      setExporting(`${row._id}:${format}`);
      try {
        const token = JSON.parse(localStorage.getItem("filo_session") || "{}").token;
        const res = await fetch(
          `/api/artifacts/${encodeURIComponent(row._id)}/export?format=${format}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const json = (await res.json().catch(() => null)) as
          | { success: boolean; data?: { filename: string; message: string }; error?: string; code?: string }
          | null;
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        toast.success(`Exported as ${format}`, { description: json.data?.message || "Saved as a new version." });
        await list.refresh();
      } catch (err) {
        toast.error(`Export to ${format} failed`, {
          description: err instanceof Error ? err.message.slice(0, 160) : "Please try again.",
        });
      } finally {
        setExporting(null);
      }
    },
    [list]
  );

  // ---- AI EDIT (spec §26 edit mode): new VERSION of the same artifact ----
  const submitEdit = useCallback(
    async (row: ArtifactRow) => {
      const instruction = editInstruction.trim();
      if (instruction.length < 3) {
        toast.error("Describe the edit you want", { description: "e.g. \"Add a risk analysis section and shorten the summary.\"" });
        return;
      }
      setEditing(true);
      try {
        const res = await apiClient.startGeneration({
          prompt: `Apply this edit to my document "${row.title}": ${instruction}`,
          editInstruction: instruction,
          sourceArtifactId: row._id,
          outputFormat: row.format || undefined,
        });
        if (!res.success) {
          throw new Error((res as any).error || "Could not start the edit");
        }
        toast.success("AI edit started", {
          description: `A new version of "${row.title}" is being generated — watch the progress panel.`,
        });
        setEditFor(null);
        setEditInstruction("");
      } catch (err) {
        toast.error("AI edit failed to start", {
          description: err instanceof Error ? err.message.slice(0, 160) : "Please try again.",
        });
      } finally {
        setEditing(false);
      }
    },
    [editInstruction]
  );

  // ---- Version history (spec §27/§28) ----
  const openHistory = useCallback(async (row: ArtifactRow) => {
    setHistoryFor(row);
    setVersions(null);
    setVersionsLoading(true);
    try {
      const token = JSON.parse(localStorage.getItem("filo_session") || "{}").token;
      const res = await fetch(`/api/artifacts/${encodeURIComponent(row._id)}/versions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => null)) as
        | { success: boolean; data?: { versions: VersionRow[] }; error?: string }
        | null;
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
      setVersions(json.data?.versions ?? []);
    } catch (err) {
      toast.error("Could not load version history", {
        description: err instanceof Error ? err.message.slice(0, 140) : undefined,
      });
      setHistoryFor(null);
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  const restoreVersion = useCallback(
    async (version: number) => {
      if (!historyFor) return;
      setRestoring(version);
      try {
        const token = JSON.parse(localStorage.getItem("filo_session") || "{}").token;
        const res = await fetch(`/api/artifacts/${encodeURIComponent(historyFor._id)}/versions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ version }),
        });
        const json = (await res.json().catch(() => null)) as
          | { success: boolean; data?: { newVersion: number }; error?: string }
          | null;
        if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
        toast.success(`Restored version ${version}`, {
          description: `Saved as version ${json.data?.newVersion} — previous files are kept.`,
        });
        await openHistory(historyFor);
        await list.refresh();
      } catch (err) {
        toast.error("Restore failed", {
          description: err instanceof Error ? err.message.slice(0, 140) : undefined,
        });
      } finally {
        setRestoring(null);
      }
    },
    [historyFor, list, openHistory]
  );

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const res = await apiClient.deleteArtifact(toDelete._id);
      if (!res.success) {
        toast.error(res.error || "Delete failed");
        return;
      }
      toast.success(`"${toDelete.title}" deleted`);
      setToDelete(null);
      await list.refresh();
    } finally {
      setDeleting(false);
    }
  }

  const StatusChip = ({ status }: { status: string }) => (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        status === "completed"
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : status === "error"
            ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
            : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      )}
    >
      {status}
    </span>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button asChild className="press shadow-md shadow-primary/20">
            <Link href={createHref}>
              <typeMeta.icon className="mr-1.5 size-4" /> {createLabel}
            </Link>
          </Button>
        }
      />

      {/* Background generations in flight — live from Convex */}
      <ActiveGenerations onSettled={() => void list.refresh()} />

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title or prompt…"
            className="pl-9"
            aria-label={`Search ${title}`}
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px]" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
            <SelectTrigger className="w-[130px]" aria-label="Sort order">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="title">Title A–Z</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex rounded-lg border">
            <button
              onClick={() => setView("grid")}
              className={cn("rounded-l-lg p-2", view === "grid" ? "bg-accent text-primary" : "text-muted-foreground")}
              aria-label="Grid view"
              aria-pressed={view === "grid"}
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              onClick={() => setView("list")}
              className={cn("rounded-r-lg border-l p-2", view === "list" ? "bg-accent text-primary" : "text-muted-foreground")}
              aria-label="List view"
              aria-pressed={view === "list"}
            >
              <List className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Body states */}
      {list.loading && !list.data ? (
        <SkeletonCards count={6} className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 grid" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.refresh()} />
      ) : rows.length === 0 ? (
        query || statusFilter !== "all" ? (
          <EmptyState
            icon={<Search className="size-5" />}
            title="No matches"
            description="Try a different search term or clear the filters."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                }}
              >
                <RotateCcw className="mr-1.5 size-4" /> Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title={`No ${title.toLowerCase()} yet`}
            description={`Generate your first one with AI — it takes about a minute.`}
            action={
              <Button asChild className="press shadow-lg shadow-primary/25">
                <Link href={createHref}>
                  <Sparkles className="mr-1.5 size-4" /> {createLabel}
                </Link>
              </Button>
            }
          />
        )
      ) : view === "grid" ? (
        <StaggerContainer className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <StaggerItem key={row._id}>
              <div className="lift group flex h-full flex-col rounded-xl border bg-card p-4 shadow-sm hover:border-primary/40">
                <div className="flex items-start justify-between">
                  <span className={cn("inline-flex size-9 items-center justify-center rounded-lg", typeMeta.chip)}>
                    <typeMeta.icon className="size-4.5" />
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
                      {row.format || typeMeta.label}
                    </span>
                    <StatusChip status={row.status} />
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-sm font-medium leading-snug">{row.title}</p>
                {row.prompt ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{row.prompt}</p>
                ) : null}
                <div className="mt-auto flex items-center justify-between pt-4">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" /> {timeAgo(row.createdAt)}
                    {(row.versionCount ?? 1) > 1 ? (
                      <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-medium">v{row.versionCount}</span>
                    ) : null}
                  </span>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Download or export ${row.title}`}
                        >
                          <Download className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>AI actions</DropdownMenuLabel>
                        <DropdownMenuItem
                          disabled={row.status !== "completed"}
                          onClick={() => {
                            setEditInstruction("");
                            setEditFor(row);
                          }}
                        >
                          <Sparkles className="mr-2 size-3.5" /> Edit with AI
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Download</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => void download(row)}>
                          <Download className="mr-2 size-3.5" /> {row.format || "File"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Export as</DropdownMenuLabel>
                        {(EXPORT_FORMATS[row.type] ?? ["PDF"])
                          .filter((f) => f !== row.format)
                          .map((f) => (
                            <DropdownMenuItem
                              key={f}
                              disabled={exporting === `${row._id}:${f}`}
                              onClick={() => void exportAs(row, f)}
                            >
                              {exporting === `${row._id}:${f}` ? (
                                <Loader2 className="mr-2 size-3.5 animate-spin" />
                              ) : (
                                <Share2 className="mr-2 size-3.5" />
                              )}
                              {f}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => void openHistory(row)}
                      aria-label={`Version history for ${row.title}`}
                    >
                      <History className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={() => setToDelete(row)}
                      aria-label={`Delete ${row.title}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="hidden grid-cols-[minmax(0,1fr)_90px_100px_110px_120px] gap-3 border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground sm:grid">
            <span>Title</span>
            <span>Format</span>
            <span>Status</span>
            <span>Created</span>
            <span className="text-right">Actions</span>
          </div>
          {rows.map((row) => (
            <div
              key={row._id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-3 last:border-0 hover:bg-accent/30 sm:grid-cols-[minmax(0,1fr)_90px_100px_110px_120px]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", typeMeta.chip)}>
                  <typeMeta.icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.title}</p>
                  <p className="text-xs text-muted-foreground sm:hidden">
                    {row.format} · {timeAgo(row.createdAt)}
                  </p>
                </div>
              </div>
              <span className="hidden text-xs font-semibold text-muted-foreground sm:block">{row.format}</span>
              <span className="hidden sm:block"><StatusChip status={row.status} /></span>
              <span className="hidden text-xs text-muted-foreground sm:block">{timeAgo(row.createdAt)}</span>
              <div className="flex justify-end gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" aria-label={`Download or export ${row.title}`}>
                      <Download className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel>AI actions</DropdownMenuLabel>
                    <DropdownMenuItem
                      disabled={row.status !== "completed"}
                      onClick={() => {
                        setEditInstruction("");
                        setEditFor(row);
                      }}
                    >
                      <Sparkles className="mr-2 size-3.5" /> Edit with AI
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Download</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => void download(row)}>
                      <Download className="mr-2 size-3.5" /> {row.format || "File"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Export as</DropdownMenuLabel>
                    {(EXPORT_FORMATS[row.type] ?? ["PDF"])
                      .filter((f) => f !== row.format)
                      .map((f) => (
                        <DropdownMenuItem
                          key={f}
                          disabled={exporting === `${row._id}:${f}`}
                          onClick={() => void exportAs(row, f)}
                        >
                          {exporting === `${row._id}:${f}` ? (
                            <Loader2 className="mr-2 size-3.5 animate-spin" />
                          ) : (
                            <Share2 className="mr-2 size-3.5" />
                          )}
                          {f}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => void openHistory(row)}
                  aria-label={`Version history for ${row.title}`}
                >
                  <History className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  onClick={() => setToDelete(row)}
                  aria-label={`Delete ${row.title}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete "${toDelete?.title ?? ""}"?`}
        description="The generated file will be removed from your library and cloud storage. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />

      {/* Version history (spec §27/§28) */}
      <Dialog open={Boolean(historyFor)} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="size-4 text-primary" /> Version history
            </DialogTitle>
            <DialogDescription>
              {historyFor?.title} — every AI edit and export is preserved. Restoring keeps all files.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {versionsLoading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Loading versions…
              </div>
            ) : (versions ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No version history yet — it starts with the first generation.
              </p>
            ) : (
              (versions ?? []).map((v) => (
                <div
                  key={v.version}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">v{v.version}</span>
                      <span className="capitalize text-muted-foreground">{v.operation.replace("_", " ")}</span>
                      <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
                        {v.format}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {v.filename} · {Math.round(v.size / 1024)}KB · {timeAgo(v.createdAt)}
                      {v.qaReport?.score !== undefined ? ` · QA ${v.qaReport.score}/100` : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 px-2.5 text-xs"
                    disabled={restoring === v.version || (historyFor?.versionCount ?? 1) === v.version}
                    onClick={() => void restoreVersion(v.version)}
                  >
                    {restoring === v.version ? (
                      <Loader2 className="mr-1 size-3 animate-spin" />
                    ) : (
                      <RotateCcw className="mr-1 size-3" />
                    )}
                    {(historyFor?.versionCount ?? 1) === v.version ? "Current" : "Restore"}
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* AI edit (edit mode → new version of the same artifact) */}
      <Dialog open={Boolean(editFor)} onOpenChange={(o) => !o && setEditFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> Edit with AI
            </DialogTitle>
            <DialogDescription>
              Describe the change to apply to "{editFor?.title}". The AI preserves everything else and saves the result as a new version in {editFor?.format || "the original format"}.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={editInstruction}
            onChange={(e) => setEditInstruction(e.target.value)}
            placeholder='e.g. "Add an executive summary at the top, update the table to 2026 figures, and make the tone more formal."'
            rows={5}
            className="w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditFor(null)} disabled={editing}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => editFor && void submitEdit(editFor)} disabled={editing || editInstruction.trim().length < 3}>
              {editing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Sparkles className="mr-1.5 size-3.5" />}
              Apply edit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
