import { Sparkles } from "lucide-react";
import Link from "next/link";
import { ThemeSwitch } from "@/components/auth/theme-switch";

// =============================================================================
// Auth layout — split screen: form on the left, brand proof on the right.
// =============================================================================

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      {/* Form column */}
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" aria-label="Filo home">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Filo</span>
          </Link>
          <ThemeSwitch />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Filo · Payments secured by Safepay
        </p>
      </div>

      {/* Brand column (desktop only) */}
      <div className="relative hidden overflow-hidden border-l bg-muted/40 lg:block">
        <div className="bg-grid absolute inset-0" aria-hidden />
        <div className="relative flex h-full flex-col justify-center px-14">
          <blockquote className="max-w-md">
            <p className="text-display text-3xl leading-snug">
              &ldquo;Describe the outcome.
              <br />
              Filo writes, structures,
              <br />
              and exports it.&rdquo;
            </p>
            <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
              Documents, spreadsheets, presentations, PDFs and reports — generated
              as real files with proper structure, consistent tone, and clean
              formatting. Private to your account, stored in secure cloud storage.
            </p>
          </blockquote>
          <div className="mt-10 grid max-w-md grid-cols-3 gap-3">
            {[
              ["DOCX", "Documents"],
              ["XLSX", "Spreadsheets"],
              ["PPTX", "Presentations"],
              ["PDF", "Reports"],
              ["CSV", "Data"],
              ["Free", "To start"],
            ].map(([big, small]) => (
              <div key={big} className="rounded-lg border bg-card/70 px-3 py-3 backdrop-blur">
                <p className="text-sm font-semibold">{big}</p>
                <p className="text-xs text-muted-foreground">{small}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
