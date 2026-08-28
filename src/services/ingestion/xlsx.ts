// =============================================================================
// XLSX INGESTION (spec §22) — SheetJS reader (sheets, cells, formulas)
// =============================================================================
// Reads every worksheet with headers, typed cell values and formulas —
// a spreadsheet is NEVER flattened into plain text.
// =============================================================================

import type { IngestedFile, IngestedSheet } from './types'
import { truncateText, countWords } from './types'

const MAX_ROWS_PER_SHEET = 500
const MAX_COLS = 60

export async function ingestXlsx(buffer: Buffer, filename: string, mimeType: string): Promise<IngestedFile> {
  const warnings: string[] = []
  const XLSX = await import('xlsx')

  let workbook: import('xlsx').WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellDates: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`XLSX could not be read: ${msg.slice(0, 160)}`)
  }

  const sheets: IngestedSheet[] = []
  const textParts: string[] = [`Workbook: ${filename}`, `Sheets: ${workbook.SheetNames.join(', ')}`]

  for (const name of workbook.SheetNames.slice(0, 30)) {
    const ws = workbook.Sheets[name]
    if (!ws) continue

    const ref = ws['!ref'] || 'A1'
    const range = XLSX.utils.decode_range(ref)
    const rowCount = Math.min(range.e.r - range.s.r + 1, MAX_ROWS_PER_SHEET)
    const colCount = Math.min(range.e.c - range.s.c + 1, MAX_COLS)

    const matrix: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
      blankrows: false,
      raw: true,
    }) as unknown[][]

    const limited = matrix.slice(0, MAX_ROWS_PER_SHEET)
    const headerRow = (limited[0] || []).map((c: unknown, i: number) =>
      c !== null && c !== undefined && String(c).trim() ? String(c).trim() : `Column ${i + 1}`
    )
    const dataRows = limited.slice(1).map((r) =>
      Array.from({ length: headerRow.length }, (_, i) => {
        const v = r[i]
        if (v === null || v === undefined) return null
        if (v instanceof Date) return v.toISOString().slice(0, 10)
        return typeof v === 'number' || typeof v === 'string' ? v : String(v)
      })
    )

    // Formulas: collect a sample of cell formulas for AI context.
    const formulas: string[] = []
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith('!')) continue
      const cell = ws[addr] as { f?: string } | undefined
      if (cell?.f && formulas.length < 50) {
        formulas.push(`${addr}: =${cell.f}`)
      }
    }

    sheets.push({
      name,
      headers: headerRow,
      rows: dataRows,
      rowCount,
      colCount,
      formulas: formulas.length > 0 ? formulas : undefined,
    })

    // Textual rendering for the AI context (bounded)
    textParts.push(`\n=== Sheet "${name}" (${rowCount} rows) ===`)
    textParts.push(headerRow.join(' | '))
    for (const r of dataRows.slice(0, 60)) {
      textParts.push(r.map((c) => (c === null ? '' : String(c))).join(' | '))
    }
    if (dataRows.length > 60) textParts.push(`… ${dataRows.length - 60} more rows`)
    if (formulas.length > 0) {
      textParts.push(`Formulas: ${formulas.slice(0, 20).join('; ')}`)
    }
  }

  const fullText = textParts.join('\n')
  const { text, truncated } = truncateText(fullText)
  if (truncated) warnings.push('Workbook content exceeded the extraction cap and was truncated.')
  if (workbook.SheetNames.length > 30) {
    warnings.push(`Only the first 30 of ${workbook.SheetNames.length} sheets were ingested.`)
  }

  return {
    kind: 'xlsx',
    filename,
    mimeType,
    size: buffer.length,
    textContent: text,
    truncated,
    structure: {
      sectionCount: sheets.length,
      sections: sheets.map((s) => ({ title: s.name, blocks: [s.headers.join(' | ')] })),
      tables: sheets.map((s) => ({ name: s.name, headers: s.headers, rows: s.rows })),
      sheets,
      stats: {
        characters: fullText.length,
        words: countWords(fullText),
        tables: sheets.length,
        lists: 0,
      },
    },
    warnings,
  }
}
