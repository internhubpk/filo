// =============================================================================
// XLSX RENDERER (spec §15) — REAL analyst workbooks via ExcelJS + native charts
// =============================================================================
// v2 — ANALYST-GRADE upgrade:
//   • DASHBOARD sheet (first tab): themed KPI band + WORKBOOK CONTENTS +
//     DATA SUMMARY table built from LIVE cross-sheet formulas
//     (=SUM/SUMIF/AVERAGE/COUNTA over the real data ranges — never hardcoded)
//   • one styled worksheet per section; MULTIPLE tables per section each get
//     their own styled block (previously they were concatenated into one blob)
//   • REAL formulas — "=SUM(...)" cells are written as Excel formulas with
//     row references remapped to the table's actual placement; every formula
//     is VALIDATED (bounds + non-empty targets + function whitelist) so the
//     workbook cannot ship with #REF!/#VALUE!/#NAME? baked in
//   • totals rows get REAL =SUM() formulas over each numeric column
//   • NATIVE Excel charts (bar/line/pie/doughnut) injected at the OOXML level
//     with THEME palette colors and live cell references — one dashboard
//     chart is anchored on the Dashboard while referencing the data sheet
//   • number formats: currency ($/€/£/¥/PKR/Rs), percentages, ISO dates,
//     thousands separators; autofilter + freeze panes; print setup A4
//     fit-to-width with repeated header rows
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
  /** Sheet whose cells feed the chart series (cross-sheet refs allowed). */
  sheetName: string
  /** Sheet the chart is anchored on (defaults to sheetName). */
  anchorSheetName?: string
  type: 'bar' | 'line' | 'pie' | 'doughnut'
  title: string
  /** 1-based data-block coordinates (categories col A, series from col B). */
  firstDataRow: number
  lastDataRow: number
  seriesCount: number
  anchorRow: number
  anchorCol: number
}

interface TableBlock {
  title?: string
  rows: Array<Array<string | number | null>>
}

interface WrittenTableInfo {
  sheetName: string
  title: string
  firstDataRow: number
  lastDataRow: number
  width: number
  numericCols: number[] // 1-based column indexes that are majority-numeric
}

interface SheetPlan {
  name: string
  title: string
  tables: TableBlock[]
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWorkbook = any

export class XlsxRenderer implements DocumentRenderer {
  format = 'XLSX' as const

  async render(document: RenderableDocument): Promise<RendererOutput> {
    const ExcelJS = (await import('exceljs')).default
    const spec = document.specification
    const theme = deriveTheme(spec)
    const colors = theme.colors
    const qa: Record<string, unknown> = {}
    const rendererIssues: string[] = []

    const wb: AnyWorkbook = new ExcelJS.Workbook()
    wb.creator = 'Filo'
    wb.created = new Date()
    wb.title = spec.title

    const usedNames = new Set<string>(['overview', 'dashboard'])
    const chartRequests: SheetChart[] = []
    const dataSheets: WrittenTableInfo[] = []

    // ---------------- Dashboard sheet (filled at the end, placed first) ----
    const dashboard = wb.addWorksheet('Dashboard', {
      properties: { tabColor: { argb: `FF${hex6(colors.primary, '1E3A5F')}` } },
      views: [{ showGridLines: false }],
    })
    dashboard.columns = Array.from({ length: 8 }, () => ({ width: 18 }))

    // ---------------- Overview / cover sheet ----------------
    const overview = wb.addWorksheet('Overview', {
      properties: { tabColor: { argb: `FF${hex6(colors.accent, '3B82F6')}` } },
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
        tables: [],
        paragraphs: [],
        lists: [],
        charts: [],
        diagrams: [],
      }

      for (const c of components) {
        if (c.type === 'table') {
          const rows = asTable(c.content)
          if (rows.length > 0) plan.tables.push({ rows: rows.slice(0, MAX_ROWS) })
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
          plan.tables.push({
            title: `${String(o.leftTitle ?? 'Option A')} vs ${String(o.rightTitle ?? 'Option B')}`,
            rows: [
              ['Aspect', String(o.leftTitle ?? 'A'), String(o.rightTitle ?? 'B')],
              ...(Array.isArray(o.leftPoints) ? (o.leftPoints as unknown[]) : []).map((l, i) => [
                `Point ${i + 1}`,
                String((l as string) ?? ''),
                String((Array.isArray(o.rightPoints) ? (o.rightPoints as unknown[])[i] : '') ?? ''),
              ]),
            ] as Array<Array<string | number | null>>,
          })
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

      // Table blocks — EACH table component gets its own styled block
      let sheetHeaderRow: number | undefined
      for (const block of plan.tables) {
        const info = this.writeTableBlock(wb, ws, sheetName, block, cursor, {
          colors,
          theme,
          rendererIssues,
          isPrimary: dataSheets.length === 0,
          sectionTitle: section.title,
        })
        if (!info) continue
        cursor = info.cursor
        if (!sheetHeaderRow && info.primaryHeaderRow) sheetHeaderRow = info.primaryHeaderRow
        if (info.dataInfo) dataSheets.push(info.dataInfo)
        for (const req of info.chartRequests) chartRequests.push(req)
      }

      // Chart data blocks + native chart requests (per AI chart component)
      for (const chartComp of plan.charts.slice(0, 3)) {
        const reqs = this.writeChartBlock(ws, sheetName, chartComp.content, cursor, { colors, sectionTitle: section.title })
        if (!reqs) continue
        cursor = reqs.cursor
        chartRequests.push(...reqs.requests)
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
          const imgId = wb.addImage({ buffer: image.png as never, extension: 'png' })
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

      ws.pageSetup = {
        paperSize: 9, // A4
        orientation: cursor >= 40 ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: false,
        margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
      }
      // AFTER pageSetup (it would be wiped otherwise): repeat the table's
      // header row on every printed page.
      if (sheetHeaderRow) {
        ws.pageSetup.printTitlesRow = `${sheetHeaderRow}:${sheetHeaderRow}`
      }
    }

    // ---------------- DASHBOARD (live formulas over real ranges) ----------
    this.buildDashboard(dashboard, wb, spec.title, spec.description, dataSheets, colors, chartRequests)

    // Overview print setup
    overview.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    dashboard.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }

    const buffer = await wb.xlsx.writeBuffer()
    let buf = Buffer.from(buffer as ArrayBuffer)

    // NATIVE CHART INJECTION — real OOXML chart parts with live cell refs.
    // Series colors come from the THEME palette (not hardcoded Office blue).
    if (chartRequests.length > 0) {
      try {
        THEME_CHART_COLORS = theme.chartPalette
          .map((c) => c.replace('#', '').toUpperCase())
          .filter((c) => /^[0-9A-F]{6}$/i.test(c))
        if (THEME_CHART_COLORS.length < 2) THEME_CHART_COLORS = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47']
        buf = (await injectNativeCharts(buf, chartRequests, wb)) as typeof buf
        qa.charts = { count: chartRequests.length, types: chartRequests.map((c) => c.type) }
      } catch (chartErr) {
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

  // ==================== TABLE BLOCK WRITER ====================

  private writeTableBlock(
    wb: AnyWorkbook,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws: any,
    sheetName: string,
    block: TableBlock,
    startCursor: number,
    opts: {
      colors: ReturnType<typeof deriveTheme>['colors']
      theme: ReturnType<typeof deriveTheme>
      rendererIssues: string[]
      isPrimary: boolean
      sectionTitle: string
    }
  ): { cursor: number; dataInfo: WrittenTableInfo | null; chartRequests: SheetChart[]; primaryHeaderRow?: number } {
    const { colors, rendererIssues } = opts
    const plan = block
    let cursor = startCursor
    let primaryHeaderRow: number | undefined

    // Optional block title (2nd+ tables in a section)
    if (block.title) {
      const t = ws.getCell(cursor, 1)
      t.value = block.title
      t.font = { bold: true, size: 12, color: { argb: `FF${hex6(colors.primary, '1E3A5F')}` } }
      cursor += 2
    }
    const tableStartRow = cursor
    const rows = plan.rows
    const width = Math.min(MAX_COLS, Math.max(...rows.map((r) => r.length)))
    let hasHeader = false
    const matrix = rows as CellMatrix

    // Column type inference across data rows (row 1 = header).
    const colFormats: Array<Map<string, number>> = Array.from({ length: width }, () => new Map())
    for (let r = 1; r < Math.min(rows.length, 200); r++) {
      for (let cIdx = 0; cIdx < width; cIdx++) {
        const raw = rows[r][cIdx]
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
        if (n > bestN) {
          best = fmt
          bestN = n
        }
      }
      return bestN >= 2 ? best : null
    })

    rows.forEach((row, rIdx) => {
      const excelRow = ws.getRow(cursor)
      for (let cIdx = 0; cIdx < width; cIdx++) {
        const raw = row[cIdx] ?? ''
        const cell = excelRow.getCell(cIdx + 1)

        if (typeof raw === 'string' && /^=/.test(raw.trim())) {
          const trimmed = raw.trim()
          const check = validateFormulaReferences(trimmed, matrix, rows.length)
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

    // ---- TOTALS row with REAL =SUM formulas over numeric columns ----
    const numericCols: number[] = []
    const lastRow = ws.getRow(cursor - 1)
    const firstCell = lastRow.getCell(1).value
    let dataEnd = cursor - 1
    if (typeof firstCell === 'string' && /^(total|sum|grand total|subtotal)\b/i.test(firstCell.trim())) {
      dataEnd = cursor - 2 // row before the total row
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

    // ---- numeric column census (for the Dashboard's live formulas) ----
    const dataRowCount = Math.max(0, dataEnd - tableStartRow)
    for (let cIdx = 2; cIdx <= width; cIdx++) {
      let numeric = 0
      for (let r = tableStartRow + 1; r <= dataEnd; r++) {
        const v = ws.getRow(r).getCell(cIdx).value
        const n = typeof v === 'number' ? v : typeof v === 'object' && v !== null && (v as { formula?: string }).formula ? 1 : typeof v === 'string' ? Number(String(v).replace(/[^0-9.-]/g, '')) : null
        if (n !== null && Number.isFinite(n)) numeric++
      }
      if (dataRowCount > 0 && numeric >= dataRowCount / 2) numericCols.push(cIdx)
    }

    // Freeze panes below header + autofilter (spec §15) — primary table only
    if (hasHeader && cursor - tableStartRow > 2 && opts.isPrimary) {
      ws.views = [{ state: 'frozen', ySplit: tableStartRow }]
      ws.autoFilter = {
        from: { row: tableStartRow, column: 1 },
        to: { row: cursor - 1, column: width },
      }
    }

    // print titles: repeat the header row on every printed page — recorded
    // here and applied AFTER the sheet-level pageSetup assignment (a later
    // pageSetup re-assignment would wipe it).
    if (hasHeader && cursor - tableStartRow > 2) {
      primaryHeaderRow = tableStartRow
    }

    const dataInfo: WrittenTableInfo | null =
      hasHeader && dataRowCount > 0
        ? {
            sheetName,
            title: block.title || opts.sectionTitle,
            firstDataRow: tableStartRow + 1,
            lastDataRow: dataEnd,
            width,
            numericCols,
          }
        : null

    return { cursor: cursor + 1, dataInfo, chartRequests: [], primaryHeaderRow }
  }

  // ==================== CHART DATA BLOCK WRITER ====================

  private writeChartBlock(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws: any,
    sheetName: string,
    spec2: Record<string, unknown>,
    startCursor: number,
    opts: { colors: ReturnType<typeof deriveTheme>['colors']; sectionTitle: string }
  ): { cursor: number; requests: SheetChart[] } | null {
    const { colors } = opts
    let cursor = startCursor
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
    if (series.length === 0 || cats.length === 0) return null
    const rowCount = Math.min(cats.length, 60)

    cursor += 1
    const labelCell = ws.getCell(cursor, 1)
    labelCell.value = `Chart data — ${typeof spec2.title === 'string' ? spec2.title : 'Chart'}`
    labelCell.font = { size: 9, italic: true, color: { argb: `FF${hex6(colors.mutedForeground, '64748B')}` } }
    cursor++
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

    const request: SheetChart = {
      sheetName,
      type,
      title: typeof spec2.title === 'string' && spec2.title ? spec2.title : `${opts.sectionTitle} chart`,
      firstDataRow,
      lastDataRow,
      seriesCount: Math.min(series.length, 5),
      anchorRow: cursor + 1,
      anchorCol: 0,
    }
    return { cursor: cursor + 16, requests: [request] }
  }

  // ==================== DASHBOARD (live formulas) ====================

  private buildDashboard(
    dashboard: AnyWorkbook,
    wb: AnyWorkbook,
    title: string,
    description: string | undefined,
    dataSheets: WrittenTableInfo[],
    colors: ReturnType<typeof deriveTheme>['colors'],
    chartRequests: SheetChart[]
  ): void {
    const accentArgb = `FF${hex6(colors.accent, '3B82F6')}`
    const mutedArgb = `FF${hex6(colors.mutedForeground, '64748B')}`
    const primaryArgb = `FF${hex6(colors.primary, '1E3A5F')}`

    // Title banner
    dashboard.mergeCells(1, 1, 1, 8)
    const banner = dashboard.getCell(1, 1)
    banner.value = `${title} — Dashboard`
    banner.font = { bold: true, size: 20, color: { argb: 'FFFFFFFF' } }
    banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } }
    banner.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    dashboard.getRow(1).height = 38

    let row = 3
    if (description) {
      const d = dashboard.getCell(row++, 1)
      d.value = description
      d.font = { size: 11, italic: true, color: { argb: mutedArgb } }
      dashboard.mergeCells(row - 1, 1, row - 1, 8)
      row++
    }

    // ---- KPI band (live formulas over the first data sheet) ----
    const firstData = dataSheets[0]
    if (firstData && firstData.numericCols.length > 0) {
      const label = dashboard.getCell(row++, 1)
      label.value = 'LIVE TOTALS (auto-recalculating)'
      label.font = { bold: true, size: 11, color: { argb: accentArgb } }

      const sheetRef = (col: number, abs = true) =>
        `'${firstData.sheetName.replace(/'/g, "''")}'!${abs ? '$' : ''}${columnLetter(col)}${abs ? '$' : ''}${firstData.firstDataRow}:${abs ? '$' : ''}${columnLetter(col)}${abs ? '$' : ''}${firstData.lastDataRow}`

      const cap = Math.min(4, firstData.numericCols.length)
      const headerRow = dashboard.getRow(row++)
      const valueRow = dashboard.getRow(row++)
      const noteRow = dashboard.getRow(row++)
      for (let i = 0; i < cap; i++) {
        const col = firstData.numericCols[i]
        // Column header text pulled live from the data sheet's header cell.
        const hCell = headerRow.getCell(i + 1)
        hCell.value = {
          formula: `IFERROR('${firstData.sheetName.replace(/'/g, "''")}'!${columnLetter(col)}${firstData.firstDataRow - 1},"Column ${col}")`,
        }
        hCell.font = { size: 10, color: { argb: mutedArgb } }

        const vCell = valueRow.getCell(i + 1)
        vCell.value = { formula: `SUM(${sheetRef(col)})` }
        vCell.font = { bold: true, size: 16, color: { argb: accentArgb } }
        vCell.numFmt = '#,##0.00'

        const nCell = noteRow.getCell(i + 1)
        nCell.value = { formula: `COUNT(${sheetRef(col)})&" entries"` }
        nCell.font = { size: 9, italic: true, color: { argb: mutedArgb } }
      }
      row++
    }

    // ---- DATA SUMMARY table: one live row per data table ----
    if (dataSheets.length > 0) {
      const label = dashboard.getCell(row++, 1)
      label.value = 'DATA SUMMARY'
      label.font = { bold: true, size: 11, color: { argb: accentArgb } }

      const head = dashboard.getRow(row++)
      const heads = ['Worksheet', 'Table', 'Rows', 'Total (col B)', 'Average (col B)', 'Max (col B)']
      heads.forEach((h, i) => {
        const c = head.getCell(i + 1)
        c.value = h
        c.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } }
      })

      for (const d of dataSheets.slice(0, 12)) {
        const r = dashboard.getRow(row++)
        const q = (s: string) => `'${s.replace(/'/g, "''")}'`
        const rangeColB = `${q(d.sheetName)}!$B$${d.firstDataRow}:$B$${d.lastDataRow}`
        r.getCell(1).value = d.sheetName
        r.getCell(1).font = { size: 10 }
        r.getCell(2).value = d.title.slice(0, 40)
        r.getCell(2).font = { size: 10 }
        r.getCell(3).value = { formula: `COUNTA(${q(d.sheetName)}!$A$${d.firstDataRow}:$A$${d.lastDataRow})` }
        r.getCell(3).font = { size: 10 }
        r.getCell(4).value = { formula: `IFERROR(SUM(${rangeColB}),"—")` }
        r.getCell(4).numFmt = '#,##0.00'
        r.getCell(4).font = { size: 10 }
        r.getCell(5).value = { formula: `IFERROR(AVERAGE(${rangeColB}),"—")` }
        r.getCell(5).numFmt = '#,##0.00'
        r.getCell(5).font = { size: 10 }
        r.getCell(6).value = { formula: `IFERROR(MAX(${rangeColB}),"—")` }
        r.getCell(6).numFmt = '#,##0.00'
        r.getCell(6).font = { size: 10 }
      }
      row++

      // One dashboard-native chart summarizing the FIRST data sheet's
      // categories + first two numeric series (live refs into the data sheet).
      if (firstData) {
        chartRequests.push({
          sheetName: firstData.sheetName, // refs point at the data sheet
          anchorSheetName: dashboard.name, // drawing lives on the Dashboard
          type: 'bar',
          title: `${firstData.title} — totals`,
          firstDataRow: firstData.firstDataRow,
          lastDataRow: firstData.lastDataRow,
          seriesCount: Math.min(2, Math.max(1, firstData.numericCols.length)),
          anchorRow: row + 1,
          anchorCol: 0,
        })
      }
    }

    // Worksheet contents
    const contents = dashboard.getCell(row + 1, 1)
    contents.value = 'WORKSHEET CONTENTS'
    contents.font = { bold: true, size: 11, color: { argb: accentArgb } }
    let cRow = row + 2
    wb.worksheets.forEach((ws: { name: string }) => {
      if (ws.name === 'Dashboard') return
      const r = dashboard.getRow(cRow++)
      r.getCell(1).value = `  ${ws.name}`
      r.getCell(1).font = { size: 10, color: { argb: mutedArgb } }
    })
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
function buildChartXml(chart: SheetChart, idx: number): string {
  const dataSheet = chart.sheetName.replace(/'/g, "''")
  const catRef = `'${dataSheet}'!$A$${chart.firstDataRow}:$A$${chart.lastDataRow}`
  const sers: string[] = []
  const isPie = chart.type === 'pie' || chart.type === 'doughnut'

  const count = isPie ? 1 : chart.seriesCount
  for (let s = 0; s < count; s++) {
    const colLetterS = columnLetter(s + 2)
    const valRef = `'${dataSheet}'!$${colLetterS}$${chart.firstDataRow}:$${colLetterS}$${chart.lastDataRow}`
    const nameRef = `'${dataSheet}'!$${columnLetter(s + 2)}$${chart.firstDataRow - 1}`
    const color = THEME_CHART_COLORS[s % THEME_CHART_COLORS.length]
    sers.push(
      `<c:ser>` +
        `<c:idx val="${s}"/>` +
        `<c:order val="${s}"/>` +
        `<c:tx><c:strRef><c:f>${escXml(nameRef)}</c:f></c:strRef></c:tx>` +
        `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${chart.type === 'line' ? '<a:ln w="28575"><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill></a:ln>' : ''}</c:spPr>` +
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

/** Theme-neutral fallback is REPLACED at render time via resolveChartColors. */
let THEME_CHART_COLORS: string[] = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47']

function buildDrawingXml(chart: SheetChart, anchorFromRow: number, anchorToRow: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor editAs="oneCell">
<xdr:from><xdr:col>${chart.anchorCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchorFromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${chart.anchorCol + 9}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchorToRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro="">
<xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart ${chart.anchorSheetName ? 'Dashboard' : '1'}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
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
    const anchorSheet = chart.anchorSheetName ?? chart.sheetName
    const target = sheetNameToFile[anchorSheet]
    if (!target) continue
    chartIdx++
    const chartPath = `xl/charts/chart${chartIdx}.xml`
    const drawingPath = `xl/drawings/drawing${chartIdx}.xml`
    const drawingRelsPath = `xl/drawings/_rels/drawing${chartIdx}.xml.rels`
    const sheetRelsPath = `xl/worksheets/_rels/sheet${target.index}.xml.rels`

    zip.file(chartPath, buildChartXml(chart, chartIdx))
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
