// =============================================================================
// TEXT-BASED RENDERERS — CSV / TXT / HTML (spec §16, §17)
// =============================================================================
// CSV: strict structured-data artifact (RFC 4180 quoting, UTF-8 + BOM):
//      • the primary data table (largest) becomes the CSV body
//      • column types are INFERRED and normalized — "$1,234" becomes 1234,
//        "12.5%" becomes 0.125 when a whole column is percentage-typed,
//        ISO dates stay ISO — so the file parses as typed data, not prose
//      • mathematically related columns are VALIDATED and REPAIRED: when the
//        header names a total/amount column alongside quantity/price/discount
//        columns, each row is recomputed (qty × price − discount = total) —
//        corrections are counted and surfaced in the QA summary
//      • formulas are EVALUATED against the table before serialization
// TXT: clean plain text — title, section headings, lists, tables as text.
// HTML: standalone themed HTML document (preview-friendly).
// =============================================================================

import type { RendererOutput, DocumentRenderer, RenderableDocument, CanonicalComponent } from './shared'
import { asMetrics, asString, asStringArray, asTable, deriveTheme, withHash } from './shared'
import { evaluateFormula, type CellMatrix } from '@/services/formula-evaluator'

function csvEscape(v: string | number | null): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function componentsOf(document: RenderableDocument, sectionId: string): CanonicalComponent[] {
  return (document.sections.find((s) => s.id === sectionId)?.components ?? []).slice().sort((a, b) => a.order - b.order)
}

// ==================== CSV COLUMN SEMANTICS ====================

type ColKind = 'number' | 'currency' | 'percent' | 'isodate' | 'text'

const CURRENCY_CLEAN = /^\s*([$€£¥₨]|Rs\.?|PKR|USD|EUR|GBP)\s?([\d,]+(?:\.\d+)?)\s*$/i

function parseNumericish(s: string): { kind: ColKind; n: number } | null {
  const t = s.trim()
  if (t === '') return null
  if (/^-?[\d,]+(?:\.\d+)?\s*%$/.test(t)) {
    const n = Number(t.replace(/[,%\s]/g, ''))
    return Number.isFinite(n) ? { kind: 'percent', n } : null
  }
  const cur = CURRENCY_CLEAN.exec(t)
  if (cur) {
    const n = Number(cur[2].replace(/,/g, ''))
    return Number.isFinite(n) ? { kind: 'currency', n } : null
  }
  if (/^-?[\d,]+(?:\.\d+)?$/.test(t)) {
    const n = Number(t.replace(/,/g, ''))
    return Number.isFinite(n) ? { kind: 'number', n } : null
  }
  return null
}

const TOTAL_HEADER = /(total[_\s]?amount|line[_\s]?total|grand[_\s]?total|total|amount|revenue)/i
const QTY_HEADER = /(quantity|qty|units|count|volume)/i
const PRICE_HEADER = /(unit[_\s]?price|price[_\s]?per[_\s]?unit|unit[_\s]?cost|price|rate)/i
const DISCOUNT_HEADER = /(discount|rebate|allowance)/i
const TAX_HEADER = /(tax|vat|gst|sales[_\s]?tax)/i

export class CsvRenderer implements DocumentRenderer {
  format = 'CSV' as const

  async render(document: RenderableDocument): Promise<RendererOutput> {
    const spec = document.specification
    const qa: Record<string, unknown> = {}

    // Prefer the largest table in the document (CSV = exactly one dataset).
    let best: string[][] | null = null
    for (const section of spec.sections) {
      for (const c of componentsOf(document, section.id)) {
        if (c.type !== 'table') continue
        const rows = asTable(c.content).map((r) => r.map((cell) => (cell === null ? '' : String(cell))))
        if (rows.length > 0 && (!best || rows.length > best.length)) best = rows
      }
    }

    let csv: string
    if (best) {
      // Formula cells are evaluated against the table before typing (a CSV
      // carries VALUES, not formulas).
      const matrix = best as CellMatrix
      for (let r = 1; r < best.length; r++) {
        for (let c = 0; c < best[r].length; c++) {
          const v = best[r][c]
          if (typeof v === 'string' && /^=/.test(v.trim())) {
            const computed = evaluateFormula(v.trim(), matrix)
            best[r][c] = computed !== null ? String(computed) : v
          }
        }
      }

      const [header, ...data] = best
      const cols = Math.max(...best.map((r) => r.length))

      // ---------- column typing ----------
      const kinds: ColKind[] = []
      for (let c = 0; c < cols; c++) {
        let numberish = 0
        let percent = 0
        let currency = 0
        let nonEmpty = 0
        for (let r = 1; r < data.length + 1; r++) {
          const raw = best[r]?.[c] ?? ''
          if (raw === '') continue
          nonEmpty++
          const parsed = parseNumericish(raw)
          if (!parsed) continue
          numberish++
          if (parsed.kind === 'percent') percent++
          if (parsed.kind === 'currency') currency++
        }
        if (nonEmpty > 0 && numberish / nonEmpty >= 0.8) {
          kinds[c] = percent / numberish >= 0.5 ? 'percent' : currency / numberish >= 0.5 ? 'currency' : 'number'
        } else {
          kinds[c] = 'text'
        }
      }

      // ---------- row-wise relationship validation + repair ----------
      // The schema (header) defines the relationship: when a total/amount
      // column coexists with quantity, unit-price and optional discount/tax
      // columns, each row must satisfy
      //   total = quantity × unit_price − discount (+ tax)
      // Rows that violate the relationship are RECOMPUTED from their
      // components (the total is the derived field) and the correction is
      // counted in the QA summary — never left silently inconsistent.
      let totalCol = -1
      let qtyCol = -1
      let priceCol = -1
      let discountCol = -1
      let taxCol = -1
      header.forEach((h, i) => {
        const name = String(h ?? '')
        if (totalCol < 0 && TOTAL_HEADER.test(name)) totalCol = i
        if (qtyCol < 0 && QTY_HEADER.test(name)) qtyCol = i
        if (priceCol < 0 && PRICE_HEADER.test(name)) priceCol = i
        if (discountCol < 0 && DISCOUNT_HEADER.test(name)) discountCol = i
        if (taxCol < 0 && TAX_HEADER.test(name)) taxCol = i
      })
      let corrections = 0
      const relationshipActive =
        totalCol >= 0 && qtyCol >= 0 && priceCol >= 0 &&
        kinds[totalCol] !== 'text' && kinds[qtyCol] !== 'text' && kinds[priceCol] !== 'text'

      const normalized: string[][] = [header.slice(0, cols)]
      for (let r = 1; r < best.length; r++) {
        const row: string[] = []
        for (let c = 0; c < cols; c++) {
          const raw = best[r][c] ?? ''
          if (kinds[c] === 'text') {
            row.push(raw)
            continue
          }
          const parsed = parseNumericish(raw)
          if (!parsed) {
            row.push(raw)
            continue
          }
          if (kinds[c] === 'percent') {
            // percent columns serialize as decimal fractions (25% → 0.25)
            row.push(String(round6(parsed.n / 100)))
          } else {
            row.push(String(round6(parsed.n)))
          }
        }
        if (relationshipActive) {
          const qty = Number(row[qtyCol])
          const price = Number(row[priceCol])
          const discount = discountCol >= 0 && kinds[discountCol] !== 'text' ? Number(row[discountCol]) || 0 : 0
          const tax = taxCol >= 0 && kinds[taxCol] !== 'text' ? Number(row[taxCol]) || 0 : 0
          const totalRaw = Number(row[totalCol])
          if (Number.isFinite(qty) && Number.isFinite(price) && Number.isFinite(totalRaw)) {
            const expected = round2(qty * price - discount + tax)
            if (Math.abs(expected - round2(totalRaw)) > 0.011) {
              corrections++
              row[totalCol] = String(expected)
            }
          }
        }
        normalized.push(row)
      }
      if (relationshipActive) {
        qa.csvRelationship = {
          rule: 'total = quantity × unit_price − discount + tax',
          columns: {
            total: header[totalCol], quantity: header[qtyCol],
            price: header[priceCol],
            discount: discountCol >= 0 ? header[discountCol] : null,
            tax: taxCol >= 0 ? header[taxCol] : null,
          },
          rowsRepaired: corrections,
        }
      }
      qa.columnTypes = kinds

      csv = normalized.map((r) => r.map(csvEscape).join(',')).join('\r\n')
    } else {
      // Structured fallback: one row per paragraph/list item.
      const rows: string[][] = [['Section', 'Type', 'Content']]
      for (const section of spec.sections) {
        for (const c of componentsOf(document, section.id)) {
          const content =
            typeof c.content === 'string'
              ? c.content
              : Array.isArray(c.content)
                ? c.content.map((x) => String(x)).join(' | ')
                : ''
          if (content) rows.push([section.title, c.type, content])
        }
      }
      csv = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')
    }

    const buffer = Buffer.from(`\uFEFF${csv}`, 'utf-8') // BOM for Excel compatibility
    return {
      buffer,
      filename: `${slugify(spec.title)}.csv`,
      mimeType: 'text/csv',
      size: buffer.length,
      qa: Object.keys(qa).length > 0 ? qa : undefined,
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

export class TxtRenderer implements DocumentRenderer {
  format = 'TXT' as const

  async render(document: RenderableDocument): Promise<RendererOutput> {
    const spec = document.specification
    const lines: string[] = []

    lines.push(spec.title.toUpperCase())
    lines.push('='.repeat(Math.min(spec.title.length, 72)))
    if (spec.description) {
      lines.push(spec.description)
      lines.push('')
    }

    for (const section of spec.sections) {
      lines.push('')
      lines.push(section.title)
      lines.push('-'.repeat(Math.min(section.title.length, 60)))
      for (const c of componentsOf(document, section.id)) {
        switch (c.type) {
          case 'heading':
            lines.push('', asString(c.content))
            break
          case 'paragraph':
            lines.push(asString(c.content))
            break
          case 'list':
          case 'key_takeaways':
            asStringArray(c.content).forEach((i) => lines.push(`  • ${i}`))
            break
          case 'metric_grid':
            asMetrics(c.content).forEach((m) => lines.push(`  ${m.label ? m.label + ': ' : ''}${m.value}${m.change ? ` (${m.change})` : ''}`))
            break
          case 'callout':
            lines.push(`[!] ${asString(c.content)}`)
            break
          case 'quote':
            lines.push(`"${asString(c.content)}"`)
            break
          case 'table': {
            const rows = asTable(c.content)
            rows.forEach((r) => lines.push('  ' + r.map((cell) => (cell === null ? '' : String(cell))).join(' | ')))
            break
          }
          case 'chart': {
            const o = (c.content && typeof c.content === 'object' ? c.content : {}) as Record<string, unknown>
            lines.push(`[Chart: ${String(o.title ?? 'Chart')}]`)
            break
          }
          default:
            if (typeof c.content === 'string') lines.push(c.content)
        }
      }
    }

    const buffer = Buffer.from(lines.join('\n'), 'utf-8')
    return {
      buffer,
      filename: `${slugify(spec.title)}.txt`,
      mimeType: 'text/plain',
      size: buffer.length,
    }
  }
}

export class HtmlRenderer implements DocumentRenderer {
  format = 'HTML' as const

  async render(document: RenderableDocument): Promise<RendererOutput> {
    const spec = document.specification
    const theme = deriveTheme(spec)
    const c = theme.colors
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const body: string[] = []
    for (const section of spec.sections) {
      body.push(`<section><h2>${esc(section.title)}</h2>`)
      for (const comp of componentsOf(document, section.id)) {
        switch (comp.type) {
          case 'heading':
            body.push(`<h3>${esc(asString(comp.content))}</h3>`)
            break
          case 'paragraph':
            body.push(`<p>${esc(asString(comp.content))}</p>`)
            break
          case 'list':
          case 'key_takeaways':
            body.push(`<ul>${asStringArray(comp.content).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`)
            break
          case 'quote':
            body.push(`<blockquote>${esc(asString(comp.content))}</blockquote>`)
            break
          case 'callout':
            body.push(`<div class="callout">${esc(asString(comp.content))}</div>`)
            break
          case 'metric_grid':
            body.push(
              `<div class="metrics">${asMetrics(comp.content)
                .map((m) => `<div class="metric"><div class="label">${esc(m.label)}</div><div class="value">${esc(m.value)}</div>${m.change ? `<div class="change">${esc(m.change)}</div>` : ''}</div>`)
                .join('')}</div>`
            )
            break
          case 'table': {
            const rows = asTable(comp.content)
            const [head, ...rest] = rows
            body.push(
              `<table>${head ? `<thead><tr>${head.map((h) => `<th>${esc(String(h ?? ''))}</th>`).join('')}</tr></thead>` : ''}<tbody>${rest
                .map((r) => `<tr>${r.map((cell) => `<td>${esc(String(cell ?? ''))}</td>`).join('')}</tr>`)
                .join('')}</tbody></table>`
            )
            break
          }
          default:
            if (typeof comp.content === 'string') body.push(`<p>${esc(comp.content)}</p>`)
        }
      }
      body.push('</section>')
    }

    const html = `<!DOCTYPE html>
<html lang="${spec.metadata?.language ?? 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.title)}</title>
<style>
  :root { --primary: ${withHash(c.primary)}; --accent: ${withHash(c.accent)}; --fg: ${withHash(c.foreground)}; --muted: ${withHash(c.mutedForeground)}; --border: ${withHash(c.border)}; }
  body { font-family: Georgia, 'Times New Roman', serif; color: var(--fg); max-width: 860px; margin: 0 auto; padding: 48px 24px; line-height: 1.65; }
  h1 { color: var(--primary); font-size: 34px; margin-bottom: 4px; }
  .subtitle { color: var(--muted); font-style: italic; margin-bottom: 32px; }
  h2 { color: var(--primary); border-bottom: 2px solid var(--accent); padding-bottom: 6px; margin-top: 40px; }
  h3 { color: var(--accent); }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th { background: var(--primary); color: #fff; text-align: left; padding: 8px 12px; }
  td { border: 1px solid var(--border); padding: 7px 12px; }
  tbody tr:nth-child(even) { background: ${withHash(c.muted)}; }
  blockquote { border-left: 4px solid var(--accent); margin: 16px 0; padding: 8px 20px; color: var(--muted); font-style: italic; }
  .callout { background: ${withHash(c.muted)}; border-left: 4px solid var(--accent); padding: 12px 18px; font-weight: 600; margin: 16px 0; }
  .metrics { display: flex; gap: 14px; margin: 18px 0; flex-wrap: wrap; }
  .metric { flex: 1; min-width: 140px; border: 1px solid var(--border); border-top: 3px solid var(--primary); padding: 12px 16px; }
  .metric .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .metric .value { font-size: 26px; font-weight: 700; color: var(--accent); margin: 4px 0; }
  .metric .change { font-size: 12px; color: var(--muted); }
  @media print { body { padding: 0; } section { page-break-before: always; } section:first-of-type { page-break-before: avoid; } }
</style>
</head>
<body>
<h1>${esc(spec.title)}</h1>
${spec.description ? `<p class="subtitle">${esc(spec.description)}</p>` : ''}
${body.join('\n')}
</body>
</html>`

    const buffer = Buffer.from(html, 'utf-8')
    return {
      buffer,
      filename: `${slugify(spec.title)}.html`,
      mimeType: 'text/html',
      size: buffer.length,
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
