// =============================================================================
// XLSX RENDERER (spec §15) — REAL analyst workbooks via ExcelJS + native charts
// =============================================================================
// Rebuilt to the first-class-artifact standard:
//   • Overview sheet — merged title banner, description, KPI band from the
//     first metric grid, workbook contents index
//   • one styled worksheet per section (themed header row, zebra striping,
//     borders, content-aware column widths, autofilter, freeze panes)
//   • REAL formulas — "=SUM(...)" cells are written as Excel formulas with
//     row references remapped to the table's actual placement; every formula
//     is VALIDATED against the table extent (bounds + non-empty targets +
//     function whitelist) so the workbook cannot ship with #REF!/#VALUE!/
//     #NAME? baked in. Invalid formulas degrade to a computed value (when
//     the evaluator can compute it) or visible text — never a corrupt cell.
//   • totals rows get REAL =SUM() formulas (never hardcoded totals)
//   • NATIVE Excel charts (bar/line/pie/doughnut) injected at the OOXML level
//     — real chart parts with live cell references, not pictures
//   • diagrams embedded as crisp PNG images
//   • number formats: currency ($/€/£/¥/PKR/Rs), percentages, ISO dates,
//     thousands separators, decimal precision
//   • print setup: A4, fit-to-width, landscape for wide tables, repeated
//     header rows on every printed page
// =============================================================================

import type { RendererOutput, DocumentRenderer, RenderableDocument, CanonicalComponent } from './shared'
import {
  asMetrics,
  asString,
  asStringArray,
  asTable,
  asDiagram,
  deriveTheme,
  hex6,
  renderComponentImage,
} from './shared'
import { remapFormulaRows } from './xlsx-formulas'
import {
  evaluateFormula,
  validateFormulaReferences,
  type CellMatrix,
} from '@/services/formula-evaluator'

const MAX_ROWS = 500
const MAX_COLS = 40

interface SheetChart {
  sheetName: string
  type: 'bar' | 'line' | 'pie' | 'doughnut'
  title: string
  /** 1-based data-block coordinates (categories col A, series from col B). */
  firstDataRow: number
  lastDataRow: number
  seriesCount: number
  anchorRow: number
  anchorCol: number
}

interface SheetPlan {
  name: string
  title: string
  rows: Array<Array<string | number | null>>
  formulas?: string[]
  metrics?: Array<{ label: string; value: string; change?: string }>
  paragraphs: string[]
  lists: string[][]
  charts: Array<{ content: Record<string, unknown>; note: string }>
  diagrams: Array<unknown>
}

function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = String(name || 'Sheet')
    .replace(/[\\/*?:[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28)
  if (!base) base = 'Sheet'
  let candidate = base
  let i = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 25)} ${i++}`
  }
  used.add(candidate.toLowerCase())
  return candidate
}

// ==================== NUMBER FORMAT DETECTION ====================

interface CellFormat {
  value: string | number | null
  numFmt?: string
}

const CURRENCY_PATTERNS: Array<{ re: RegExp; fmt: string }> = [
  { re: /^\s*-\?\$\s?[\d,]+(\.\d+)?\s*$/, fmt: '"$"#,##0.00' },
  { re: /^\s*-\?€\s?[\d,]+(\.\d+)?\s*$/, fmt: '"€"#,##0.00' },
  { re: /^\s*-\?£\s?[\d,]+(\.\d+)?\s*$/, fmt: '"£"#,##0.00' },
  { re: /^\s*-\?¥\s?[\d,]+(\.\d+)?\s*$/, fmt: '"¥"#,##0' },
  { re: /^\s*-\?(?:PKR|Rs\.?|₨)\s?[\d,]+(\.\d+)?\s*$/i, fmt: '"Rs "#,##0.00' },
  { re: /^\s*[\d,]+(\.\d+)?\s?(USD|EUR|GBP|PKR)\s*$/i, fmt: '"$"#,##0.00' },
]

/** Detect the display format of a raw cell string. Returns null for text. */
function detectFormat(raw: string): CellFormat | null {
  const text = String(raw).trim()
  if (text === '') return null

  // percent: keep the numeric value, display with %
  if (/^-?[\d,]+(\.\d+)?\s*%$/.test(text)) {
    const n = Number(text.replace(/[,%\s]/g, ''))
    if (Number.isFinite(n)) return { value: n / 100, numFmt: '0.0%' }
  }

  for (const { re, fmt } of CURRENCY_PATTERNS) {
    if (re.test(text)) {
      const n = Number(text.replace(/[^0-9.-]/g, '').replace(/^-/, '-'))
      if (Number.isFinite(n)) return { value: n, numFmt: fmt }
    }
  }

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const d = new Date(`${text}T00:00:00Z`)
    if (!Number.isNaN(d.getTime())) return { value: text, numFmt: 'yyyy-mm-dd' }
  }

  // plain number (with optional thousands separators)
  if (/^[+-]?[\d,]+(\.\d+)?$/.test(text)) {
    const n = Number(text.replace(/,/g, ''))
    if (Number.isFinite(n)) {
      return { value: n, numFmt: Number.isInteger(n) ? '#,##0' : '#,##0.00' }
    }
  }
  return null
}

export class XlsxRenderer implements DocumentRenderer {
  format = 'XLSX' as const

  async render(document: RenderableDocument): Promise<RendererOutput> {
    const ExcelJS = (await import('exceljs')).default
    const spec = document.specification
    const theme = deriveTheme(spec)
    const colors = theme.colors
    const qa: Record<string, unknown> = {}
    const rendererIssues: string[] = []

    const wb = new ExcelJS.Workbook()
    wb.creator = 'Filo'
    wb.created = new Date()
    wb.title = spec.title

    const usedNames = new Set<string>(['overview'])
    const chartRequests: SheetChart[] = []

    // ---------------- Overview / cover sheet ----------------
    const overview = wb.addWorksheet('Overview', {
      properties: { tabColor: { argb: `FF${hex6(colors.primary, '1E3A5F')}` } },
      views: [{ showGridLines: false }],
    })
    overview.columns = [
      { key: 'field', width: 24 },
      { key: 'value', width: 92 },
    ]

    // Title banner (merged A1:B1)
    overview.mergeCells(1, 1, 1, 2)
    const banner = overview.getCell(1, 1)
    banner.value = spec.title
    banner.font = { bold: true, size: 20, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
    banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex6(colors.primary, '1E3A5F')}` } }
    banner.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    overview.getRow(1).height = 40

    let oRow = 3
    if (spec.description) {
      const d = overview.getCell(oRow++, 1)
      d.value = spec.description
      d.font = { size: 12, italic: true, color: { argb: `FF${hex6(colors.mutedForeground, '64748B')}` } }
      overview.mergeCells(oRow - 1, 1, oRow - 1, 2)
      oRow++
    }
    const meta = overview.getCell(oRow++, 1)
    meta.value = `Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} · Filo`
    meta.font = { size: 10, color: { argb: `FF${hex6(colors.mutedForeground, '64748B')}` } }
    oRow++

    // KPI band from the first metric grid in the document
    let kpi: Array<{ label: string; value: string; change?: string }> = []
    for (const section of spec.sections) {
      const comps = document.sections.find((s) => s.id === section.id)?.components ?? []
      const grid = comps.find((c) => c.type === 'metric_grid')
      if (grid) {
        kpi = asMetrics(grid.content)
        break
      }
    }
    if (kpi.length > 0) {
      const kpiHeader = overview.getCell(oRow++, 1)
      kpiHeader.value = 'KEY METRICS'
      kpiHeader.font = { bold: true, size: 11, color: { argb: `FF${hex6(colors.accent, '3B82F6')}` } }
      const labels = kpi.slice(0, 4)
      const labelRow = overview.getRow(oRow++)
      const valueRow = overview.getRow(oRow++)
      const changeRow = overview.getRow(oRow++)
      labels.forEach((m, i) => {
        const lc = labelRow.getCell(i + 1)
        lc.value = m.label || 'Metric'
        lc.font = { size: 10, color: { argb: `FF${hex6(colors.mutedForeground, '64748B')}` } }
        const vc = valueRow.getCell(i + 1)
        vc.value = m.value
        vc.font = { bold: true, size: 18, color: { argb: `FF${hex6(colors.accent, '3B82F6')}` } }
        const cc = changeRow.getCell(i + 1)
        if (m.change) {
          cc.value = m.change
          cc.font = { size: 9, italic: true, color: { argb: `FF${hex6(colors.mutedForeground, '64748B')}` } }
        }
      })
      oRow++
    }

    // Contents index
    const idxHeader = overview.getCell(oRow++, 1)
    idxHeader.value = 'WORKSHEET CONTENTS'
    idxHeader.font = { bold: true, size: 11, color: { argb: `FF${hex6(colors.accent, '3B82F6')}` } }
    spec.sections.forEach((s, i) => {
      const r = overview.getRow(oRow++)
      r.getCell(1).value = `  ${i + 1}.`
      r.getCell(1).font = { size: 10, color: { argb: `FF${hex6(colors.mutedForeground, '64748B')}` } }
      const c = r.getCell(2)
      c.value = s.title
      c.font = { size: 10, bold: i === 0 }
    })

    // ---------------- Section sheets ----------------
    for (const section of spec.sections) {
      const components = (document.sections.find((x) => x.id === section.id)?.components ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)

      const plan: SheetPlan = {
        name: section.title,
        title: section.title,
        rows: [],
        paragraphs: [],
        lists: [],
        charts: [],
        diagrams: [],
      }

      for (const c of components) {
        if (c.type === 'table') {
          const rows = asTable(c.content)
          if (rows.length > 0) plan.rows.push(...rows.slice(0, MAX_ROWS))
        } else if (c.type === 'metric_grid') {
          plan.metrics = asMetrics(c.content)
        } else if (c.type === 'list' || c.type === 'key_takeaways') {
          plan.lists.push(asStringArray(c.content))
        } else if (c.type === 'paragraph' || c.type === 'quote' || c.type === 'callout') {
          const t = asString(c.content)
          if (t) plan.paragraphs.push(t)
        } else if (c.type === 'chart') {
          const o = (c.content && typeof c.content === 'object' ? c.content : {}) as Record<string, unknown>
          const note = typeof o.note === 'string' ? o.note : ''
          plan.charts.push({ content: o, note })
        } else if (c.type === 'diagram' || c.type === 'timeline') {
          plan.diagrams.push(c.content)
        } else if (c.type === 'two_column') {
          const o = (c.content && typeof c.content === 'object' ? c.content : {}) as Record<string, unknown>
          plan.rows.push(
            ['Aspect', String(o.leftTitle ?? 'A'), String(o.rightTitle ?? 'B')],
            ...(Array.isArray(o.leftPoints) ? (o.leftPoints as unknown[]) : []).map((l, i) => [
              `Point ${i + 1}`,
              String((l as string) ?? ''),
              String((Array.isArray(o.rightPoints) ? (o.rightPoints as unknown[])[i] : '') ?? ''),
            ])
          )
        }
      }

      const sheetName = sanitizeSheetName(section.title, usedNames)
      const ws = wb.addWorksheet(sheetName, {
        properties: { tabColor: { argb: `FF${hex6(colors.accent, '3B82F6')}` } },
        views: [{ showGridLines: true }],
      })

      let cursor = 1
      // Section title banner
      ws.mergeCells(cursor, 1, cursor, 2)
      const titleCell = ws.getCell(cursor, 1)
      titleCell.value = section.title
      titleCell.font = { bold: true, size: 16, color: { argb: `FF${hex6(colors.primary, '1E3A5F')}` } }
      titleCell.alignment = { vertical: 'middle' }
      ws.getRow(cursor).height = 26
      cursor += 2

      // Metrics block
      if (plan.metrics && plan.metrics.length > 0) {
        const headers = plan.metrics.map((m) => m.label || 'Metric')
        const values = plan.metrics.map((m) => m.value)
        const changes = plan.metrics.map((m) => m.change ?? '')
        const hRow = ws.getRow(cursor)
        headers.forEach((h, i) => {
          const cell = hRow.getCell(i + 1)
          cell.value = h
          cell.font = { bold: true, size: 10, color: { argb: `FF${hex6(colors.mutedForeground, '64748B')}` } }
        })
        const vRow = ws.getRow(cursor + 1)
        values.forEach((v, i) => {
          const cell = vRow.getCell(i + 1)
          cell.value = v
          cell.font = { bold: true, size: 16, color: { argb: `FF${hex6(colors.accent, '3B82F6')}` } }
        })
        const cRow = ws.getRow(cursor + 2)
        changes.forEach((c, i) => {
          const cell = cRow.getCell(i + 1)
          cell.value = c
          cell.font = { size: 9, italic: true, color: { argb: `FF${hex6(colors.mutedForeground, '64748B')}` } }
        })
        cursor += 4
      }

      // Paragraphs (wrapped, merged across a sane width)
      for (const p of plan.paragraphs.slice(0, 30)) {
        const cell = ws.getCell(cursor, 1)
        cell.value = p
        cell.alignment = { wrapText: true, vertical: 'top' }
        ws.mergeCells(cursor, 1, cursor, Math.max(3, Math.min(10, Math.ceil(p.length / 90))))
        // generous row height so wrapped text is not clipped
        ws.getRow(cursor).height = Math.max(15, Math.ceil(p.length / 110) * 15)
        cursor++
      }
      if (plan.paragraphs.length > 0) cursor++

      // Lists
      for (const list of plan.lists.slice(0, 20)) {
        for (const item of list.slice(0, 50)) {
          ws.getCell(cursor++, 1).value = `• ${item}`
        }
        cursor++
      }

      // Table data (the main event)
      if (plan.rows.length > 0) {
        const tableStartRow = cursor
        const width = Math.min(
          MAX_COLS,
          Math.max(...plan.rows.map((r) => r.length))
        )
        let hasHeader = false
        const matrix = plan.rows as CellMatrix

        // Column type inference across data rows (row 1 = header).
        const colFormats: Array<Map<string, number>> = Array.from({ length: width }, () => new Map())
        for (let r = 1; r < Math.min(plan.rows.length, 200); r++) {
          for (let cIdx = 0; cIdx < width; cIdx++) {
            const raw = plan.rows[r][cIdx]
            if (typeof raw !== 'string' || /^=/.test(raw.trim())) continue
            const fmt = detectFormat(raw)
            if (fmt && fmt.numFmt) {
              const m = colFormats[cIdx]
              m.set(fmt.numFmt, (m.get(fmt.numFmt) ?? 0) + 1)
            }
          }
        }
        const dominantFmt = colFormats.map((m) => {
          let best: string | null = null
          let bestN = 0
          for (const [fmt, n] of m) {
            if (n > bestN) { best = fmt; bestN = n }
          }
          return bestN >= 2 ? best : null
        })

        plan.rows.forEach((row, rIdx) => {
          const excelRow = ws.getRow(cursor)
          for (let cIdx = 0; cIdx < width; cIdx++) {
            const raw = row[cIdx] ?? ''
            const cell = excelRow.getCell(cIdx + 1)

            if (typeof raw === 'string' && /^=/.test(raw.trim())) {
              // REAL formula (spec §15: never hardcode calculated values).
              // Row references are remapped to the table's actual placement
              // (the AI numbered its table from row 1), then the formula is
              // VALIDATED: in-bounds references, non-empty targets, known
              // functions. An invalid formula NEVER reaches the workbook as
              // a live formula — it degrades to its computed value (when the
              // data allows) or visible text, so #REF!/#NAME? is impossible.
              const trimmed = raw.trim()
              const check = validateFormulaReferences(trimmed, matrix, plan.rows.length)
              if (check.ok) {
                const rowOffset = tableStartRow - 1
                cell.value = { formula: remapFormulaRows(trimmed.replace(/^=/, ''), rowOffset) }
              } else {
                const computed = evaluateFormula(trimmed, matrix)
                if (computed !== null) {
                  cell.value = computed
                  cell.numFmt = Number.isInteger(computed) ? '#,##0' : '#,##0.00'
                  rendererIssues.push(`${sheetName}!${cell.address}: formula degraded to computed value (${check.problem})`)
                } else {
                  cell.value = trimmed.replace(/^=/, '') + '  [formula not applied — ' + String(check.problem ?? 'unverified') + ']'
                  rendererIssues.push(`${sheetName}!${cell.address}: formula written as text (${check.problem})`)
                }
              }
            } else if (typeof raw === 'number') {
              cell.value = raw
              cell.numFmt = Number.isInteger(raw) ? '#,##0' : '#,##0.00'
            } else if (rIdx > 0 && dominantFmt[cIdx]) {
              const fmt = detectFormat(String(raw))
              if (fmt) {
                cell.value = fmt.value
                cell.numFmt = fmt.numFmt as string
              } else {
                cell.value = String(raw)
              }
            } else {
              const text = String(raw)
              if (rIdx > 0 && text !== '') {
                const fmt = detectFormat(text)
                if (fmt) {
                  cell.value = fmt.value
                  cell.numFmt = fmt.numFmt as string
                } else {
                  cell.value = text
                }
              } else {
                cell.value = text
              }
            }

            // Header row styling
            if (rIdx === 0) {
              hasHeader = true
              cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex6(colors.primary, '1E3A5F')}` } }
              cell.alignment = { wrapText: true, vertical: 'middle' }
              cell.border = {
                top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
              }
            } else if (rIdx % 2 === 0) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex6(colors.muted, 'F1F5F9')}` } }
              cell.border = {
                top: { style: 'hair', color: { argb: 'FFE2E8F0' } },
                left: { style: 'hair', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
                right: { style: 'hair', color: { argb: 'FFE2E8F0' } },
              }
            }
          }
          cursor++
        })

        // Column widths from content
        for (let cIdx = 1; cIdx <= width; cIdx++) {
          let maxLen = 10
          for (let r = tableStartRow; r < Math.min(cursor, tableStartRow + 40); r++) {
            const v = ws.getRow(r).getCell(cIdx).value
            const s = v === null || v === undefined ? '' : typeof v === 'object' ? String((v as { formula?: string }).formula ?? '') : String(v)
            maxLen = Math.max(maxLen, s.length)
          }
          ws.getColumn(cIdx).width = Math.min(42, Math.max(12, maxLen + 3))
        }

        // Total row: REAL =SUM formulas over each numeric column (never a
        // hardcoded total). A hardcoded total supplied by the AI is REPLACED
        // by the live formula — the sum of the actual data is definitionally
        // correct, and the formula recalculates if a user edits a value.
        // Guards: the range NEVER includes the total row itself (that would
        // be a circular reference), and cells that already carry a formula
        // (the AI's remapped =SUM) are left untouched.
        const lastRow = ws.getRow(cursor - 1)
        const firstCell = lastRow.getCell(1).value
        if (typeof firstCell === 'string' && /^(total|sum|grand total|subtotal)\b/i.test(firstCell.trim())) {
          const dataEnd = cursor - 2 // row before the total row
          for (let cIdx = 2; cIdx <= width; cIdx++) {
            const existing = lastRow.getCell(cIdx).value
            if (existing && typeof existing === 'object' && (existing as { formula?: string }).formula) continue
            // is this column numeric across the data rows?
            let numeric = 0
            const dataRowCount = Math.max(0, dataEnd - tableStartRow)
            for (let r = tableStartRow + 1; r <= dataEnd; r++) {
              const v = ws.getRow(r).getCell(cIdx).value
              const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(String(v).replace(/[^0-9.-]/g, '')) : null
              if (n !== null && Number.isFinite(n)) numeric++
            }
            if (numeric > 0 && dataRowCount > 0 && numeric >= dataRowCount / 2) {
              const colLetter = columnLetter(cIdx)
              const range = `${colLetter}${tableStartRow + 1}:${colLetter}${dataEnd}`
              lastRow.getCell(cIdx).value = { formula: `SUM(${range})` }
            }
          }
          lastRow.font = { bold: true }
          for (let cIdx = 1; cIdx <= width; cIdx++) {
            const c = lastRow.getCell(cIdx)
            c.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: `FF${hex6(colors.accent, '3B82F6')}` },
            }
            c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
          }
        }

        // Freeze panes below header + autofilter (spec §15)
        if (hasHeader && cursor - tableStartRow > 2) {
          ws.views = [{ state: 'frozen', ySplit: tableStartRow }]
          ws.autoFilter = {
            from: { row: tableStartRow, column: 1 },
            to: { row: cursor - 1, column: width },
          }
        }

        // CHART DATA BLOCKS + native chart requests
        for (const chartComp of plan.charts.slice(0, 3)) {
          const spec2 = chartComp.content
          const kind = String(spec2.chartType || 'bar').toLowerCase()
          const type: SheetChart['type'] = kind === 'pie' ? 'pie' : kind === 'donut' || kind === 'doughnut' ? 'doughnut' : kind === 'line' ? 'line' : 'bar'
          const cats = Array.isArray(spec2.categories) ? spec2.categories.map((x) => String(x)) : []
          const series = Array.isArray(spec2.series)
            ? (spec2.series as Array<Record<string, unknown>>)
                .map((s) => ({
                  name: typeof s.name === 'string' ? s.name : 'Series',
                  data: Array.isArray(s.data) ? s.data.map((d) => (typeof d === 'number' ? d : Number(String(d).replace(/[^0-9.-]/g, '')))).filter((d) => Number.isFinite(d)) : [],
                }))
                .filter((s) => s.data.length > 0)
            : []
          if (series.length === 0 || cats.length === 0) continue
          const rowCount = Math.min(cats.length, 60)

          cursor += 1
          const blockHeaderRow = cursor
          const labelCell = ws.getCell(cursor, 1)
          labelCell.value = `Chart data — ${typeof spec2.title === 'string' ? spec2.title : 'Chart'}`
          labelCell.font = { size: 9, italic: true, color: { argb: `FF${hex6(colors.mutedForeground, '64748B')}` } }
          cursor++
          const headerRowNo = cursor
          ws.getCell(cursor, 1).value = 'Category'
          ws.getCell(cursor, 1).font = { bold: true, size: 9 }
          series.slice(0, 5).forEach((s, i) => {
            const c = ws.getCell(cursor, i + 2)
            c.value = s.name
            c.font = { bold: true, size: 9 }
          })
          cursor++
          const firstDataRow = cursor
          for (let r = 0; r < rowCount; r++) {
            ws.getCell(cursor, 1).value = cats[r] ?? `Item ${r + 1}`
            series.slice(0, 5).forEach((s, i) => {
              const cell = ws.getCell(cursor, i + 2)
              cell.value = s.data[r] ?? null
              cell.numFmt = Number.isInteger(s.data[r] ?? 0) ? '#,##0' : '#,##0.00'
            })
            cursor++
          }
          const lastDataRow = cursor - 1

          chartRequests.push({
            sheetName,
            type,
            title: typeof spec2.title === 'string' && spec2.title ? spec2.title : `${section.title} chart`,
            firstDataRow,
            lastDataRow,
            seriesCount: Math.min(series.length, 5),
            anchorRow: cursor + 1, // one blank row below the data block
            anchorCol: 0,
          })
          cursor += 16 // vertical space the anchored chart occupies
        }

        // Diagram images embedded below the table
        for (const diagramContent of plan.diagrams.slice(0, 2)) {
          const fake: CanonicalComponent = {
            sectionId: section.id,
            componentId: `diag-${section.id}-${cursor}`,
            type: section.title.toLowerCase().includes('timeline') ? 'timeline' : 'diagram',
            content: diagramContent,
            order: cursor,
          }
          const image = await renderComponentImage(fake, theme, { width: 620 })
          if (image) {
            const imgId = wb.addImage({ buffer: image.png as unknown as Parameters<typeof wb.addImage>[0]['buffer'], extension: 'png' })
            const scale = Math.min(1, 720 / image.width)
            const pxW = Math.round(image.width * scale)
            const pxH = Math.round(image.height * scale)
            ws.addImage(imgId, {
              tl: { col: 0, row: cursor - 1 },
              ext: { width: pxW, height: pxH },
            })
            cursor += Math.ceil(pxH / 20) + 2
          }
        }

        // Print setup: A4, fit to width, landscape for wide tables, and the
        // header row repeated on every printed page. (printTitlesRow is set
        // HERE — a later pageSetup re-assignment would wipe it.)
        const isWide = width >= 6
        ws.pageSetup = {
          paperSize: 9, // A4
          orientation: isWide ? 'landscape' : 'portrait',
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          horizontalCentered: false,
          margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
        }
        if (hasHeader && cursor - tableStartRow > 2) {
          ws.pageSetup.printTitlesRow = `${tableStartRow}:${tableStartRow}`
        }
      } else {
        // no table — still set a sane print setup
        ws.pageSetup = {
          paperSize: 9,
          orientation: 'portrait',
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
        }
      }
    }

    // Overview print setup
    overview.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }

    const buffer = await wb.xlsx.writeBuffer()
    let buf = Buffer.from(buffer as ArrayBuffer)

    // NATIVE CHART INJECTION — real OOXML chart parts with live cell refs.
    if (chartRequests.length > 0) {
      try {
        buf = (await injectNativeCharts(buf, chartRequests, wb)) as typeof buf
        qa.charts = { count: chartRequests.length, types: chartRequests.map((c) => c.type) }
      } catch (chartErr) {
        // Never lose the workbook over a chart: log + continue with the
        // chart-data blocks still present (they carry the same numbers).
        console.error('[XLSX-RENDER] native chart injection failed — workbook kept without charts:', chartErr instanceof Error ? chartErr.message : chartErr)
        rendererIssues.push(`native chart injection failed: ${chartErr instanceof Error ? chartErr.message.slice(0, 120) : 'error'}`)
      }
    }

    if (rendererIssues.length > 0) {
      qa.formulaFallbacks = rendererIssues.slice(0, 20)
    }

    return {
      buffer: buf,
      filename: `${slugify(spec.title)}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: buf.length,
      qa,
    }
  }
}

// ==================== NATIVE CHART INJECTION (OOXML) ====================

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function columnLetter(idx: number): string {
  let s = ''
  let n = idx
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function escXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

/**
 * Build a c:chartSpace document. Element order follows ECMA-376 strictly —
 * Excel refuses (or "repairs") charts whose parts are out of sequence.
 */
function buildChartXml(chart: SheetChart, sheetName: string, idx: number): string {
  const catRef = `'${sheetName.replace(/'/g, "''")}'!$A$${chart.firstDataRow}:$A$${chart.lastDataRow}`
  const sers: string[] = []
  const isPie = chart.type === 'pie' || chart.type === 'doughnut'

  const count = isPie ? 1 : chart.seriesCount
  for (let s = 0; s < count; s++) {
    const colLetter = columnLetter(s + 2)
    const valRef = `'${sheetName.replace(/'/g, "''")}'!$${colLetter}$${chart.firstDataRow}:$${colLetter}$${chart.lastDataRow}`
    const nameRef = `'${sheetName.replace(/'/g, "''")}'!$${columnLetter(s + 2)}$${chart.firstDataRow - 1}`
    sers.push(
      `<c:ser>` +
        `<c:idx val="${s}"/>` +
        `<c:order val="${s}"/>` +
        `<c:tx><c:strRef><c:f>${escXml(nameRef)}</c:f></c:strRef></c:tx>` +
        `<c:spPr><a:solidFill><a:srgbClr val="${SERIES_COLORS[s % SERIES_COLORS.length]}"/></a:solidFill>${chart.type === 'line' ? '<a:ln w="28575"><a:solidFill><a:srgbClr val="' + SERIES_COLORS[s % SERIES_COLORS.length] + '"/></a:solidFill></a:ln>' : ''}</c:spPr>` +
        (chart.type === 'line' ? `<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>` : '') +
        `<c:cat><c:strRef><c:f>${escXml(catRef)}</c:f></c:strRef></c:cat>` +
        `<c:val><c:numRef><c:f>${escXml(valRef)}</c:f></c:numRef></c:val>` +
        `</c:ser>`
    )
  }

  let plot = ''
  if (chart.type === 'bar') {
    plot = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${sers.join('')}<c:gapWidth val="120"/><c:axId val="101"/><c:axId val="102"/></c:barChart>`
  } else if (chart.type === 'line') {
    plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers.join('')}<c:marker val="1"/><c:axId val="101"/><c:axId val="102"/></c:lineChart>`
  } else if (chart.type === 'pie') {
    plot = `<c:pieChart><c:varyColors val="1"/>${sers.join('')}<c:firstSliceAng val="0"/></c:pieChart>`
  } else {
    plot = `<c:doughnutChart><c:varyColors val="1"/>${sers.join('')}<c:firstSliceAng val="0"/><c:holeSize val="50"/></c:doughnutChart>`
  }

  const axes =
    chart.type === 'bar' || chart.type === 'line'
      ? `<c:catAx>` +
        `<c:axId val="101"/>` +
        `<c:scaling><c:orientation val="minMax"/></c:scaling>` +
        `<c:delete val="0"/>` +
        `<c:axPos val="b"/>` +
        `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></a:txPr>` +
        `<c:crossAx val="102"/>` +
        `</c:catAx>` +
        `<c:valAx>` +
        `<c:axId val="102"/>` +
        `<c:scaling><c:orientation val="minMax"/></c:scaling>` +
        `<c:delete val="0"/>` +
        `<c:axPos val="l"/>` +
        `<c:majorGridlines/>` +
        `<c:numFmt formatCode="General" sourceLinked="1"/>` +
        `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></a:txPr>` +
        `<c:crossAx val="101"/>` +
        `</c:valAx>`
      : ''

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_R}">
<c:roundedCorners val="0"/>
<c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>${escXml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>
<c:legend><c:legendPos val="${isPie ? 'r' : 'b'}"/><c:overlay val="0"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></a:txPr></c:legend>
<c:plotVisOnly val="1"/>
<c:dispBlanksAs val="gap"/>
</c:chart>
<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr>
<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></a:txPr>
</c:chartSpace>`
}

const SERIES_COLORS = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47']

function buildDrawingXml(chart: SheetChart, anchorFromRow: number, anchorToRow: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor editAs="oneCell">
<xdr:from><xdr:col>${chart.anchorCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchorFromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${chart.anchorCol + 9}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchorToRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro="">
<xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${NS_R}" r:id="rId1"/></a:graphicData></a:graphic>
</xdr:graphicFrame>
<xdr:clientData/>
</xdr:twoCellAnchor>
</xdr:wsDr>`
}

/**
 * Inject native chart parts into a written workbook buffer:
 *   xl/charts/chartN.xml (+ chartN colors/style skipped — optional parts)
 *   xl/drawings/drawingN.xml + rels
 *   xl/worksheets/_rels/sheetN.xml.rels (merged when present)
 *   sheetN.xml gets a <drawing r:id> element
 *   [Content_Types].xml gets chart + drawing overrides
 */
async function injectNativeCharts(
  buf: Buffer,
  requests: SheetChart[],
  wb: { worksheets: Array<{ name: string }> }
): Promise<Buffer> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)

  const sheetNameToFile: Record<string, { path: string; index: number }> = {}
  wb.worksheets.forEach((ws, i) => {
    sheetNameToFile[ws.name] = { path: `xl/worksheets/sheet${i + 1}.xml`, index: i + 1 }
  })

  const contentTypesPath = '[Content_Types].xml'
  let contentTypes = await zip.file(contentTypesPath)?.async('string') ?? null
  if (!contentTypes) throw new Error('[Content_Types].xml missing')

  let chartIdx = 0
  for (const chart of requests) {
    const target = sheetNameToFile[chart.sheetName]
    if (!target) continue
    chartIdx++
    const chartPath = `xl/charts/chart${chartIdx}.xml`
    const drawingPath = `xl/drawings/drawing${chartIdx}.xml`
    const drawingRelsPath = `xl/drawings/_rels/drawing${chartIdx}.xml.rels`
    const sheetRelsPath = `xl/worksheets/_rels/sheet${target.index}.xml.rels`

    zip.file(chartPath, buildChartXml(chart, chart.sheetName, chartIdx))
    zip.file(
      drawingPath,
      buildDrawingXml(chart, chart.anchorRow, chart.anchorRow + 15)
    )
    zip.file(
      drawingRelsPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/chart" Target="../charts/chart${chartIdx}.xml"/></Relationships>`
    )

    // sheet rels: merge with existing or create
    const existingRels = await zip.file(sheetRelsPath)?.async('string') ?? null
    const drawingRelId = existingRels ? `rIdDrawing${chartIdx}` : 'rId1'
    if (existingRels) {
      const merged = existingRels.replace(
        '</Relationships>',
        `<Relationship Id="${drawingRelId}" Type="${NS_R}/drawing" Target="../drawings/drawing${chartIdx}.xml"/></Relationships>`
      )
      zip.file(sheetRelsPath, merged)
    } else {
      zip.file(
        sheetRelsPath,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${drawingRelId}" Type="${NS_R}/drawing" Target="../drawings/drawing${chartIdx}.xml"/></Relationships>`
      )
    }

    // sheet XML: add <drawing r:id> just before </worksheet>
    const sheetXml = await zip.file(target.path)?.async('string')
    if (!sheetXml) throw new Error(`worksheet part missing: ${target.path}`)
    if (sheetXml.includes('<drawing ')) continue // already has a drawing — skip (shouldn't happen)
    const xmlnsR = /xmlns:r=/.test(sheetXml)
      ? sheetXml
      : sheetXml.replace(
          /<worksheet /,
          `<worksheet xmlns:r="${NS_R}" `
        )
    const patched = xmlnsR.replace('</worksheet>', `<drawing r:id="${drawingRelId}"/></worksheet>`)
    zip.file(target.path, patched)

    // content types
    contentTypes = contentTypes!.replace(
      '</Types>',
      `<Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`
    )
  }

  if (chartIdx > 0) {
    zip.file(contentTypesPath, contentTypes!)
  }

  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function slugify(title: string): string {
  return (
    String(title || 'Generated_Document')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/['’]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'Generated_Document'
  )
}
