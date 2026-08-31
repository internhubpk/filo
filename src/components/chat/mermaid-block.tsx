"use client";

// =============================================================================
// MermaidBlock — renders ```mermaid fenced code inside chat messages.
// =============================================================================
// mermaid is heavy (~1MB), so it is dynamically imported only when a chat
// message actually contains a mermaid diagram — the main chat bundle stays
// lean. Rendering follows the app theme (dark/light). On a parse error the
// raw code stays visible in a fallback card (never a blank box), and the
// copy button keeps working so the user can fix the diagram source.
// =============================================================================

import { useEffect, useId, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Copy, TriangleAlert } from "lucide-react";

const MAX_MERMAID_CHARS = 20_000;

export function MermaidBlock({ code }: { code: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (code.length > MAX_MERMAID_CHARS) {
      setError(`Diagram source too large (${code.length} chars)`);
      return;
    }

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: resolvedTheme === "dark" ? "dark" : "default",
          fontFamily: "inherit",
        });
        const { svg: rendered } = await mermaid.render(`filo-mermaid-${reactId}`, code);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setSvg(null);
          setError(e instanceof Error ? e.message : "Diagram failed to render");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, reactId, resolvedTheme]);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="group/mermaid my-3 overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          diagram
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Copy diagram source"
        >
          {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {error ? (
        <div className="p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] text-destructive">
            <TriangleAlert className="size-3.5" />
            Mermaid error: {error}
          </div>
          <pre className="overflow-x-auto rounded bg-muted/40 p-3 text-[13px] leading-relaxed">
            {code}
          </pre>
        </div>
      ) : svg ? (
        <div
          className="flex justify-center overflow-x-auto bg-background p-4 [&_svg]:h-auto [&_svg]:max-w-full"
          // mermaid output is generated locally with securityLevel:"strict"
          // (no event handlers, no foreignObject scripts) — safe to inject.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="flex h-24 items-center justify-center text-[12px] text-muted-foreground">
          Rendering diagram…
        </div>
      )}
    </div>
  );
}
