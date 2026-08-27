"use client";

// =============================================================================
// FILES — professional file manager over Cloudflare R2.
// Every row is REAL Convex file metadata (registered on upload); downloads
// use server-generated presigned URLs scoped to the owner. Grid/list views,
// search, sort, type filter, multi-select, bulk delete, drag-and-drop upload
// with per-file results.
// =============================================================================

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Upload,
  Search,
  LayoutGrid,
  List,
  Download,
  Trash2,
  FileUp,
  HardDrive,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useFiloSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { formatBytes, formatDate, fileTypeMeta } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, ConfirmDialog } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StaggerContainer, StaggerItem } from "@/components/animations";

interface FileRow {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  r2Key: string;
  createdAt: number;
  uploaded: boolean;
}

type UploadState = { active: boolean; finished: number; total: number };

export default function FilesPage() {
  const { user, ready } = useFiloSession();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name" | "size">("newest");
  const [typeFilter, setTypeFilter] = useState("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ active: false, finished: 0, total: 0 });
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const files = useApi<{ files?: FileRow[]; total?: number; storageBytes?: number }>(
    ready && user ? () => apiClient.listFiles().then((r) => (r.success ? (r.data as any) : null)) : null,
    { pollMs: 30_000 }
  );

  const rows = useMemo(() => {
    const all = files.data?.files ?? [];
    const q = query.trim().toLowerCase();
    const filtered = all.filter((f) => {
      const meta = fileTypeMeta(f.name, f.mimeType);
      return (
        (!q || f.name.toLowerCase().includes(q)) &&
        (typeFilter === "all" || meta.label.toLowerCase() === typeFilter.toLowerCase())
      );
    });
    return filtered.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "size") return b.size - a.size;
      if (sort === "oldest") return a.createdAt - b.createdAt;
      return b.createdAt - a.createdAt;
    });
  }, [files.data, query, sort, typeFilter]);

  const storageBytes = files.data?.storageBytes ?? 0;

  // ---- Upload (sequential; per-file toasts; honest failure states) ----
  const doUpload = useCallback(
    async (list: FileList | File[]) => {
      const items = Array.from(list);
      if (items.length === 0) return;
      setUpload({ active: true, finished: 0, total: items.length });
      let ok = 0;
      let failed = 0;
      for (const f of items) {
        const res = await apiClient.uploadFile(f);
        if (res.success) ok++;
        else failed++;
        setUpload((u) => ({ ...u, finished: u.finished + 1 }));
      }
      setUpload({ active: false, finished: 0, total: 0 });
      if (ok > 0) {
        toast.success(`${ok} file${ok > 1 ? "s" : ""} uploaded`);
        await files.refresh();
      }
      if (failed > 0) toast.error(`${failed} upload${failed > 1 ? "s" : ""} failed`);
    },
     
    []
  );

  const downloadOne = useCallback(async (row: FileRow) => {
    try {
      const token = JSON.parse(localStorage.getItem("filo_session") || "{}").token;
      const res = await fetch("/api/files/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "download", existingKey: row.r2Key, filename: row.name, contentType: row.mimeType }),
      });
      const json = (await res.json().catch(() => null)) as { success: boolean; url?: string; signedUrl?: string; error?: string } | null;
      const url = json?.url ?? json?.signedUrl;
      if (!res.ok || !url) throw new Error(json?.error || `HTTP ${res.status}`);
      const a = document.createElement("a");
      a.href = url;
      a.download = row.name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.error("Download failed", { description: err instanceof Error ? err.message.slice(0, 120) : undefined });
    }
  }, []);

  const deleteOne = useCallback(
    async (row: FileRow) => {
      const token = JSON.parse(localStorage.getItem("filo_session") || "{}").token;
      const res = await fetch(`/api/files/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => null)) as { success: boolean; error?: string } | null;
      if (!res.ok || !json?.success) {
        toast.error(json?.error || "Delete failed");
        return false;
      }
      return true;
    },
    []
  );

  async function bulkDelete() {
    setDeleting(true);
    try {
      const targets = rows.filter((r) => selected.has(r.id));
      let ok = 0;
      for (const t of targets) {
        if (await deleteOne(t)) ok++;
      }
      toast.success(`${ok} file${ok === 1 ? "" : "s"} deleted`);
      setSelected(new Set());
      setBulkConfirm(false);
      await files.refresh();
    } finally {
      setDeleting(false);
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!ready) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void doUpload(e.target.files);
          e.target.value = "";
        }}
      />

      <PageHeader
        title="Files"
        description="Your uploads and generated artifacts — stored in encrypted cloud storage."
        actions={
          <Button onClick={() => inputRef.current?.click()} disabled={upload.active}>
            <Upload className="mr-1.5 size-4" /> Upload
          </Button>
        }
      />

      {/* Storage summary + upload progress */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <HardDrive className="size-4.5" />
          </span>
          <div>
            <p className="text-sm font-medium">{formatBytes(storageBytes)} stored</p>
            <p className="text-xs text-muted-foreground">
              {files.data?.total ?? 0} file{(files.data?.total ?? 0) === 1 ? "" : "s"} · plan limits apply
            </p>
          </div>
        </div>
        {upload.active && (
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <p className="mb-1 text-xs text-muted-foreground">
              Uploading… {upload.finished}/{upload.total}
            </p>
            <Progress value={(upload.finished / Math.max(1, upload.total)) * 100} className="h-1.5" />
          </div>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) void doUpload(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center transition-colors",
          dragOver ? "border-primary/60 bg-primary/5" : "hover:border-primary/40 hover:bg-accent/30"
        )}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        aria-label="Upload files"
      >
        <FileUp className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">Drag files here or click to upload</p>
        <p className="text-xs text-muted-foreground">Documents, spreadsheets, presentations and images · up to 10MB each</p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files…" className="pl-9" aria-label="Search files" />
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setBulkConfirm(true)}>
              <Trash2 className="mr-1.5 size-3.5" /> Delete ({selected.size})
            </Button>
          )}
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[120px]" aria-label="Filter by type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="docx">DOCX</SelectItem>
              <SelectItem value="pdf">PDF</SelectItem>
              <SelectItem value="xlsx">XLSX</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="pptx">PPTX</SelectItem>
              <SelectItem value="img">Images</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
            <SelectTrigger className="w-[130px]" aria-label="Sort order">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="name">Name A–Z</SelectItem>
              <SelectItem value="size">Largest first</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex rounded-lg border">
            <button
              onClick={() => setView("grid")}
              className={cn("rounded-l-lg p-2", view === "grid" ? "bg-accent text-primary" : "text-muted-foreground")}
              aria-label="Grid view"
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              onClick={() => setView("list")}
              className={cn("rounded-r-lg border-l p-2", view === "list" ? "bg-accent text-primary" : "text-muted-foreground")}
              aria-label="List view"
            >
              <List className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      {files.loading && !files.data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-32 rounded-xl border bg-card" />
          ))}
        </div>
      ) : files.error ? (
        <ErrorState message={files.error} onRetry={() => void files.refresh()} />
      ) : rows.length === 0 ? (
        query || typeFilter !== "all" ? (
          <EmptyState
            icon={<Search className="size-5" />}
            title="No matches"
            description="Try a different search or clear the filters."
            action={
              <Button variant="outline" onClick={() => { setQuery(""); setTypeFilter("all"); }}>
                <RotateCcw className="mr-1.5 size-4" /> Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title="No files yet"
            description="Upload context files for AI generation, or generate your first document."
            action={
              <Button asChild>
                <Link href="/create">
                  <Sparkles className="mr-1.5 size-4" /> Create a document
                </Link>
              </Button>
            }
          />
        )
      ) : view === "grid" ? (
        <StaggerContainer className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((row) => {
            const meta = fileTypeMeta(row.name, row.mimeType);
            const isSelected = selected.has(row.id);
            return (
              <StaggerItem key={row.id}>
                <div
                  className={cn(
                    "group relative flex h-full flex-col rounded-xl border bg-card p-4 transition-colors",
                    isSelected ? "border-primary/60 bg-primary/5" : "hover:border-primary/40"
                  )}
                >
                  <button
                    onClick={() => toggleSelect(row.id)}
                    className={cn(
                      "absolute left-3 top-3 size-4.5 rounded border transition-colors",
                      isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 bg-background"
                    )}
                    aria-label={isSelected ? `Deselect ${row.name}` : `Select ${row.name}`}
                  >
                    {isSelected && (
                      <svg viewBox="0 0 10 8" className="mx-auto size-2.5 fill-none stroke-current stroke-[1.6]">
                        <path d="M1 4l2.5 2.5L9 1" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                  <div className="flex justify-center py-3">
                    <span className={cn("inline-flex size-11 items-center justify-center rounded-xl text-xs font-bold", meta.className)}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="truncate text-center text-sm font-medium" title={row.name}>{row.name}</p>
                  <p className="mt-0.5 text-center text-xs text-muted-foreground">{formatBytes(row.size)}</p>
                  <p className="mt-0.5 text-center text-[11px] text-muted-foreground">{formatDate(row.createdAt)}</p>
                  <div className="mt-3 flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => void downloadOne(row)} aria-label={`Download ${row.name}`}>
                      <Download className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={async () => {
                        if (await deleteOne(row)) {
                          toast.success("File deleted");
                          await files.refresh();
                        }
                      }}
                      aria-label={`Delete ${row.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </StaggerItem>
            );
          })}
        </StaggerContainer>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="hidden grid-cols-[auto_minmax(0,1fr)_90px_90px_110px_120px] gap-3 border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground sm:grid">
            <span className="w-4" />
            <span>Name</span>
            <span>Type</span>
            <span>Size</span>
            <span>Uploaded</span>
            <span className="text-right">Actions</span>
          </div>
          {rows.map((row) => {
            const meta = fileTypeMeta(row.name, row.mimeType);
            return (
              <div key={row.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-2.5 last:border-0 hover:bg-accent/30 sm:grid-cols-[auto_minmax(0,1fr)_90px_90px_110px_120px]">
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={() => toggleSelect(row.id)}
                  className="size-4 accent-[var(--primary)]"
                  aria-label={`Select ${row.name}`}
                />
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={cn("inline-flex h-7 shrink-0 items-center justify-center rounded-md px-1.5 text-[10px] font-bold", meta.className)}>
                    {meta.label}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground sm:hidden">
                      {formatBytes(row.size)} · {formatDate(row.createdAt)}
                    </p>
                  </div>
                </div>
                <span className="hidden text-xs text-muted-foreground sm:block">{formatBytes(row.size)}</span>
                <span className="hidden text-xs text-muted-foreground sm:block">{meta.label}</span>
                <span className="hidden text-xs text-muted-foreground sm:block">{formatDate(row.createdAt)}</span>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => void downloadOne(row)} aria-label={`Download ${row.name}`}>
                    <Download className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    onClick={async () => {
                      if (await deleteOne(row)) {
                        toast.success("File deleted");
                        await files.refresh();
                      }
                    }}
                    aria-label={`Delete ${row.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={bulkConfirm}
        onOpenChange={setBulkConfirm}
        title={`Delete ${selected.size} file${selected.size === 1 ? "" : "s"}?`}
        description="Files will be removed from cloud storage. This cannot be undone."
        confirmLabel="Delete files"
        destructive
        loading={deleting}
        onConfirm={() => void bulkDelete()}
      />
    </div>
  );
}
