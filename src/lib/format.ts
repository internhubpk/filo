// =============================================================================
// FILO formatting helpers (shared client/server, dependency-free)
// =============================================================================

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

export function formatPkr(amount: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(amount)) return "₨0";
  if (opts.compact && amount >= 1000) {
    return `₨${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(amount)}`;
  }
  return `₨${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(amount)}`;
}

export function formatDate(ms: number | string | Date | undefined | null): string {
  if (ms === undefined || ms === null) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(ms: number | string | Date | undefined | null): string {
  if (ms === undefined || ms === null) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(ms: number | undefined | null): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const mins = Math.floor(abs / 60000);
  if (abs < 45000) return future ? "in a moment" : "just now";
  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return future ? `in ${months}mo` : `${months}mo ago`;
  const years = Math.floor(months / 12);
  return future ? `in ${years}y` : `${years}y ago`;
}

export function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en").format(n);
}

export function initials(name: string | undefined | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** File-type → Tailwind color classes for badges/icons. */
export function fileTypeMeta(filename: string, mimeType?: string): { label: string; className: string } {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "docx":
    case "doc":
      return { label: "DOCX", className: "text-blue-600 dark:text-blue-400 bg-blue-500/10" };
    case "pdf":
      return { label: "PDF", className: "text-red-600 dark:text-red-400 bg-red-500/10" };
    case "xlsx":
    case "xls":
    case "csv":
      return { label: ext.toUpperCase(), className: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" };
    case "pptx":
    case "ppt":
      return { label: "PPTX", className: "text-orange-600 dark:text-orange-400 bg-orange-500/10" };
    case "txt":
      return { label: "TXT", className: "text-muted-foreground bg-muted" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return { label: "IMG", className: "text-violet-600 dark:text-violet-400 bg-violet-500/10" };
    default:
      return {
        label: ext ? ext.toUpperCase().slice(0, 4) : (mimeType ?? "FILE").split("/").pop()!.slice(0, 4).toUpperCase(),
        className: "text-muted-foreground bg-muted",
      };
  }
}
