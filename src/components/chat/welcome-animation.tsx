"use client";

// =============================================================================
// WelcomeOrb — animated centerpiece for the chat empty state.
// =============================================================================
// A calm "AI aurora" orb: the Filo mark sits in a frosted circular core while
// two counter-rotating conic arcs and a breathing glow orbit around it.
//
// Why this design: every animation is transform/opacity ONLY, so each layer is
// GPU-composited and holds a steady 60fps (no path/stroke re-paints, no layout
// work). The global prefers-reduced-motion override in globals.css collapses
// the loops to a single instant run → a static, fully-formed orb.
// =============================================================================

import { LogoMark } from "@/components/shared/logo";
import { cn } from "@/lib/utils";

export function WelcomeOrb({ className }: { className?: string }) {
  return (
    <div className={cn("relative size-16", className)} aria-hidden="true">
      {/* Breathing aurora glow (behind everything) */}
      <div className="wg-orb-glow absolute -inset-3 rounded-full" />

      {/* Counter-rotating inner arc */}
      <div className="wg-orb-arc-inner absolute inset-[5px] rounded-full" />

      {/* Rotating outer arc */}
      <div className="wg-orb-arc absolute inset-0 rounded-full" />

      {/* Frosted core with the brand mark */}
      <div className="absolute inset-[7px] flex items-center justify-center rounded-full border border-primary/15 bg-card shadow-sm">
        <LogoMark size={24} rounded="rounded-full" className="wg-orb-mark" />
      </div>
    </div>
  );
}
