"use client";

// =============================================================================
// ADMIN AUDIT LOG — who did what, when. Auth, role changes, billing events,
// admin actions, artifact/file deletions, subscription transitions.
// =============================================================================

import { useMemo, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { formatDateTime } from "@/lib/format";
import { AdminPageHeader, AdminTable, FilterChip } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";

const ACTION_FILTERS = [
  { id: "all", label: "All" },
  { id: "subscription.", label: "Subscriptions" },
  { id: "payment.", label: "Payments" },
  { id: "billing.", label: "Billing ops" },
  { id: "user.role", label: "Role changes" },
  { id: "user.profile", label: "Profile" },
  { id: "user.password", label: "Password" },
  { id: "plan.", label: "Plans" },
  { id: "artifact.", label: "Artifacts" },
] as const;

function actorBadge(type: string) {
  switch (type) {
    case "admin":
      return <Badge className="bg-primary/10 text-primary">admin</Badge>;
    case "webhook":
      return <Badge variant="outline" className="gap-1"><span className="size-1.5 rounded-full bg-sky-500" /> webhook</Badge>;
    case "system":
      return <Badge variant="outline">system</Badge>;
    default:
      return <Badge variant="outline">user</Badge>;
  }
}

export default function AdminAuditPage() {
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const logs = useApi<any[]>(
    () => apiClient.adminAuditLogs(filter === "all" ? undefined : filter).then((r) => (r.success ? (r.data as unknown as any[]) : null)),
    { pollMs: 20_000, deps: [filter] }
  );

  const rows = useMemo(() => {
    const all = logs.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (log) =>
        String(log.action ?? "").toLowerCase().includes(q) ||
        String(log.actorEmail ?? "").toLowerCase().includes(q) ||
        String(log.actorId ?? "").toLowerCase().includes(q) ||
        String(log.targetType ?? "").toLowerCase().includes(q)
    );
  }, [logs.data, query]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AdminPageHeader title="Audit log" description="Security-relevant events with actor, target, and metadata." />

      <div className="flex flex-wrap gap-2">
        {ACTION_FILTERS.map((f) => (
          <FilterChip key={f.id} label={f.label} active={filter === f.id} onClick={() => setFilter(f.id)} />
        ))}
      </div>

      <AdminTable
        columns={["Time", "Actor", "Action", "Target", "Metadata"]}
        loading={logs.loading && !logs.data}
        error={logs.error}
        onRetry={() => void logs.refresh()}
        rowsCount={rows.length}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search action, actor or target…"
        emptyTitle={filter !== "all" || query ? "No audit entries match" : "Audit log is empty"}
        emptyDescription={
          filter !== "all" || query
            ? "Try a different action filter or clear the search."
            : "Security-relevant events are recorded here as the platform is used."
        }
      >
        {rows.map((log) => (
          <tr key={log._id} className="border-b last:border-0 hover:bg-accent/30">
            <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                {actorBadge(log.actorType ?? "user")}
                <span className="max-w-40 truncate text-xs text-muted-foreground" title={log.actorEmail ?? ""}>
                  {log.actorEmail ?? log.actorId ?? "system"}
                </span>
              </div>
            </td>
            <td className="px-4 py-3 font-mono text-xs">{log.action}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {log.targetType ? `${log.targetType}:${String(log.targetId ?? "").slice(0, 12)}…` : "—"}
            </td>
            <td className="max-w-52 px-4 py-3">
              {log.metadata ? (
                <span className="block truncate font-mono text-[11px] text-muted-foreground" title={JSON.stringify(log.metadata)}>
                  {JSON.stringify(log.metadata)}
                </span>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
