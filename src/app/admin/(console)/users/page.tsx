"use client";

// =============================================================================
// ADMIN USERS — real user rows joined in Convex (plan, subscription status,
// storage, artifact counts). Safe admin actions: activate / suspend with
// confirmation + audit; role grant/revoke with self-demotion protection.
// Sensitive actions always confirm first.
// =============================================================================

import { useMemo, useState } from "react";
import { MoreHorizontal, ShieldCheck, ShieldOff, UserCheck, UserX, Mail } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { formatBytes, formatDate, initials, timeAgo } from "@/lib/format";
import { AdminPageHeader, AdminTable, FilterChip } from "@/components/admin/admin-ui";
import { ConfirmDialog } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/shared";
import { Badge } from "@/components/ui/badge";

interface AdminUserRow {
  _id: string;
  name: string;
  email: string;
  status: "pending_activation" | "active" | "suspended";
  isAdmin: boolean;
  createdAt: number;
  planName: string;
  planTier: string;
  subscriptionStatus: string | null;
  storageBytes: number;
  artifactCount: number;
  generationCount?: number;
  lastGenerationAt?: number | null;
  lastActiveAt?: number | null;
}

export default function AdminUsersPage() {
  const users = useApi<AdminUserRow[]>(() => apiClient.adminListUsers().then((r) => (r.success ? (r.data as unknown as AdminUserRow[]) : null)), { pollMs: 30_000 });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: AdminUserRow; action: "activate" | "suspend" | "grant" | "revoke" } | null>(null);

  const rows = useMemo(() => {
    const all = users.data ?? [];
    const q = query.trim().toLowerCase();
    return all.filter(
      (u) =>
        (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
        (statusFilter === "all" ||
          (statusFilter === "admin" ? u.isAdmin : statusFilter === "paid" ? u.planTier !== "free" : u.status === statusFilter))
    );
  }, [users.data, query, statusFilter]);

  const counts = useMemo(() => {
    const all = users.data ?? [];
    return {
      all: all.length,
      active: all.filter((u) => u.status === "active").length,
      suspended: all.filter((u) => u.status === "suspended").length,
      paid: all.filter((u) => u.planTier !== "free").length,
      admin: all.filter((u) => u.isAdmin).length,
    };
  }, [users.data]);

  async function runConfirmed() {
    if (!confirm) return;
    const { row, action } = confirm;
    setBusy(row._id);
    try {
      let res;
      if (action === "activate") res = await apiClient.adminActivateUser(row._id);
      else if (action === "suspend") res = await apiClient.adminSuspendUser(row._id);
      else res = await apiClient.adminSetRole(row._id, action === "grant");
      if (!res.success) {
        toast.error(res.error || "Action failed");
        return;
      }
      toast.success(
        action === "activate" ? "Account activated" :
        action === "suspend" ? "Account suspended" :
        action === "grant" ? "Admin role granted" : "Admin role revoked"
      );
      await users.refresh();
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  const confirmCopy = confirm
    ? {
        activate: { title: `Activate ${confirm.row.name}?`, desc: "The account regains full access, including AI generation." },
        suspend: { title: `Suspend ${confirm.row.name}?`, desc: "The account immediately loses access. Their data is preserved." },
        grant: { title: `Grant admin to ${confirm.row.name}?`, desc: "They will access the admin console, all users, and billing data. Verified server-side." },
        revoke: { title: `Revoke admin from ${confirm.row.name}?`, desc: "They lose access to the admin console immediately." },
      }[confirm.action]
    : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AdminPageHeader title="Users" description="Every registered account with live plan and usage data." />

      <div className="flex flex-wrap gap-2">
        <FilterChip label="All" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} count={counts.all} />
        <FilterChip label="Active" active={statusFilter === "active"} onClick={() => setStatusFilter("active")} count={counts.active} />
        <FilterChip label="Suspended" active={statusFilter === "suspended"} onClick={() => setStatusFilter("suspended")} count={counts.suspended} />
        <FilterChip label="Paid" active={statusFilter === "paid"} onClick={() => setStatusFilter("paid")} count={counts.paid} />
        <FilterChip label="Admins" active={statusFilter === "admin"} onClick={() => setStatusFilter("admin")} count={counts.admin} />
      </div>

      <AdminTable
        columns={["User", "Role", "Plan", "Subscription", "Status", "Documents", "Generations", "Storage", "Last active", "Joined", "Actions"]}
        loading={users.loading && !users.data}
        error={users.error}
        onRetry={() => void users.refresh()}
        rowsCount={rows.length}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search name or email…"
      >
        {rows.map((u) => (
          <tr key={u._id} className="border-b last:border-0 hover:bg-accent/30">
            <td className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {initials(u.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{u.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
              </div>
            </td>
            <td className="px-4 py-3">
              {u.isAdmin ? (
                <Badge className="gap-1 bg-primary/10 text-primary"><ShieldCheck className="size-3" /> Admin</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">User</span>
              )}
            </td>
            <td className="px-4 py-3 text-sm">{u.planName}</td>
            <td className="px-4 py-3">
              {u.subscriptionStatus ? <StatusBadge kind="subscription" status={u.subscriptionStatus} /> : <span className="text-xs text-muted-foreground">—</span>}
            </td>
            <td className="px-4 py-3">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                u.status === "active" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : u.status === "suspended" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              }`}>
                {u.status === "active" ? "Active" : u.status === "suspended" ? "Suspended" : "Pending"}
              </span>
            </td>
            <td className="px-4 py-3 text-sm tabular-nums">{u.artifactCount}</td>
            <td className="px-4 py-3 text-sm tabular-nums" title={u.lastGenerationAt ? `Last generation ${formatDate(u.lastGenerationAt)}` : undefined}>
              {u.generationCount ?? 0}
            </td>
            <td className="px-4 py-3 text-sm tabular-nums">{formatBytes(u.storageBytes)}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground" title={u.lastActiveAt ? formatDate(u.lastActiveAt) : undefined}>
              {u.lastActiveAt ? timeAgo(u.lastActiveAt) : <span className="opacity-50">never logged in</span>}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground" title={formatDate(u.createdAt)}>{timeAgo(u.createdAt)}</td>
            <td className="px-4 py-3">
              <div className="flex justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" disabled={busy === u._id} aria-label={`Actions for ${u.name}`}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {u.status !== "active" && (
                      <DropdownMenuItem onClick={() => setConfirm({ row: u, action: "activate" })}>
                        <UserCheck className="mr-2 size-4" /> Activate account
                      </DropdownMenuItem>
                    )}
                    {u.status === "active" && (
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirm({ row: u, action: "suspend" })}>
                        <UserX className="mr-2 size-4" /> Suspend account
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    {!u.isAdmin ? (
                      <DropdownMenuItem onClick={() => setConfirm({ row: u, action: "grant" })}>
                        <ShieldCheck className="mr-2 size-4" /> Grant admin
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => setConfirm({ row: u, action: "revoke" })}>
                        <ShieldOff className="mr-2 size-4" /> Revoke admin
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => { void navigator.clipboard.writeText(u.email); toast("Email copied"); }}>
                      <Mail className="mr-2 size-4" /> Copy email
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirmCopy?.title ?? ""}
        description={confirmCopy?.desc}
        confirmLabel={confirm?.action === "suspend" ? "Suspend" : confirm?.action === "grant" ? "Grant" : confirm?.action === "revoke" ? "Revoke" : "Activate"}
        destructive={confirm?.action === "suspend" || confirm?.action === "revoke"}
        loading={Boolean(confirm && busy === confirm.row._id)}
        onConfirm={() => void runConfirmed()}
      />
    </div>
  );
}
