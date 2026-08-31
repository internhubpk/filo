"use client";

// =============================================================================
// PRICING (public) — driven ENTIRELY by Convex plans via /api/plans.
// Logged-in visitors check out directly; visitors are sent to /register.
// =============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Sparkles, Crown, Users, Building2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBytes, formatPkr } from "@/lib/format";
import { apiClient } from "@/lib/api-client";
import { useFiloSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FadeUp, FadeIn } from "@/components/animations";

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

const PLAN_ICONS: Record<string, typeof Sparkles> = { free: Sparkles, pro: Crown, team: Users, department: Building2 };

const FAQ = [
  {
    q: "How do payments work?",
    a: "Paid plans are billed in PKR through Safepay, a Pakistani payment platform. After you complete checkout, Safepay notifies our system with a signed webhook and your plan activates automatically — usually within seconds.",
  },
  {
    q: "What happens when I hit my generation limit?",
    a: "Generation pauses until the next month, or you can upgrade immediately for a higher limit. Failed generations never count against your quota.",
  },
  {
    q: "Can I cancel?",
    a: "Yes — one click from the billing page. Your plan stays active until the end of the period you've paid for, then your account moves to Free. Your documents are never deleted.",
  },
  {
    q: "Do you offer yearly billing?",
    a: "Yes — yearly plans save about 17% compared to paying monthly.",
  },
];

export default function PricingPage() {
  const { user } = useFiloSession();
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState(false);
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getPlans()
      .then((res) => {
        if (cancelled) return;
        if (res.success && Array.isArray(res.data)) setPlans(((res.data as unknown) as PlanRow[]).filter((p) => p.active));
        else setError(true);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  async function choose(plan: PlanRow) {
    if (!user) {
      window.location.href = `/register?plan=${plan.tier ?? plan._id}`;
      return;
    }
    if (plan.tier === "free") {
      window.location.href = "/chat";
      return;
    }
    if (plan.contactSales) {
      window.location.href = "mailto:sales@filo.app?subject=Filo%20Department%20plan";
      return;
    }
    setBusy(plan._id);
    try {
      const res = await apiClient.startCheckout({ planId: plan._id, interval });
      if (!res.success || !res.data?.checkoutUrl) {
        toast.error(res.error || "Could not start checkout");
        return;
      }
      window.location.href = res.data.checkoutUrl;
    } catch {
      toast.error("Checkout failed — please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="border-b bg-background/85 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Filo</span>
          </Link>
          <Button asChild variant="ghost" size="sm" className="ml-auto">
            <Link href="/">
              <ArrowLeft className="mr-1.5 size-3.5" /> Back home
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href={user ? "/chat" : "/register"}>{user ? "Open Filo" : "Get started"}</Link>
          </Button>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
        <FadeIn className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Pricing</p>
          <h1 className="text-display mt-3 text-4xl sm:text-5xl">Pay for output, not seats you don&apos;t use.</h1>
          <p className="mt-4 text-[15px] text-muted-foreground">
            Every plan includes real file exports and secure cloud storage. Prices in PKR, billed securely through Safepay.
          </p>
          <div className="mt-6 inline-flex rounded-lg border p-0.5">
            {(["monthly", "yearly"] as const).map((i) => (
              <button
                key={i}
                onClick={() => setInterval(i)}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors",
                  interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                aria-pressed={interval === i}
              >
                {i}
                {i === "yearly" && <span className="ml-1 text-[10px] opacity-80">−17%</span>}
              </button>
            ))}
          </div>
        </FadeIn>

        {/* Plans */}
        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {error ? (
            <div className="col-span-full rounded-xl border border-dashed px-6 py-14 text-center text-sm text-muted-foreground">
              Plans couldn&apos;t load just now. Please refresh the page in a moment.
            </div>
          ) : !plans ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-96 rounded-xl" />)
          ) : (
            plans.map((plan, idx) => {
              const Icon = PLAN_ICONS[plan.tier ?? ""] ?? Sparkles;
              const price = interval === "yearly" ? plan.priceYearly : plan.priceMonthly;
              return (
                <FadeUp key={plan._id} delay={idx * 0.06}>
                  <div
                    className={cn(
                      "lift relative flex h-full flex-col rounded-xl border bg-card p-6 shadow-sm",
                      plan.popular && "border-primary/50 border-glow"
                    )}
                  >
                    {plan.popular && (
                      <Badge className="absolute -top-2.5 left-6 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold">
                        Most popular
                      </Badge>
                    )}
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 text-primary" />
                      <h2 className="font-semibold tracking-tight">{plan.name}</h2>
                    </div>
                    <p className="mt-1.5 min-h-10 text-sm text-muted-foreground">{plan.description}</p>
                    <div className="mt-4 flex items-baseline gap-1">
                      {plan.contactSales || price === 0 ? (
                        <span className="text-3xl font-semibold tracking-tight">{plan.contactSales ? "Custom" : "Free"}</span>
                      ) : (
                        <>
                          <span className="text-3xl font-semibold tracking-tight">{formatPkr(price)}</span>
                          <span className="text-sm text-muted-foreground">/{interval === "yearly" ? "yr" : "mo"}</span>
                        </>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {plan.maxAiGenerations >= 1000000 ? "Unlimited" : plan.maxAiGenerations.toLocaleString()} generations/mo ·{" "}
                      {formatBytes(plan.maxStorageMb * 1024 * 1024)}
                    </p>
                    <ul className="mt-5 flex-1 space-y-2">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" /> {f}
                        </li>
                      ))}
                    </ul>
                    <Button
                      className={cn("press mt-6 w-full", plan.popular && "shadow-lg shadow-primary/25")}
                      variant={plan.popular ? "default" : "outline"}
                      disabled={busy === plan._id}
                      onClick={() => void choose(plan)}
                    >
                      {busy === plan._id && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                      {plan.contactSales
                        ? "Contact sales"
                        : price === 0
                          ? user
                            ? "Go to dashboard"
                            : "Start free"
                          : `Choose ${plan.name}`}
                    </Button>
                  </div>
                </FadeUp>
              );
            })
          )}
        </div>

        {/* Comparison */}
        {plans && (
          <FadeUp className="mt-14 overflow-hidden rounded-xl border">
            <div className="border-b bg-muted/50 px-5 py-3">
              <h2 className="text-sm font-semibold">What&apos;s included</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">Feature</th>
                    {plans.map((p) => (
                      <th key={p._id} className="px-5 py-2.5 text-center font-medium">{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["AI generations / month", (p: PlanRow) => (p.maxAiGenerations >= 1000000 ? "Unlimited" : p.maxAiGenerations.toLocaleString())],
                    ["Storage", (p: PlanRow) => formatBytes(p.maxStorageMb * 1024 * 1024)],
                    ["All export formats", (p: PlanRow) => (p.tier === "free" ? "DOCX, PDF, CSV" : "DOCX, PDF, XLSX, PPTX, CSV")],
                    ["Priority queue", (p: PlanRow) => (p.tier === "free" ? "—" : "✓")],
                    ["Brand profiles", (p: PlanRow) => (p.tier === "free" ? "—" : "✓")],
                    ["Team features", (p: PlanRow) => (p.tier === "team" || p.tier === "department" ? "✓" : "—")],
                  ].map(([label, get]) => (
                    <tr key={label as string} className="border-b last:border-0">
                      <td className="px-5 py-3 font-medium">{label as string}</td>
                      {plans.map((p) => (
                        <td key={p._id} className="px-5 py-3 text-center text-muted-foreground">
                          {(get as (p: PlanRow) => string)(p)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeUp>
        )}

        {/* FAQ */}
        <div className="mx-auto mt-16 max-w-2xl">
          <FadeUp>
            <h2 className="text-display text-center text-2xl">Billing questions</h2>
          </FadeUp>
          <FadeUp delay={0.06} className="mt-8">
            <Accordion type="single" collapsible>
              {FAQ.map((f) => (
                <AccordionItem key={f.q} value={f.q}>
                  <AccordionTrigger className="text-left text-[15px]">{f.q}</AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </FadeUp>
        </div>
      </main>
    </div>
  );
}
