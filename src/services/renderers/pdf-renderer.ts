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
import { existsSync } from 'node:fs'

const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  LETTER: [612, 792],
  LEGAL: [612, 1008],
}

interface FontPair {
  regular: string
  bold: string
}

/**
 * Locate a Unicode-capable TTF/TTC on this host for pdfkit embedding.
 * pdfkit's base-14 fonts are Latin-1 only; without a real font file every
 * CJK glyph degrades to mojibake. Checked in order so any standard install
 * works; FILO_PDF_FONT_PATH wins for constrained deployments.
 */
function resolveUnicodeFonts(): FontPair | null {
  const env = process.env.FILO_PDF_FONT_PATH
  const regularCandidates = [
    env,
    '/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/System/Library/Fonts/Supplemental/Songti.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    'C:\\Windows\\Fonts\\msyh.ttc',
    'C:\\Windows\\Fonts\\simsun.ttc',
  ].filter((p): p is string => Boolean(p))
  const boldCandidates = [
    env,
    '/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
    '/System/Library/Fonts/Supplemental/Songti.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    'C:\\Windows\\Fonts\\msyhbd.ttc',
    'C:\\Windows\\Fonts\\simsun.ttc',
  ].filter((p): p is string => Boolean(p))
  const regular = regularCandidates.find((p) => existsSync(p))
  if (!regular) return null
  const bold = boldCandidates.find((p) => existsSync(p)) ?? regular
  return { regular, bold }
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
    // The footer is drawn at pageH - 40. pdfkit auto-paginates any text whose
    // baseline would land beyond maxY (pageH - bottomMargin), so the bottom
    // margin MUST be smaller than the footer inset — with a symmetric 56pt
    // bottom margin every footer stamp silently created a BLANK page holding
    // only the page number (the classic "extra blank pages" PDF defect).
    const bottomMargin = 24

    const doc = new pdfkit({
      size: sizeKey === 'LEGAL' ? 'LEGAL' : sizeKey === 'LETTER' ? 'LETTER' : 'A4',
      margins: { top: margin, bottom: bottomMargin, left: margin, right: margin },
      info: { Title: spec.title, Author: 'Filo' },
    })

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

    // ---------------- FONT REGISTRATION (Unicode support) ----------------
    // pdfkit's built-in base-14 fonts (Helvetica et al.) cover Latin-1 only —
    // any CJK/most unicode content silently renders as mojibake. Register a
    // real Unicode TTF when one is available on the host (pdfkit SUBSETS the
    // embedded font, so output size stays proportional to the glyphs used).
    // Deployment note: point FILO_PDF_FONT_PATH at any TTF/TTC on hosts
    // without system fonts; without a font we degrade to Helvetica.
    let bodyFont = 'Helvetica'
    let headingFont = 'Helvetica-Bold'
    const unicodeFonts = resolveUnicodeFonts()
    if (unicodeFonts) {
      try {
        doc.registerFont('FiloBody', unicodeFonts.regular)
        doc.registerFont('FiloHeading', unicodeFonts.bold)
        bodyFont = 'FiloBody'
        headingFont = 'FiloHeading'
      } catch (fontErr) {
        console.warn('[PDF-RENDER] Unicode font registration failed — falling back to Helvetica:', fontErr instanceof Error ? fontErr.message : fontErr)
      }
    }

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
    // Stamping is driven by pdfkit's pageAdded event and is idempotent per
    // page. This covers pages WE add (section breaks, ensureSpace) AND pages
    // pdfkit creates internally when auto-flowing an overlong paragraph —
    // explicit-only stamping left auto-flowed pages blank and desynced the
    // page numbers.
    const stampHeaderFooter = () => {
      if ((doc as any).__filoStamped === doc.page) return // this page already stamped
      ;(doc as any).__filoStamped = doc.page
      if (spec.design?.layout?.headerEnabled !== false) {
        doc.font(bodyFont).fontSize(8).fillColor(mutedFg)
        doc.text(spec.title, margin, 28, { width: pageW - margin * 2, align: 'right', lineBreak: false })
      }
      if (spec.design?.layout?.footerEnabled !== false) {
        // True 1-based page index (cover included) — never drifts from the
        // real page count, even with internal auto-pagination.
        const label = String(doc.bufferedPageRange().count)
        doc.font(bodyFont).fontSize(9).fillColor(mutedFg)
        doc.text(label, margin, pageH - 40, { width: pageW - margin * 2, align: 'center', lineBreak: false })
      }
    }
    let skipNextStamp = hasCover // the cover page itself carries no running header/footer
    doc.on('pageAdded', () => {
      if (skipNextStamp) {
        skipNextStamp = false
        return
      }
      stampHeaderFooter()
    })

    const contentBottom = pageH - 64
    let cursorY = margin + 8

    // Returns the y at which drawing may continue given the component's OWN
    // current y — components advance their local y independently (lists,
    // flowed paragraphs), so the pagination decision MUST use that position,
    // never the section-level cursor. The previous versions had two variants
    // of this bug: checking a stale section cursor (long lists overflowed the
    // page bottom) or overwriting the component's position with the cursor
    // (list items stacked on top of each other).
    const ensureSpaceAt = (currentY: number, needed: number): number => {
      if (currentY + needed > contentBottom) {
        doc.addPage() // pageAdded event stamps + numbers the fresh page
        cursorY = margin + 8
        return margin + 8
      }
      return currentY
    }

    // ---------------- SECTIONS ----------------
    const contentSections = coverSection ? sections.slice(1) : sections
    let sectionIdx = 0
    for (const section of contentSections) {
      sectionIdx++
      // Section heading (new page for each section — clean pagination).
      // The outgoing page was already stamped when it was created (pageAdded);
      // stamp it again only if content somehow skipped the event path.
      if (sectionIdx > 1) {
        stampHeaderFooter()
        doc.addPage()
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
          ensureSpace: ensureSpaceAt,
          contentBottom,
          ctx: { pageW, margin, fg, primary, accent, mutedFg, borderCol, bodyFont, headingFont },
          document,
        })
      }
    }

    // Stamp the final page (idempotent — skipped if already stamped) so a
    // document whose last page never triggered addPage still gets its
    // header/footer + page number.
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
      ensureSpace: (currentY: number, needed: number) => number
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
        y = ensureSpace(y, 46)
        doc.font(headingFont).fontSize(14).fillColor(primary)
        doc.text(text, margin, y, { width })
        return doc.y + 12
      }

      case 'paragraph': {
        const text = asString(component.content)
        if (!text) return y
        doc.font(bodyFont).fontSize(10.5).fillColor(fg)
        const height = doc.heightOfString(text, { width, lineGap: 3 })
        y = ensureSpace(y, height + 10)
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
          if (!item) continue // empty strings would still consume a bullet row
          const h = doc.heightOfString(item, { width: width - 18, lineGap: 2 })
          iy = ensureSpace(iy, h + 6)
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
        y = ensureSpace(y, h + 24)
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
        y = ensureSpace(y, boxH + 12)
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
        y = ensureSpace(y, cardH + 16)
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
        y = ensureSpace(y, colH + 16)
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
        const drawHeaderBand = (bandY: number) => {
          doc.rect(margin, bandY, width, 24).fill(primary)
          doc.font(headingFont).fontSize(9).fillColor('#FFFFFF')
          header.forEach((cell, i) => {
            doc.text(String(cell ?? ''), margin + 6 + i * colW, bandY + 8, { width: colW - 12, lineBreak: false })
          })
          doc.font(bodyFont).fontSize(9)
        }

        // Header band
        y = ensureSpace(y, 30 + 24)
        drawHeaderBand(y)
        let ry = y + 24

        doc.font(bodyFont).fontSize(9)
        data.forEach((row, rIdx) => {
          const rowH = Math.max(
            20,
            ...row.map((cell) => doc.heightOfString(String(cell ?? ''), { width: colW - 12, lineGap: 1 }) + 10)
          )
          if (ry + rowH > opts.contentBottom) {
            // Page break INSIDE the table: repeat the header band on the new
            // page and continue from its top — never from a stale y.
            y = ensureSpace(ry, rowH + 24 + 24)
            drawHeaderBand(y)
            ry = y + 24
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
        y = ensureSpace(y, h + 24)
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
