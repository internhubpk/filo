"use client";

// =============================================================================
// WelcomeGlyph — animated SVG greeting for the chat empty state.
// =============================================================================
// Replaces the static Sparkles icon above "Hi <name> — what are we working
// on?" with a living mark that tells the product story (conversation →
// finished file):
//   • the document sheet + dog-ear fold draw themselves in on mount
//   • the text lines write themselves in a slow, staggered loop
//   • two sparkles twinkle beside the sheet
//   • the whole glyph floats on a gentle vertical drift
//
// Pure SVG + CSS keyframes (globals.css `wg-*` rules) — no motion library.
// prefers-reduced-motion is handled globally in globals.css, which collapses
// every animation to a single instant run, leaving the fully-drawn document.
// =============================================================================

export function WelcomeGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* Gentle vertical drift of the whole glyph */}
      <g className="wg-float">
        {/* Sheet */}
        <path
          className="wg-sheet text-primary"
          pathLength={1}
          d="M19 7 H36 L49 20 V51 A6 6 0 0 1 43 57 H25 A6 6 0 0 1 19 51 Z"
          stroke="currentColor"
          strokeWidth={2.5}
        />
        {/* Dog-ear fold */}
        <path
          className="wg-fold text-primary/60"
          pathLength={1}
          d="M36 7 V20 H49"
          stroke="currentColor"
          strokeWidth={2.5}
        />
        {/* Text lines — written in, held, faded, rewritten (staggered) */}
        <path
          className="wg-line wg-line-1 text-primary/55"
          pathLength={1}
          d="M25 30 H43"
          stroke="currentColor"
          strokeWidth={2.5}
        />
        <path
          className="wg-line wg-line-2 text-primary/55"
          pathLength={1}
          d="M25 37 H43"
          stroke="currentColor"
          strokeWidth={2.5}
        />
        <path
          className="wg-line wg-line-3 text-primary/55"
          pathLength={1}
          d="M25 44 H37"
          stroke="currentColor"
          strokeWidth={2.5}
        />
        {/* Sparkles */}
        <path
          className="wg-spark wg-spark-a text-primary"
          d="M54 9 C54.7 12 55 12.3 58 13 C55 13.7 54.7 14 54 17 C53.3 14 53 13.7 50 13 C53 12.3 53.3 12 54 9 Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          className="wg-spark wg-spark-b text-primary/50"
          d="M12 23 C12.55 25.05 12.95 25.45 15 26 C12.95 26.55 12.55 26.95 12 29 C11.45 26.95 11.05 26.55 9 26 C11.05 25.45 11.45 25.05 12 23 Z"
          fill="currentColor"
          stroke="none"
        />
      </g>
    </svg>
  );
}
