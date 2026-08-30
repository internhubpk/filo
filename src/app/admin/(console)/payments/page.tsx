"use client";

// =============================================================================
// ADMIN PAYMENTS — real Safepay payment records with status filters.
// =============================================================================

import { useMemo, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { formatDateTime, formatPkr } from "@/lib/format";
import { PAYMENT_STATUS } from "@/lib/billing-shared";
import { AdminPageHeader, AdminTable, FilterChip } from "@/components/admin/admin-ui";
import { StatusBadge } from "@/components/shared";

const FILTERS = [
  "all",
  "succeeded",
  "pending",
  "failed",
  "refunded",
  "disputed",
  "dispute_won",
  "dispute_lost",
] as const;

export default function AdminPaymentsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [query, setQuery] = useState("");
  const payments = useApi<any[]>(
    () => apiClient.adminPayments(filter === "all" ? undefined : filter).then((r) => (r.success ? (r.data as unknown as any[]) : null)),
    { pollMs: 15_000, deps: [filter] }
  );

  const rows = useMemo(() => {
    const all = payments.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (p) =>
        String(p.userName ?? "").toLowerCase().includes(q) ||
        String(p.userEmail ?? "").toLowerCase().includes(q) ||
        String(p.safepayTrackingId ?? "").toLowerCase().includes(q) ||
        String(p.safepayPaymentToken ?? "").toLowerCase().includes(q)
    );
  }, [payments.data, query]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AdminPageHeader title="Payments" description="Every Safepay transaction recorded through verified webhook events." />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <FilterChip
            key={f}
            label={f === "all" ? "All" : PAYMENT_STATUS[f as keyof typeof PAYMENT_STATUS]?.label ?? f}
            active={filter === f}
            onClick={() => setFilter(f)}
          />
        ))}
      </div>

      <AdminTable
        columns={["Customer", "Amount", "Status", "Plan", "Method", "Safepay reference", "Recorded"]}
        loading={payments.loading && !payments.data}
        error={payments.error}
        onRetry={() => void payments.refresh()}
        rowsCount={rows.length}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search customer, email or tracking id…"
        emptyTitle={filter !== "all" || query ? "No payments match" : "No payments yet"}
        emptyDescription={
          filter !== "all" || query
            ? "Try a different status filter or clear the search."
            : "Payments appear here the moment Safepay webhooks are verified."
        }
      >
        {rows.map((p) => (
          <tr key={p._id} className="border-b last:border-0 hover:bg-accent/30">
            <td className="px-4 py-3">
              <p className="text-sm font-medium">{p.userName}</p>
              <p className="text-xs text-muted-foreground">{p.userEmail}</p>
            </td>
            <td className="px-4 py-3 text-sm font-medium tabular-nums">{formatPkr(p.amount)}</td>
            <td className="px-4 py-3">
              <StatusBadge kind="payment" status={String(p.status)} />
              {p.failureReason ? (
                <p className="mt-1 max-w-40 truncate text-[11px] text-muted-foreground" title={p.failureReason}>{p.failureReason}</p>
              ) : null}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{p.planName ?? "—"}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{p.paymentMethod ?? "—"}</td>
            <td className="max-w-40 truncate px-4 py-3 font-mono text-xs text-muted-foreground" title={p.safepayTrackingId ?? ""}>
              {p.safepayTrackingId ?? p.safepayPaymentToken ?? "—"}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(p.createdAt)}</td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
