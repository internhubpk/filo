"use client";

// =============================================================================
// ADMIN SUBSCRIPTIONS — Safepay-backed subscription table with lifecycle
// status filters. Data from Convex via the admin-guarded API.
// =============================================================================

import { useMemo, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { formatDate, formatPkr } from "@/lib/format";
import { SUBSCRIPTION_STATUS } from "@/lib/billing-shared";
import { AdminPageHeader, AdminTable, FilterChip } from "@/components/admin/admin-ui";
import { StatusBadge } from "@/components/shared";
import { ShieldCheck } from "lucide-react";

const FILTERS = ["all", "active", "pending", "past_due", "paused", "unpaid", "canceled", "ended", "failed"] as const;

export default function AdminSubscriptionsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [query, setQuery] = useState("");
  const subs = useApi<any[]>(
    () => apiClient.adminSubscriptions(filter === "all" ? undefined : filter).then((r) => (r.success ? (r.data as unknown as any[]) : null)),
    { pollMs: 15_000, deps: [filter] }
  );

  const rows = useMemo(() => {
    const all = subs.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (s) =>
        String(s.userName ?? "").toLowerCase().includes(q) ||
        String(s.userEmail ?? "").toLowerCase().includes(q) ||
        String(s.planName ?? "").toLowerCase().includes(q) ||
        String(s.safepaySubscriptionId ?? "").toLowerCase().includes(q)
    );
  }, [subs.data, query]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AdminPageHeader title="Subscriptions" description="Safepay subscription lifecycle, updated by verified webhooks." />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <FilterChip
            key={f}
            label={f === "all" ? "All" : SUBSCRIPTION_STATUS[f as keyof typeof SUBSCRIPTION_STATUS]?.label ?? f}
            active={filter === f}
            onClick={() => setFilter(f)}
          />
        ))}
      </div>

      <AdminTable
        columns={["Subscriber", "Plan", "Safepay subscription", "Status", "Amount", "Interval", "Period end", "Created", "Actions"]}
        loading={subs.loading && !subs.data}
        error={subs.error}
        onRetry={() => void subs.refresh()}
        rowsCount={rows.length}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search subscriber, plan or Safepay id…"
        emptyTitle={filter !== "all" || query ? "No subscriptions match" : "No subscriptions yet"}
        emptyDescription={
          filter !== "all" || query
            ? "Try a different status filter or clear the search."
            : "Subscriptions appear here as soon as users check out through Safepay."
        }
      >
        {rows.map((s) => (
          <tr key={s._id} className="border-b last:border-0 hover:bg-accent/30">
            <td className="px-4 py-3">
              <p className="text-sm font-medium">{s.userName}</p>
              <p className="text-xs text-muted-foreground">{s.userEmail}</p>
            </td>
            <td className="px-4 py-3 text-sm">{s.planName}</td>
            <td className="max-w-44 truncate px-4 py-3 font-mono text-xs text-muted-foreground" title={s.safepaySubscriptionId ?? ""}>
              {s.safepaySubscriptionId ?? "—"}
            </td>
            <td className="px-4 py-3"><StatusBadge kind="subscription" status={String(s.status)} /></td>
            <td className="px-4 py-3 text-sm font-medium tabular-nums">{formatPkr(s.amount)}</td>
            <td className="px-4 py-3 text-xs capitalize text-muted-foreground">{s.interval}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "—"}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(s.createdAt)}</td>
            <td className="px-4 py-3">
              {String(s.status) === "pending" ? (
                <span
                  className="text-xs text-muted-foreground"
                  title="Activates automatically as soon as Safepay confirms the payment via a verified signal"
                >
                  Awaiting payment…
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </td>
          </tr>
        ))}
      </AdminTable>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-emerald-500" />
        Status changes originate exclusively from verified Safepay signals (webhook, signed return, tracker API).
        There is no manual activation — use Billing diagnostics / Webhook self-test to troubleshoot a stuck
        checkout, never a hand-applied status.
      </p>
    </div>
  );
}
