"use client";

// =============================================================================
// ScrollReveal — IntersectionObserver-driven entrance animation
// =============================================================================
// Wraps children in a div that starts invisible (opacity-0 translate-y-3.5)
// and plays the `animate-fade-up` keyframe (see globals.css) the first time
// it scrolls into view (threshold 0.12, once).
//
// Server-component-safe: import and use it from any server or client page —
// the animation runs client-side after hydration. Respects
// prefers-reduced-motion (content is shown immediately, no motion) and
// falls back to visible when IntersectionObserver is unavailable.
// =============================================================================

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ScrollReveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Stagger delay in SECONDS (consistent with the FadeIn/FadeUp primitives). */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // NOTE: never setState synchronously inside this effect (react-hooks/
  // set-state-in-effect) — every reveal path is async (IO callback or rAF).
  // Reduced-motion users are handled in CSS: `motion-reduce:transition-none`
  // below reveals content instantly without animating.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Legacy browsers without IntersectionObserver: reveal on the next
    // animation frame (before paint, but off the synchronous effect path).
    if (typeof IntersectionObserver === "undefined") {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.12 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        visible ? "animate-fade-up" : "opacity-0 translate-y-3.5",
        "motion-reduce:transition-none motion-reduce:[animation:none]",
        className
      )}
      style={delay > 0 ? { animationDelay: `${Math.round(delay * 1000)}ms` } : undefined}
    >
      {children}
    </div>
  );
}
