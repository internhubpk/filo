// =============================================================================
// FILO STRUCTURAL QA (spec §29, §30)
// =============================================================================
// No artifact is declared complete on AI output alone. Before rendering (and
// again on the rendered bytes), the QA validator checks for structural
// defects — overflow risks, empty sections, placeholder text, oversized
// tables, orphaned headings, slide-bound overruns — and a bounded,
// deterministic repair pass fixes what it can (max 1 pass, no infinite loops,
// no AI in the loop here: repairs are mechanical).
// =============================================================================

import type { ArtifactSpecification } from '@/types'

export type QaSeverity = 'error' | 'warning' | 'info'

export interface QaIssue {
  sectionId?: string
  componentIndex?: number
  type: string
  severity: QaSeverity
  message: string
  /** Set when the repair pass fixed the issue. */
  repaired?: boolean
}

export interface QaReport {
  passed: boolean
  score: number
  issues: QaIssue[]
  repaired: number
  checks: Array<{ id: string; label: string; passed: boolean }>
}

export interface QaComponent {
  sectionId: string
  index: number
  type: string
  content: unknown
}

const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /\[insert[^}]*\]/i,
  /\[placeholder\]/i,
  /placeholder text/i,
  /TODO:?\s*(fill|add|complete)/i,
  /xxx+/i,
]

const MAX_TABLE_COLS = 12
const MAX_PARAGRAPH_CHARS = 6000
const MIN_LIST_ITEMS = 2
const PPT_MAX_CHARS_PER_SLIDE = 900
const PPT_MAX_BULLETS = 8

// ==================== VALIDATION ====================

export function validateDocument(
  spec: ArtifactSpecification,
  components: QaComponent[]
): QaReport {
  const issues: QaIssue[] = []
  const checks: Array<{ id: string; label: string; passed: boolean }> = []

  const bySection = new Map<string, QaComponent[]>()
  for (const c of components) {
    const list = bySection.get(c.sectionId) ?? []
    list.push(c)
    bySection.set(c.sectionId, list)
  }

  // --- Check 1: title present + non-generic ------------------------------
  const titleOk =
    Boolean(spec.title && spec.title.trim()) &&
    !/^untitled|^generated document|^new document|^document$/i.test(spec.title.trim())
  checks.push({ id: 'title', label: 'Meaningful document title', passed: titleOk })
  if (!titleOk) {
    issues.push({ type: 'MISSING_TITLE', severity: 'error', message: 'Document title is missing or generic.' })
  }

  // --- Check 2: every section has content ---------------------------------
  const emptySections: string[] = []
  for (const s of spec.sections) {
    const list = bySection.get(s.id) ?? []
    const hasContent = list.some(
      (c) => c.content !== null && c.content !== undefined && String(Array.isArray(c.content) ? c.content.length : c.content).trim?.() !== ''
    )
    if (!hasContent) emptySections.push(s.id)
  }
  const sectionsOk = emptySections.length === 0
  checks.push({ id: 'sections-covered', label: 'Every section has content', passed: sectionsOk })
  for (const sid of emptySections) {
    issues.push({ type: 'EMPTY_SECTION', sectionId: sid, severity: 'error', message: 'Section has no generated content.' })
  }

  // --- Check 3: placeholder text ------------------------------------------
  let placeholderHits = 0
  for (const c of components) {
    const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content)
    if (PLACEHOLDER_PATTERNS.some((p) => p.test(text))) {
      placeholderHits++
      issues.push({
        sectionId: c.sectionId,
        componentIndex: c.index,
        type: 'PLACEHOLDER_CONTENT',
        severity: 'error',
        message: 'Component contains placeholder-style content.',
      })
    }
  }
  checks.push({ id: 'no-placeholders', label: 'No placeholder content', passed: placeholderHits === 0 })

  // --- Check 4: table width / sanity --------------------------------------
  let tableIssues = 0
  for (const c of components) {
    if (c.type !== 'TABLE' && c.type !== 'table') continue
    const rows = Array.isArray(c.content) ? c.content : []
    const cols = Math.max(0, ...rows.map((r: unknown[]) => (Array.isArray(r) ? r.length : 0)))
    if (cols > MAX_TABLE_COLS) {
      tableIssues++
      issues.push({
        sectionId: c.sectionId,
        componentIndex: c.index,
        type: 'TABLE_TOO_WIDE',
        severity: 'warning',
        message: `Table has ${cols} columns — wider than the ${MAX_TABLE_COLS}-column page-safe maximum.`,
      })
    }
    if (rows.length < 2) {
      tableIssues++
      issues.push({
        sectionId: c.sectionId,
        componentIndex: c.index,
        type: 'TABLE_TOO_SMALL',
        severity: 'warning',
        message: 'Table has fewer than 2 rows (header only or empty).',
      })
    }
  }
  checks.push({ id: 'tables-sane', label: 'Tables fit the page and carry data', passed: tableIssues === 0 })

  // --- Check 5: paragraph length / overflow risk --------------------------
  let longParas = 0
  for (const c of components) {
    if ((c.type === 'PARAGRAPH' || c.type === 'paragraph') && typeof c.content === 'string' && c.content.length > MAX_PARAGRAPH_CHARS) {
      longParas++
      issues.push({
        sectionId: c.sectionId,
        componentIndex: c.index,
        type: 'PARAGRAPH_TOO_LONG',
        severity: 'warning',
        message: `Paragraph exceeds ${MAX_PARAGRAPH_CHARS} characters — splitting for pagination safety.`,
      })
    }
  }
  checks.push({ id: 'paragraph-length', label: 'Paragraphs within pagination limits', passed: longParas === 0 })

  // --- Check 6: tiny lists --------------------------------------------------
  let tinyLists = 0
  for (const c of components) {
    if ((c.type === 'LIST' || c.type === 'list') && Array.isArray(c.content) && c.content.length > 0 && c.content.length < MIN_LIST_ITEMS) {
      tinyLists++
      issues.push({ type: 'TINY_LIST', sectionId: c.sectionId, componentIndex: c.index, severity: 'info', message: 'List has fewer than 2 items.' })
    }
  }
  checks.push({ id: 'lists-sane', label: 'Lists carry at least 2 items', passed: tinyLists === 0 })

  // --- Check 7: orphaned headings (heading last in section with no body after) ---
  let orphans = 0
  for (const [sid, list] of bySection) {
    const meaningful = list.filter((c) => c.content !== null && c.content !== undefined)
    const last = meaningful[meaningful.length - 1]
    if (last && (last.type === 'HEADING' || last.type === 'heading')) {
      orphans++
      issues.push({ type: 'ORPHANED_HEADING', sectionId: sid, componentIndex: last.index, severity: 'warning', message: 'Section ends with a heading that has no body after it.' })
    }
  }
  checks.push({ id: 'no-orphan-headings', label: 'No orphaned headings', passed: orphans === 0 })

  // --- Check 8: PPTX slide density (chars + bullets per slide) -------------
  if (spec.outputFormat === 'PPTX') {
    let denseSlides = 0
    for (const [sid, list] of bySection) {
      const chars = list.reduce((acc, c) => acc + (typeof c.content === 'string' ? c.content.length : JSON.stringify(c.content ?? '').length), 0)
      const bullets = list.filter((c) => c.type === 'LIST').reduce((acc, c) => acc + (Array.isArray(c.content) ? c.content.length : 0), 0)
      if (chars > PPT_MAX_CHARS_PER_SLIDE) {
        denseSlides++
        issues.push({ type: 'SLIDE_OVERFLOW_RISK', sectionId: sid, severity: 'warning', message: `Slide content ~${chars} chars — above the ${PPT_MAX_CHARS_PER_SLIDE} overflow-safe budget; text may be clipped.` })
      }
      if (bullets > PPT_MAX_BULLETS) {
        denseSlides++
        issues.push({ type: 'SLIDE_TOO_MANY_BULLETS', sectionId: sid, severity: 'warning', message: `Slide has ${bullets} bullets (safe max ${PPT_MAX_BULLETS}).` })
      }
    }
    checks.push({ id: 'slide-density', label: 'Slide text within safe density', passed: denseSlides === 0 })
  }

  // --- Check 9: chart data validity ----------------------------------------
  let chartIssues = 0
  for (const c of components) {
    if (c.type !== 'CHART' && c.type !== 'chart') continue
    const o = (c.content && typeof c.content === 'object' ? c.content : {}) as Record<string, unknown>
    const series = Array.isArray(o.series) ? (o.series as Array<Record<string, unknown>>) : []
    const hasData = series.some((s) => Array.isArray(s.data) && s.data.some((d) => typeof d === 'number' && Number.isFinite(d)))
    if (!hasData) {
      chartIssues++
      issues.push({ type: 'INVALID_CHART_DATA', sectionId: c.sectionId, componentIndex: c.index, severity: 'error', message: 'Chart component has no numeric series data.' })
    }
  }
  checks.push({ id: 'chart-data', label: 'Charts carry numeric data', passed: chartIssues === 0 })

  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.filter((i) => i.severity === 'warning').length
  const score = Math.max(0, 100 - errors * 15 - warnings * 5)

  return {
    passed: errors === 0,
    score,
    issues,
    repaired: 0,
    checks,
  }
}

// ==================== BOUNDED REPAIR (deterministic, 1 pass) ====================

/**
 * Mechanical, deterministic repair of what can be structurally fixed.
 * NEVER calls the AI, NEVER loops — one pass, bounded transforms:
 *   • PARAGRAPH_TOO_LONG → split into paragraph chunks
 *   • TINY_LIST          → convert single-item list to a paragraph
 *   • TABLE_TOO_WIDE     → transpose risk flagged only (kept for renderer)
 *   • SLIDE_TOO_MANY_BULLETS → keep first 6 + "…" (PPTX only)
 */
export function autoRepair(
  spec: ArtifactSpecification,
  components: QaComponent[],
  report: QaReport
): { components: QaComponent[]; report: QaReport } {
  if (report.passed && report.issues.length === 0) return { components, report }

  const repairedIssues: QaIssue[] = []
  const out: QaComponent[] = []

  for (const c of components) {
    // Split overly long paragraphs. The chunk target is intentionally well
    // below the MAX_PARAGRAPH_CHARS limit: a ~5800-char chunk is ~940pt tall
    // when typeset, which exceeds a single A4/Letter text column — the PDF
    // renderer would then rely on pdfkit's internal page-splitting and lose
    // header/footer + page-number fidelity. ~1800 chars ≈ 300pt fits any page.
    if (
      (c.type === 'PARAGRAPH' || c.type === 'paragraph') &&
      typeof c.content === 'string' &&
      c.content.length > MAX_PARAGRAPH_CHARS
    ) {
      const chunks = splitParagraph(c.content, 1800)
      chunks.forEach((chunk, i) => {
        out.push({ ...c, index: c.index + i * 0.001, content: chunk })
      })
      repairedIssues.push(
        ...report.issues
          .filter((iss) => iss.type === 'PARAGRAPH_TOO_LONG' && iss.componentIndex === c.index && iss.sectionId === c.sectionId)
          .map((iss) => ({ ...iss, repaired: true }))
      )
      continue
    }

    // Single-item list → paragraph.
    if ((c.type === 'LIST' || c.type === 'list') && Array.isArray(c.content) && c.content.length === 1) {
      out.push({ ...c, type: 'PARAGRAPH', content: String(c.content[0]) })
      repairedIssues.push(
        ...report.issues
          .filter((iss) => iss.type === 'TINY_LIST' && iss.componentIndex === c.index && iss.sectionId === c.sectionId)
          .map((iss) => ({ ...iss, repaired: true }))
      )
      continue
    }

    // PPTX: cap bullet count.
    if (
      spec.outputFormat === 'PPTX' &&
      (c.type === 'LIST' || c.type === 'list') &&
      Array.isArray(c.content) &&
      c.content.length > PPT_MAX_BULLETS
    ) {
      out.push({ ...c, content: c.content.slice(0, PPT_MAX_BULLETS - 1).concat(['• …']) })
      repairedIssues.push(
        ...report.issues
          .filter((iss) => iss.type === 'SLIDE_TOO_MANY_BULLETS' && iss.componentIndex === c.index && iss.sectionId === c.sectionId)
          .map((iss) => ({ ...iss, repaired: true }))
      )
      continue
    }

    // Drop 1-row tables (header only, no data).
    if ((c.type === 'TABLE' || c.type === 'table') && Array.isArray(c.content) && c.content.length === 1) {
      repairedIssues.push(
        ...report.issues
          .filter((iss) => iss.type === 'TABLE_TOO_SMALL' && iss.componentIndex === c.index && iss.sectionId === c.sectionId)
          .map((iss) => ({ ...iss, repaired: true }))
      )
      continue // remove
    }

    out.push(c)
  }

  const remaining = report.issues.filter(
    (iss) => !repairedIssues.some((r) => r.type === iss.type && r.sectionId === iss.sectionId && r.componentIndex === iss.componentIndex)
  )
  const errors = [...remaining, ...repairedIssues.filter((i) => !i.repaired)].filter((i) => i.severity === 'error').length
  const warnings = [...remaining, ...repairedIssues.filter((i) => !i.repaired)].filter((i) => i.severity === 'warning').length

  const repairedReport: QaReport = {
    ...report,
    issues: [...remaining, ...repairedIssues],
    repaired: repairedIssues.length,
    passed: remaining.filter((i) => i.severity === 'error').length === 0,
    score: Math.max(0, 100 - errors * 15 - warnings * 5),
  }

  return { components: out, report: repairedReport }
}

function splitParagraph(text: string, chunkSize: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text]
  const chunks: string[] = []
  let current = ''
  for (const s of sentences) {
    if (current.length + s.length > chunkSize && current) {
      chunks.push(current.trim())
      current = s
    } else {
      current += s
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

/**
 * Validate rendered artifact bytes (post-render sanity — spec §31).
 * Layer 1: cheap signature/size checks (no dependencies).
 */
export function validateRenderedOutput(
  buffer: Buffer,
  format: string,
  mimeType: string
): { ok: boolean; issues: QaIssue[] } {
  const issues: QaIssue[] = []

  // Per-format minimums. A 512-byte floor used to FALSELY REJECT small but
  // perfectly valid CSV/TXT exports (a header + a few rows is often < 512 B),
  // which failed otherwise-good jobs at the render gate.
  const MIN_BYTES: Record<string, number> = {
    DOCX: 1024,
    XLSX: 1024,
    PPTX: 1024,
    PDF: 512,
    CSV: 32,
    TXT: 32,
    HTML: 64,
  }
  const min = MIN_BYTES[format.toUpperCase()] ?? 512

  if (!buffer || buffer.length < min) {
    issues.push({ type: 'RENDER_TOO_SMALL', severity: 'error', message: `Rendered file is only ${buffer?.length ?? 0} bytes (minimum ${min}).` })
  }

  const sig: Record<string, (b: Buffer) => boolean> = {
    DOCX: (b) => b[0] === 0x50 && b[1] === 0x4b,
    XLSX: (b) => b[0] === 0x50 && b[1] === 0x4b,
    PPTX: (b) => b[0] === 0x50 && b[1] === 0x4b,
    PDF: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
    CSV: (b) => b.length > 0,
    TXT: (b) => b.length > 0,
    HTML: (b) => b.length > 0,
  }
  const checker = sig[format.toUpperCase()]
  if (checker && !checker(buffer)) {
    issues.push({ type: 'RENDER_BAD_SIGNATURE', severity: 'error', message: `Rendered bytes do not look like a valid ${format} file.` })
  }
  if (mimeType.includes('json') || mimeType.includes('javascript')) {
    issues.push({ type: 'RENDER_BAD_MIME', severity: 'error', message: `Suspicious mime type for artifact: ${mimeType}` })
  }

  return { ok: issues.every((i) => i.severity !== 'error'), issues }
}

/**
 * Layer 2: STRUCTURAL validation of the rendered bytes. A job may only be
 * marked completed when the artifact is genuinely readable, so we re-open
 * the container exactly the way a consumer would:
 *   • DOCX/XLSX/PPTX → the ZIP must decompress and contain the mandatory
 *     OOXML part (word/document.xml / xl/workbook.xml / ppt/presentation.xml)
 *   • PDF → header + trailer + at least one /Page object
 *   • CSV → RFC4180-parseable with a consistent column count
 * Any failure here is a hard error: the bytes exist but are unusable, which
 * must never be presented to the user as a finished document.
 */
export async function validateRenderedOutputDeep(
  buffer: Buffer,
  format: string
): Promise<{ ok: boolean; issues: QaIssue[] }> {
  const issues: QaIssue[] = []
  const fmt = format.toUpperCase()

  if (fmt === 'DOCX' || fmt === 'XLSX' || fmt === 'PPTX') {
    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(buffer)
      const required =
        fmt === 'DOCX'
          ? ['word/document.xml', '[Content_Types].xml']
          : fmt === 'XLSX'
            ? ['xl/workbook.xml', '[Content_Types].xml']
            : ['ppt/presentation.xml', '[Content_Types].xml']
      for (const part of required) {
        if (!zip.files[part]) {
          issues.push({ type: 'RENDER_MISSING_PART', severity: 'error', message: `Rendered ${fmt} is missing required part ${part}.` })
        }
      }
      // The main part must also be non-trivial — an empty document.xml shell
      // technically unzips but is not a usable document.
      const mainPart = required[0]
      if (zip.files[mainPart]) {
        const xml = await zip.files[mainPart].async('string')
        if (xml.length < 200) {
          issues.push({ type: 'RENDER_EMPTY_DOCUMENT', severity: 'error', message: `Rendered ${fmt} main part is suspiciously empty (${xml.length} chars).` })
        }
      }
    } catch (err) {
      issues.push({ type: 'RENDER_UNREADABLE_CONTAINER', severity: 'error', message: `Rendered ${fmt} container could not be opened: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}` })
    }
  }

  if (fmt === 'PDF') {
    const text = buffer.toString('latin1')
    if (!text.includes('%%EOF')) {
      issues.push({ type: 'RENDER_BAD_PDF_TRAILER', severity: 'error', message: 'Rendered PDF has no %%EOF trailer — the file is truncated.' })
    }
    if (!/\/Type\s*\/Page[^s]/.test(text)) {
      issues.push({ type: 'RENDER_NO_PAGES', severity: 'error', message: 'Rendered PDF contains no page objects.' })
    }
  }

  if (fmt === 'CSV') {
    const text = buffer.toString('utf-8').replace(/^\uFEFF/, '')
    // RFC4180-aware record scan: quoted fields may contain commas, quotes
    // and NEWLINES, so records must be counted with quote state — a naive
    // line split would falsely reject valid multi-line cells as ragged rows.
    const widths = rfc4180ColumnWidths(text)
    if (widths.length === 0) {
      issues.push({ type: 'RENDER_EMPTY_CSV', severity: 'error', message: 'Rendered CSV is empty.' })
    } else {
      const ragged = widths.filter((w) => w !== widths[0]).length
      if (ragged > 0) {
        issues.push({ type: 'RENDER_RAGGED_CSV', severity: 'error', message: `Rendered CSV has ${ragged} rows with a different column count than the header.` })
      }
    }
  }

  return { ok: issues.every((i) => i.severity !== 'error'), issues }
}

/**
 * RFC4180-aware column count per record (bounded to the first 500 records).
 * Handles quoted fields containing commas, escaped quotes and newlines.
 */
function rfc4180ColumnWidths(text: string): number[] {
  const widths: number[] = []
  let cols = 1
  let inQ = false
  let scanned = 0
  let recordHasContent = false
  for (let i = 0; i < text.length && scanned < 500; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') i++
      else if (ch === '"') inQ = false
    } else if (ch === '"') inQ = true
    else if (ch === ',') { cols++; recordHasContent = true }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      widths.push(cols)
      scanned++
      cols = 1
      recordHasContent = false
    } else recordHasContent = true
  }
  // A final record not terminated by a newline still counts when non-empty
  // (a newline-terminated file resets recordHasContent on the last newline).
  if (recordHasContent) widths.push(cols)
  return widths
}
