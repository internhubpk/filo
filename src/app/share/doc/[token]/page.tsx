"use client";

// =============================================================================
// /share/doc/[token] — PUBLIC shared document landing (view + download).
// =============================================================================
// Resolves through the PUBLIC token query (sanitized: title, type, format,
// status — never the owner's identity). Download goes through the
// token-verified route, which re-checks the share inside Convex on every
// request, so revocation kills existing links immediately.
// =============================================================================

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Download, FileSpreadsheet, FileText, Loader2, Presentation, TriangleAlert } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LogoMark } from "@/components/shared/logo";

export default function SharedDocPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const shared = useQuery(api.sharing.getSharedArtifactByToken, { token }) as
    | {
        artifactId: string;
        title: string;
        type: string;
        format: string;
        status: string;
        versionCount: number;
        createdAt: number;
        updatedAt: number;
        fileId: string | null;
      }
    | null
    | undefined;

  const Icon =
    shared?.type === "spreadsheet" ? FileSpreadsheet : shared?.type === "presentation" ? Presentation : FileText;

  async function download() {
    const res = await fetch(`/api/shared/doc/${encodeURIComponent(token)}/download`);
    const json = await res.json().catch(() => null);
    if (json?.success && json.data?.url) {
      const a = document.createElement("a");
      a.href = json.data.url;
      a.download = json.data.fileName || shared?.title || "document";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <Link href="/" className="flex items-center gap-2" aria-label="Filo">
          <LogoMark size={24} />
          <span className="text-sm font-semibold tracking-tight">Filo</span>
        </Link>
        <span className="rounded-full border bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          Shared · read-only
        </span>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        {shared === undefined ? (
          <div className="w-full max-w-md space-y-4">
            <Skeleton className="mx-auto h-16 w-16 rounded-2xl" />
            <Skeleton className="mx-auto h-5 w-2/3" />
            <Skeleton className="mx-auto h-4 w-1/3" />
            <Skeleton className="mx-auto h-9 w-40 rounded-lg" />
          </div>
        ) : shared === null ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10">
              <TriangleAlert className="size-6 text-destructive" />
            </span>
            <h1 className="text-lg font-semibold">This link is no longer valid</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              The share link was revoked or never existed. Ask the owner for a fresh link.
            </p>
          </div>
        ) : (
          <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10">
              <Icon className="size-7 text-primary" />
            </span>
            <h1 className="mt-4 text-lg font-semibold tracking-tight">{shared.title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {String(shared.format || "file").toUpperCase()} · {shared.versionCount} version
              {shared.versionCount === 1 ? "" : "s"} · shared{" "}
              {new Date(shared.updatedAt).toLocaleDateString()}
            </p>
            {shared.status !== "completed" ? (
              <p className="mt-4 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                This document is still processing — check back soon.
              </p>
            ) : (
              <Button className="mt-5 w-full" onClick={() => void download()}>
                <Download className="mr-2 size-4" /> Download {String(shared.format || "").toUpperCase()}
              </Button>
            )}
            <p className="mt-4 text-[11px] text-muted-foreground">
              Shared via Filo — the owner can revoke this link at any time.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
