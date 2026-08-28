// =============================================================================
// XLSX RENDERER (spec §15) — professional workbooks via ExcelJS
// =============================================================================
// Replaces the previous SheetJS plain-dump renderer. Produces real analyst
// workbooks:
//   • Overview/summary sheet with document title, description and sheet index
//   • one styled worksheet per section (themed header row, zebra striping,
//     borders, column widths, autofilter, freeze panes)
//   • REAL formulas — cells containing "=SUM(...)"-style strings from the AI
//     are written as Excel formulas, never hardcoded values
//   • number detection, bold totals heuristics
// =============================================================================

import type { RendererOutput, DocumentRenderer, RenderableDocument, CanonicalComponent } from './shared'
import { asMetrics, asString, asStringArray, asTable, deriveTheme, hex6 } from './shared'

const MAX_ROWS = 500
const MAX_COLS = 40

/**
 * Remap A1-style row references in an AI-provided formula to the table's
 * ACTUAL placement on the worksheet. The AI writes formulas assuming its
 * table starts at row 1 (headers) — the renderer may place the table lower
 * (title banner + paragraphs first), so every row reference shifts by the
 * offset. Function names (LOG10, ATAN2…) are excluded via the negative
 * lookahead on '('.
 */
export function remapFormulaRows(formula: string, rowOffset: number): string {
  if (!rowOffset) return formula
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d{1,7})(?!\()/g, (_m, dollar1, col, dollar2, row) => {
    return `${dollar1}${col}${dollar2}${Number(row) + rowOffset}`
  })
}

interface SheetPlan {
  name: string
  title: string
  rows: Array<Array<string | number | null>>
  formulas?: string[]
  metrics?: Array<{ label: string; value: string; change?: string }>
  paragraphs: string[]
  lists: string[][]
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

export class XlsxRenderer implements DocumentRenderer {
  format = 'XLSX' as const

  async render(document: RenderableDocument): Promise<RendererOutput> {
    const ExcelJS = (await import('exceljs')).default
    const spec = document.specification
    const theme = deriveTheme(spec)
    const colors = theme.colors

    const wb = new ExcelJS.Workbook()
    wb.creator = 'Filo'
    wb.created = new Date()
    wb.title = spec.title

    const usedNames = new Set<string>(['overview'])

    // ---------------- Overview sheet ----------------
    const overview = wb.addWorksheet('Overview', {
      properties: { tabColor: { argb: `FF${hex6(colors.primary, '1E3A5F')}` } },
    })
    overview.columns = [
      { header: 'Field', key: 'field', width: 22 },
      { header: 'Value', key: 'value', width: 80 },
    ]
    const overviewRows: Array<{ field: string; value: string }> = [
      { field: 'Title', value: spec.title },
      ...(spec.description ? [{ field: 'Description', value: spec.description }] : []),
      { field: 'Generated', value: new Date().toLocaleString('en-US') },
      { field: 'Sheets', value: String(spec.sections.length + 1) },
    ]
    for (const r of overviewRows) overview.addRow(r)
    overview.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    overview.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex6(colors.primary, '1E3A5F')}` } }
    overview.views = [{ state: 'frozen', ySplit: 1 }]

    // Sheet index
    const idxRow = overview.addRow({ field: 'Contents', value: '' })
    idxRow.font = { bold: true }
    spec.sections.forEach((s, i) => {
      overview.addRow({ field: `  ${i + 1}.`, value: s.title })
    })

    // ---------------- Section sheets ----------------
    spec.sections.forEach((section, sIdx) => {
      const components = (document.sections.find((x) => x.id === section.id)?.components ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)

      const plan: SheetPlan = { name: section.title, title: section.title, rows: [], paragraphs: [], lists: [] }

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
          if (note) plan.paragraphs.push(`[Chart] ${note}`)
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

      // Default content: section title + paragraphs
      const sheetName = sanitizeSheetName(section.title, usedNames)
      const ws = wb.addWorksheet(sheetName, {
        properties: { tabColor: { argb: `FF${hex6(colors.accent, '3B82F6')}` } },
      })

      let cursor = 1
      // Section title banner
      const titleCell = ws.getCell(cursor, 1)
      titleCell.value = section.title
      titleCell.font = { bold: true, size: 14, color: { argb: `FF${hex6(colors.primary, '1E3A5F')}` } }
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
          cell.font = { bold: true, color: { argb: `FF${hex6(colors.mutedForeground, '64748B')}` } }
        })
        const vRow = ws.getRow(cursor + 1)
        values.forEach((v, i) => {
          const cell = vRow.getCell(i + 1)
          cell.value = v
          cell.font = { bold: true, size: 16, color: { argb: `FF${hex6(colors.accent, '3B82F6')}` } }
        })
        const cRow = ws.getRow(cursor + 2)
        changes.forEach((c, i) => {
          cRow.getCell(i + 1).value = c
        })
        cursor += 4
      }

      // Paragraphs
      for (const p of plan.paragraphs.slice(0, 30)) {
        const cell = ws.getCell(cursor, 1)
        cell.value = p
        cell.alignment = { wrapText: true, vertical: 'top' }
        ws.mergeCells(cursor, 1, cursor, Math.max(3, Math.min(10, Math.ceil(p.length / 90))))
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

        plan.rows.forEach((row, rIdx) => {
          const excelRow = ws.getRow(cursor)
          for (let cIdx = 0; cIdx < width; cIdx++) {
            const raw = row[cIdx] ?? ''
            const cell = excelRow.getCell(cIdx + 1)

            if (typeof raw === 'string' && /^=[A-Z@]/i.test(raw.trim())) {
              // REAL formula (spec §15: never hardcode calculated values).
              // ExcelJS wants the formula WITHOUT the leading '='; row
              // references are remapped to the table's actual placement
              // (the AI assumed its table starts at row 1).
              const rowOffset = tableStartRow - 1
              cell.value = { formula: remapFormulaRows(raw.trim().replace(/^=/, ''), rowOffset) }
            } else if (typeof raw === 'number') {
              cell.value = raw
              cell.numFmt = Number.isInteger(raw) ? '#,##0' : '#,##0.00'
            } else {
              const text = String(raw)
              const asNum = text.replace(/[$,%\s]/g, '')
              if (text !== '' && Number.isFinite(Number(asNum)) && /^[+-]?[\d.,]+$/.test(text)) {
                const n = Number(text.replace(/,/g, ''))
                if (Number.isFinite(n)) {
                  cell.value = n
                  cell.numFmt = text.includes('.') || Math.abs(n) < 100 ? '#,##0.00' : '#,##0'
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

        // Freeze panes below header + autofilter (spec §15)
        if (hasHeader && cursor - tableStartRow > 2) {
          ws.views = [{ state: 'frozen', ySplit: tableStartRow }]
          ws.autoFilter = {
            from: { row: tableStartRow, column: 1 },
            to: { row: cursor - 1, column: width },
          }
        }

        // Total row heuristic: label "Total"/"Sum" in col 1 → bold
        const lastRow = ws.getRow(cursor - 1)
        const firstCell = lastRow.getCell(1).value
        if (typeof firstCell === 'string' && /^(total|sum|grand total)\b/i.test(firstCell.trim())) {
          lastRow.font = { bold: true }
          for (let cIdx = 1; cIdx <= width; cIdx++) {
            lastRow.getCell(cIdx).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: `FF${hex6(colors.accent, '3B82F6')}` },
            }
            lastRow.getCell(cIdx).font = { bold: true, color: { argb: 'FFFFFFFF' } }
          }
        }
      }
    })

    const buffer = await wb.xlsx.writeBuffer()
    const buf = Buffer.from(buffer)
    return {
      buffer: buf,
      filename: `${slugify(spec.title)}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: buf.length,
    }
  }
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
