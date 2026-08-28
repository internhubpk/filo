// =============================================================================
// DOCX INGESTION (spec §22) — mammoth-based semantic extraction
// =============================================================================
// Extracts headings, paragraphs, lists, and tables while preserving semantic
// structure so the AI can reference "section 3" or "the second table".
// =============================================================================

import type { IngestedFile, IngestedSection, IngestedTable } from './types'
import { truncateText, countWords } from './types'

interface MammothResult {
  value: string
  messages: Array<{ type: string; message: string }>
}

function textFromHtml(html: string): string {
  // Block-level tags become newlines, then strip remaining tags.
  return html
    .replace(/<\/(p|h1|h2|h3|h4|h5|h6|li|tr|table)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export async function ingestDocx(buffer: Buffer, filename: string, mimeType: string): Promise<IngestedFile> {
  const warnings: string[] = []
  const mammoth = await import('mammoth')

  // Structured HTML pass (tables preserved) + raw text pass.
  let html = ''
  let rawText = ''
  try {
    const htmlResult: MammothResult = await mammoth.convertToHtml({ buffer })
    html = htmlResult.value || ''
    const textResult: MammothResult = await mammoth.extractRawText({ buffer })
    rawText = textResult.value || ''
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`DOCX could not be read: ${msg.slice(0, 160)}`)
  }

  // --- Sections: split the HTML by headings -------------------------------
  const sections: IngestedSection[] = []
  const headingRe = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi
  const headingMatches: Array<{ level: number; text: string; index: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(html)) !== null) {
    headingMatches.push({
      level: Number(m[1][1]),
      text: textFromHtml(m[2]).trim(),
      index: m.index,
      end: m.index + m[0].length,
    })
  }

  const pushSection = (title: string | undefined, htmlChunk: string) => {
    const blocks = textFromHtml(htmlChunk)
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    const tables = extractTables(htmlChunk)
    if (blocks.length > 0 || tables.length > 0) {
      sections.push({ title, blocks, tables })
    }
  }

  if (headingMatches.length === 0) {
    pushSection(undefined, html)
  } else {
    // Preamble before first heading
    if (headingMatches[0].index > 0) {
      pushSection(undefined, html.slice(0, headingMatches[0].index))
    }
    headingMatches.forEach((h, i) => {
      const next = headingMatches[i + 1]
      pushSection(h.text || `Section ${i + 1}`, html.slice(h.end, next ? next.index : undefined))
    })
  }

  const allTables = extractTables(html)
  const { text, truncated } = truncateText(rawText)
  if (truncated) warnings.push('Document text exceeded the extraction cap and was truncated.')

  return {
    kind: 'docx',
    filename,
    mimeType,
    size: buffer.length,
    textContent: text,
    truncated,
    structure: {
      sectionCount: sections.length,
      sections,
      tables: allTables,
      headings: headingMatches.map((h) => h.text).filter(Boolean),
      stats: {
        characters: rawText.length,
        words: countWords(rawText),
        tables: allTables.length,
        lists: (html.match(/<(ul|ol)[^>]*>/gi) || []).length,
      },
    },
    warnings,
  }
}

/** Extract <table> elements as IngestedTable objects. */
function extractTables(html: string): IngestedTable[] {
  const tables: IngestedTable[] = []
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi
  let tm: RegExpExecArray | null
  let tIdx = 0
  while ((tm = tableRe.exec(html)) !== null) {
    tIdx++
    const rows: string[][] = []
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let rm: RegExpExecArray | null
    while ((rm = rowRe.exec(tm[1])) !== null) {
      const cells: string[] = []
      const cellRe = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi
      let cm: RegExpExecArray | null
      while ((cm = cellRe.exec(rm[1])) !== null) {
        cells.push(textFromHtml(cm[2]).trim())
      }
      if (cells.length > 0) rows.push(cells)
    }
    if (rows.length > 0) {
      const [headerRow, ...dataRows] = rows
      const width = Math.max(...rows.map((r) => r.length))
      tables.push({
        name: `Table ${tIdx}`,
        headers: headerRow.map((h, i) => (h ? h : `Column ${i + 1}`)),
        rows: dataRows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null)),
      })
    }
  }
  return tables
}
