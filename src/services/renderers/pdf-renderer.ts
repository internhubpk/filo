// =============================================================================
// PDF RENDERER (spec §13) — pdfkit with a professional design system
// =============================================================================
// Visually coherent, paginated PDF output:
//   • themed cover page (title block, accent rules, date/company)
//   • running header + footer with page numbers
//   • themed section headings with accent rules
//   • paragraphs, lists, quotes, callouts, metric bands, two-column,
//     styled tables (dark header band, zebra rows, column width fitting)
//   • charts + timelines embedded as PNG
//   • completion promise bounded by a 120s guard — pdfkit streams can hang
//     silently on malformed content, so the render can never block a job.
// =============================================================================

import type { RendererOutput, DocumentRenderer, RenderableDocument, CanonicalComponent } from './shared'
import {
  asMetrics,
  asString,
  asStringArray,
  asTable,
  asTwoColumn,
  deriveTheme,
  hex6,
  renderComponentImage,
  tint,
  withHash,
} from './shared'

const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  LETTER: [612, 792],
  LEGAL: [612, 1008],
}

export class PdfRenderer implements DocumentRenderer {
  format = 'PDF' as const

  async render(document: RenderableDocument): Promise<RendererOutput> {
    const pdfkit = (await import('pdfkit')).default
    const spec = document.specification
    const theme = deriveTheme(spec)
    const colors = theme.colors
    const layout = spec.design?.layout
    const sizeKey = (layout?.pageSize ?? 'A4').toUpperCase()
    const [pageW, pageH] = PAGE_SIZES[sizeKey] ?? PAGE_SIZES.A4
    const margin = 56

    const doc = new pdfkit({ size: sizeKey === 'LEGAL' ? 'LEGAL' : sizeKey === 'LETTER' ? 'LETTER' : 'A4', margin, info: { Title: spec.title, Author: 'Filo' } })

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('PDF render timed out after 120s')), 120_000)
      doc.on('end', () => {
        clearTimeout(timeout)
        resolve(Buffer.concat(chunks))
      })
      doc.on('error', (err: Error) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    const fg = withHash(colors.foreground, '#1F2937')
    const primary = withHash(colors.primary, '#1E3A5F')
    const accent = withHash(colors.accent, '#3B82F6')
    const mutedFg = withHash(colors.mutedForeground, '#64748B')
    const borderCol = withHash(colors.border, '#E2E8F0')
    const bodyFont = 'Helvetica'
    const headingFont = 'Helvetica-Bold'

    // ---------------- COVER PAGE ----------------
    const sections = spec.sections
    const coverSection = sections[0]?.type === 'cover' ? sections[0] : null
    const hasCover = Boolean(coverSection) || sections.length >= 3
    if (hasCover) {
      // accent top band
      doc.rect(0, 0, pageW, 16).fill(primary)
      doc.rect(margin, pageH * 0.34, 72, 4).fill(accent)

      const title = coverSection?.title ?? spec.title ?? 'Untitled Document'
      doc.font(headingFont).fontSize(30).fillColor(primary)
      doc.text(title, margin, pageH * 0.38, { width: pageW - margin * 2, align: 'center' })

      const subtitle =
        asString(
          (document.sections.find((s) => s.id === coverSection?.id)?.components ?? []).find((c) => c.type === 'paragraph')?.content
        ) || spec.description
      if (subtitle) {
        doc.moveDown(0.6)
        doc.font(bodyFont).fontSize(13).fillColor(mutedFg)
        doc.text(subtitle.slice(0, 300), margin, doc.y, { width: pageW - margin * 2, align: 'center' })
      }
      doc.moveDown(1.2)
      const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      doc.font(bodyFont).fontSize(10).fillColor(mutedFg)
      doc.text([document.branding?.companyName, date].filter(Boolean).join('  ·  '), margin, doc.y, {
        width: pageW - margin * 2,
        align: 'center',
      })
      doc.addPage()
    }

    // ---------------- RUNNING HEADER / FOOTER ----------------
    let pageNumber = hasCover ? 2 : 1
    const totalSections = sections.filter((s) => s !== coverSection).length
    const stampHeaderFooter = () => {
      if (spec.design?.layout?.headerEnabled !== false) {
        doc.font(bodyFont).fontSize(8).fillColor(mutedFg)
        doc.text(spec.title, margin, 28, { width: pageW - margin * 2, align: 'right', lineBreak: false })
      }
      if (spec.design?.layout?.footerEnabled !== false) {
        doc.font(bodyFont).fontSize(9).fillColor(mutedFg)
        doc.text(String(pageNumber), margin, pageH - 40, { width: pageW - margin * 2, align: 'center', lineBreak: false })
      }
    }

    const contentBottom = pageH - 64
    let cursorY = margin + 8

    const ensureSpace = (needed: number) => {
      if (cursorY + needed > contentBottom) {
        stampHeaderFooter()
        doc.addPage()
        pageNumber++
        cursorY = margin + 8
      }
    }

    // ---------------- SECTIONS ----------------
    const contentSections = coverSection ? sections.slice(1) : sections
    let sectionIdx = 0
    for (const section of contentSections) {
      sectionIdx++
      // Section heading (new page for each section — clean pagination)
      if (sectionIdx > 1) {
        stampHeaderFooter()
        doc.addPage()
        pageNumber++
      }
      cursorY = margin + 8
      doc.font(headingFont).fontSize(20).fillColor(primary)
      doc.text(section.title, margin, cursorY, { width: pageW - margin * 2 })
      cursorY = doc.y + 6
      doc.moveTo(margin, cursorY).lineTo(margin + 64, cursorY).lineWidth(2.5).stroke(accent)
      cursorY += 18

      const components = (document.sections.find((s) => s.id === section.id)?.components ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)

      for (const component of components) {
        cursorY = await this.renderComponent(doc, component, {
          theme,
          y: cursorY,
          ensureSpace,
          contentBottom,
          ctx: { pageW, margin, fg, primary, accent, mutedFg, borderCol, bodyFont, headingFont },
          document,
        })
      }
      void totalSections
    }

    stampHeaderFooter()
    doc.end()
    const buffer = await done

    return {
      buffer,
      filename: `${slugify(spec.title)}.pdf`,
      mimeType: 'application/pdf',
      size: buffer.length,
    }
  }

  private async renderComponent(
    doc: any,
    component: CanonicalComponent,
    opts: {
      theme: ReturnType<typeof deriveTheme>
      y: number
      ensureSpace: (n: number) => void
      contentBottom: number
      ctx: {
        pageW: number
        margin: number
        fg: string
        primary: string
        accent: string
        mutedFg: string
        borderCol: string
        bodyFont: string
        headingFont: string
      }
      document: RenderableDocument
    }
  ): Promise<number> {
    const { theme, ensureSpace, ctx } = opts
    const { pageW, margin, fg, primary, accent, mutedFg, borderCol, bodyFont, headingFont } = ctx
    const width = pageW - margin * 2
    let y = opts.y

    switch (component.type) {
      case 'heading': {
        const text = asString(component.content)
        if (!text) return y
        ensureSpace(46)
        doc.font(headingFont).fontSize(14).fillColor(primary)
        doc.text(text, margin, y, { width })
        return doc.y + 12
      }

      case 'paragraph': {
        const text = asString(component.content)
        if (!text) return y
        doc.font(bodyFont).fontSize(10.5).fillColor(fg)
        const height = doc.heightOfString(text, { width, lineGap: 3 })
        ensureSpace(height + 10)
        doc.text(text, margin, y, { width, align: 'justify', lineGap: 3 })
        return doc.y + 10
      }

      case 'list':
      case 'key_takeaways': {
        const items = asStringArray(component.content)
        if (items.length === 0) return y
        doc.font(bodyFont).fontSize(10.5).fillColor(fg)
        let iy = y
        for (const item of items) {
          const h = doc.heightOfString(item, { width: width - 18, lineGap: 2 })
          ensureSpace(h + 6)
          if (iy > y && iy + h > opts.contentBottom) {
            // ensureSpace already paginated; recompute
          }
          doc.fillColor(accent).circle(margin + 4, iy + 5, 2).fill()
          doc.fillColor(fg).text(item, margin + 16, iy, { width: width - 18, lineGap: 2 })
          iy = doc.y + 6
        }
        return iy + 4
      }

      case 'quote': {
        const text = asString(component.content)
        if (!text) return y
        const qWidth = width - 36
        doc.font(bodyFont).fontSize(11.5)
        const h = doc.heightOfString(`“${text}”`, { width: qWidth, lineGap: 3 })
        ensureSpace(h + 24)
        doc.rect(margin, y, 3, h + 12).fill(accent)
        doc.fillColor(primary).font(bodyFont).fontSize(11.5)
        doc.text(`“${text}”`, margin + 18, y + 6, { width: qWidth, lineGap: 3 })
        return y + h + 24
      }

      case 'callout': {
        const text = asString(component.content)
        if (!text) return y
        doc.font(bodyFont).fontSize(10.5)
        const h = doc.heightOfString(text, { width: width - 32, lineGap: 2 })
        const boxH = h + 24
        ensureSpace(boxH + 12)
        const fill = tint(accent, 0.9)
        doc.rect(margin, y, width, boxH).fill(fill)
        doc.rect(margin, y, 4, boxH).fill(accent)
        doc.fillColor(fg).font(headingFont).fontSize(10.5)
        doc.text(text, margin + 18, y + 12, { width: width - 32, lineGap: 2 })
        return y + boxH + 14
      }

      case 'metric_grid': {
        const metrics = asMetrics(component.content).slice(0, 4)
        if (metrics.length === 0) return y
        const gap = 10
        const cardW = (width - gap * (metrics.length - 1)) / metrics.length
        const cardH = 78
        ensureSpace(cardH + 16)
        let x = margin
        for (const m of metrics) {
          doc.rect(x, y, cardW, cardH).fillAndStroke('#FAFBFC', borderCol)
          doc.rect(x, y, cardW, 3).fill(primary)
          doc.font(bodyFont).fontSize(8.5).fillColor(mutedFg)
          doc.text(m.label || ' ', x + 10, y + 12, { width: cardW - 20 })
          doc.font(headingFont).fontSize(19).fillColor(accent)
          doc.text(m.value, x + 10, y + 28, { width: cardW - 20 })
          if (m.change) {
            doc.font(bodyFont).fontSize(8.5).fillColor(mutedFg)
            doc.text(m.change, x + 10, y + 56, { width: cardW - 20 })
          }
          x += cardW + gap
        }
        return y + cardH + 18
      }

      case 'two_column': {
        const data = asTwoColumn(component.content)
        if (!data) return y
        const colW = (width - 16) / 2
        const colH = 150
        ensureSpace(colH + 16)
        const render = (title: string, points: string[], x: number) => {
          doc.rect(x, y, colW, colH).fillAndStroke('#FFFFFF', borderCol)
          doc.rect(x, y, colW, 2.5).fill(accent)
          doc.font(headingFont).fontSize(11.5).fillColor(primary)
          doc.text(title, x + 12, y + 12, { width: colW - 24 })
          doc.font(bodyFont).fontSize(9.5).fillColor(fg)
          let py = y + 34
          for (const p of points.slice(0, 5)) {
            doc.circle(x + 14, py + 4, 1.6).fill(accent)
            doc.text(p, x + 22, py, { width: colW - 34, lineGap: 1.5 })
            py = doc.y + 5
          }
        }
        render(data.leftTitle, data.leftPoints, margin)
        render(data.rightTitle, data.rightPoints, margin + colW + 16)
        return y + colH + 16
      }

      case 'table': {
        const rows = asTable(component.content)
        if (rows.length === 0) return y
        const [header, ...data] = rows
        const cols = Math.max(header.length, 1)
        const colW = width / cols

        // Header band
        ensureSpace(30 + 24)
        doc.rect(margin, y, width, 24).fill(primary)
        doc.font(headingFont).fontSize(9).fillColor('#FFFFFF')
        header.forEach((cell, i) => {
          doc.text(String(cell ?? ''), margin + 6 + i * colW, y + 8, { width: colW - 12, lineBreak: false })
        })
        let ry = y + 24

        doc.font(bodyFont).fontSize(9)
        data.forEach((row, rIdx) => {
          const rowH = Math.max(
            20,
            ...row.map((cell) => doc.heightOfString(String(cell ?? ''), { width: colW - 12, lineGap: 1 }) + 10)
          )
          if (ry + rowH > opts.contentBottom) {
            ensureSpace(rowH + 24)
            ry = opts.y
            doc.rect(margin, ry, width, 24).fill(primary)
            doc.font(headingFont).fontSize(9).fillColor('#FFFFFF')
            header.forEach((cell, i) => {
              doc.text(String(cell ?? ''), margin + 6 + i * colW, ry + 8, { width: colW - 12, lineBreak: false })
            })
            ry += 24
            doc.font(bodyFont).fontSize(9)
          }
          if (rIdx % 2 === 1) {
            doc.rect(margin, ry, width, rowH).fill(tint(primary, 0.96))
          }
          doc.rect(margin, ry, width, rowH).stroke(borderCol)
          row.forEach((cell, i) => {
            doc.fillColor(fg).text(String(cell ?? ''), margin + 6 + i * colW, ry + 5, { width: colW - 12, lineGap: 1 })
          })
          ry += rowH
        })
        return ry + 16
      }

      case 'chart':
      case 'timeline': {
        const image = await renderComponentImage(component, theme, { width: 620 })
        if (!image) return y
        const maxW = width
        const maxH = 280
        const scale = Math.min(maxW / image.width, maxH / image.height)
        const w = image.width * scale
        const h = image.height * scale
        ensureSpace(h + 24)
        doc.image(image.png, margin + (width - w) / 2, y, { width: w, height: h })
        if (image.caption) {
          doc.font(bodyFont).fontSize(8.5).fillColor(mutedFg)
          doc.text(image.caption, margin, y + h + 4, { width, align: 'center' })
          return y + h + 24
        }
        return y + h + 14
      }

      default: {
        const text = asString(component.content)
        if (!text) return y
        doc.font(bodyFont).fontSize(10.5).fillColor(fg)
        doc.text(text, margin, y, { width, lineGap: 3 })
        return doc.y + 10
      }
    }
    void headingFont
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
