"use client";

// =============================================================================
// ChatMarkdown — renders assistant replies (and shared-chat transcripts).
// =============================================================================
// Security: react-markdown renders SAFE html only (no raw HTML by default —
// untrusted content can never inject markup or scripts).
// Fidelity:
//   • GFM tables, strikethrough, task lists
//   • Syntax-highlighted code blocks (react-syntax-highlighter PrismLight —
//     only ~20 common grammars registered to keep the chat chunk lean; any
//     other language falls back to a clean unhighlighted block)
//   • ```mermaid blocks rendered as diagrams (dynamic import, see
//     MermaidBlock) with the raw source still copyable
//   • LaTeX math via remark-math + rehype-katex ($inline$ and $$block$$)
//   • Per-block copy buttons and a per-message copy button (in Workspace)
// Typography is part of the Filo design system, not browser defaults.
// =============================================================================

import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import "katex/dist/katex.min.css";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { MermaidBlock } from "./mermaid-block";

// ---- Registered grammars (keep this list focused — chat rarely needs more) --
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";

const LANGS: Record<string, unknown> = {
  javascript,
  typescript,
  jsx,
  tsx,
  python,
  bash,
  json,
  css,
  markup,
  html: markup,
  xml: markup,
  sql,
  yaml,
  go,
  rust,
  java,
  c,
  cpp,
  csharp,
  php,
  markdown,
  diff,
  docker,
  dockerfile: docker,
};
for (const [name, grammar] of Object.entries(LANGS)) {
  SyntaxHighlighter.registerLanguage(name, grammar as never);
}

// ---- Copy button shared by code / mermaid surfaces ---------------------------
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label={label}
    >
      {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

// ---- Fenced code block -------------------------------------------------------
function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  const text = extractText(children);
  const lang = /language-(\w+)/.exec(className ?? "")?.[1]?.toLowerCase();

  // Mermaid diagrams get a dedicated renderer (raw source stays copyable).
  if (lang === "mermaid") return <MermaidBlock code={text} />;

  const grammar = lang ? LANGS[lang] : undefined;

  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
          {lang ?? "code"}
        </span>
        <CopyButton text={text} label="Copy" />
      </div>
      {grammar ? (
        <SyntaxHighlighter
          language={lang}
          style={oneDark}
          customStyle={{
            margin: 0,
            padding: "14px",
            background: "#18181b",
            fontSize: "13px",
            lineHeight: 1.6,
          }}
          codeTagProps={{ style: { fontFamily: "var(--font-mono, monospace)" } }}
          wrapLongLines={false}
        >
          {text}
        </SyntaxHighlighter>
      ) : (
        <pre className="overflow-x-auto bg-zinc-900 p-3.5 text-[13px] leading-relaxed text-zinc-200">
          <code>{text}</code>
        </pre>
      )}
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
    <div
      className={cn(
        "text-[14.5px] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        // KaTeX: keep display math scrollable inside the bubble.
        "[&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto [&_.katex-display]:pb-1",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: (p) => <h1 className="mb-3 mt-5 text-lg font-semibold tracking-tight" {...p} />,
          h2: (p) => <h2 className="mb-2.5 mt-5 text-base font-semibold tracking-tight" {...p} />,
          h3: (p) => <h3 className="mb-2 mt-4 text-[15px] font-semibold" {...p} />,
          h4: (p) => <h4 className="mb-2 mt-3 text-[14.5px] font-semibold" {...p} />,
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
          img: (p) => (
            <img className="my-3 max-w-full rounded-lg border" loading="lazy" alt="" {...p} />
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
          tr: (p) => <tr className="transition-colors hover:bg-muted/30" {...p} />,
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
