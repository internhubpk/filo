// =============================================================================
// FILO TYPOGRAPHY — INLINE RICH TEXT
// =============================================================================
// The AI writes markdown emphasis inside prose (**bold**, *italic*, `code`,
// [links](https://…), ~~strike~~). A document engine that ships those literal
// asterisks to the page looks broken. This parser converts a paragraph into
// typed segments ONCE; every renderer (DOCX/PDF/PPTX/HTML/TXT) consumes the
// same segments and styles them natively.
//
// Deterministic, dependency-free, worst-case-input safe (unterminated
// markers degrade to literal text, never to data loss).
// =============================================================================

export type InlineStyle = 'text' | 'bold' | 'italic' | 'code' | 'link' | 'strike'

export interface InlineSegment {
  text: string
  style: InlineStyle
  /** Absolute https?/mailto URL for link segments; undefined otherwise. */
  href?: string
}

/** Inline markdown → segments. Never throws; unknown syntax stays literal. */
export function parseInlineMarkdown(input: unknown): InlineSegment[] {
  const text = typeof input === 'string' ? input : String(input ?? '')
  if (!text) return []
  const segments: InlineSegment[] = []
  // Order matters: code first (its content must not be re-parsed), then
  // links, then bold, then italic/strike.
  const pattern =
    /(`+)([^`]+)\1|(\[((?:[^\[\]\\]|\\.)*?)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\))|(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(__(.+?)__)|(~~(.+?)~~)|(?<![\w*])\*([^*\n]+?)\*(?![\w*])|(?<![\w_])_([^_\n]+?)_(?![\w_])|(\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])/g

  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), style: 'text' })
    if (m[2] !== undefined) {
      segments.push({ text: m[2], style: 'code' })
    } else if (m[3] !== undefined) {
      // [text](url) — G3 whole, G4 link text, G5 URL.
      segments.push({ text: m[4] || m[5], style: 'link', href: m[5] })
    } else if (m[7] !== undefined) {
      // ***bold italic*** → bold wins, italics preserved as emphasis chars-free
      segments.push({ text: m[7], style: 'bold' })
    } else if (m[9] !== undefined) {
      segments.push({ text: m[9], style: 'bold' })
    } else if (m[11] !== undefined) {
      // __content__ is ambiguous: markdown bold vs. a Python dunder
      // identifier. Technical prose (__init__, __enter__, __dict__) means the
      // DUNDER — rendering "enter" in bold destroyed the identifier. When the
      // content is a single snake_case token with no spaces, keep the FULL
      // text (underscores included) as inline code; otherwise treat as bold.
      const full = m[11] !== undefined ? String(m[0]) : ''
      if (/^__[a-z][a-z0-9_]*__$/i.test(full) && !m[11]!.includes(' ')) {
        segments.push({ text: full, style: 'code' })
      } else {
        segments.push({ text: m[11], style: 'bold' })
      }
    } else if (m[13] !== undefined) {
      segments.push({ text: m[13], style: 'strike' })
    } else if (m[14] !== undefined) {
      segments.push({ text: m[14], style: 'italic' })
    } else if (m[15] !== undefined) {
      segments.push({ text: m[15], style: 'italic' })
    } else if (m[16] !== undefined) {
      segments.push({ text: m[16], style: 'link', href: m[16] })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last), style: 'text' })
  return segments.filter((s) => s.text.length > 0)
}

/** Plain-text projection (TXT/CSV renderers and search indexing). */
export function inlineToPlainText(input: unknown): string {
  return parseInlineMarkdown(input)
    .map((s) => s.text)
    .join('')
}

/**
 * Move whitespace at segment BOUNDARIES onto the END of the previous segment.
 *
 * Flow typesetting engines (pdfkit continued runs, DOCX run joins, …) wrap
 * each chunk independently and swallow whitespace at the START of a chunk —
 * a styled run "exit" followed by " to establish" would join as "exitto".
 * Shifting the space to the trailing edge of the previous segment preserves
 * it (trailing spaces at a line break are dropped by any engine, which is
 * correct typography; a MISSING space mid-line is not).
 */
export function normalizeSegmentBoundaries<T extends { text: string }>(segments: T[]): T[] {
  const out = segments.map((s) => ({ ...s }))
  for (let i = 0; i < out.length - 1; i++) {
    const lead = out[i + 1].text.match(/^\s+/)
    if (lead) {
      out[i].text = out[i].text.replace(/\s+$/, '') + lead[0]
      out[i + 1].text = out[i + 1].text.slice(lead[0].length)
    }
  }
  return out.filter((s) => s.text.length > 0)
}
