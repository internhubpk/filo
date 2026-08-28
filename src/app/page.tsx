"use client";

// =============================================================================
// FILO LANDING PAGE
// =============================================================================
// Premium SaaS marketing page. Positioning: "Create professional work with AI."
// The pricing preview loads REAL plans from /api/plans (Convex-driven).
// Animations are subtle and reduced-motion aware.
// =============================================================================

import { useEffect, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  Sparkles,
  FileText,
  FileSpreadsheet,
  Presentation,
  FileType2,
  Table2,
  ArrowRight,
  Check,
  Zap,
  ShieldCheck,
  Clock,
  Cloud,
  Layers,
  Languages,
  Wand2,
  FileDown,
  Bot,
  Lock,
  Server,
  ChevronDown,
  Moon,
  Sun,
  Menu,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { formatPkr } from "@/lib/format";
import { apiClient } from "@/lib/api-client";
import { useFiloSession } from "@/hooks/use-session";
import { LogoMark } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  FadeUp,
  StaggerContainer,
  StaggerItem,
  HoverLift,
  FadeIn,
} from "@/components/animations";

const EASE = [0.16, 1, 0.3, 1] as const;

const FORMATS = [
  { icon: FileText, label: "Documents", ext: "DOCX" },
  { icon: FileType2, label: "PDFs", ext: "PDF" },
  { icon: Table2, label: "Spreadsheets", ext: "XLSX" },
  { icon: Presentation, label: "Presentations", ext: "PPTX" },
  { icon: FileSpreadsheet, label: "Data sheets", ext: "CSV" },
  { icon: Layers, label: "Reports", ext: "DOCX" },
];

const FEATURES = [
  {
    icon: Wand2,
    title: "One prompt, a finished file",
    body: "Describe the outcome — Filo plans the structure, writes every section, and renders a polished file you can share immediately.",
  },
  {
    icon: Bot,
    title: "Structure-aware AI",
    body: "Blueprints keep long documents coherent: headings, tables, and conclusions build on each other instead of drifting.",
  },
  {
    icon: FileDown,
    title: "Real exports, no watermarks",
    body: "Download DOCX, PDF, XLSX, PPTX, and CSV files that open cleanly in Word, Excel, PowerPoint, and Google Workspace.",
  },
  {
    icon: Languages,
    title: "Business & academic tone",
    body: "From board-ready proposals to literature reviews — pick a tone and Filo keeps terminology and voice consistent.",
  },
  {
    icon: Zap,
    title: "Fast by design",
    body: "Section-level generation and smart retries mean long documents keep moving even when a single request stumbles.",
  },
  {
    icon: Cloud,
    title: "Your work, everywhere",
    body: "Every artifact and upload is stored in secure cloud storage, organized and downloadable from any device.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Describe what you need",
    body: "A sentence is enough — “a 12-page investor update for our fintech seed round”. Attach context files if you have them.",
  },
  {
    n: "02",
    title: "Watch Filo build it",
    body: "Filo drafts an outline, then generates section by section with live progress. You see the structure take shape in real time.",
  },
  {
    n: "03",
    title: "Export and share",
    body: "Preview the result, download in the format you need, or regenerate sections until it's exactly right.",
  },
];

const FAQ = [
  {
    q: "What can Filo generate?",
    a: "Professional documents (DOCX), PDFs, spreadsheets (XLSX, CSV), presentations (PPTX), reports, business documents like proposals and memos, and academic documents like essays and literature reviews.",
  },
  {
    q: "Are the exported files real files?",
    a: "Yes. Filo renders actual DOCX/PDF/XLSX/PPTX/CSV files that open in Word, Excel, PowerPoint, Google Workspace, and any standards-compliant viewer. Nothing is an image of text.",
  },
  {
    q: "How does billing work?",
    a: "Plans are billed monthly or yearly in PKR through Safepay, Pakistan's payment platform. Your subscription status comes straight from our billing database — when a payment is confirmed, your plan upgrades instantly.",
  },
  {
    q: "Is my data private?",
    a: "Your documents and uploads are private to your account, stored in encrypted cloud storage with per-user access controls. Deleting a file removes it from storage.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from the billing page and your plan stays active until the end of the period you already paid for. After that you're moved to the Free plan — nothing is deleted.",
  },
];

interface PlanPreview {
  _id: string;
  name: string;
  description: string;
  tier?: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  features: string[];
  popular: boolean;
  active: boolean;
  contactSales?: boolean;
  maxAiGenerations: number;
  maxStorageMb: number;
}

export default function LandingPage() {
  const { user } = useFiloSession();
  const [plans, setPlans] = useState<PlanPreview[] | null>(null);
  const [plansError, setPlansError] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Real plans for the pricing preview.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getPlans()
      .then((res) => {
        if (cancelled) return;
        if (res.success && Array.isArray(res.data)) {
          setPlans(((res.data as unknown) as PlanPreview[]).filter((p) => p.active));
        } else {
          setPlansError(true);
        }
      })
      .catch(() => !cancelled && setPlansError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const primaryHref = user ? "/create" : "/register";
  const dashboardHref = user ? "/dashboard" : "/login";

  return (
    <div className="min-h-screen bg-background">
      <SiteNav primaryHref={primaryHref} dashboardHref={dashboardHref} mobileOpen={mobileNavOpen} setMobileOpen={setMobileNavOpen} />

      {/* ============================ HERO ============================ */}
      <section className="relative overflow-hidden pt-16 sm:pt-24">
        <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <FadeIn>
              <Badge variant="outline" className="gap-1.5 rounded-full border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                <Sparkles className="size-3" />
                AI document generation for serious work
              </Badge>
            </FadeIn>
            <motion.h1
              className="text-display mt-6 text-4xl leading-[1.08] sm:text-6xl"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.05 }}
            >
              Create professional
              <br />
              <span className="text-gradient">work with AI.</span>
            </motion.h1>
            <motion.p
              className="mx-auto mt-5 max-w-xl text-base text-muted-foreground sm:text-lg"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.14 }}
            >
              Filo turns a short description into polished documents, spreadsheets,
              presentations, and reports — structured, written, and exported as real files.
            </motion.p>
            <motion.div
              className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.22 }}
            >
              <Button asChild size="lg" className="h-11 w-full px-6 text-sm sm:w-auto">
                <Link href={primaryHref}>
                  Start creating free <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 w-full px-6 text-sm sm:w-auto">
                <Link href="#formats">See what it makes</Link>
              </Button>
            </motion.div>
            <p className="mt-4 text-xs text-muted-foreground">
              Free plan includes 25 generations / month · No credit card required
            </p>
          </div>

          {/* Floating artifact previews */}
          <HeroPreview />
        </div>
      </section>

      {/* ============================ FORMATS ============================ */}
      <section id="formats" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <FadeUp>
          <SectionHeading
            eyebrow="Artifact formats"
            title="Every format your work needs"
            body="Filo renders real, standards-compliant files — not text dumps. Pick the output format, or let Filo choose based on your prompt."
          />
        </FadeUp>
        <StaggerContainer className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {FORMATS.map((f) => (
            <StaggerItem key={f.label}>
              <HoverLift>
                <div className="flex flex-col items-center gap-2 rounded-xl border bg-card px-3 py-6 text-center">
                  <f.icon className="size-6 text-primary" />
                  <p className="text-sm font-medium">{f.label}</p>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
                    {f.ext}
                  </span>
                </div>
              </HoverLift>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </section>

      {/* ============================ WORKFLOW ============================ */}
      <section className="border-y bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <FadeUp>
            <SectionHeading
              eyebrow="How it works"
              title="From prompt to polished file in three steps"
              body="No templates to wrestle, no formatting to fix. Describe, watch, export."
            />
          </FadeUp>
          <StaggerContainer className="mt-12 grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <StaggerItem key={s.n}>
                <div className="h-full rounded-xl border bg-card p-6">
                  <span className="text-sm font-semibold tabular-nums text-primary">{s.n}</span>
                  <h3 className="mt-3 text-lg font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ============================ FEATURES ============================ */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <FadeUp>
          <SectionHeading
            eyebrow="Capabilities"
            title="Built for real professional output"
            body="Filo is a production system — durable generation, honest progress, and files that survive contact with your boss."
          />
        </FadeUp>
        <StaggerContainer className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <StaggerItem key={f.title}>
              <div className="group h-full rounded-xl border bg-card p-6 transition-colors hover:border-primary/40">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">
                  <f.icon className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </section>

      {/* ============================ TEMPLATES ============================ */}
      <section className="border-y bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <FadeUp>
              <SectionHeading
                align="left"
                eyebrow="Templates & presets"
                title="Start from proven structures"
                body="Filo ships with battle-tested blueprints for the documents professionals actually write — each one a full structure with the right sections, tone, and depth baked in."
              />
              <ul className="mt-6 space-y-3">
                {[
                  "Business proposals & investor updates",
                  "Project reports & status documents",
                  "Academic essays & literature reviews",
                  "Financial models & budget trackers",
                  "Sales decks & product presentations",
                  "Meeting agendas, briefs & memos",
                ].map((t) => (
                  <li key={t} className="flex items-center gap-2.5 text-sm">
                    <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <Check className="size-3" />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </FadeUp>
            <FadeUp delay={0.1}>
              <TemplatePreview />
            </FadeUp>
          </div>
        </div>
      </section>

      {/* ============================ PRICING PREVIEW ============================ */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <FadeUp>
          <SectionHeading
            eyebrow="Pricing"
            title="Simple plans, real payments"
            body="Billed in PKR through Safepay. Start free, upgrade when the work demands it."
          />
        </FadeUp>

        {plansError ? (
          <FadeUp className="mt-12">
            <EmptyNote>
              Plans couldn&apos;t be loaded right now — please refresh, or{" "}
              <Link href="/pricing" className="font-medium text-primary underline-offset-4 hover:underline">
                open the full pricing page
              </Link>
              .
            </EmptyNote>
          </FadeUp>
        ) : (
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {(plans ?? []).slice(0, 3).map((plan, i) => (
              <FadeUp key={plan._id} delay={i * 0.08}>
                <div
                  className={cn(
                    "relative flex h-full flex-col rounded-xl border bg-card p-6",
                    plan.popular && "border-primary/50 border-glow"
                  )}
                >
                  {plan.popular && (
                    <Badge className="absolute -top-2.5 left-6 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold">
                      Most popular
                    </Badge>
                  )}
                  <h3 className="font-semibold tracking-tight">{plan.name}</h3>
                  <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.description}</p>
                  <div className="mt-4 flex items-baseline gap-1">
                    {plan.contactSales || plan.priceMonthly === 0 ? (
                      <span className="text-3xl font-semibold tracking-tight">
                        {plan.contactSales ? "Custom" : "Free"}
                      </span>
                    ) : (
                      <>
                        <span className="text-3xl font-semibold tracking-tight">{formatPkr(plan.priceMonthly)}</span>
                        <span className="text-sm text-muted-foreground">/month</span>
                      </>
                    )}
                  </div>
                  <ul className="mt-5 flex-1 space-y-2.5">
                    {plan.features.slice(0, 5).map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant={plan.popular ? "default" : "outline"} className="mt-6 w-full">
                    <Link href={user ? `/billing?plan=${plan.tier ?? plan._id}` : "/register"}>
                      {plan.contactSales ? "Contact sales" : plan.priceMonthly === 0 ? "Start free" : "Choose " + plan.name}
                    </Link>
                  </Button>
                </div>
              </FadeUp>
            ))}
            {!plans && (
              <>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton-shimmer h-80 rounded-xl border bg-card" />
                ))}
              </>
            )}
          </div>
        )}

        <FadeUp className="mt-8 text-center">
          <Link href="/pricing" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Compare all plans and features →
          </Link>
        </FadeUp>
      </section>

      {/* ============================ SECURITY ============================ */}
      <section className="border-y bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="grid gap-8 sm:grid-cols-3">
            {[
              {
                icon: Lock,
                title: "Private by default",
                body: "Files and artifacts are scoped to your account with server-side ownership checks on every request.",
              },
              {
                icon: ShieldCheck,
                title: "Verified payments",
                body: "Subscriptions activate only after Safepay's signed webhook confirms payment — never from the browser.",
              },
              {
                icon: Server,
                title: "Honest status, always",
                body: "Every number you see — usage, storage, plan state — is read live from our database. No mock dashboards.",
              },
            ].map((s, i) => (
              <FadeUp key={s.title} delay={i * 0.06}>
                <div className="flex gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <s.icon className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold tracking-tight">{s.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                  </div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ FAQ ============================ */}
      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28">
        <FadeUp>
          <SectionHeading eyebrow="FAQ" title="Questions, answered" />
        </FadeUp>
        <FadeUp delay={0.08} className="mt-10">
          <Accordion type="single" collapsible className="w-full">
            {FAQ.map((item) => (
              <AccordionItem key={item.q} value={item.q}>
                <AccordionTrigger className="text-left text-[15px]">{item.q}</AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </FadeUp>
      </section>

      {/* ============================ FINAL CTA ============================ */}
      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <FadeUp>
          <div className="card-sheen relative overflow-hidden rounded-2xl border bg-card px-6 py-16 text-center sm:px-12">
            <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
            <div className="relative">
              <h2 className="text-display text-3xl sm:text-4xl">Your next document is one sentence away.</h2>
              <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
                Join the people who stopped formatting and started finishing. Free to start.
              </p>
              <Button asChild size="lg" className="mt-8 h-11 px-8 text-sm">
                <Link href={primaryHref}>
                  Create your first document <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </FadeUp>
      </section>

      <SiteFooter />
    </div>
  );
}

// ============================ SUB-COMPONENTS ============================

function SectionHeading({
  eyebrow,
  title,
  body,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  body?: string;
  align?: "center" | "left";
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" ? "mx-auto text-center" : "text-left")}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
      <h2 className="text-display mt-3 text-2xl sm:text-4xl">{title}</h2>
      {body ? <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{body}</p> : null}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function SiteNav({
  primaryHref,
  dashboardHref,
  mobileOpen,
  setMobileOpen,
}: {
  primaryHref: string;
  dashboardHref: string;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-colors",
        scrolled ? "border-border bg-background/85 backdrop-blur" : "border-transparent bg-transparent"
      )}
    >
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark size={28} />
          <span className="text-[15px] font-semibold tracking-tight">Filo</span>
        </Link>
        <div className="ml-2 hidden items-center gap-1 md:flex">
          {[
            ["Formats", "#formats"],
            ["How it works", "#workflow"],
            ["Pricing", "/pricing"],
            ["FAQ", "#faq"],
          ].map(([label, href]) => (
            <Link
              key={label}
              href={href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href={dashboardHref}>Log in</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href={primaryHref}>Get started</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </nav>
      {mobileOpen && (
        <div className="border-t bg-background px-4 py-3 md:hidden">
          {[
            ["Formats", "#formats"],
            ["How it works", "#workflow"],
            ["Pricing", "/pricing"],
            ["FAQ", "#faq"],
            ["Log in", dashboardHref],
          ].map(([label, href]) => (
            <Link
              key={label}
              href={href}
              onClick={() => setMobileOpen(false)}
              className="block rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {label}
            </Link>
          ))}
          <Button asChild size="sm" className="mt-2 w-full">
            <Link href={primaryHref} onClick={() => setMobileOpen(false)}>
              Get started free
            </Link>
          </Button>
        </div>
      )}
    </header>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
    >
      {mounted && resolvedTheme === "dark" ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
    </Button>
  );
}

const EASE_OUT = { duration: 0.6, ease: EASE };

function HeroPreview() {
  const reduced = useReducedMotion() ?? false;
  const float = (delay: number, y: number, x: number, rotate: number) => ({
    initial: { opacity: 0, y: 24 },
    animate: reduced
      ? ({ opacity: 1, y: 0 } as any)
      : ({ opacity: 1, y: [0, y, 0], x: [0, x, 0], rotate: [0, rotate, 0] } as any),
    transition:
      delay === 0
        ? EASE_OUT
        : ({ duration: 7, repeat: Infinity, ease: "easeInOut", delay } as any),
  });

  return (
    <div className="relative mx-auto mt-14 max-w-3xl sm:mt-20" aria-hidden>
      {/* Center: prompt card */}
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: EASE, delay: 0.3 }}
        className="relative z-10 rounded-xl border bg-card p-4 shadow-xl sm:p-5"
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          Describe what you need…
        </div>
        <p className="mt-3 text-sm leading-relaxed sm:text-[15px]">
          &ldquo;A 10-page investor update: metrics summary, product progress, runway — confident tone.&rdquo;
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded-md border px-2 py-1 font-medium">DOCX</span>
            <span className="rounded-md border px-2 py-1 font-medium">PDF</span>
          </div>
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">
            Generate <ArrowRight className="size-3" />
          </span>
        </div>
        {/* generation progress line */}
        <div className="mt-4 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span className="pulse-dot size-1.5 rounded-full bg-emerald-500" />
          Planning sections… 4 of 10 written
        </div>
      </motion.div>

      {/* Floating side cards */}
      <motion.div {...float(0.9, -10, 6, -1.5)} className="absolute -left-16 -top-8 z-0 hidden w-48 rounded-lg border bg-card/95 p-3 shadow-lg backdrop-blur lg:block">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-blue-500" />
          <span className="text-xs font-medium">Q3 Report.docx</span>
        </div>
        <div className="mt-2 space-y-1.5">
          <div className="h-1.5 w-full rounded bg-muted" />
          <div className="h-1.5 w-4/5 rounded bg-muted" />
          <div className="h-1.5 w-3/5 rounded bg-muted" />
        </div>
      </motion.div>

      <motion.div {...float(1.6, 12, -8, 2)} className="absolute -bottom-10 -right-14 z-0 hidden w-44 rounded-lg border bg-card/95 p-3 shadow-lg backdrop-blur lg:block">
        <div className="flex items-center gap-2">
          <Presentation className="size-4 text-orange-500" />
          <span className="text-xs font-medium">Pitch deck.pptx</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] rounded-sm bg-muted" />
          ))}
        </div>
      </motion.div>

      <motion.div {...float(2.2, -14, -4, 1.5)} className="absolute -right-10 -top-10 z-0 hidden w-40 rounded-lg border bg-card/95 p-3 shadow-lg backdrop-blur lg:block">
        <div className="flex items-center gap-2">
          <Table2 className="size-4 text-emerald-500" />
          <span className="text-xs font-medium">Budget.xlsx</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={cn("h-2 rounded-sm", i % 5 === 0 ? "bg-emerald-500/25" : "bg-muted")} />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function TemplatePreview() {
  const rows = [
    { icon: FileText, name: "Investor Update", meta: "Report · 10 pages" },
    { icon: Presentation, name: "Sales Pitch Deck", meta: "Presentation · 12 slides" },
    { icon: Table2, name: "Annual Budget", meta: "Spreadsheet · 4 sheets" },
    { icon: FileType2, name: "Research Summary", meta: "PDF · 6 pages" },
  ];
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between border-b pb-3">
        <p className="text-sm font-medium">Start from a template</p>
        <span className="text-xs text-muted-foreground">6 of 24</span>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <motion.div
            key={r.name}
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08, duration: 0.4, ease: EASE }}
            className="flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <r.icon className="size-4.5 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.name}</p>
              <p className="truncate text-xs text-muted-foreground">{r.meta}</p>
            </div>
            <ArrowRight className="size-4 text-muted-foreground" />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-xs">
            <div className="flex items-center gap-2">
              <LogoMark size={28} />
              <span className="text-[15px] font-semibold tracking-tight">Filo</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Create professional work with AI. Documents, spreadsheets, presentations, and reports — from a single prompt.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <FooterCol
              title="Product"
              links={[
                ["Formats", "/#formats"],
                ["Pricing", "/pricing"],
                ["FAQ", "/#faq"],
              ]}
            />
            <FooterCol
              title="Get started"
              links={[
                ["Create an account", "/register"],
                ["Log in", "/login"],
                ["Dashboard", "/dashboard"],
              ]}
            />
            <FooterCol
              title="Account"
              links={[
                ["Billing", "/billing"],
                ["Settings", "/settings"],
                ["Help", "/help"],
              ]}
            />
          </div>
        </div>
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Filo. All rights reserved.</p>
          <p>Payments secured by Safepay · Built with Next.js, Convex & Cloudflare</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
