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
  const subs = useApi<any[]>(
    () => apiClient.adminSubscriptions(filter === "all" ? undefined : filter).then((r) => (r.success ? (r.data as unknown as any[]) : null)),
    { pollMs: 15_000 }
  );

  const rows = useMemo(() => subs.data ?? [], [subs.data]);

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
        columns={["Subscriber", "Plan", "Safepay subscription", "Status", "Amount", "Interval", "Period end", "Created"]}
        loading={subs.loading && !subs.data}
        error={subs.error}
        onRetry={() => void subs.refresh()}
        rowsCount={rows.length}
        searchPlaceholder="Search subscribers…"
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
          </tr>
        ))}
      </AdminTable>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-emerald-500" />
        Status changes can only originate from verified Safepay webhook events — every transition is recorded in the audit log.
      </p>
    </div>
  );
}
