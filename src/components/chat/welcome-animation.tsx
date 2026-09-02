"use client";

// =============================================================================
// WelcomeOrb — animated centerpiece for the chat empty state.
// =============================================================================
// A calm "AI aurora" orb: a frosted circular core wrapped by ONE rotating
// conic arc and a breathing glow. Inside the core, file-type badges
// (Word → PPTX → PDF → CSV → XLSX) crossfade slowly — a nod to what Filo
// turns conversations into.
//
// Why this design: every animation is transform/opacity ONLY, so each layer is
// GPU-composited and holds a steady 60fps (no path/stroke re-paints, no layout
// work). The global prefers-reduced-motion override in globals.css collapses
// the loops; a targeted rule pins the first badge so the orb never renders
// empty.
// =============================================================================

import { cn } from "@/lib/utils";

// Office-style badges: brand color + letter, cycled slowly inside the core.
const FILE_TYPES = [
  { label: "W", title: "Word document", bg: "#185ABD", size: "text-[13px]" },
  { label: "P", title: "PowerPoint deck", bg: "#C43E1C", size: "text-[13px]" },
  { label: "PDF", title: "PDF document", bg: "#DC2626", size: "text-[7px]" },
  { label: "CSV", title: "CSV data", bg: "#0F766E", size: "text-[7px]" },
  { label: "X", title: "Excel workbook", bg: "#107C41", size: "text-[13px]" },
] as const;

// 12s full cycle — each badge holds ~2s with a soft crossfade between.
const CYCLE_SECONDS = 12;
const STAGGER_SECONDS = CYCLE_SECONDS / FILE_TYPES.length;

export function WelcomeOrb({ className }: { className?: string }) {
  return (
    <div className={cn("relative size-16", className)} aria-hidden="true">
      {/* Breathing aurora glow (behind everything) */}
      <div className="wg-orb-glow absolute -inset-3 rounded-full" />

      {/* Single rotating arc */}
      <div className="wg-orb-arc absolute inset-0 rounded-full" />

      {/* Frosted core with the slowly cycling file-type badges */}
      <div className="absolute inset-[7px] flex items-center justify-center rounded-full border border-primary/15 bg-card shadow-sm">
        {FILE_TYPES.map((t, i) => (
          <span
            key={t.title}
            className={cn(
              "wg-orb-type absolute flex size-6 items-center justify-center rounded-[6px] font-bold leading-none text-white shadow-sm select-none",
              t.size,
              i === 0 && "wg-orb-type-first"
            )}
            style={{ backgroundColor: t.bg, animationDelay: `${i * STAGGER_SECONDS}s` }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
