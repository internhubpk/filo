"use client";

// =============================================================================
// SourcesBlock — "Web resources" strip under an assistant message.
// =============================================================================
// Rendered whenever an assistant message carries `metadata.sources` (the
// shape the chat backend is expected to attach when the reply is grounded
// in web results). Each entry shows a favicon, the page title and domain,
// and opens in a new tab. Numbered badges match inline citation markers
// like [1], [2] if the model emits them.
// =============================================================================

import { useState } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatSource {
  /** Page title as shown on the result. */
  title: string;
  /** Absolute URL — the citation target. */
  url: string;
  /** Optional supporting excerpt from the page. */
  snippet?: string;
}

function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return <Globe className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (failed) return <Globe className="size-3.5 shrink-0 text-muted-foreground" />;
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      width={14}
      height={14}
      className="size-3.5 shrink-0 rounded-sm"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SourcesBlock({ sources, className }: { sources: ChatSource[]; className?: string }) {
  if (!sources?.length) return null;

  return (
    <div className={cn("my-3 rounded-lg border bg-muted/30 px-3 py-2.5", className)}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Globe className="size-3.5" />
        Web resources
        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium normal-case">
          {sources.length}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {sources.map((s, i) => {
          const valid = /^https?:\/\//i.test(s.url);
          if (!valid) return null;
          return (
            <a
              key={`${s.url}-${i}`}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.snippet ? `${s.title}\n\n${s.snippet}` : s.title}
              className="flex max-w-[260px] items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-[12.5px] transition-colors hover:border-primary/40 hover:bg-accent/50"
            >
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9.5px] font-semibold text-muted-foreground">
                {i + 1}
              </span>
              <Favicon url={s.url} />
              <span className="min-w-0">
                <span className="block truncate font-medium leading-tight">{s.title || hostOf(s.url)}</span>
                <span className="block truncate text-[10.5px] leading-tight text-muted-foreground">
                  {hostOf(s.url)}
                </span>
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/** Normalizes whatever the backend attached into ChatSource[] (fail-soft). */
export function toChatSources(raw: unknown): ChatSource[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ChatSource | null => {
      if (typeof item === "string") return { title: item, url: item };
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const url = typeof o.url === "string" ? o.url : typeof o.link === "string" ? (o.link as string) : "";
        if (!url) return null;
        return {
          title: typeof o.title === "string" ? o.title : "",
          url,
          snippet: typeof o.snippet === "string" ? o.snippet : undefined,
        };
      }
      return null;
    })
    .filter((s): s is ChatSource => s !== null)
    .slice(0, 12);
}
