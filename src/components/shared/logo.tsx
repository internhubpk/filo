"use client";

// =============================================================================
// FILO BRAND — <Logo /> / <LogoMark />
// =============================================================================
// The ONE place the brand mark is rendered from. Every surface (app sidebar,
// admin navbar, auth screens, marketing header/footer) imports these instead
// of hand-rolling a span+icon, so swapping the artwork is a single-file
// operation: replace public/logo.png and re-run scripts/generate-brand-assets
// .py (regenerates favicon, apple-touch-icon, PWA icons, og-image).
// =============================================================================

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({
  size = 28,
  className,
  rounded = "rounded-lg",
  alt = "Filo logo",
}: {
  /** Rendered square side in px. */
  size?: number;
  className?: string;
  rounded?: string;
  alt?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden shadow-sm transition-transform duration-200 group-hover/logo:scale-105",
        rounded,
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden={alt === ""}
    >
      <Image
        src="/logo.png"
        alt={alt}
        width={size * 2}
        height={size * 2}
        priority
        className="size-full object-cover"
      />
    </span>
  );
}

export function Logo({
  href,
  size = 28,
  wordmark = true,
  badge,
  className,
  wordmarkClassName,
}: {
  /** When set the logo links to this href (defaults to plain span group). */
  href?: string;
  size?: number;
  wordmark?: boolean;
  /** Optional trailing badge, e.g. "Admin". */
  badge?: string;
  className?: string;
  wordmarkClassName?: string;
}) {
  const inner = (
    <>
      <LogoMark size={size} />
      {wordmark ? (
        <span
          className={cn(
            "truncate text-[15px] font-semibold tracking-tight text-foreground",
            wordmarkClassName
          )}
        >
          Filo
        </span>
      ) : null}
      {badge ? (
        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
          {badge}
        </span>
      ) : null}
    </>
  );

  const group = cn("group/logo flex items-center gap-2 overflow-hidden", className);

  if (href) {
    return (
      <Link href={href} className={group} aria-label="Filo home">
        {inner}
      </Link>
    );
  }
  return <span className={group}>{inner}</span>;
}
