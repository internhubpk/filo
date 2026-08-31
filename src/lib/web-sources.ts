// =============================================================================
// Web source extraction for chat replies (server-only).
// =============================================================================
// When an assistant reply references web pages (models cite links they were
// grounded in, or well-known resources), those links are extracted at the
// persist point and attached to the message as `metadata.sources`. The chat
// UI renders them as a "Web resources" strip (src/components/chat/
// sources-block.tsx).
//
// Design notes:
//   • Provider-agnostic — works identically for Gemini, OpenAI and
//     AgentRouter replies; no AI-layer changes needed. When Gemini search
//     grounding is enabled later, its native groundingMetadata can be
//     passed through the same `metadata.sources` shape and take precedence.
//   • Code-safe — fenced code blocks and inline code are stripped BEFORE
//     scanning so URLs inside code samples never become "resources".
//   • Conservative — http(s) only, junk hosts skipped, per-domain cap so a
//     single site can't dominate the strip, hard total cap.
// =============================================================================

export interface ExtractedWebSource {
  title: string;
  url: string;
}

const SKIP_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "example.com",
  "www.example.com",
  "example.org",
  "example.net",
  "test.com",
]);

const ASSET_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|eot|pdf|zip|tar|gz|dmg|exe|apk)$/i;

const MAX_SOURCES = 8;
const MAX_PER_DOMAIN = 2;

/** Remove fenced code blocks and inline code so their URLs are ignored. */
function stripCode(text: string): string {
  return (
    text
      // fenced blocks (``` or ~~~, any language)
      .replace(/```[\s\S]*?(```|~~~|$)/g, " ")
      .replace(/~~~[\s\S]*?(~~~|```|$)/g, " ")
      // inline code spans
      .replace(/`[^`\n]*`/g, " ")
  );
}

/** Normalize a URL for dedup: lowercase host, drop hash + trailing slash. */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    let out = u.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return raw;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function prettyTitle(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) {
      const cleaned = decodeURIComponent(last)
        .replace(/\.(html?|php|aspx?|md)$/i, "")
        .replace(/[-_]+/g, " ")
        .trim();
      if (cleaned.length >= 3) {
        return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      }
    }
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

function isSkippable(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    const host = u.hostname.toLowerCase();
    if (SKIP_HOSTS.has(host)) return true;
    if (host.endsWith(".local") || host.endsWith(".internal")) return true;
    if (ASSET_EXTENSIONS.test(u.pathname.toLowerCase())) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Extract web resources from a finished assistant reply.
 * Order of preference per URL: markdown link text as title → pretty title.
 */
export function extractWebSources(text: string): ExtractedWebSource[] {
  if (!text || text.indexOf("http") === -1) return [];

  const body = stripCode(text);
  const seen = new Map<string, ExtractedWebSource>(); // normalized url → source
  const perDomain = new Map<string, number>();

  const add = (rawUrl: string, title: string | null) => {
    if (seen.size >= MAX_SOURCES) return;
    const normalized = normalizeUrl(rawUrl);
    if (!normalized || seen.has(normalized)) return;
    if (isSkippable(normalized)) return;

    const domain = hostOf(normalized);
    const count = perDomain.get(domain) ?? 0;
    if (count >= MAX_PER_DOMAIN) return;

    perDomain.set(domain, count + 1);
    seen.set(normalized, { url: normalized, title: (title ?? prettyTitle(normalized)).trim() || domain });
  };

  // 1) Markdown links: [title](url) — the link text is the best title.
  const mdLink = /\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]+)\)/g;
  for (const m of body.matchAll(mdLink)) {
    add(m[2].trim(), m[1].trim());
  }

  // 2) Bare URLs not already captured (lookbehind avoids markdown/HTML attr tails).
  const bare = /(?<![(\["'>=\w])https?:\/\/[^\s<>()[\]{}"'`]+/g;
  for (const m of body.matchAll(bare)) {
    // Trim trailing punctuation that sentence context sticks to the URL.
    const url = m[0].replace(/[.,;:!?'")\]]+$/, "");
    add(url, null);
  }

  return Array.from(seen.values());
}
