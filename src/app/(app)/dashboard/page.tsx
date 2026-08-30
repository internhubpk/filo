"use client";

// =============================================================================
// DASHBOARD — professional, uncluttered workspace home.
// =============================================================================
// Structure (every block has ONE job, no redundancy):
//   1. Hero — greeting, live plan badge, primary CTA, in-flight generations
//   2. Creation window — New document / spreadsheet / presentation / Upload
//   3. Status row — artifact totals, storage, plan & usage (upgrade CTA lives
//      inline here instead of shouting from its own banner)
//   4. Artifacts window — ALL artifacts with filters, multi-select, bulk
//      delete and ZIP export (the <ArtifactsWorkspace />)
// All data is REAL Convex-backed state (billing overview + artifacts list).
// =============================================================================

import { useMemo } from "react";
import Link from "next/link";
import {
  Sparkles,
  FileText,
  FileSpreadsheet,
  Presentation,
  FolderOpen,
  CreditCard,
  ChevronRight,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useFiloSession } from "@/hooks/use-session";
import { formatBytes, formatNumber } from "@/lib/format";
import { SkeletonCards } from "@/components/shared";
import { ActiveGenerations } from "@/components/shared/active-generations";
import { StatCard } from "@/components/shared/stat-card";
import { ArtifactsWorkspace } from "@/components/shared/artifacts-workspace";
import { ScrollReveal } from "@/components/shared/scroll-reveal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";

interface BillingData {
  planName?: string;
  planTier?: string;
  usedGenerations?: number;
  planLimit?: number;
  planStorageMb?: number;
  usage?: { generations: number; storageBytes: number; fileCount: number; artifactCount: number };
  subscription?: { status: string; interval?: string; currentPeriodEnd?: number } | null;
}

interface ArtifactsData {
  artifacts?: Array<{ _id: string; type: string; status: string }>;
  total?: number;
}

// ---- Creation window: four focused entry points ----
const CREATE_TILES = [
  {
    href: "/create?type=document",
    icon: FileText,
    label: "New document",
    desc: "Reports, memos, proposals",
    chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  {
    href: "/create?type=spreadsheet",
    icon: FileSpreadsheet,
    label: "New spreadsheet",
    desc: "Models, budgets, trackers",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  {
    href: "/create?type=presentation",
    icon: Presentation,
    label: "New presentation",
    desc: "Decks and pitch stories",
    chip: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  {
    href: "/files",
    icon: FolderOpen,
    label: "Upload files",
    desc: "Add context for AI edits",
    chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
] as const;

export default function DashboardPage() {
  const { user, ready } = useFiloSession();

  const billing = useApi<BillingData>(
    ready && user ? () => apiClient.getBillingOverview().then((r) => (r.success ? ((r.data as unknown) as BillingData) : null)) : null,
    { pollMs: 30_000 }
  );
  const artifacts = useApi<ArtifactsData>(
    ready && user ? () => apiClient.listArtifacts({ limit: 500 }).then((r) => (r.success ? ((r.data as unknown) as ArtifactsData) : null)) : null,
    { pollMs: 60_000 }
  );

  const firstName = (user?.name ?? "there").split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const planTier = billing.data?.planTier ?? "free";
  const isFree = planTier === "free";

  const allArtifacts = useMemo(() => artifacts.data?.artifacts ?? [], [artifacts.data]);
  const typeCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of allArtifacts) c[a.type] = (c[a.type] ?? 0) + 1;
    return c;
  }, [allArtifacts]);

  if (!ready || !user) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 py-2">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <SkeletonCards count={3} className="grid-cols-1" />
      </div>
    );
  }

  const used = billing.data?.usedGenerations ?? 0;
  const genLimit = billing.data?.planLimit ?? 0;
  const storageBytes = billing.data?.usage?.storageBytes ?? 0;
  const storageMb = billing.data?.planStorageMb ?? 0;
  const storageLimitBytes = storageMb * 1024 * 1024;
  const storagePct = storageLimitBytes > 0 ? Math.min(100, (storageBytes / storageLimitBytes) * 100) : 0;
  const genPct = genLimit > 0 ? Math.min(100, (used / genLimit) * 100) : 0;
  const nearLimit = !isFree && genLimit > 0 && genPct >= 80;
  const totalArtifacts = artifacts.data?.total ?? billing.data?.usage?.artifactCount ?? 0;
  const billingLoading = billing.loading && !billing.data;
  const countsHint =
    `${formatNumber(typeCount["document"] ?? 0)} documents · ${formatNumber(typeCount["spreadsheet"] ?? 0)} spreadsheets · ${formatNumber(typeCount["presentation"] ?? 0)} presentations`;

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      {/* ============ 1. Hero ============ */}
      <ScrollReveal>
        <section className="relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm sm:p-8" aria-label="Overview">
          <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar className="size-12 shrink-0 ring-2 ring-primary/25">
                <AvatarFallback className="text-base">{firstName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-display text-2xl tracking-tight sm:text-3xl">
                    {greeting}, <span className="text-gradient">{firstName}</span>
                  </h1>
                  {billing.data?.planName ? (
                    <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
                      {billing.data.planName}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create, edit and manage every document from one place.
                </p>
              </div>
            </div>
            <Button
              asChild
              size="lg"
              className="press shrink-0 shadow-lg shadow-primary/25"
            >
              <Link href="/create">
                <Sparkles className="size-4" /> Create document
              </Link>
            </Button>
          </div>

          {/* Live background generations — renders nothing when idle */}
          <div className="relative mt-5">
            <ActiveGenerations />
          </div>
        </section>
      </ScrollReveal>

      {/* ============ 2. Creation window ============ */}
      <ScrollReveal delay={0.05}>
        <section aria-label="Start creating">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Start creating</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CREATE_TILES.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="lift group flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm hover:border-primary/40 hover:bg-accent/30"
              >
                <span className={`inline-flex size-10 items-center justify-center rounded-lg ${t.chip}`}>
                  <t.icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-sm font-medium">
                    {t.label}
                    <ChevronRight className="size-3.5 -translate-x-1 text-primary opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{t.desc}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </ScrollReveal>

      {/* ============ 3. Status row ============ */}
      <ScrollReveal delay={0.05}>
        <section aria-label="Usage and plan">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Total artifacts"
              value={totalArtifacts}
              hint={countsHint}
              icon={<Sparkles className="size-5" />}
              loading={artifacts.loading && !artifacts.data}
            />
            <StatCard
              label="Storage used"
              value={billing.data ? formatBytes(storageBytes) : "—"}
              hint={storageMb > 0 ? `of ${formatBytes(storageLimitBytes)} plan quota` : "across all uploaded files"}
              icon={<FolderOpen className="size-5" />}
              loading={billingLoading}
            />

            {/* Plan & usage — the upgrade CTA lives here, inline and quiet */}
            <Card className="col-span-1 shadow-sm sm:col-span-2 lg:col-span-1">
              <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CreditCard className="size-4 text-primary" /> Plan &amp; usage
                </CardTitle>
                {billingLoading ? (
                  <Skeleton className="h-5 w-16 rounded-full" />
                ) : (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {billing.data?.planName ?? "Free"}
                  </span>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="font-medium text-muted-foreground">AI generations</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatNumber(used)} / {genLimit === -1 ? "∞" : formatNumber(genLimit)}
                    </span>
                  </div>
                  {billingLoading ? (
                    <Skeleton className="h-1.5 w-full" />
                  ) : (
                    <Progress value={genPct} className="h-1.5" aria-label="Generation usage" />
                  )}
                </div>
                {storageMb > 0 ? (
                  <div>
                    <div className="mb-1 flex items-baseline justify-between text-xs">
                      <span className="font-medium text-muted-foreground">Storage</span>
                      <span className="tabular-nums text-muted-foreground">{storagePct.toFixed(0)}%</span>
                    </div>
                    <Progress value={storagePct} className="h-1.5" aria-label="Storage usage" />
                  </div>
                ) : null}
                {isFree || nearLimit ? (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                    <p className="text-xs font-medium">
                      {isFree ? "Unlock AI generation" : "Close to your monthly limit"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {isFree
                        ? "Upgrade to generate documents, spreadsheets and decks."
                        : `Used ${formatNumber(used)} of ${formatNumber(genLimit)} this month.`}
                    </p>
                  </div>
                ) : null}
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href="/billing">
                    {isFree ? "Upgrade plan" : nearLimit ? "Get more headroom" : "Manage plan"}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>
      </ScrollReveal>

      {/* ============ 4. Artifacts window ============ */}
      <ScrollReveal delay={0.08}>
        <ArtifactsWorkspace
          variant="dashboard"
          title="Artifacts"
          description="All your generated files — filter, select, export or delete."
        />
      </ScrollReveal>
    </div>
  );
}
