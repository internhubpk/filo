"use client";

// =============================================================================
// ChatMarkdown — renders assistant replies (and shared-chat transcripts).
// =============================================================================
// Security: react-markdown renders SAFE html only (no raw HTML by default —
// untrusted content can never inject markup or scripts).
// Fidelity: GFM tables/strikethrough/task lists, Shiki-free code blocks with
// a lightweight highlighter fallback (server bundles stay lean) and a copy
// button. Typography is part of the Filo design system, not browser defaults.
// =============================================================================

import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];

  return (
    <div className="group/code relative my-3 overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {lang ?? "code"}
        </span>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">{children}</pre>
    </div>
  );
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as unknown as Record<string, unknown>)) {
    const props = (node as unknown as { props?: { children?: ReactNode } }).props;
    return extractText(props?.children);
  }
  return "";
}

export const ChatMarkdown = memo(function ChatMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn("text-[14.5px] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mb-3 mt-5 text-lg font-semibold tracking-tight" {...p} />,
          h2: (p) => <h2 className="mb-2.5 mt-5 text-base font-semibold tracking-tight" {...p} />,
          h3: (p) => <h3 className="mb-2 mt-4 text-[15px] font-semibold" {...p} />,
          p: (p) => <p className="my-2.5" {...p} />,
          ul: (p) => <ul className="my-2.5 ml-5 list-disc space-y-1" {...p} />,
          ol: (p) => <ol className="my-2.5 ml-5 list-decimal space-y-1" {...p} />,
          li: (p) => <li className="pl-1" {...p} />,
          a: (p) => (
            <a
              className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
              target="_blank"
              rel="noopener noreferrer"
              {...p}
            />
          ),
          blockquote: (p) => (
            <blockquote className="my-3 border-l-2 border-primary/40 pl-3 text-muted-foreground" {...p} />
          ),
          hr: () => <hr className="my-4 border-border" />,
          table: (p) => (
            <div className="my-3 overflow-x-auto rounded-lg border">
              <table className="w-full text-[13px]" {...p} />
            </div>
          ),
          thead: (p) => <thead className="bg-muted/60" {...p} />,
          th: (p) => <th className="border-b px-3 py-1.5 text-left font-semibold" {...p} />,
          td: (p) => <td className="border-b px-3 py-1.5 align-top last:border-b-0" {...p} />,
          code: (p) => {
            const { className: cls, children } = p as { className?: string; children?: ReactNode };
            const isBlock = typeof cls === "string" && cls.includes("language-");
            if (isBlock || String(children ?? "").includes("\n")) {
              return <CodeBlock className={cls}>{children}</CodeBlock>;
            }
            return (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12.5px]" {...p} />
            );
          },
          pre: (p) => <pre {...p} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
