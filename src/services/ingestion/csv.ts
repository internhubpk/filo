// =============================================================================
// CSV INGESTION (spec §16, §22) — RFC 4180 parser with type inference
// =============================================================================
// Deterministic parsing: quotes, embedded commas/newlines, escaped quotes,
// BOM handling. Never trusts the AI to serialize CSV.
// =============================================================================

import type { IngestedTable } from './types'

/** Parse CSV text into a 2D array, honoring RFC 4180 quoting rules. */
export function parseCsv(text: string): string[][] {
  // Strip UTF-8 BOM
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < src.length) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      if (src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  // Final field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Drop fully-empty trailing rows
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Infer a cell's typed value: number, null (empty) or trimmed string. */
export function inferCellValue(raw: string): string | number | null {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'na') return null
  // Numeric: 1,234.56 · -12.5 · 42 · 3.14 · 1e5 · $1,200 stripped of currency symbols
  const numericCandidate = trimmed.replace(/^[$€£¥]|%$/g, '').replace(/,/g, '')
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(numericCandidate)) {
    const n = Number(numericCandidate)
    if (Number.isFinite(n)) return n
  }
  return trimmed
}

/** Build a typed table (headers + inferred rows) from CSV text. */
export function ingestCsv(filename: string, text: string): IngestedTable {
  const rows = parseCsv(text)
  if (rows.length === 0) {
    return { name: filename, headers: [], rows: [] }
  }
  const [headerRow, ...dataRows] = rows
  const headers = headerRow.map((h, i) => (h.trim() ? h.trim() : `Column ${i + 1}`))
  return {
    name: filename,
    headers,
    rows: dataRows.map((r) => headers.map((_, i) => inferCellValue(r[i] ?? ''))),
  }
}
