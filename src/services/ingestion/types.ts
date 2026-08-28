// =============================================================================
// FILO INGESTION TYPES (spec §21, §22, §26)
// =============================================================================
// When a user attaches a file, Filo extracts a STRUCTURED representation so
// the AI can genuinely operate on the content — never a blind binary blob.
// =============================================================================

export type IngestedKind = 'docx' | 'pdf' | 'xlsx' | 'pptx' | 'csv' | 'text'

export interface IngestedTable {
  name?: string
  headers: string[]
  rows: (string | number | null)[][]
}

export interface IngestedSection {
  title?: string
  /** Paragraph-ish text blocks in order. */
  blocks: string[]
  tables?: IngestedTable[]
}

export interface IngestedSheet {
  name: string
  headers: string[]
  rows: (string | number | null)[][]
  rowCount: number
  colCount: number
  formulas?: string[]
}

export interface IngestedSlide {
  index: number
  title?: string
  bullets: string[]
  notes?: string
}

export interface IngestedFile {
  kind: IngestedKind
  filename: string
  mimeType: string
  size: number
  /** Full extracted plain text (truncated to cap). */
  textContent: string
  /** True when textContent was truncated by the cap. */
  truncated: boolean
  /** Structure summary — semantic map the user can reference ("section 3", "the second table"). */
  structure: {
    sectionCount: number
    sections: IngestedSection[]
    tables: IngestedTable[]
    sheets?: IngestedSheet[]
    slides?: IngestedSlide[]
    pageCount?: number
    headings?: string[]
    stats: {
      characters: number
      words: number
      tables: number
      lists: number
    }
  }
  warnings: string[]
}

/** Hard cap for extracted text carried into jobs/prompts (Convex doc limit is 1MB). */
export const INGEST_TEXT_CAP = 180_000

export const INGEST_MAX_FILE_BYTES = 25 * 1024 * 1024

export function truncateText(text: string, cap = INGEST_TEXT_CAP): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false }
  return { text: text.slice(0, cap), truncated: true }
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}'’-]+/gu)
  return m ? m.length : 0
}
