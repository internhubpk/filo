"use client";

// =============================================================================
// ArtifactsWorkspace — the unified artifacts window.
// =============================================================================
// Every generated artifact across ALL types (documents, spreadsheets,
// presentations, pdf exports) in one professional view:
//   • Filters: search, type chips, status, sort
//   • Grid / list views
//   • Multi-select (checkboxes + select-all) with a floating bulk bar
//   • Bulk actions: Delete (ownership-checked server-side), Export as ZIP
//   • Per-item actions: download, export to other formats, AI edit, history
//
// Used on the Dashboard as the artifacts window (variant="dashboard") and as
// the full Library page. All data is REAL Convex-backed state.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
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
  FolderArchive,
  X,
  CheckSquare,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { timeAgo, formatNumber } from "@/lib/format";
import { EmptyState, ErrorState, SkeletonCards, ConfirmDialog, ActiveGenerations } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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

// ---- Type metadata (mirrors the libraries' chips) ----
const TYPE_META: Record<string, DocumentTypeMeta> = {
  document: { icon: FileText, label: "DOCX", chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  spreadsheet: { icon: FileSpreadsheet, label: "XLSX", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  presentation: { icon: Presentation, label: "PPTX", chip: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  pdf: { icon: FileText, label: "PDF", chip: "bg-red-500/10 text-red-600 dark:text-red-400" },
};

function metaFor(type: string): DocumentTypeMeta {
  return TYPE_META[type] ?? TYPE_META.document;
}

// Format-aware export options per artifact type — only genuinely renderable
// conversions are exposed, never irrelevant ones.
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
  format: string;
  filename: string;
  size: number;
  qaReport?: { score?: number };
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

const TYPE_FILTERS = [
  { id: "all", label: "All" },
  { id: "document", label: "Documents" },
  { id: "spreadsheet", label: "Spreadsheets" },
  { id: "presentation", label: "Presentations" },
] as const;

// Quick-edit actions for the AI edit dialog — one tap fills the instruction.
const QUICK_EDIT_ACTIONS = [
  { label: "Rewrite", prompt: "Rewrite the content for clarity and impact while keeping the structure." },
  { label: "Improve", prompt: "Improve the overall quality: tighter wording, better flow, stronger headings." },
  { label: "Redesign", prompt: "Redesign the visual layout — better theme, spacing and component variety." },
  { label: "Summarize", prompt: "Summarize the material into a shorter, executive-level version." },
  { label: "Expand", prompt: "Expand each section with more depth, examples and supporting detail." },
  { label: "Convert", prompt: "Restructure this content for a different audience and use case." },
  { label: "Fix grammar", prompt: "Fix grammar, spelling and punctuation throughout without changing meaning." },
  { label: "Analyze", prompt: "Add an analytical section with key findings and recommendations." },
] as const;

export function ArtifactsWorkspace({
  title = "Artifacts",
  description = "Everything you've generated — filter, select and manage your files.",
  variant = "page",
  pageSize = 24,
  initialType = "all",
}: {
  title?: string;
  description?: string;
  /** "dashboard" = tighter vertical rhythm inside the dashboard; "page" = standalone. */
  variant?: "dashboard" | "page";
  pageSize?: number;
  /** Pre-selected type filter ("all" | "document" | "spreadsheet" | "presentation"). */
  initialType?: string;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(initialType);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "title">("newest");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [visible, setVisible] = useState(pageSize);

  // ---- Selection state ----
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [zipping, setZipping] = useState(false);

  // ---- Per-item dialog state ----
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
    () => apiClient.listArtifacts({ limit: 500 }).then((r) => (r.success ? (r.data as any) : null)),
    { pollMs: 45_000 }
  );

  const all = useMemo(() => list.data?.artifacts ?? [], [list.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = all.filter((a) => {
      const t = String(a.type || "").toLowerCase();
      return (
        (!q || a.title.toLowerCase().includes(q) || (a.prompt ?? "").toLowerCase().includes(q)) &&
        (typeFilter === "all" || t === typeFilter) &&
        (statusFilter === "all" || a.status === statusFilter)
      );
    });
    return rows.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "oldest") return a.createdAt - b.createdAt;
      return b.createdAt - a.createdAt;
    });
  }, [all, query, typeFilter, statusFilter, sort]);

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { all: all.length, document: 0, spreadsheet: 0, presentation: 0 };
    for (const a of all) {
      const t = String(a.type || "").toLowerCase();
      if (t in c) c[t] += 1;
    }
    return c;
  }, [all]);

  // Selection only makes sense for visible, exportable rows.
  const selectedRows = useMemo(
    () => filtered.filter((r) => selected.has(r._id)),
    [filtered, selected]
  );

  // Drop stale selection entries when data refreshes (deleted items etc).
  useEffect(() => {
    if (selected.size === 0) return;
    const live = new Set(all.map((a) => a._id));
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [all, selected.size]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r._id));
  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (filtered.length > 0 && filtered.every((r) => prev.has(r._id))) {
        for (const r of filtered) prev.delete(r._id);
        return new Set(prev);
      }
      return new Set(filtered.map((r) => r._id));
    });
  }, [filtered]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // ---- Per-item + bulk actions ----
  const download = useCallback(async (row: ArtifactRow) => {
    try {
      const res = await fetch(`/api/artifacts/download?id=${encodeURIComponent(row._id)}`, {
        headers: apiClient.getAuthHeaders(),
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

  const exportAs = useCallback(
    async (row: ArtifactRow, format: string) => {
      setExporting(`${row._id}:${format}`);
      try {
        const res = await fetch(
          `/api/artifacts/${encodeURIComponent(row._id)}/export?format=${format}`,
          { headers: apiClient.getAuthHeaders() }
        );
        const json = (await res.json().catch(() => null)) as
          | { success: boolean; data?: { message: string }; error?: string }
          | null;
        if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
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

  const submitEdit = useCallback(
    async (row: ArtifactRow) => {
      const instruction = editInstruction.trim();
      if (instruction.length < 3) return;
      setEditing(true);
      try {
        const res = await apiClient.startGeneration({
          prompt: `Apply this edit to my document "${row.title}": ${instruction}`,
          editInstruction: instruction,
          sourceArtifactId: row._id,
          outputFormat: row.format || undefined,
        });
        if (!res.success) throw new Error((res as any).error || "Could not start the edit");
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

  const openHistory = useCallback(async (row: ArtifactRow) => {
    setHistoryFor(row);
    setVersions(null);
    setVersionsLoading(true);
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(row._id)}/versions`, {
        headers: apiClient.getAuthHeaders(),
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
        const res = await fetch(`/api/artifacts/${encodeURIComponent(historyFor._id)}/versions`, {
          method: "POST",
          headers: { ...apiClient.getAuthHeaders(), "Content-Type": "application/json" },
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

  const bulkDelete = useCallback(async () => {
    if (selectedRows.length === 0) return;
    setBulkDeleting(true);
    try {
      const res = await apiClient.bulkDeleteArtifacts(selectedRows.map((r) => r._id));
      if (!res.success || !res.data) {
        toast.error(res.error || "Bulk delete failed");
        return;
      }
      const { deletedCount, failed } = res.data;
      if (failed.length === 0) {
        toast.success(`${deletedCount} artifact${deletedCount === 1 ? "" : "s"} deleted`);
      } else {
        toast.warning(`${deletedCount} deleted, ${failed.length} failed`, {
          description: failed.slice(0, 3).map((f) => f.error).join(" · "),
        });
      }
      clearSelection();
      setBulkDeleteOpen(false);
      await list.refresh();
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedRows, clearSelection, list]);

  const exportZip = useCallback(async () => {
    if (selectedRows.length === 0) return;
    setZipping(true);
    try {
      const result = await apiClient.exportArtifactsZip(selectedRows.map((r) => r._id));
      if (!result.ok || !result.blob) {
        toast.error("ZIP export failed", { description: result.error });
        return;
      }
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName || "filo-export.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`ZIP with ${selectedRows.length} file${selectedRows.length === 1 ? "" : "s"} downloaded`);
    } finally {
      setZipping(false);
    }
  }, [selectedRows]);

  const hasFilters = query.trim() !== "" || typeFilter !== "all" || statusFilter !== "all";
  const rows = filtered.slice(0, visible);

  const StatusChip = ({ status }: { status: string }) => (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
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
    <section className={cn(variant === "page" ? "space-y-6" : "space-y-4")} aria-label={title}>
      {/* ---------- Header ---------- */}
      {variant === "page" ? (
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {formatNumber(all.length)} artifact{all.length === 1 ? "" : "s"} · search, filter, select and export
            </p>
          </div>
          <Link
            href="/documents"
            className="hidden shrink-0 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline sm:flex"
          >
            Open library
          </Link>
        </div>
      )}

      {variant === "page" ? <ActiveGenerations onSettled={() => void list.refresh()} /> : null}

      {/* ---------- Toolbar: search + filters + view ---------- */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisible(pageSize);
              }}
              placeholder="Search by title or prompt…"
              className="pl-9 pr-8"
              aria-label={`Search ${title}`}
            />
            {query ? (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setVisible(pageSize);
              }}
            >
              <SelectTrigger className="w-[128px]" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger className="w-[128px]" aria-label="Sort order">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="title">Title A–Z</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex overflow-hidden rounded-lg border" role="group" aria-label="View mode">
              <button
                onClick={() => setView("grid")}
                className={cn("flex h-9 w-9 items-center justify-center", view === "grid" ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground")}
                aria-label="Grid view"
                aria-pressed={view === "grid"}
              >
                <LayoutGrid className="size-4" />
              </button>
              <button
                onClick={() => setView("list")}
                className={cn("flex h-9 w-9 items-center justify-center border-l", view === "list" ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground")}
                aria-label="List view"
                aria-pressed={view === "list"}
              >
                <List className="size-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Type chips + select-all */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setTypeFilter(f.id);
                  setVisible(pageSize);
                }}
                aria-pressed={typeFilter === f.id}
                className={cn(
                  "inline-flex min-h-[30px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                  typeFilter === f.id
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {f.label}
                <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", typeFilter === f.id ? "bg-primary/20" : "bg-muted")}>
                  {typeCounts[f.id] ?? 0}
                </span>
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {filtered.length > 0 ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={() => toggleSelectAll()}
                  aria-label="Select all filtered artifacts"
                />
                Select all
              </label>
            ) : null}
            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs text-muted-foreground"
                onClick={() => {
                  setQuery("");
                  setTypeFilter("all");
                  setStatusFilter("all");
                  setVisible(pageSize);
                }}
              >
                <RotateCcw className="size-3" /> Clear
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---------- Bulk action bar ---------- */}
      {selected.size > 0 ? (
        <div
          className="sticky top-[60px] z-10 flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-2.5 shadow-sm backdrop-blur"
          role="toolbar"
          aria-label="Bulk actions"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <CheckSquare className="size-4 text-primary" />
            {selected.size} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={zipping || bulkDeleting}
              onClick={() => void exportZip()}
            >
              {zipping ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <FolderArchive className="mr-1.5 size-3.5" />}
              Export ZIP
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-8"
              disabled={zipping || bulkDeleting}
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="mr-1.5 size-3.5" /> Delete
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={clearSelection}>
              <X className="mr-1 size-3.5" /> Clear
            </Button>
          </div>
        </div>
      ) : null}

      {/* ---------- Body states ---------- */}
      {list.loading && !list.data ? (
        <SkeletonCards count={6} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.refresh()} />
      ) : filtered.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Search className="size-5" />}
            title="No matches"
            description="Try a different search term or clear the filters."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setTypeFilter("all");
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
            title="No artifacts yet"
            description="Describe what you need and Filo will build it — a report, a budget model, a deck."
            action={
              <Button asChild className="press shadow-lg shadow-primary/25">
                <Link href="/chat">
                  <Sparkles className="mr-1.5 size-4" /> Start with Filo Chat
                </Link>
              </Button>
            }
          />
        )
      ) : view === "grid" ? (
        <StaggerContainer className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => {
            const meta = metaFor(row.type);
            const isSelected = selected.has(row._id);
            return (
              <StaggerItem key={row._id}>
                <div
                  className={cn(
                    "lift group relative flex h-full flex-col rounded-xl border bg-card p-4 shadow-sm transition-colors",
                    isSelected ? "border-primary/60 ring-1 ring-primary/30" : "hover:border-primary/40"
                  )}
                  data-selected={isSelected || undefined}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(row._id)}
                        aria-label={`Select ${row.title}`}
                        className="mt-0.5 data-[state=checked]:border-primary"
                      />
                      <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg", meta.chip)}>
                        <meta.icon className="size-4" />
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
                        {row.format || meta.label}
                      </span>
                      <StatusChip status={row.status} />
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm font-medium leading-snug">{row.title}</p>
                  {row.prompt ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{row.prompt}</p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between pt-4">
                    <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="size-3 shrink-0" /> {timeAgo(row.createdAt)}
                      {(row.versionCount ?? 1) > 1 ? (
                        <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-medium">v{row.versionCount}</span>
                      ) : null}
                    </span>
                    <div className="flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <ItemActions
                        row={row}
                        exporting={exporting}
                        onDownload={download}
                        onExport={exportAs}
                        onEdit={(r) => {
                          setEditInstruction("");
                          setEditFor(r);
                        }}
                        onHistory={openHistory}
                        onDelete={setToDelete}
                      />
                    </div>
                  </div>
                </div>
              </StaggerItem>
            );
          })}
        </StaggerContainer>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="hidden grid-cols-[36px_minmax(0,1fr)_90px_100px_110px_130px] gap-3 border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground sm:grid">
            <span className="flex items-center">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={() => toggleSelectAll()}
                aria-label="Select all"
              />
            </span>
            <span>Title</span>
            <span>Format</span>
            <span>Status</span>
            <span>Created</span>
            <span className="text-right">Actions</span>
          </div>
          {rows.map((row) => {
            const meta = metaFor(row.type);
            const isSelected = selected.has(row._id);
            return (
              <div
                key={row._id}
                className={cn(
                  "grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-3 last:border-0 sm:grid-cols-[36px_minmax(0,1fr)_90px_100px_110px_130px]",
                  isSelected ? "bg-primary/5" : "hover:bg-accent/30"
                )}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleSelect(row._id)}
                  aria-label={`Select ${row.title}`}
                />
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", meta.chip)}>
                    <meta.icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.title}</p>
                    <p className="truncate text-xs text-muted-foreground sm:hidden">
                      {row.format} · {timeAgo(row.createdAt)}
                    </p>
                  </div>
                </div>
                <span className="hidden text-xs font-semibold text-muted-foreground sm:block">{row.format}</span>
                <span className="hidden sm:block"><StatusChip status={row.status} /></span>
                <span className="hidden text-xs text-muted-foreground sm:block">{timeAgo(row.createdAt)}</span>
                <div className="flex justify-end gap-1">
                  <ItemActions
                    row={row}
                    exporting={exporting}
                    onDownload={download}
                    onExport={exportAs}
                    onEdit={(r) => {
                      setEditInstruction("");
                      setEditFor(r);
                    }}
                    onHistory={openHistory}
                    onDelete={setToDelete}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- Load more ---------- */}
      {filtered.length > visible ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + pageSize * 2)}>
            Show more ({formatNumber(filtered.length - visible)} remaining)
          </Button>
        </div>
      ) : null}

      {/* ---------- Dialogs ---------- */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(o) => !o && setBulkDeleteOpen(false)}
        title={`Delete ${selected.size} artifact${selected.size === 1 ? "" : "s"}?`}
        description="The generated files will be removed from your library and cloud storage. This cannot be undone."
        confirmLabel={`Delete ${selected.size}`}
        destructive
        loading={bulkDeleting}
        onConfirm={() => void bulkDelete()}
      />

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
                <div key={v.version} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
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

      <Dialog open={Boolean(editFor)} onOpenChange={(o) => !o && setEditFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> Edit with AI
            </DialogTitle>
            <DialogDescription>
              Describe the change to apply to &quot;{editFor?.title}&quot;. The AI preserves everything else and saves the result as a
              new version in {editFor?.format || "the original format"}.
            </DialogDescription>
          </DialogHeader>
          {/* Quick-edit actions — one tap fills the instruction */}
          <div className="flex flex-wrap gap-1.5" aria-label="Quick edit actions">
            {QUICK_EDIT_ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => setEditInstruction(a.prompt)}
                className="rounded-full border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
              >
                {a.label}
              </button>
            ))}
          </div>
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
            <Button
              size="sm"
              onClick={() => editFor && void submitEdit(editFor)}
              disabled={editing || editInstruction.trim().length < 3}
            >
              {editing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Sparkles className="mr-1.5 size-3.5" />}
              Apply edit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// =============================================================================
// ItemActions — download / export / AI edit / history / delete for one row
// =============================================================================
function ItemActions({
  row,
  exporting,
  onDownload,
  onExport,
  onEdit,
  onHistory,
  onDelete,
}: {
  row: ArtifactRow;
  exporting: string | null;
  onDownload: (row: ArtifactRow) => void | Promise<void>;
  onExport: (row: ArtifactRow, format: string) => void | Promise<void>;
  onEdit: (row: ArtifactRow) => void;
  onHistory: (row: ArtifactRow) => void | Promise<void>;
  onDelete: (row: ArtifactRow) => void;
}) {
  const meta = metaFor(row.type);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Download or export ${row.title}`}>
            <Download className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>AI actions</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={row.status !== "completed"}
            onClick={() => onEdit(row)}
          >
            <Sparkles className="mr-2 size-3.5" /> Edit with AI
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Download</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => void onDownload(row)}>
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
                onClick={() => void onExport(row, f)}
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
        onClick={() => void onHistory(row)}
        aria-label={`Version history for ${row.title}`}
      >
        <History className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-destructive hover:text-destructive"
        onClick={() => onDelete(row)}
        aria-label={`Delete ${row.title}`}
      >
        <Trash2 className="size-3.5" />
      </Button>
      <span className="hidden">{meta.label}</span>
    </>
  );
}
