"use client";

// =============================================================================
// WelcomeOrb — animated centerpiece for the chat empty state.
// =============================================================================
// A calm "AI aurora" orb: an empty frosted circular core wrapped by ONE
// rotating conic arc and a breathing glow. The brand logo stays out of the
// animation on purpose — the orb is pure motion, no mark inside.
//
// Why this design: every animation is transform/opacity ONLY, so each layer is
// GPU-composited and holds a steady 60fps (no path/stroke re-paints, no layout
// work). The global prefers-reduced-motion override in globals.css collapses
// the loops to a single instant run → a static, fully-formed orb.
// =============================================================================

import { cn } from "@/lib/utils";

export function WelcomeOrb({ className }: { className?: string }) {
  return (
    <div className={cn("relative size-16", className)} aria-hidden="true">
      {/* Breathing aurora glow (behind everything) */}
      <div className="wg-orb-glow absolute -inset-3 rounded-full" />

      {/* Single rotating arc */}
      <div className="wg-orb-arc absolute inset-0 rounded-full" />

      {/* Frosted core — intentionally empty */}
      <div className="absolute inset-[7px] rounded-full border border-primary/15 bg-card shadow-sm" />
    </div>
  );
}
