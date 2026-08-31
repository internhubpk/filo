// =============================================================================
// FILO AI — Native Search-Grounding Source Mapping (pure helpers)
// =============================================================================
// Converts provider-native citation payloads into the normalized AiWebSource
// shape consumed by the chat transcript (metadata.sources → SourcesBlock):
//
//   • GEMINI — candidates[].groundingMetadata.groundingChunks[].web
//     { uri, title, domain } (accumulated across the SSE stream)
//   • OPENAI — choices[].delta.annotations[] / message.annotations[]
//     { type: 'url_citation', url_citation: { url, title, content } }
//
// Both are fail-soft: malformed/missing fields are skipped, duplicates are
// removed by URL, per-domain entries are capped so one site can't dominate
// the strip, and the total is capped to keep the UI sane. These helpers are
// PURE — no fetch, no env — so they are unit-testable in isolation.
// =============================================================================

import type { AiWebSource } from './types'

const MAX_SOURCES = 8
const MAX_PER_DOMAIN = 2
const MAX_SNIPPET_CHARS = 220

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function finalize(
  entries: Array<{ title: string; url: string; snippet?: string }>,
): AiWebSource[] {
  const seen = new Set<string>()
  const perDomain = new Map<string, number>()
  const out: AiWebSource[] = []

  for (const e of entries) {
    if (out.length >= MAX_SOURCES) break
    if (!e.url || !/^https?:\/\//i.test(e.url)) continue
    const key = e.url.replace(/\/+$/, '')
    if (seen.has(key)) continue

    const domain = hostOf(e.url)
    const count = domain ? perDomain.get(domain) ?? 0 : 0
    if (domain && count >= MAX_PER_DOMAIN) continue
    if (domain) perDomain.set(domain, count + 1)

    seen.add(key)
    out.push({
      title: e.title?.trim() || domain || e.url,
      url: key,
      ...(e.snippet ? { snippet: e.snippet.slice(0, MAX_SNIPPET_CHARS) } : {}),
    })
  }
  return out
}

// ---- Gemini -----------------------------------------------------------------

export interface GeminiGroundingChunk {
  web?: { uri?: string; title?: string; domain?: string }
}

/**
 * Map accumulated Gemini groundingChunks (from groundingMetadata across all
 * stream chunks) to normalized sources. Title falls back to the domain.
 */
export function mapGeminiGrounding(
  chunks: GeminiGroundingChunk[],
): AiWebSource[] {
  const entries: Array<{ title: string; url: string; snippet?: string }> = []
  for (const c of chunks) {
    const web = c?.web
    if (!web?.uri) continue
    entries.push({ title: web.title || web.domain || '', url: web.uri })
  }
  return finalize(entries)
}

// ---- OpenAI -----------------------------------------------------------------

export interface OpenAiUrlCitation {
  type?: string
  url_citation?: {
    url?: string
    title?: string
    content?: string
    start_index?: number
    end_index?: number
  }
}

/**
 * Map accumulated OpenAI url_citation annotations (from stream deltas or the
 * final message) to normalized sources. The citation `content` excerpt
 * becomes the snippet.
 */
export function mapOpenAiCitations(
  annotations: OpenAiUrlCitation[],
): AiWebSource[] {
  const entries: Array<{ title: string; url: string; snippet?: string }> = []
  for (const a of annotations) {
    if (a?.type && a.type !== 'url_citation') continue
    const cit = a?.url_citation
    if (!cit?.url) continue
    entries.push({
      title: cit.title || '',
      url: cit.url,
      ...(cit.content ? { snippet: cit.content } : {}),
    })
  }
  return finalize(entries)
}
