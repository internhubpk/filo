// =============================================================================
// FILO INGESTION PIPELINE (spec §21, §22, §26)
// =============================================================================
// Dispatcher: detect the file type from BOTH the declared MIME type and the
// actual content signature (never trust the extension alone), then extract a
// structured IngestedFile. The context builder turns one or more ingested
// files into a bounded textual context that the planning + section prompts
// can actually reason about — this is what makes "upload a file and ask the
// AI to edit it" real.
// =============================================================================

import type { IngestedFile } from './types'
import { INGEST_MAX_FILE_BYTES } from './types'
import { ingestDocx } from './docx'
import { ingestPdf } from './pdf'
import { ingestXlsx } from './xlsx'
import { ingestPptx } from './pptx'
import { ingestCsv } from './csv'

export * from './types'

// ==================== TYPE DETECTION (signature + extension) ====================

export interface DetectResult {
  kind: 'docx' | 'pdf' | 'xlsx' | 'pptx' | 'csv' | 'text' | 'unknown'
  reason: string
}

/** Magic-byte detection with extension/MIME fallback (spec §39). */
export function detectFileType(buffer: Buffer, filename: string, mimeType?: string): DetectResult {
  const ext = filename.toLowerCase().split('.').pop() || ''
  const declared = (mimeType || '').toLowerCase()

  if (buffer.length >= 4) {
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return { kind: 'pdf', reason: 'magic bytes %PDF' }
    }
    // ZIP-family (docx/xlsx/pptx are all zip) — distinguish by internal parts
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1')
      if (head.includes('word/')) return { kind: 'docx', reason: 'zip contains word/' }
      if (head.includes('xl/')) return { kind: 'xlsx', reason: 'zip contains xl/' }
      if (head.includes('ppt/')) return { kind: 'pptx', reason: 'zip contains ppt/' }
      if (ext === 'docx' || declared.includes('wordprocessing')) return { kind: 'docx', reason: 'extension' }
      if (ext === 'xlsx' || declared.includes('spreadsheetml')) return { kind: 'xlsx', reason: 'extension' }
      if (ext === 'pptx' || declared.includes('presentationml')) return { kind: 'pptx', reason: 'extension' }
      return { kind: 'unknown', reason: 'unrecognized zip container' }
    }
  }

  if (ext === 'csv' || declared === 'text/csv') return { kind: 'csv', reason: 'extension/mime' }
  if (ext === 'txt' || ext === 'md' || declared.startsWith('text/')) return { kind: 'text', reason: 'extension/mime' }
  if (ext === 'docx') return { kind: 'docx', reason: 'extension (signature unreadable)' }
  if (ext === 'xlsx') return { kind: 'xlsx', reason: 'extension (signature unreadable)' }
  if (ext === 'pptx') return { kind: 'pptx', reason: 'extension (signature unreadable)' }
  if (ext === 'pdf') return { kind: 'pdf', reason: 'extension (signature unreadable)' }
  return { kind: 'unknown', reason: `unrecognized type (ext: ${ext || 'none'})` }
}

// ==================== MAIN ENTRY ====================

export async function ingestFile(
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<IngestedFile> {
  if (buffer.length === 0) throw new Error('File is empty.')
  if (buffer.length > INGEST_MAX_FILE_BYTES) {
    throw new Error(`File is too large to analyze (${Math.round(buffer.length / 1024 / 1024)}MB; max ${INGEST_MAX_FILE_BYTES / 1024 / 1024}MB).`)
  }

  const detected = detectFileType(buffer, filename, mimeType)
  switch (detected.kind) {
    case 'docx':
      return ingestDocx(buffer, filename, mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    case 'pdf':
      return ingestPdf(buffer, filename, mimeType || 'application/pdf')
    case 'xlsx':
      return ingestXlsx(buffer, filename, mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    case 'pptx':
      return ingestPptx(buffer, filename, mimeType || 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    case 'csv':
      return ingestCsvFile(buffer, filename)
    case 'text':
      return ingestTextFile(buffer, filename, mimeType || 'text/plain')
    default:
      throw new Error(`Unsupported file type: ${filename} (${detected.reason}). Supported: DOCX, PDF, XLSX, PPTX, CSV, TXT.`)
  }
}

function ingestCsvFile(buffer: Buffer, filename: string): IngestedFile {
  const text = buffer.toString('utf-8')
  const table = ingestCsv(filename, text)
  const lines = table.rows.map((r) => r.map((c) => (c === null ? '' : String(c))).join(','))
  const fullText = [table.headers.join(','), ...lines].join('\n')
  const { text: capped, truncated } = capLocal(fullText)
  return {
    kind: 'csv',
    filename,
    mimeType: 'text/csv',
    size: buffer.length,
    textContent: capped,
    truncated,
    structure: {
      sectionCount: 1,
      sections: [{ title: 'Dataset', blocks: [`${table.headers.length} columns, ${table.rows.length} rows`] }],
      tables: [table],
      stats: {
        characters: fullText.length,
        words: fullText.split(/\s+/).filter(Boolean).length,
        tables: 1,
        lists: 0,
      },
    },
    warnings: truncated ? ['CSV content exceeded the extraction cap and was truncated.'] : [],
  }
}

function ingestTextFile(buffer: Buffer, filename: string, mimeType: string): IngestedFile {
  const text = buffer.toString('utf-8')
  const { text: capped, truncated } = capLocal(text)
  const blocks = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
  return {
    kind: 'text',
    filename,
    mimeType,
    size: buffer.length,
    textContent: capped,
    truncated,
    structure: {
      sectionCount: Math.max(1, blocks.length),
      sections: [{ blocks: blocks.slice(0, 200) }],
      tables: [],
      stats: {
        characters: text.length,
        words: text.split(/\s+/).filter(Boolean).length,
        tables: 0,
        lists: 0,
      },
    },
    warnings: truncated ? ['Text exceeded the extraction cap and was truncated.'] : [],
  }
}

function capLocal(text: string): { text: string; truncated: boolean } {
  const CAP = 180_000
  if (text.length <= CAP) return { text, truncated: false }
  return { text: text.slice(0, CAP), truncated: true }
}

// ==================== AI CONTEXT BUILDER ====================

function renderTablePreview(name: string | undefined, headers: string[], rows: (string | number | null)[][], maxRows = 15): string {
  const header = headers.join(' | ')
  const body = rows.slice(0, maxRows).map((r) => r.map((c) => (c === null ? '' : String(c))).join(' | '))
  const more = rows.length > maxRows ? `\n… ${rows.length - maxRows} more rows` : ''
  return `${name ? `### ${name}\n` : ''}${header}\n${body.join('\n')}${more}`
}

/**
 * Build the bounded textual context the AI will "see" for attached files.
 * Includes structure stats + headings + table previews + full text excerpt —
 * enough to modify, summarize, expand, convert or fact-check the content.
 */
export function buildSourceContext(files: IngestedFile[], cap = 60_000): string {
  const parts: string[] = []
  let budget = cap

  for (const f of files) {
    if (budget <= 500) break
    const header =
      `#### FILE: ${f.filename} (${f.kind.toUpperCase()}, ${Math.round(f.size / 1024)}KB` +
      `${f.structure.pageCount ? `, ${f.structure.pageCount} pages` : ''}` +
      `${f.structure.slides ? `, ${f.structure.slides.length} slides` : ''}` +
      `${f.structure.sheets ? `, ${f.structure.sheets.length} sheets` : ''}` +
      `) — ${f.structure.stats.words} words`
    const section = [header]

    if (f.structure.headings && f.structure.headings.length > 0) {
      section.push(`Outline: ${f.structure.headings.slice(0, 40).join(' / ')}`)
    }
    if (f.structure.sheets) {
      for (const s of f.structure.sheets) {
        section.push(`Sheet "${s.name}" (${s.rowCount} rows × ${s.colCount} cols): ${s.headers.slice(0, 12).join(', ')}`)
        if (s.formulas && s.formulas.length > 0) {
          section.push(`  Formulas: ${s.formulas.slice(0, 10).join('; ')}`)
        }
      }
    }
    if (f.structure.tables.length > 0) {
      for (const t of f.structure.tables.slice(0, 6)) {
        section.push(renderTablePreview(t.name, t.headers, t.rows))
      }
    }
    if (f.structure.slides) {
      for (const s of f.structure.slides.slice(0, 30)) {
        section.push(`Slide ${s.index}${s.title ? ` — ${s.title}` : ''}: ${s.bullets.slice(0, 6).join(' · ')}`)
      }
    }

    const structureText = section.join('\n')
    budget -= structureText.length
    parts.push(structureText)

    // Full text excerpt with remaining budget
    const textBudget = Math.max(0, Math.min(budget, 24_000))
    if (textBudget > 500 && f.textContent) {
      const excerpt = f.textContent.slice(0, textBudget)
      parts.push(`--- Content of ${f.filename} ---\n${excerpt}${f.textContent.length > textBudget ? '\n… [truncated]' : ''}`)
      budget -= excerpt.length
    }
  }

  return parts.join('\n\n')
}
