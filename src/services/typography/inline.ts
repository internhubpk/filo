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
    } else if (m[5] !== undefined && m[6]) {
      segments.push({ text: m[4] ?? m[5], style: 'link', href: m[6] })
    } else if (m[7] !== undefined) {
      // ***bold italic*** → bold wins, italics preserved as emphasis chars-free
      segments.push({ text: m[7], style: 'bold' })
    } else if (m[9] !== undefined) {
      segments.push({ text: m[9], style: 'bold' })
    } else if (m[11] !== undefined) {
      segments.push({ text: m[11], style: 'bold' })
    } else if (m[13] !== undefined) {
      segments.push({ text: m[13], style: 'strike' })
    } else if (m[15] !== undefined) {
      segments.push({ text: m[15], style: 'italic' })
    } else if (m[17] !== undefined) {
      segments.push({ text: m[17], style: 'italic' })
    } else if (m[18] !== undefined) {
      segments.push({ text: m[18], style: 'link', href: m[18] })
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
