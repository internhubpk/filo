"use client";

// =============================================================================
// ADMIN WEBHOOK MONITOR — Safepay event ledger: processing status, retries,
// errors, sanitized payloads. Makes debugging the billing integration easy
// without exposing secrets (payloads are redacted at ingest time).
// =============================================================================

import { useMemo, useState } from "react";
import { Webhook } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { formatDateTime } from "@/lib/format";
import { WEBHOOK_STATUS } from "@/lib/billing-shared";
import { AdminPageHeader, AdminTable, FilterChip } from "@/components/admin/admin-ui";
import { StatusBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FILTERS = ["all", "success", "failed", "retrying", "ignored", "duplicate"] as const;

export default function AdminWebhooksPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [viewPayload, setViewPayload] = useState<Record<string, unknown> | null>(null);
  const [query, setQuery] = useState("");

  const events = useApi<any[]>(
    () => apiClient.adminWebhookEvents(filter === "all" ? undefined : filter).then((r) => (r.success ? (r.data as unknown as any[]) : null)),
    { pollMs: 10_000, deps: [filter] } // live-ish monitor — webhooks arrive in near real time
  );

  const rows = useMemo(() => {
    const all = events.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (ev) =>
        String(ev.eventId ?? "").toLowerCase().includes(q) ||
        String(ev.eventType ?? "").toLowerCase().includes(q) ||
        String(ev.error ?? "").toLowerCase().includes(q)
    );
  }, [events.data, query]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AdminPageHeader title="Webhook monitor" description="Safepay deliveries processed by /api/webhooks/safepay — auto-refreshing every 10s." />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <FilterChip
            key={f}
            label={f === "all" ? "All" : WEBHOOK_STATUS[f as keyof typeof WEBHOOK_STATUS]?.label ?? f}
            active={filter === f}
            onClick={() => setFilter(f)}
          />
        ))}
      </div>

      <AdminTable
        columns={["Event", "Type", "Status", "Retries", "Received", "Processed", "Payload"]}
        loading={events.loading && !events.data}
        error={events.error}
        onRetry={() => void events.refresh()}
        rowsCount={rows.length}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search event id, type or error…"
        emptyTitle={filter !== "all" || query ? "No webhook events match" : "No webhook events yet"}
        emptyDescription={
          filter !== "all" || query
            ? "Try a different status filter or clear the search."
            : "Safepay deliveries are recorded here as they arrive."
        }
      >
        {rows.map((ev) => (
          <tr key={ev._id} className="border-b align-middle last:border-0 hover:bg-accent/30">
            <td className="max-w-40 truncate px-4 py-3 font-mono text-xs" title={ev.eventId}>{ev.eventId}</td>
            <td className="px-4 py-3 font-mono text-xs">{ev.eventType}</td>
            <td className="px-4 py-3"><StatusBadge kind="webhook" status={String(ev.processingStatus)} /></td>
            <td className="px-4 py-3 text-center text-sm tabular-nums">{ev.retryCount ?? 0}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(ev.receivedAt)}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{ev.processedAt ? formatDateTime(ev.processedAt) : "—"}</td>
            <td className="px-4 py-3">
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setViewPayload(ev.payload ?? {})}>
                  <Webhook className="mr-1.5 size-3.5" /> Inspect
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>

      {/* Error detail inline for failed rows */}
      {rows.some((r) => r.processingStatus === "failed" && r.error) && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">Recent processing errors</p>
          <ul className="mt-2 space-y-1.5">
            {rows
              .filter((r) => r.processingStatus === "failed" && r.error)
              .slice(0, 5)
              .map((r) => (
                <li key={r._id} className="truncate font-mono text-xs text-muted-foreground" title={r.error}>
                  {r.eventType} · {r.error}
                </li>
              ))}
          </ul>
        </div>
      )}

      <Dialog open={Boolean(viewPayload)} onOpenChange={(o) => !o && setViewPayload(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Sanitized webhook payload</DialogTitle>
            <DialogDescription>
              Secret-like fields are redacted before storage. This is the exact event data used for processing.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[50vh] overflow-auto rounded-lg border bg-muted/50 p-4 text-xs leading-relaxed">
            {JSON.stringify(viewPayload, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
