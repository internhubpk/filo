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
import { StaggerContainer, StaggerItem } from "@/components/animations";
import type { DocumentTypeMeta } from "@/components/generation/artifact-type";

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
          <Button asChild>
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
              <Button asChild>
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
              <div className="group flex h-full flex-col rounded-xl border bg-card p-4 transition-colors hover:border-primary/40">
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
                  </span>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => void download(row)} aria-label={`Download ${row.title}`}>
                      <Download className="size-3.5" />
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
                <Button variant="ghost" size="icon" className="size-8" onClick={() => void download(row)} aria-label={`Download ${row.title}`}>
                  <Download className="size-4" />
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
    </div>
  );
}
