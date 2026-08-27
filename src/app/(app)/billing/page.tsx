"use client";

// =============================================================================
// BILLING — real Safepay sandbox subscriptions.
// =============================================================================
// - Current subscription + plan read live from Convex (/api/billing/subscription)
// - Plan cards built from DB-driven plans (/api/plans); checkout calls
//   /api/billing/checkout which creates the pending subscription + Safepay
//   session server-side and returns the hosted payment URL.
// - The UI NEVER marks a payment successful. After returning from Safepay
//   the page polls the live subscription state and shows PENDING until the
//   verified webhook flips it to ACTIVE.
// - Cancel at period end with confirmation; revert any time before end.
// =============================================================================

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  CreditCard,
  ShieldCheck,
  Clock,
  Loader2,
  ArrowUpRight,
  Info,
  X,
  Building2,
  Crown,
  Users,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { useFiloSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { formatBytes, formatDate, formatPkr } from "@/lib/format";
import { SUBSCRIPTION_STATUS, PAYMENT_STATUS, statusMetaFor } from "@/lib/billing-shared";
import { PageHeader, UsageBar, StatusBadge, ConfirmDialog } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FadeIn, FadeUp, AnimatedNumber } from "@/components/animations";
import { Skeleton } from "@/components/ui/skeleton";

interface BillingData {
  accountStatus?: string;
  subscription?: {
    _id: string;
    status: keyof typeof SUBSCRIPTION_STATUS;
    interval: "monthly" | "yearly";
    amount: number;
    currency: string;
    currentPeriodEnd?: number;
    cancelAtPeriodEnd?: boolean;
    safepaySubscriptionId?: string;
  } | null;
  plan?: {
    _id?: string;
    name: string;
    tier?: string;
    priceMonthly: number;
    priceYearly: number;
    maxAiGenerations: number;
    maxStorageMb: number;
    features: string[];
    contactSales?: boolean;
  } | null;
  payments?: Array<{
    _id: string;
    amount: number;
    currency: string;
    status: keyof typeof PAYMENT_STATUS;
    safepayTrackingId?: string;
    createdAt: number;
    failureReason?: string;
  }>;
  usage?: { generations: number; storageBytes: number; fileCount: number; artifactCount: number };
  planName?: string;
  planTier?: string;
  usedGenerations?: number;
  planLimit?: number;
  planStorageMb?: number;
  billingEnabled?: boolean;
}

interface PlanRow {
  _id: string;
  name: string;
  description: string;
  tier?: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  features: string[];
  limitations?: string[];
  popular: boolean;
  active: boolean;
  contactSales?: boolean;
  maxAiGenerations: number;
  maxStorageMb: number;
}

const PLAN_ICONS: Record<string, typeof Sparkles> = {
  free: Sparkles,
  pro: Crown,
  team: Users,
  department: Building2,
};

function BillingContent() {
  const { user, ready } = useFiloSession();
  const router = useRouter();
  const search = useSearchParams();
  const returnedFromCheckout = search.get("checkout") === "return";

  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  const billing = useApi<BillingData>(
    ready && user
      ? () => apiClient.getBillingOverview().then((r) => (r.success ? (r.data as BillingData) : null))
      : null,
    // After returning from Safepay, poll faster while the webhook lands.
    { pollMs: returnedFromCheckout ? 4_000 : 20_000 }
  );

  const plans = useApi<PlanRow[]>(() => apiClient.getPlans().then((r) => (r.success ? ((r.data as unknown) as PlanRow[]) : null)));

  const sub = billing.data?.subscription ?? null;
  const currentTier = billing.data?.planTier ?? "free";
  const billingEnabled = billing.data?.billingEnabled !== false;

  // Poll aggressively for up to ~90s after returning from checkout.
  const [returnPolls, setReturnPolls] = useState(0);
  useEffect(() => {
    if (!returnedFromCheckout) return;
    if (returnPolls > 22) return;
    const t = setTimeout(() => {
      setReturnPolls((p) => p + 1);
      void billing.refresh();
    }, 4000);
    return () => clearTimeout(t);

  }, [returnedFromCheckout, returnPolls]);

  // Post-checkout status toasts (cancelled / bad return signature).
  const checkoutOutcome = search.get("checkout");
  useEffect(() => {
    if (checkoutOutcome === "cancelled") {
      toast.info("Checkout cancelled", { description: "No charge was made. You can pick a plan any time." });
    } else if (checkoutOutcome === "invalid_signature") {
      toast.warning("Payment could not be verified on return", {
        description: "If you completed the payment, it will still activate automatically via the payment webhook.",
      });
    }
  }, [checkoutOutcome]);

  const activePlanIds = useMemo(() => new Set((plans.data ?? []).map((p) => p._id)), [plans.data]);

  async function startCheckout(plan: PlanRow) {
    if (plan.tier === "free") return;
    if (!plan.contactSales && plan.priceMonthly === 0 && plan.priceYearly === 0) return;
    if (plan.contactSales) {
      window.location.href = "mailto:sales@filo.app?subject=Filo%20Department%20plan";
      return;
    }
    setCheckoutBusy(plan._id);
    try {
      const res = await apiClient.startCheckout({ planId: plan._id, interval });
      if (!res.success || !res.data?.checkoutUrl) {
        toast.error(res.error || "Could not start checkout");
        return;
      }
      toast.info("Redirecting to Safepay…", { description: "Complete the sandbox payment to activate your plan." });
      // Give the toast a beat, then leave for Safepay's hosted page.
      setTimeout(() => {
        window.location.href = res.data!.checkoutUrl;
      }, 600);
    } catch {
      toast.error("Checkout failed — please try again.");
    } finally {
      setCheckoutBusy(null);
    }
  }

  async function doCancel(cancel: boolean) {
    setCancelBusy(true);
    try {
      const res = await apiClient.cancelSubscription(cancel);
      if (!res.success) {
        toast.error(res.error || "Could not update the subscription");
        return;
      }
      toast.success(res.data?.message ?? "Subscription updated");
      setCancelOpen(false);
      await billing.refresh();
    } finally {
      setCancelBusy(false);
    }
  }

  if (!ready || !user) return null;

  const used = billing.data?.usedGenerations ?? 0;
  const genLimit = billing.data?.planLimit ?? 0;
  const storageBytes = billing.data?.usage?.storageBytes ?? 0;
  const storageLimitBytes = (billing.data?.planStorageMb ?? 0) * 1024 * 1024;

  const pendingBadge = sub?.status === "pending";
  const showPendingHint = pendingBadge || (returnedFromCheckout && sub?.status !== "active");

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Billing & plan"
        description="Manage your subscription, payment method history, and usage."
      />

      {/* Post-checkout status banner (honest, webhook-driven) */}
      {showPendingHint && sub?.status !== "active" && (
        <FadeIn>
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
            <Loader2 className="mt-0.5 size-4.5 shrink-0 animate-spin text-amber-500" />
            <div className="text-sm">
              <p className="font-medium">Waiting for payment confirmation</p>
              <p className="mt-0.5 text-muted-foreground">
                Safepay is processing your payment. Your plan activates automatically the moment our
                system verifies it — this usually takes a few seconds. This page refreshes itself.
              </p>
            </div>
          </div>
        </FadeIn>
      )}

      {/* Current plan + usage */}
      <div className="grid gap-5 lg:grid-cols-2">
        <FadeUp>
          <Card className="h-full">
            <CardHeader className="flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Current plan</CardTitle>
              {sub ? (
                <StatusBadge kind="subscription" status={String(sub.status)} />
              ) : (
                <Badge variant="outline" className="gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" /> Active</Badge>
              )}
            </CardHeader>
            <CardContent>
              {billing.loading && !billing.data ? (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-40" />
                  <Skeleton className="h-4 w-64" />
                  <Skeleton className="h-4 w-48" />
                </div>
              ) : (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tracking-tight">{billing.data?.plan?.name ?? billing.data?.planName ?? "Free"}</span>
                    {billing.data?.plan && !billing.data.plan.contactSales && (billing.data.plan.priceMonthly ?? 0) > 0 ? (
                      <span className="text-sm text-muted-foreground">
                        {formatPkr(sub?.interval === "yearly" ? billing.data.plan.priceYearly : billing.data.plan.priceMonthly)}
                        /{sub?.interval === "yearly" ? "year" : "month"}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {billing.data?.plan?.contactSales ? "· custom pricing" : "· no charge"}
                      </span>
                    )}
                  </div>

                  <ul className="mt-3 space-y-1.5">
                    {(billing.data?.plan?.features ?? []).slice(0, 4).map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" /> {f}
                      </li>
                    ))}
                  </ul>

                  {sub?.currentPeriodEnd ? (
                    <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="size-3.5" />
                      {sub.status === "canceled"
                        ? `Access ends ${formatDate(sub.currentPeriodEnd)}`
                        : sub.cancelAtPeriodEnd
                          ? `Cancels on ${formatDate(sub.currentPeriodEnd)}`
                          : `Renews ${formatDate(sub.currentPeriodEnd)}`}
                    </p>
                  ) : null}

                  {/* Cancel / reinstate */}
                  {sub?.status === "active" && (
                    <div className="mt-4 border-t pt-4">
                      {sub.cancelAtPeriodEnd ? (
                        <Button variant="outline" size="sm" onClick={() => void doCancel(false)} disabled={cancelBusy}>
                          {cancelBusy ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : null}
                          Reinstate subscription
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setCancelOpen(true)}>
                          Cancel subscription
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </FadeUp>

        <FadeUp delay={0.06}>
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Usage this period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <UsageBar
                label="AI generations"
                used={used}
                limit={genLimit}
                hint="Resets monthly"
              />
              <UsageBar label="Storage" used={storageBytes} limit={storageLimitBytes} />
              <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
                Subscription state is verified through Safepay webhooks — the browser can never
                change your plan.
              </div>
            </CardContent>
          </Card>
        </FadeUp>
      </div>

      {/* Plans */}
      <div>
        <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <h2 className="text-lg font-semibold tracking-tight">Change plan</h2>
          <div className="flex rounded-lg border p-0.5">
            {(["monthly", "yearly"] as const).map((i) => (
              <button
                key={i}
                onClick={() => setInterval(i)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                  interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                aria-pressed={interval === i}
              >
                {i}
                {i === "yearly" && <span className="ml-1 text-[10px] opacity-80">−17%</span>}
              </button>
            ))}
          </div>
        </div>

        {!billingEnabled && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Online payments aren&apos;t configured on this deployment yet (SAFEPAY_BEACON_SECRET missing).
            Plans below are shown for reference.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(plans.data ?? []).map((plan) => {
            const Icon = PLAN_ICONS[plan.tier ?? ""] ?? Sparkles;
            const isCurrent = plan._id === billing.data?.plan?._id || plan.tier === currentTier;
            const price = interval === "yearly" ? plan.priceYearly : plan.priceMonthly;
            const busy = checkoutBusy === plan._id;
            return (
              <div
                key={plan._id}
                className={cn(
                  "relative flex h-full flex-col rounded-xl border bg-card p-5",
                  plan.popular && "border-primary/50 border-glow",
                  isCurrent && "ring-1 ring-emerald-500/50"
                )}
              >
                {isCurrent && (
                  <Badge className="absolute -top-2.5 left-5 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                    Current
                  </Badge>
                )}
                {plan.popular && !isCurrent && (
                  <Badge className="absolute -top-2.5 left-5 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold">
                    Popular
                  </Badge>
                )}
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-primary" />
                  <h3 className="font-semibold tracking-tight">{plan.name}</h3>
                </div>
                <p className="mt-1 min-h-9 text-xs leading-relaxed text-muted-foreground">{plan.description}</p>
                <div className="mt-3 flex items-baseline gap-1">
                  {plan.contactSales || price === 0 ? (
                    <span className="text-2xl font-semibold tracking-tight">{plan.contactSales ? "Custom" : "Free"}</span>
                  ) : (
                    <>
                      <span className="text-2xl font-semibold tracking-tight">{formatPkr(price)}</span>
                      <span className="text-xs text-muted-foreground">/{interval === "yearly" ? "yr" : "mo"}</span>
                    </>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {plan.maxAiGenerations >= 1000000 ? "Unlimited" : plan.maxAiGenerations.toLocaleString()} generations ·{" "}
                  {formatBytes(plan.maxStorageMb * 1024 * 1024)} storage
                </p>
                <ul className="mt-3 flex-1 space-y-1.5">
                  {plan.features.slice(0, 4).map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Check className="mt-0.5 size-3 shrink-0 text-emerald-500" /> {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-4 w-full"
                  variant={isCurrent ? "outline" : plan.popular ? "default" : "secondary"}
                  disabled={isCurrent || busy || plans.loading || (activePlanIds.size === 0)}
                  onClick={() => void startCheckout(plan)}
                >
                  {busy ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : isCurrent ? null : (
                    <ArrowUpRight className="mr-1.5 size-3.5" />
                  )}
                  {isCurrent ? "Your plan" : plan.contactSales ? "Contact sales" : price === 0 ? "Included" : `Choose ${plan.name}`}
                </Button>
              </div>
            );
          })}
          {plans.loading && !plans.data &&
            [0, 1, 2, 3].map((i) => <div key={i} className="skeleton-shimmer h-72 rounded-xl border bg-card" />)}
        </div>
      </div>

      {/* Payment history */}
      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Payment history</h2>
        {(billing.data?.payments ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            No payments yet. Upgrades are charged through Safepay when you choose a paid plan.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Safepay reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(billing.data?.payments ?? []).map((p) => (
                  <TableRow key={p._id}>
                    <TableCell className="text-sm">{formatDate(p.createdAt)}</TableCell>
                    <TableCell className="text-sm font-medium tabular-nums">{formatPkr(p.amount)}</TableCell>
                    <TableCell>
                      <StatusBadge kind="payment" status={String(p.status)} />
                      {p.failureReason ? (
                        <p className="mt-1 max-w-56 truncate text-[11px] text-muted-foreground" title={p.failureReason}>
                          {p.failureReason}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden max-w-40 truncate font-mono text-xs text-muted-foreground sm:table-cell">
                      {p.safepayTrackingId ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel subscription?"
        description="Your paid features stay active until the end of the current billing period, then your account moves to the Free plan. Your documents are never deleted."
        confirmLabel="Cancel subscription"
        destructive
        loading={cancelBusy}
        onConfirm={() => void doCancel(true)}
      />
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl"><Skeleton className="h-96 w-full rounded-xl" /></div>}>
      <BillingContent />
    </Suspense>
  );
}
