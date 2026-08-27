"use client";

// =============================================================================
// DASHBOARD — everything on this page is REAL Convex-backed state:
//   - greeting + live plan badge
//   - usage: generations this month vs plan limit (usageRecords)
//   - storage used vs plan quota (sum of files.size)
//   - documents count (artifacts table)
//   - recent generations (artifacts) + quick actions + activity timeline
// Empty states are real empty states. Upgrade CTA appears only when the
// account is actually on a non-paid plan or near its limit.
// =============================================================================

import { useMemo } from "react";
import Link from "next/link";
import {
  Sparkles,
  FileText,
  FileSpreadsheet,
  Presentation,
  FolderOpen,
  HardDrive,
  ArrowRight,
  Clock,
  CreditCard,
  Loader2,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useFiloSession } from "@/hooks/use-session";
import { formatBytes, formatNumber, timeAgo, initials } from "@/lib/format";
import { PageHeader, UsageBar, EmptyState, SkeletonCards } from "@/components/shared";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { FadeIn, FadeUp, StaggerContainer, StaggerItem } from "@/components/animations";
import type { DocumentTypeMeta } from "@/components/generation/artifact-type";

interface BillingData {
  planName?: string;
  planTier?: string;
  usedGenerations?: number;
  planLimit?: number;
  planStorageMb?: number;
  usage?: { generations: number; storageBytes: number; fileCount: number; artifactCount: number };
  subscription?: { status: string; interval?: string; currentPeriodEnd?: number } | null;
  payments?: Array<Record<string, unknown>>;
}

interface ArtifactsData {
  artifacts?: Array<{
    _id: string;
    title: string;
    type: string;
    format: string;
    status: string;
    createdAt: number;
  }>;
  total?: number;
}

const QUICK_ACTIONS = [
  { href: "/create?type=document", icon: FileText, label: "New document", desc: "Reports, memos, proposals" },
  { href: "/create?type=spreadsheet", icon: FileSpreadsheet, label: "New spreadsheet", desc: "Models, budgets, trackers" },
  { href: "/create?type=presentation", icon: Presentation, label: "New presentation", desc: "Decks and pitch stories" },
  { href: "/files", icon: FolderOpen, label: "Upload files", desc: "Add context for generation" },
] as const;

export default function DashboardPage() {
  const { user, ready } = useFiloSession();

  const billing = useApi<BillingData>(
    ready && user ? () => apiClient.getBillingOverview().then((r) => (r.success ? ((r.data as unknown) as BillingData) : null)) : null,
    { pollMs: 30_000 }
  );
  const artifacts = useApi<ArtifactsData>(
    ready && user ? () => apiClient.listArtifacts({ limit: 8 }).then((r) => (r.success ? ((r.data as unknown) as ArtifactsData) : null)) : null,
    { pollMs: 60_000 }
  );

  const firstName = (user?.name ?? "there").split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const planTier = billing.data?.planTier ?? "free";
  const isFree = planTier === "free";
  const nearLimit =
    !isFree &&
    billing.data &&
    typeof billing.data.planLimit === "number" &&
    billing.data.planLimit > 0 &&
    (billing.data.usedGenerations ?? 0) / billing.data.planLimit >= 0.8;

  const recent = artifacts.data?.artifacts ?? [];
  const typeCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of recent) c[a.type] = (c[a.type] ?? 0) + 1;
    return c;
  }, [recent]);

  if (!ready || !user) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const used = billing.data?.usedGenerations ?? 0;
  const genLimit = billing.data?.planLimit ?? 0;
  const storageBytes = billing.data?.usage?.storageBytes ?? 0;
  const storageMb = billing.data?.planStorageMb ?? 0;
  const storageLimitBytes = storageMb * 1024 * 1024;
  const docCount = billing.data?.usage?.artifactCount ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Greeting */}
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description="Here's what's happening across your workspace."
        actions={
          <div className="flex items-center gap-2">
            <Avatar className="size-9">
              <AvatarFallback className="text-sm">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <Button asChild className="hidden sm:inline-flex">
              <Link href="/create">
                <Sparkles className="mr-1.5 size-4" /> New generation
              </Link>
            </Button>
          </div>
        }
      />

      {/* Upgrade CTA — honest conditions only */}
      {(isFree || nearLimit) && (
        <FadeIn>
          <div className="card-sheen flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">
                {isFree
                  ? `You're on the ${billing.data?.planName ?? "Free"} plan`
                  : "You're close to your monthly generation limit"}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {isFree
                  ? "Upgrade for more generations, larger storage, and every export format."
                  : `Used ${formatNumber(used)} of ${formatNumber(genLimit ?? 0)} generations this month.`}
              </p>
            </div>
            <Button asChild size="sm" className="shrink-0">
              <Link href="/billing">
                <CreditCard className="mr-1.5 size-4" /> {isFree ? "Upgrade" : "Manage plan"}
              </Link>
            </Button>
          </div>
        </FadeIn>
      )}

      {/* Stat row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="AI generations"
          value={used}
          hint={genLimit === -1 ? "Unlimited plan" : `of ${formatNumber(genLimit)} this month`}
          icon={<Sparkles className="size-5" />}
          loading={billing.loading && !billing.data}
        />
        <StatCard
          label="Documents"
          value={docCount}
          hint={`${typeCount["document"] ?? 0} recent in this view`}
          icon={<FileText className="size-5" />}
          loading={billing.loading && !billing.data}
        />
        <StatCard
          label="Storage used"
          value={formatBytes(storageBytes)}
          hint={storageMb > 0 ? `of ${formatBytes(storageLimitBytes)}` : undefined}
          icon={<HardDrive className="size-5" />}
          loading={billing.loading && !billing.data}
        />
        <StatCard
          label="Current plan"
          value={billing.data?.planName ?? "—"}
          hint={billing.data?.subscription?.status === "active" ? "Subscription active" : isFree ? "Free forever" : undefined}
          icon={<CreditCard className="size-5" />}
          loading={billing.loading && !billing.data}
        />
      </div>

      {/* Usage + quick actions */}
      <div className="grid gap-6 lg:grid-cols-5">
        <FadeUp className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Usage this month</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <UsageBar
                label="AI generations"
                used={used}
                limit={genLimit}
                hint={genLimit !== -1 ? "Resets on the 1st of next month" : undefined}
              />
              <UsageBar
                label="Storage"
                used={storageBytes}
                limit={storageLimitBytes}
              />
            </CardContent>
          </Card>
        </FadeUp>

        <FadeUp delay={0.05} className="lg:col-span-3">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {QUICK_ACTIONS.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="group flex items-start gap-3 rounded-lg border p-3.5 transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">
                    <a.icon className="size-4.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{a.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{a.desc}</span>
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </FadeUp>
      </div>

      {/* Recent generations */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Recent generations</h2>
          <Link href="/documents" className="flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
            View all <ArrowRight className="size-3.5" />
          </Link>
        </div>
        {artifacts.loading && !artifacts.data ? (
          <SkeletonCards count={3} className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" />
        ) : recent.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title="No generations yet"
            description="Describe what you need and Filo will build it — a report, a budget model, a deck, anything."
            action={
              <Button asChild>
                <Link href="/create">
                  <Sparkles className="mr-1.5 size-4" /> Create your first document
                </Link>
              </Button>
            }
          />
        ) : (
          <StaggerContainer className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recent.slice(0, 6).map((a) => {
              const meta = typeMeta(a.type);
              return (
                <StaggerItem key={a._id}>
                  <Link
                    href={`/documents?artifact=${a._id}`}
                    className="group flex h-full flex-col rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex size-8 items-center justify-center rounded-lg ${meta.chip}`}>
                        <meta.icon className="size-4" />
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
                        {a.format || meta.label}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm font-medium leading-snug">{a.title}</p>
                    <p className="mt-auto flex items-center gap-1 pt-3 text-xs text-muted-foreground">
                      <Clock className="size-3" /> {timeAgo(a.createdAt)}
                    </p>
                  </Link>
                </StaggerItem>
              );
            })}
          </StaggerContainer>
        )}
      </div>
    </div>
  );
}

function typeMeta(type: string): DocumentTypeMeta {
  switch (type) {
    case "spreadsheet":
      return { icon: FileSpreadsheet, label: "XLSX", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" };
    case "presentation":
      return { icon: Presentation, label: "PPTX", chip: "bg-orange-500/10 text-orange-600 dark:text-orange-400" };
    case "pdf":
      return { icon: FileText, label: "PDF", chip: "bg-red-500/10 text-red-600 dark:text-red-400" };
    default:
      return { icon: FileText, label: "DOCX", chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400" };
  }
}
