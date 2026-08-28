// =============================================================================
// TEXT-BASED RENDERERS — CSV / TXT / HTML (spec §16, §17)
// =============================================================================
// CSV: deterministic serialization (RFC 4180 quoting, UTF-8) from the first
//      real data table; falls back to structured rows.
// TXT: clean plain text — title, section headings, lists, tables as text.
// HTML: standalone themed HTML document (preview-friendly).
// =============================================================================

import type { RendererOutput, DocumentRenderer, RenderableDocument, CanonicalComponent } from './shared'
import { asMetrics, asString, asStringArray, asTable, deriveTheme, withHash } from './shared'

function csvEscape(v: string | number | null): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function componentsOf(document: RenderableDocument, sectionId: string): CanonicalComponent[] {
  return (document.sections.find((s) => s.id === sectionId)?.components ?? []).slice().sort((a, b) => a.order - b.order)
}

export class CsvRenderer implements DocumentRenderer {
  format = 'CSV' as const

  async render(document: RenderableDocument): Promise<RendererOutput> {
    const spec = document.specification

    // Prefer the largest table in the document.
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
      csv = best.map((r) => r.map(csvEscape).join(',')).join('\r\n')
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
    }
  }
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
