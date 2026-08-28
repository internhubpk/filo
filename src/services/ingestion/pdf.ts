// =============================================================================
// PDF INGESTION (spec §22) — unpdf, page-aware extraction
// =============================================================================
// Extracts per-page text and detects image/scanned PDFs (too little text →
// warn; OCR path is intentionally NOT auto-invoked).
// =============================================================================

import type { IngestedFile, IngestedSection } from './types'
import { truncateText, countWords } from './types'

export async function ingestPdf(buffer: Buffer, filename: string, mimeType: string): Promise<IngestedFile> {
  const warnings: string[] = []
  const { extractText, getDocumentProxy } = await import('unpdf')

  let text = ''
  let totalPages = 0
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const result = await extractText(pdf, { mergePages: false })
    totalPages = result.totalPages
    const pages = Array.isArray(result.text) ? result.text : [result.text]
    text = pages.map((p, i) => `\n\n----- [Page ${i + 1}] -----\n${p}`).join('')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`PDF could not be read: ${msg.slice(0, 160)}`)
  }

  const pageTexts = text.split(/\n?-----\s\[Page \d+\]\s-----\n?/).filter((s) => s.trim().length > 0)

  // Scanned/image PDF heuristic: almost no extractable text.
  if (countWords(text) < Math.max(20, totalPages * 5)) {
    warnings.push(
      'This PDF appears to be scanned or image-based — very little text could be extracted. ' +
        'A text-based PDF will produce much better results.'
    )
  }

  // Page-aware sections: group pages into pseudo-sections split by page.
  const sections: IngestedSection[] = pageTexts.slice(0, 80).map((p, i) => ({
    title: `Page ${i + 1}`,
    blocks: p
      .split(/\n{2,}|\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 40),
  }))

  const { text: capped, truncated } = truncateText(text.trim())
  if (truncated) warnings.push('PDF text exceeded the extraction cap and was truncated.')

  return {
    kind: 'pdf',
    filename,
    mimeType,
    size: buffer.length,
    textContent: capped,
    truncated,
    structure: {
      sectionCount: sections.length,
      sections,
      tables: [],
      pageCount: totalPages,
      stats: {
        characters: text.length,
        words: countWords(text),
        tables: 0,
        lists: 0,
      },
    },
    warnings,
  }
}
