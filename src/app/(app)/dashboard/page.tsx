"use client";

// =============================================================================
// DASHBOARD — everything on this page is REAL Convex-backed state:
//   - greeting + live plan badge + gradient primary CTA
//   - KPI row: total artifacts, per-type counts, storage, plan
//   - live <ActiveGenerations /> banner (background jobs)
//   - usage vs plan limits + quick actions
//   - recent artifacts grid with download links and .lift hover cards
// Data flow is unchanged (billing overview + artifacts list via useApi);
// this file rebuilds the presentation layer only.
// =============================================================================

import { useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
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
  Download,
  Loader2,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useFiloSession } from "@/hooks/use-session";
import { formatBytes, formatNumber, timeAgo, initials } from "@/lib/format";
import { UsageBar, EmptyState, SkeletonCards } from "@/components/shared";
import { ActiveGenerations } from "@/components/shared/active-generations";
import { StatCard } from "@/components/shared/stat-card";
import { ScrollReveal } from "@/components/shared/scroll-reveal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

/** Download a generated artifact via its presigned R2 URL (session-authed). */
async function downloadArtifact(a: { _id: string; title: string; format: string }) {
  try {
    const res = await fetch(`/api/artifacts/download?id=${encodeURIComponent(a._id)}`, {
      headers: apiClient.getAuthHeaders(),
    });
    const json = (await res.json().catch(() => null)) as
      | { success: boolean; data?: { url: string; fileName: string }; error?: string; code?: string }
      | null;
    if (!res.ok || !json?.success || !json.data?.url) {
      if (json?.code === "NO_PERSISTED_FILE") {
        toast.error("No stored file", { description: json.error });
        return;
      }
      throw new Error(json?.error || `HTTP ${res.status}`);
    }
    const el = document.createElement("a");
    el.href = json.data.url;
    el.download = json.data.fileName || `${a.title}.${(a.format || "docx").toLowerCase()}`;
    el.rel = "noopener";
    document.body.appendChild(el);
    el.click();
    el.remove();
  } catch (err) {
    toast.error("Download failed", {
      description: err instanceof Error ? err.message.slice(0, 140) : "The file could not be retrieved.",
    });
  }
}

export default function DashboardPage() {
  const { user, ready } = useFiloSession();

  const billing = useApi<BillingData>(
    ready && user ? () => apiClient.getBillingOverview().then((r) => (r.success ? ((r.data as unknown) as BillingData) : null)) : null,
    { pollMs: 30_000 }
  );
  const artifacts = useApi<ArtifactsData>(
    ready && user ? () => apiClient.listArtifacts({ limit: 100 }).then((r) => (r.success ? ((r.data as unknown) as ArtifactsData) : null)) : null,
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

  // Stable identity: `artifacts.data` changes only on fetch completion, so
  // downstream useMemo deps stay stable (React compiler requirement).
  const allArtifacts = useMemo(() => artifacts.data?.artifacts ?? [], [artifacts.data]);
  const recent = allArtifacts.slice(0, 8);
  const typeCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of allArtifacts) c[a.type] = (c[a.type] ?? 0) + 1;
    return c;
  }, [allArtifacts]);
  const partialHistory = (artifacts.data?.total ?? 0) > allArtifacts.length;

  if (!ready || !user) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const used = billing.data?.usedGenerations ?? 0;
  const genLimit = billing.data?.planLimit ?? 0;
  const storageBytes = billing.data?.usage?.storageBytes ?? 0;
  const storageMb = billing.data?.planStorageMb ?? 0;
  const storageLimitBytes = storageMb * 1024 * 1024;
  const totalArtifacts = artifacts.data?.total ?? billing.data?.usage?.artifactCount ?? 0;
  const countsHint = partialHistory
    ? `latest ${formatNumber(allArtifacts.length)} of ${formatNumber(artifacts.data?.total ?? 0)}`
    : undefined;
  const billingLoading = billing.loading && !billing.data;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* ---------- Hero row: greeting + primary CTA ---------- */}
      <ScrollReveal>
        <section className="card-sheen relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar className="size-12 shrink-0 ring-2 ring-primary/25">
                <AvatarFallback className="text-base">{initials(user.name)}</AvatarFallback>
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
                <p className="mt-1 text-sm text-muted-foreground">Here&apos;s what&apos;s happening across your workspace.</p>
              </div>
            </div>
            <Button
              asChild
              size="lg"
              className="press shrink-0 bg-gradient-to-r from-primary to-chart-2 text-primary-foreground shadow-lg shadow-primary/25 hover:scale-[1.02] hover:shadow-xl hover:shadow-primary/30"
            >
              <Link href="/create">
                <Sparkles className="size-4" /> Create document
              </Link>
            </Button>
          </div>

          {/* Live background generations — placed prominently under the hero */}
          <ActiveGenerationsSlot />
        </section>
      </ScrollReveal>

      {/* Upgrade CTA — honest conditions only */}
      {(isFree || nearLimit) && (
        <ScrollReveal delay={0.05}>
          <div className="card-sheen flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
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
            <Button asChild size="sm" className="press shrink-0 shadow-md shadow-primary/20">
              <Link href="/billing">
                <CreditCard className="size-4" /> {isFree ? "Upgrade" : "Manage plan"}
              </Link>
            </Button>
          </div>
        </ScrollReveal>
      )}

      {/* ---------- KPI row ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ScrollReveal delay={0} className="h-full">
          <StatCard
            label="Total artifacts"
            value={totalArtifacts}
            hint={countsHint}
            icon={<Sparkles className="size-5" />}
            loading={artifacts.loading && !artifacts.data && billingLoading}
          />
        </ScrollReveal>
        <ScrollReveal delay={0.05} className="h-full">
          <StatCard
            label="Documents"
            value={typeCount["document"] ?? 0}
            hint={countsHint ?? "DOCX · PDF exports"}
            icon={<FileText className="size-5" />}
            loading={artifacts.loading && !artifacts.data}
          />
        </ScrollReveal>
        <ScrollReveal delay={0.1} className="h-full">
          <StatCard
            label="Spreadsheets"
            value={typeCount["spreadsheet"] ?? 0}
            hint={countsHint ?? "XLSX · CSV exports"}
            icon={<FileSpreadsheet className="size-5" />}
            loading={artifacts.loading && !artifacts.data}
          />
        </ScrollReveal>
        <ScrollReveal delay={0.15} className="h-full">
          <StatCard
            label="Presentations"
            value={typeCount["presentation"] ?? 0}
            hint={countsHint ?? "PPTX decks"}
            icon={<Presentation className="size-5" />}
            loading={artifacts.loading && !artifacts.data}
          />
        </ScrollReveal>
        <ScrollReveal delay={0.2} className="h-full">
          <StatCard
            label="Storage used"
            value={formatBytes(storageBytes)}
            hint={storageMb > 0 ? `of ${formatBytes(storageLimitBytes)} plan quota` : "across all uploaded files"}
            icon={<HardDrive className="size-5" />}
            loading={billingLoading}
          />
        </ScrollReveal>
        <ScrollReveal delay={0.25} className="h-full">
          <StatCard
            label="Current plan"
            value={billing.data?.planName ?? "—"}
            hint={
              billing.data?.subscription?.status === "active"
                ? "Subscription active"
                : isFree
                  ? "Free forever"
                  : undefined
            }
            icon={<CreditCard className="size-5" />}
            loading={billingLoading}
          />
        </ScrollReveal>
      </div>

      {/* ---------- Usage + quick actions ---------- */}
      <div className="grid gap-6 lg:grid-cols-5">
        <ScrollReveal delay={0.05} className="lg:col-span-2">
          <Card className="lift h-full shadow-sm hover:border-primary/35">
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
        </ScrollReveal>

        <ScrollReveal delay={0.1} className="lg:col-span-3">
          <Card className="h-full shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {QUICK_ACTIONS.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="lift group flex items-start gap-3 rounded-xl border bg-card p-3.5 shadow-sm hover:border-primary/40 hover:bg-accent/40"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-inset ring-primary/20 transition-transform group-hover:scale-105">
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
        </ScrollReveal>
      </div>

      {/* ---------- Recent artifacts ---------- */}
      <ScrollReveal delay={0.05}>
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight">Recent generations</h2>
            <Link href="/documents" className="flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
              View all <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {artifacts.loading && !artifacts.data ? (
            <SkeletonCards count={4} className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-5" />}
              title="No generations yet"
              description="Describe what you need and Filo will build it — a report, a budget model, a deck, anything."
              action={
                <Button asChild className="press shadow-lg shadow-primary/25">
                  <Link href="/create">
                    <Sparkles className="size-4" /> Create your first document
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recent.map((a, i) => {
                const meta = typeMeta(a.type);
                const completed = a.status === "completed";
                return (
                  <ScrollReveal key={a._id} delay={Math.min(i * 0.06, 0.3)} className="h-full">
                    <div className="lift group relative flex h-full flex-col rounded-xl border bg-card p-4 shadow-sm hover:border-primary/40">
                      {/* Card-wide link to the artifact detail view */}
                      <Link
                        href={`/documents?artifact=${a._id}`}
                        className="absolute inset-0 z-0 rounded-xl"
                        aria-label={`Open ${a.title}`}
                      />
                      <div className="flex items-center justify-between">
                        <span className={`inline-flex size-8 items-center justify-center rounded-lg ${meta.chip}`}>
                          <meta.icon className="size-4" />
                        </span>
                        {completed ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
                            {a.format || meta.label}
                          </span>
                        ) : (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${
                              a.status === "error"
                                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            {a.status}
                          </span>
                        )}
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm font-medium leading-snug">{a.title}</p>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                        <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="size-3 shrink-0" /> {timeAgo(a.createdAt)}
                        </p>
                        {completed ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="relative z-10 size-7 text-muted-foreground hover:text-primary"
                            aria-label={`Download ${a.title}`}
                            onClick={() => void downloadArtifact(a)}
                          >
                            <Download className="size-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </ScrollReveal>
                );
              })}
            </div>
          )}
        </div>
      </ScrollReveal>
    </div>
  );
}

/**
 * ActiveGenerations renders nothing when there are no in-flight jobs, so it
 * is mounted through this slot inside the hero (no stray spacing gaps).
 */
function ActiveGenerationsSlot() {
  return (
    <div className="relative mt-5">
      <ActiveGenerations />
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
