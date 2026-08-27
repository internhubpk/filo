"use client";

// =============================================================================
// ADMIN OVERVIEW — every number and chart series is computed from real
// database rows in Convex (billing:adminAnalytics / adminBillingStats /
// adminStorageTotal), fetched through the admin-guarded API.
// =============================================================================

import { useState } from "react";
import Link from "next/link";
import {
  Users,
  UserCheck,
  CreditCard,
  DollarSign,
  TrendingUp,
  FileWarning,
  HardDrive,
  Sparkles,
  ArrowRight,
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
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FadeIn } from "@/components/animations";

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

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export default function AdminOverviewPage() {
  const [range, setRange] = useState("30");
  const stats = useApi<Stats>(() => apiClient.adminStats().then((r) => (r.success ? (r.data as Stats) : null)), { pollMs: 20_000 });
  const analytics = useApi<Analytics>(
    () => apiClient.adminAnalytics(parseInt(range, 10)).then((r) => (r.success ? (r.data as Analytics) : null)),
    { pollMs: 60_000 }
  );

  const loading = stats.loading && !stats.data;
  const t = stats.data?.totals;
  const b = stats.data?.billing;

  const series = (analytics.data?.series ?? []).map((d) => ({
    ...d,
    label: new Date(d.date + "T00:00:00Z").toLocaleDateString("en", { day: "numeric", month: "short" }),
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total users" value={t?.users ?? 0} icon={<Users className="size-5" />} hint={`${formatNumber(t?.activeUsers ?? 0)} active · ${t?.suspendedUsers ?? 0} suspended`} loading={loading} />
        <StatCard label="Paid users" value={t?.paidUsers ?? 0} icon={<UserCheck className="size-5" />} hint={`${formatNumber(t?.freeUsers ?? 0)} on Free`} loading={loading} />
        <StatCard label="MRR" value={b?.mrrPkr ?? 0} format={(n) => formatPkr(Math.round(n), { compact: true })} icon={<TrendingUp className="size-5" />} hint={`${b?.activeSubscriptions ?? 0} active subscriptions`} loading={loading} />
        <StatCard label="Revenue (all time)" value={b?.revenuePkr ?? 0} format={(n) => formatPkr(Math.round(n), { compact: true })} icon={<DollarSign className="size-5" />} hint={`${b?.totalPayments ?? 0} payments recorded`} loading={loading} tone={(b?.failedPayments ?? 0) > 0 ? "warning" : "default"} />
      </div>

      {/* Secondary KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active subscriptions" value={b?.activeSubscriptions ?? 0} icon={<CreditCard className="size-5" />} hint={`${b?.pendingSubscriptions ?? 0} pending · ${b?.pastDueSubscriptions ?? 0} past due`} loading={loading} />
        <StatCard label="Failed payments" value={b?.failedPayments ?? 0} icon={<FileWarning className="size-5" />} tone={(b?.failedPayments ?? 0) > 0 ? "destructive" : "default"} hint={`${b?.refundedPayments ?? 0} refunded`} loading={loading} />
        <StatCard label="Storage used" value={formatBytes(t?.storageBytes ?? 0)} icon={<HardDrive className="size-5" />} hint="Across all user files (R2)" loading={loading} />
        <StatCard label="Documents generated" value={t?.artifacts ?? 0} icon={<Sparkles className="size-5" />} hint="All-time artifacts" loading={loading} />
      </div>

      {/* Charts */}
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
    </div>
  );
}

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
    <Card>
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
          <FadeIn>{children}</FadeIn>
        )}
      </CardContent>
    </Card>
  );
}
