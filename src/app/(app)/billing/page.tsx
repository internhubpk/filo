"use client";

// =============================================================================
// BILLING — real Safepay sandbox subscriptions.
// =============================================================================
// - Current subscription + plan read live from Convex (/api/billing/subscription)
// - Plan cards built from DB-driven plans (/api/plans); checkout calls
//   /api/billing/checkout which creates the pending subscription + Safepay
//   session server-side and returns the hosted payment URL.
// - The UI NEVER marks a payment successful. After returning from Safepay
//   the page ACTIVELY VERIFIES the payment server-to-server (Safepay Fetch
//   Tracker API via /api/billing/verify, every 5s) and flips to ACTIVE the
//   moment it is confirmed — webhook delivery is no longer a single point
//   of failure. Signed return POSTs confirm instantly as well.
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
  // The plan a PENDING checkout would grant once Safepay confirms it. Never
  // the current entitlement — only shown in the "waiting for confirmation"
  // banner, never on the "Current plan" card or in the quota numbers.
  pendingPlan?: {
    _id?: string;
    name: string;
    priceMonthly: number;
    priceYearly: number;
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

interface VerifyPayload {
  status: "confirmed" | "pending" | "failed" | "none";
  reason?: string;
  state?: string;
  detail?: string;
  subscriptionStatus?: string | null;
  mode?: "sandbox" | "production";
  subscriptionFlowConfigured?: boolean;
}

/**
 * Turn Safepay's raw verification answer into one human sentence so the
 * waiting state is never a black box ("still processing" forever helps
 * nobody — if Safepay says the payment never finished, say exactly that).
 */
function describeVerify(v: VerifyPayload | null): { line: string; tone: "info" | "warn" } {
  if (!v) return { line: "Checking your payment with Safepay…", tone: "info" };
  if (v.status === "confirmed") return { line: "Payment confirmed — your plan is active.", tone: "info" };
  if (v.status === "failed") {
    return { line: `Safepay reported this payment as ${v.state ?? "cancelled or expired"}. You can start checkout again any time — you were not charged for a failed payment.`, tone: "warn" };
  }
  const state = (v.state ?? "").toUpperCase();
  if (state === "TRACKER_STARTED") {
    return {
      line: "Safepay's latest status: payment STARTED but not completed. If you didn't finish Safepay's payment page (including the final 3-D Secure / confirm step), the plan cannot activate — pick the plan again to retry.",
      tone: "warn",
    };
  }
  if (state === "TRACKER_AUTHORIZED" || state === "TRACKER_ENROLLED") {
    return { line: `Safepay's latest status: ${state} — the payment is still in progress on Safepay's side.`, tone: "info" };
  }
  if (v.reason === "no_tracker") {
    return {
      line: "This checkout has no Safepay payment tracker attached, so only Safepay's webhook or its signed redirect can confirm it. Set up the webhook (guide below), or start a new checkout.",
      tone: "warn",
    };
  }
  if (v.reason === "tracker_unavailable") {
    return {
      line: `We couldn't read this payment from Safepay right now${v.detail ? ` (${v.detail})` : ""}. We'll keep retrying automatically — if this persists, verify the Safepay credentials (SAFEPAY_SECRET_KEY) on the server and that SAFEPAY_SANDBOX matches where you paid.`,
      tone: "warn",
    };
  }
  if (v.reason === "stale") {
    return {
      line: "This checkout is more than 24 hours old — Safepay has likely expired it. Please start the checkout again.",
      tone: "warn",
    };
  }
  if (state) {
    return { line: `Safepay's latest status: ${state}.`, tone: "info" };
  }
  return { line: "Safepay hasn't confirmed this payment yet. The page keeps checking automatically.", tone: "info" };
}

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

  const pendingCheckout = sub?.status === "pending";

  // ---- Active payment verification ----
  // While a checkout is pending we don't just wait for the webhook: every 5s
  // the server asks Safepay directly (Fetch Tracker API) whether the payment
  // completed and activates the plan the moment it is confirmed. This works
  // even if webhook delivery is delayed or not configured yet.
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyPolls, setVerifyPolls] = useState(0);
  // Toast-once guard, keyed by the pending subscription id (resets for new checkouts).
  const [confirmedForSub, setConfirmedForSub] = useState<string | null>(null);
  // Last raw answer from /api/billing/verify — rendered in the waiting banner
  // so the user sees WHAT Safepay actually reports instead of a black box.
  const [lastVerify, setLastVerify] = useState<VerifyPayload | null>(null);
  const subId = sub?._id ?? null;
  useEffect(() => {
    if (!pendingCheckout || confirmedForSub === subId) return;
    if (verifyPolls > 240) return; // keep trying for ~20 minutes of tab time
    const t = setTimeout(async () => {
      setVerifyPolls((p) => p + 1);
      try {
        const res = await apiClient.verifyPendingPayment();
        if (res.success && res.data) setLastVerify(res.data as VerifyPayload);
        if (res.success && res.data?.status === "confirmed" && confirmedForSub !== subId) {
          setConfirmedForSub(subId);
          toast.success("Payment confirmed", { description: "Your new plan is now active. Enjoy!" });
          await billing.refresh();
        } else if (res.success && res.data?.status === "failed") {
          setConfirmedForSub(subId);
          toast.error("Payment did not complete", {
            description: "Safepay reported the payment as cancelled or expired. You can start checkout again any time.",
          });
          await billing.refresh();
        }
      } catch {
        /* transient — keep polling */
      }
    }, 5_000);
    return () => clearTimeout(t);
  }, [pendingCheckout, verifyPolls, confirmedForSub, subId]);

  async function manualVerify() {
    setVerifyBusy(true);
    try {
      const res = await apiClient.verifyPendingPayment();
      if (res.success && res.data) setLastVerify(res.data as VerifyPayload);
      if (res.success && res.data?.status === "confirmed") {
        if (confirmedForSub !== subId) {
          setConfirmedForSub(subId);
          toast.success("Payment confirmed", { description: "Your new plan is now active. Enjoy!" });
        }
        await billing.refresh();
      } else if (res.success && res.data?.status === "failed") {
        toast.error("Payment did not complete", {
          description: "Safepay reported the payment as cancelled or expired. You can start checkout again any time.",
        });
        await billing.refresh();
      } else if (res.success && res.data) {
        const { line } = describeVerify(res.data as VerifyPayload);
        toast.info("Still processing", { description: line });
      } else {
        toast.info("Still processing", {
          description: "Safepay hasn't confirmed this payment yet. The page keeps checking automatically.",
        });
      }
    } catch {
      toast.error("Could not reach the payment verification service — it will retry automatically.");
    } finally {
      setVerifyBusy(false);
    }
  }

  // Post-checkout status toasts.
  const checkoutOutcome = search.get("checkout");
  useEffect(() => {
    if (checkoutOutcome === "confirmed") {
      toast.success("Payment confirmed", { description: "Your new plan is now active. Enjoy!" });
    } else if (checkoutOutcome === "cancelled") {
      toast.info("Checkout cancelled", { description: "No charge was made. You can pick a plan any time." });
    } else if (checkoutOutcome === "failed") {
      toast.error("Payment did not complete", {
        description: "Safepay reported the payment as cancelled or expired. You can start checkout again any time.",
      });
    } else if (checkoutOutcome === "invalid_signature") {
      toast.warning("Payment could not be verified on return", {
        description: "If you completed the payment, this page will detect and activate it automatically.",
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
      // Surface any appUrl misconfiguration BEFORE the user pays — this is
      // the exact condition that causes a 404 after the card is submitted,
      // and it's much cheaper to catch here than after a real payment.
      const debug = res.data.paymentDebug;
      if (debug?.warning) {
        console.warn("[billing] payment redirect misconfiguration:", debug);
        toast.warning("Payment redirect may be misconfigured", {
          description: `${debug.warning} You can still continue, but the return page may 404.`,
          duration: 10000,
        });
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

      {/* Post-checkout status banner — actively verified against Safepay */}
      {showPendingHint && sub?.status !== "active" && (() => {
        const statusLine = describeVerify(lastVerify);
        return (
          <FadeIn>
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
              <Loader2 className="mt-0.5 size-4.5 shrink-0 animate-spin text-amber-500" />
              <div className="flex-1 text-sm">
                <p className="font-medium">Waiting for payment confirmation</p>
                <p className="mt-0.5 text-muted-foreground">
                  {billing.data?.pendingPlan
                    ? <>You're still on the <span className="font-medium text-foreground">{billing.data.plan?.name ?? "Free"}</span> plan — <span className="font-medium text-foreground">{billing.data.pendingPlan.name}</span> activates the moment Safepay confirms this payment, even if you close this page and come back later.</>
                    : "We check your payment directly with Safepay every few seconds — your plan activates the moment the payment is confirmed, even if you close this page and come back later."}
                </p>
                {lastVerify && (
                  <p
                    className={cn(
                      "mt-2 rounded-lg border px-3 py-2 text-[13px] leading-relaxed",
                      statusLine.tone === "warn"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "border-border bg-muted/50 text-muted-foreground"
                    )}
                  >
                    {statusLine.line}
                  </p>
                )}
                {lastVerify?.mode && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Payments environment: <span className="font-medium text-foreground">{lastVerify.mode}</span>
                    {" · "}
                    {lastVerify.subscriptionFlowConfigured
                      ? "recurring subscriptions (Safepay-managed plans)"
                      : "payments not fully configured"}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={verifyBusy}
                    onClick={() => void manualVerify()}
                  >
                    {verifyBusy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 size-3.5" />}
                    Check payment status now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const pro = (plans.data ?? []).find((p) => p.tier === "pro");
                      if (pro) void startCheckout(pro);
                    }}
                  >
                    <CreditCard className="mr-1.5 size-3.5" />
                    Restart checkout
                  </Button>
                </div>
              </div>
            </div>
          </FadeIn>
        );
      })()}

      {/* Current plan + usage */}
      <div className="grid gap-5 lg:grid-cols-2">
        <FadeUp>
          <Card className="h-full">
            <CardHeader className="flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Current plan</CardTitle>
              {/* This card always reflects the ACTUALLY GRANTED entitlement
                  (billing.data.plan == user.planId), never a pending
                  checkout's target plan — so its badge must not show
                  "pending" either, or it reads as "your current plan is
                  itself unconfirmed", which isn't true. A pending checkout
                  for a DIFFERENT plan is surfaced in the banner above, not
                  here. Only show the subscription's own status badge when
                  that subscription IS the one backing the displayed plan. */}
              {sub && sub.status !== "pending" ? (
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
                        {/* sub.interval only applies when sub backs the DISPLAYED plan (see badge note above) */}
                        {formatPkr(sub?.status !== "pending" && sub?.interval === "yearly" ? billing.data.plan.priceYearly : billing.data.plan.priceMonthly)}
                        /{sub?.status !== "pending" && sub?.interval === "yearly" ? "year" : "month"}
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
              <UsageBar
                label="Storage"
                used={storageBytes}
                limit={storageLimitBytes}
                formatValue={formatBytes}
              />
              <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
                Plans activate only after Safepay-verified signals (webhooks, signed payment
                returns, or Safepay&apos;s payment API) — the browser can never change your plan.
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
            Online payments aren&apos;t configured on this deployment yet (SAFEPAY_SECRET_KEY missing).
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
                  {plan.maxStorageMb >= 1000000 ? "Unlimited" : formatBytes(plan.maxStorageMb * 1024 * 1024)} storage
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
          {!plans.loading && !plans.data && (
            <div className="col-span-full flex flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center">
              <p className="text-sm font-medium">Plans could not be loaded</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                {plans.error ?? "The plans service returned no data."} You can retry — this does not affect your current plan or entitlement.
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => void plans.refresh()}>
                Retry
              </Button>
            </div>
          )}
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
