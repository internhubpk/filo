"use client";

// =============================================================================
// ADMIN OVERVIEW — every number and chart series is computed from real
// database rows in Convex (billing:adminAnalytics / adminBillingStats /
// adminStorageTotal), fetched through the admin-guarded API.
// Adds the "AI usage" panel (GET /api/admin/ai/usage): token totals,
// per-user input/output rollups, and recent generation token accounting.
// =============================================================================

import { useState } from "react";
import Link from "next/link";
import {
  Users,
  CreditCard,
  DollarSign,
  TrendingUp,
  HardDrive,
  Sparkles,
  ArrowRight,
  Bot,
  FileStack,
  Webhook,
  ScrollText,
  Layers,
  RefreshCw,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { formatBytes, formatNumber, formatPkr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatCard } from "@/components/shared/stat-card";
import { ScrollReveal } from "@/components/shared/scroll-reveal";
import { ErrorState } from "@/components/shared";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface Analytics {
  series?: Array<{ date: string; signups: number; revenue: number; payments: number; generations: number; artifacts: number }>;
  planDistribution?: Array<{ name: string; tier: string; count: number }>;
  artifactTypes?: Array<{ type: string; count: number }>;
  totals?: { users: number; activeUsers: number; suspendedUsers: number; artifacts: number };
}

interface Stats {
  totals?: { users: number; activeUsers: number; suspendedUsers: number; artifacts: number; paidUsers: number; freeUsers: number; storageBytes: number };
  billing?: {
    activeSubscriptions: number;
    canceledSubscriptions: number;
    pendingSubscriptions: number;
    pastDueSubscriptions: number;
    mrrPkr: number;
    revenuePkr: number;
    totalPayments: number;
    failedPayments: number;
    refundedPayments: number;
  };
}

// ---- AI usage payload (GET /api/admin/ai/usage — admin-guarded) ----
interface AiUsage {
  totals: { jobs: number; completed: number; failed: number; inputTokens: number; outputTokens: number; totalTokens: number };
  perUser: Array<{ email: string; jobs: number; inputTokens: number; outputTokens: number; totalTokens: number }>;
  recent: Array<{
    jobId: string;
    userEmail: string;
    userName?: string;
    status: string;
    artifactType: string;
    outputFormat: string;
    model: string | null;
    provider: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalUnits?: number;
    completedUnits?: number;
    failedUnits?: number;
    createdAt: number;
  }>;
}

const QUICK_LINKS = [
  { href: "/admin/users", icon: Users, title: "Users", desc: "Accounts, roles, suspensions" },
  { href: "/admin/subscriptions", icon: CreditCard, title: "Subscriptions", desc: "Renewals, cancellations, states" },
  { href: "/admin/payments", icon: DollarSign, title: "Payments", desc: "Transaction ledger and refunds" },
  { href: "/admin/webhooks", icon: Webhook, title: "Webhooks", desc: "Safepay deliveries + self-test" },
  { href: "/admin/audit", icon: ScrollText, title: "Audit log", desc: "Every admin action, recorded" },
  { href: "/admin/plans", icon: Layers, title: "Plans", desc: "Pricing, limits, Safepay mapping" },
] as const;

/** Humanize token counts: 1234 → 1.2k, 5600000 → 5.6M. */
function formatTokens(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

async function fetchAiUsage(): Promise<AiUsage | null> {
  const res = await fetch("/api/admin/ai/usage?limit=50", {
    headers: apiClient.getAuthHeaders(),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: AiUsage; error?: string } | null;
  if (!res.ok || !json?.success || !json.data) {
    throw new Error(json?.error || `Request failed (HTTP ${res.status})`);
  }
  return json.data;
}

export default function AdminOverviewPage() {
  const [range, setRange] = useState("30");
  const stats = useApi<Stats>(() => apiClient.adminStats().then((r) => (r.success ? (r.data as Stats) : null)), { pollMs: 20_000 });
  const analytics = useApi<Analytics>(
    () => apiClient.adminAnalytics(parseInt(range, 10)).then((r) => (r.success ? (r.data as Analytics) : null)),
    { pollMs: 60_000 }
  );
  const aiUsage = useApi<AiUsage>(fetchAiUsage, { pollMs: 45_000 });

  const loading = stats.loading && !stats.data;
  const t = stats.data?.totals;
  const b = stats.data?.billing;
  const usage = aiUsage.data;

  const series = (analytics.data?.series ?? []).map((d) => ({
    ...d,
    label: new Date(d.date + "T00:00:00Z").toLocaleDateString("en", { day: "numeric", month: "short" }),
  }));

  const perUser = [...(usage?.perUser ?? [])].sort((a, z) => z.totalTokens - a.totalTokens);
  const recentJobs = (usage?.recent ?? []).slice(0, 12);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* ---------- Header ---------- */}
      <ScrollReveal className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Live platform metrics, straight from the database.</p>
        </div>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-[150px]" aria-label="Time range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 180 days</SelectItem>
          </SelectContent>
        </Select>
      </ScrollReveal>

      {/* ---------- KPI row 1: platform ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ScrollReveal>
          <StatCard
            label="Total users"
            value={t?.users ?? 0}
            icon={<Users className="size-5" />}
            hint={`${formatNumber(t?.activeUsers ?? 0)} active · ${t?.suspendedUsers ?? 0} suspended`}
            loading={loading}
          />
        </ScrollReveal>
        <ScrollReveal delay={0.05}>
          <StatCard
            label="Artifacts generated"
            value={t?.artifacts ?? 0}
            icon={<FileStack className="size-5" />}
            hint={`${t?.paidUsers ?? 0} paid · ${t?.freeUsers ?? 0} free users`}
            loading={loading}
          />
        </ScrollReveal>
        <ScrollReveal delay={0.1}>
          <StatCard
            label="MRR"
            value={b?.mrrPkr ?? 0}
            format={(n) => formatPkr(Math.round(n), { compact: true })}
            icon={<TrendingUp className="size-5" />}
            hint={`${b?.activeSubscriptions ?? 0} active subscriptions`}
            loading={loading}
          />
        </ScrollReveal>
        <ScrollReveal delay={0.15}>
          <StatCard
            label="Storage used"
            value={formatBytes(t?.storageBytes ?? 0)}
            icon={<HardDrive className="size-5" />}
            hint="Across all user files (R2)"
            loading={loading}
          />
        </ScrollReveal>
      </div>

      {/* ---------- KPI row 2: billing + AI ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ScrollReveal>
          <StatCard
            label="AI jobs completed"
            value={usage?.totals.completed ?? 0}
            icon={<Bot className="size-5" />}
            hint={
              usage
                ? `${formatNumber(usage.totals.failed)} failed of ${formatNumber(usage.totals.jobs)} total`
                : "Awaiting AI usage feed"
            }
            tone={(usage?.totals.failed ?? 0) > 0 ? "warning" : "default"}
            loading={aiUsage.loading && !aiUsage.data}
          />
        </ScrollReveal>
        <ScrollReveal delay={0.05}>
          <StatCard
            label="AI tokens (in → out)"
            value={formatTokens(usage?.totals.totalTokens ?? 0)}
            icon={<Sparkles className="size-5" />}
            hint={usage ? `${formatTokens(usage.totals.inputTokens)} in · ${formatTokens(usage.totals.outputTokens)} out` : undefined}
            loading={aiUsage.loading && !aiUsage.data}
          />
        </ScrollReveal>
        <ScrollReveal delay={0.1}>
          <StatCard
            label="Active subscriptions"
            value={b?.activeSubscriptions ?? 0}
            icon={<CreditCard className="size-5" />}
            hint={`${b?.pendingSubscriptions ?? 0} pending · ${b?.pastDueSubscriptions ?? 0} past due`}
            loading={loading}
          />
        </ScrollReveal>
        <ScrollReveal delay={0.15}>
          <StatCard
            label="Revenue (all time)"
            value={b?.revenuePkr ?? 0}
            format={(n) => formatPkr(Math.round(n), { compact: true })}
            icon={<DollarSign className="size-5" />}
            hint={`${b?.totalPayments ?? 0} payments · ${b?.failedPayments ?? 0} failed`}
            tone={(b?.failedPayments ?? 0) > 0 ? "warning" : "default"}
            loading={loading}
          />
        </ScrollReveal>
      </div>

      {/* ---------- Quick links / control cards ---------- */}
      <ScrollReveal delay={0.05}>
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Controls</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {QUICK_LINKS.map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className="lift group flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm hover:border-primary/40"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-inset ring-primary/20 transition-transform group-hover:scale-105">
                  <q.icon className="size-4.5" />
                </span>
                <span className="flex items-center gap-1 text-sm font-medium">
                  {q.title}
                  <ArrowRight className="size-3.5 -translate-x-1 text-primary opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                </span>
                <span className="text-xs leading-snug text-muted-foreground">{q.desc}</span>
              </Link>
            ))}
          </div>
        </section>
      </ScrollReveal>

      {/* ---------- AI usage panel ---------- */}
      <ScrollReveal delay={0.05}>
        <Card className="shadow-sm">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-4">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="size-4 text-primary" />
                AI usage
              </CardTitle>
              <CardDescription className="text-xs">
                Context used per user (input → output tokens) and recent generation accounting. Never includes prompt content.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" className="press" onClick={() => void aiUsage.refresh()} disabled={aiUsage.loading}>
              <RefreshCw className={cn("size-4", aiUsage.loading && "animate-spin")} />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {aiUsage.loading && !aiUsage.data ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-24 rounded-full" />
                  ))}
                </div>
                <Skeleton className="h-40 w-full rounded-xl" />
                <Skeleton className="h-40 w-full rounded-xl" />
              </div>
            ) : aiUsage.error && !aiUsage.data ? (
              <ErrorState title="Could not load AI usage" message={aiUsage.error} onRetry={() => void aiUsage.refresh()} />
            ) : usage ? (
              <>
                {/* Totals chips */}
                <div className="flex flex-wrap gap-2">
                  <UsageChip label="Jobs" value={formatNumber(usage.totals.jobs)} />
                  <UsageChip label="Completed" value={formatNumber(usage.totals.completed)} tone="success" />
                  <UsageChip label="Failed" value={formatNumber(usage.totals.failed)} tone={usage.totals.failed > 0 ? "destructive" : "default"} />
                  <UsageChip label="Input tokens" value={formatTokens(usage.totals.inputTokens)} />
                  <UsageChip label="Output tokens" value={formatTokens(usage.totals.outputTokens)} />
                  <UsageChip label="Total tokens" value={formatTokens(usage.totals.totalTokens)} tone="primary" />
                </div>

                {usage.totals.jobs === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center">
                    <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Bot className="size-5" />
                    </div>
                    <p className="text-sm font-medium">No AI jobs recorded yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Token accounting appears here as soon as users start generating documents.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-6 xl:grid-cols-2">
                    {/* Per-user rollup (sorted by total tokens) */}
                    <div>
                      <h3 className="mb-2 text-sm font-semibold">Context by user</h3>
                      <div className="overflow-x-auto rounded-xl border">
                        <table className="w-full min-w-[420px] text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                              <th className="px-4 py-2.5 font-medium">User</th>
                              <th className="px-4 py-2.5 text-right font-medium">Jobs</th>
                              <th className="px-4 py-2.5 text-right font-medium">In → Out</th>
                              <th className="px-4 py-2.5 text-right font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {perUser.map((u) => (
                              <tr key={u.email} className="border-b last:border-0 hover:bg-accent/30">
                                <td className="max-w-52 truncate px-4 py-3 font-medium" title={u.email}>
                                  {u.email}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">{formatNumber(u.jobs)}</td>
                                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                                  {formatTokens(u.inputTokens)} → {formatTokens(u.outputTokens)}
                                </td>
                                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                                  {formatTokens(u.totalTokens)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Recent generations */}
                    <div>
                      <h3 className="mb-2 text-sm font-semibold">Recent generations</h3>
                      <div className="overflow-x-auto rounded-xl border">
                        <table className="w-full min-w-[520px] text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                              <th className="px-4 py-2.5 font-medium">User</th>
                              <th className="px-4 py-2.5 font-medium">Type</th>
                              <th className="px-4 py-2.5 font-medium">Model</th>
                              <th className="px-4 py-2.5 text-right font-medium">In / Out</th>
                              <th className="px-4 py-2.5 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recentJobs.map((j) => (
                              <tr key={j.jobId} className="border-b last:border-0 hover:bg-accent/30">
                                <td className="max-w-44 truncate px-4 py-3" title={j.userEmail}>
                                  {j.userEmail}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 capitalize">
                                  {j.artifactType}
                                  <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
                                    {(j.outputFormat || "?").toUpperCase()}
                                  </span>
                                </td>
                                <td className="max-w-40 truncate px-4 py-3 font-mono text-[11px] text-muted-foreground" title={`${j.provider ?? "—"} · ${j.model ?? "—"}`}>
                                  {j.model ?? "—"}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                                  {formatTokens(j.inputTokens)} / {formatTokens(j.outputTokens)}
                                </td>
                                <td className="px-4 py-3">
                                  <JobStatusBadge status={j.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
      </ScrollReveal>

      {/* ---------- Charts ---------- */}
      <ScrollReveal delay={0.05}>
        <div className="grid gap-5 xl:grid-cols-2">
          <ChartCard
            title="Signups"
            description="New users per day"
            loading={analytics.loading && !analytics.data}
            empty={(analytics.data?.series ?? []).length === 0}
            headerAction={
              <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
                <Link href="/admin/users">Users <ArrowRight className="size-3" /></Link>
              </Button>
            }
          >
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={series} margin={{ top: 5, right: 10, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="signupFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="signups" stroke={CHART_COLORS[0]} strokeWidth={2} fill="url(#signupFill)" name="Signups" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Revenue"
            description="Successful payments per day (PKR)"
            loading={analytics.loading && !analytics.data}
            empty={(analytics.data?.series ?? []).length === 0}
            headerAction={
              <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
                <Link href="/admin/payments">Payments <ArrowRight className="size-3" /></Link>
              </Button>
            }
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={series} margin={{ top: 5, right: 10, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatPkr(Number(v), { compact: true })} width={64} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatPkr(Number(v)), "Revenue"]} />
                <Bar dataKey="revenue" fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} name="Revenue" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="AI generations"
            description="Generation usage per day"
            loading={analytics.loading && !analytics.data}
            empty={(analytics.data?.series ?? []).length === 0}
          >
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={series} margin={{ top: 5, right: 10, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="generations" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} name="Generations" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
            <ChartCard
              title="Plan distribution"
              description="Users by current plan"
              loading={analytics.loading && !analytics.data}
              empty={(analytics.data?.planDistribution ?? []).length === 0}
            >
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={analytics.data?.planDistribution ?? []}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={80}
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    {(analytics.data?.planDistribution ?? []).map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Generations by artifact type"
              description="Documents, spreadsheets, decks"
              loading={analytics.loading && !analytics.data}
              empty={(analytics.data?.artifactTypes ?? []).length === 0}
            >
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={analytics.data?.artifactTypes ?? []} layout="vertical" margin={{ top: 0, right: 12, left: 24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="type" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={80} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill={CHART_COLORS[3]} radius={[0, 3, 3, 0]} name="Artifacts" barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>
      </ScrollReveal>
    </div>
  );
}

// ---- Small helpers ----

function UsageChip({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "destructive" | "primary" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs shadow-sm",
        tone === "success" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "destructive" && "border-destructive/25 bg-destructive/10 text-destructive",
        tone === "primary" && "border-primary/25 bg-primary/10 text-primary",
        tone === "default" && "bg-muted/40 text-foreground"
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls =
    s === "completed"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : s === "error" || s === "failed" || s === "canceled"
        ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
        : "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", cls)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {s}
    </span>
  );
}

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
};

function ChartCard({
  title,
  description,
  children,
  loading,
  empty,
  headerAction,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  headerAction?: React.ReactNode;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex-row items-start justify-between pb-2">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription className="text-xs">{description}</CardDescription>
        </div>
        {headerAction}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[240px] w-full rounded-lg" />
        ) : empty ? (
          <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No data in this range yet — charts fill in as the platform is used.
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
