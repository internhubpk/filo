"use client";

// =============================================================================
// WelcomeOrb — animated centerpiece for the chat empty state.
// =============================================================================
// A calm "AI aurora" orb: a frosted circular core wrapped by ONE rotating
// conic arc and a breathing glow. Inside the core, real file-type icons
// (Word → PowerPoint → PDF → CSV → Excel) crossfade slowly — a nod to what
// Filo turns conversations into.
//
// Why this design: every animation is transform/opacity ONLY, so each layer is
// GPU-composited and holds a steady 60fps (no path/stroke re-paints, no layout
// work). The global prefers-reduced-motion override in globals.css collapses
// the loops; a targeted rule pins the first icon so the orb never renders
// empty.
// =============================================================================

import { cn } from "@/lib/utils";
import {
  CsvIcon,
  ExcelIcon,
  PdfIcon,
  PowerPointIcon,
  WordIcon,
} from "@/components/shared/file-type-icons";

const FILE_TYPES = [
  { title: "Word document", Icon: WordIcon },
  { title: "PowerPoint deck", Icon: PowerPointIcon },
  { title: "PDF document", Icon: PdfIcon },
  { title: "CSV data", Icon: CsvIcon },
  { title: "Excel workbook", Icon: ExcelIcon },
] as const;

// 12s full cycle — each icon holds ~2s with a soft crossfade between.
const CYCLE_SECONDS = 12;
const STAGGER_SECONDS = CYCLE_SECONDS / FILE_TYPES.length;

export function WelcomeOrb({ className }: { className?: string }) {
  return (
    <div className={cn("relative size-16", className)} aria-hidden="true">
      {/* Breathing aurora glow (behind everything) */}
      <div className="wg-orb-glow absolute -inset-3 rounded-full" />

      {/* Single rotating arc */}
      <div className="wg-orb-arc absolute inset-0 rounded-full" />

      {/* Frosted core with the slowly cycling file-type icons */}
      <div className="absolute inset-[7px] flex items-center justify-center rounded-full border border-primary/15 bg-card shadow-sm">
        {FILE_TYPES.map(({ title, Icon }, i) => (
          <span
            key={title}
            className={cn("wg-orb-type absolute", i === 0 && "wg-orb-type-first")}
            style={{ animationDelay: `${i * STAGGER_SECONDS}s` }}
          >
            <Icon />
          </span>
        ))}
      </div>
    </div>
  );
}
