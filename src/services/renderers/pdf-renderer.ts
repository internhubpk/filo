// =============================================================================
// PDF RENDERER (spec §13) — pdfkit with a professional design system
// =============================================================================
// v2 — THEME-DIALECT + LONG-DOCUMENT edition:
//   • TWO-PASS rendering: pass 1 lays out the body and records every section's
//     start page; pass 2 emits cover → real TABLE OF CONTENTS (dotted leaders,
//     accurate page numbers) → body. A 100-page document finally ships with a
//     navigable TOC instead of a blind guess.
//   • 5 cover layouts (banner | centered | sidebar | minimal | gradient-bar)
//   • 6 heading ornaments (rule | kicker | band | left-bar | underline | none)
//   • hierarchical headings: Part (large) / chapter / sub-section, numbers
//     from the blueprint outline
//   • 4 footer styles (page | page-of | brand-page | minimal) — "of Y" made
//     possible by the two-pass total
//   • themed tables (banded | boxed | minimal | dark-header | editorial),
//     running header + page numbers stamped on every auto-flowed page
//   • charts/timelines/diagrams as PNG, MathJax equations, metric cards
// =============================================================================

import type { RendererOutput, DocumentRenderer, RenderableDocument, CanonicalComponent } from './shared'
import {
  asMetrics,
  asString,
  asStringArray,
  asTable,
  asTwoColumn,
  deriveTheme,
  equationLatexOf,
  renderComponentImage,
  tint,
  withHash,
  type DerivedTheme,
} from './shared'
import { evaluateFormula } from '@/services/formula-evaluator'
import type { CellMatrix } from '@/services/formula-evaluator'
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

interface PdfThemeColors {
  fg: string
  primary: string
  accent: string
  mutedFg: string
  borderCol: string
}

export class PdfRenderer implements DocumentRenderer {
  format = 'PDF' as const

  private figureNo = 0

  async render(document: RenderableDocument): Promise<RendererOutput> {
    const pdfkit = (await import('pdfkit')).default
    const spec = document.specification
    const theme = deriveTheme(spec)
    const colors = theme.colors
    const layout = spec.design?.layout
    const sizeKey = (layout?.pageSize ?? 'A4').toUpperCase()
    const [pageW, pageH] = PAGE_SIZES[sizeKey] ?? PAGE_SIZES.A4
    const margin = 56
    const bottomMargin = 24

    const sections = spec.sections
    const coverSection = sections[0]?.type === 'cover' ? sections[0] : null
    const hasCover = Boolean(coverSection) || sections.length >= 3
    const contentSections = coverSection ? sections.slice(1) : sections
    const hasParts = contentSections.some((s) => (s.level || 'chapter') === 'part')

    // ---------------- PASS 1: layout probe ----------------
    // Render the body into a throwaway document to learn where every section
    // lands and how many pages the body needs. Deterministic because pass 2
    // repeats the identical layout from an identical starting state.
    const probe = new pdfkit({
      size: sizeKey === 'LEGAL' ? 'LEGAL' : sizeKey === 'LETTER' ? 'LETTER' : 'A4',
      margins: { top: margin, bottom: bottomMargin, left: margin, right: margin },
      info: { Title: spec.title, Producer: 'Filo' },
    })
    probe.info = probe.info // keep TS shape
    const probeChunks: Buffer[] = []
    probe.on('data', (c: Buffer) => probeChunks.push(c))
    const probeDone = new Promise<Buffer>((resolve) => {
      probe.on('end', () => resolve(Buffer.concat(probeChunks)))
      probe.on('error', () => resolve(Buffer.concat(probeChunks)))
    })
    const sectionStartPages: number[] = []
    let bodyPagesTotal = 0
    const registerFonts = (doc: any): { bodyFont: string; headingFont: string } => {
      let bodyFont = 'Helvetica'
      let headingFont = 'Helvetica-Bold'
      const unicodeFonts = resolveUnicodeFonts()
      if (unicodeFonts) {
        try {
          doc.registerFont('FiloBody', unicodeFonts.regular)
          doc.registerFont('FiloHeading', unicodeFonts.bold)
          bodyFont = 'FiloBody'
          headingFont = 'FiloHeading'
        } catch {
          // fall back to base-14
        }
      }
      return { bodyFont, headingFont }
    }
    {
      const { bodyFont, headingFont } = registerFonts(probe)
      await this.renderBody(probe, document, contentSections, {
        theme,
        pageW,
        pageH,
        margin,
        contentBottom: pageH - 64,
        bodyFont,
        headingFont,
        recordSectionPage: (idx: number) => sectionStartPages.push(probe.bufferedPageRange().count),
      })
      bodyPagesTotal = probe.bufferedPageRange().count
      probe.end()
      await probeDone
    }
    void sectionStartPages

    // ---------------- TOC ENTRY LIST ----------------
    interface TocEntry {
      level: string
      number?: string
      title: string
      page: number // body-relative (1-based)
    }
    const tocEntries: TocEntry[] = contentSections
      .map((s: any, i: number) => ({
        level: (s.level || 'chapter').toLowerCase(),
        number: s.number as string | undefined,
        title: String(s.title ?? ''),
        page: sectionStartPages[i] ?? 0,
      }))
      .filter((e: TocEntry) => e.title && e.page > 0 && e.level !== 'subsection')
    // drop the auto-cover placeholder from the TOC
    if (coverSection && tocEntries.length > 0) tocEntries.shift()

    // ---------------- PASS 2: final document ----------------
    const doc = new pdfkit({
      size: sizeKey === 'LEGAL' ? 'LEGAL' : sizeKey === 'LETTER' ? 'LETTER' : 'A4',
      margins: { top: margin, bottom: bottomMargin, left: margin, right: margin },
      info: { Title: spec.title, Author: 'Filo' },
    })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('PDF render timed out after 240s')), 240_000)
      doc.on('end', () => {
        clearTimeout(timeout)
        resolve(Buffer.concat(chunks))
      })
      doc.on('error', (err: Error) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    const { bodyFont, headingFont } = registerFonts(doc)
    const fg = withHash(colors.foreground, '#1F2937')
    const primary = withHash(colors.primary, '#1E3A5F')
    const accent = withHash(colors.accent, '#3B82F6')
    const mutedFg = withHash(colors.mutedForeground, '#64748B')
    const borderCol = withHash(colors.border, '#E2E8F0')
    const themeColors: PdfThemeColors = { fg, primary, accent, mutedFg, borderCol }

    // ---- cover (offset 0: body starts at page coverPages+1) ----
    let coverPages = 0
    if (hasCover) {
      coverPages = this.drawCover(doc, document, theme, themeColors, {
        pageW,
        pageH,
        margin,
        bodyFont,
        headingFont,
        coverSectionTitle: coverSection?.title ?? spec.title ?? 'Untitled Document',
        coverSubtitle:
          asString(
            (document.sections.find((s) => s.id === coverSection?.id)?.components ?? []).find((c) => c.type === 'paragraph')?.content
          ) || spec.description,
      })
    }

    // ---- TOC pages ----
    let tocPages = 0
    if (tocEntries.length >= 4) {
      // Precompute how many pages the TOC will consume using the exact same
      // layout constants drawToc uses, so body page numbers printed in the
      // TOC are correct even when the TOC itself spans multiple pages.
      const usable = pageH - margin - 60
      const entryH = 19
      const firstPageCap = Math.floor((usable - 44) / entryH)
      const laterPageCap = Math.floor(usable / entryH)
      tocPages =
        tocEntries.length <= firstPageCap
          ? 1
          : 1 + Math.ceil((tocEntries.length - firstPageCap) / laterPageCap)
      this.drawToc(doc, tocEntries, {
        pageW,
        pageH,
        margin,
        bodyFont,
        headingFont,
        colors: themeColors,
        // printed page = body page + cover + toc pages (absolute, 1-based)
        offset: coverPages + tocPages,
        // pdfkit can only draw on the CURRENT page — TOC pages must be
        // stamped exactly as they are created.
        stamp: (pageNo: number) => {
          if (spec.design?.layout?.headerEnabled !== false) {
            doc.font(bodyFont).fontSize(8).fillColor(mutedFg)
            doc.text(spec.title, margin, 28, { width: pageW - margin * 2, align: 'right', lineBreak: false })
          }
          if (spec.design?.layout?.footerEnabled !== false) {
            doc.font(bodyFont).fontSize(8.5).fillColor(mutedFg)
            doc.text(`${pageNo}`, margin, pageH - 40, { width: pageW - margin * 2, align: 'center', lineBreak: false })
          }
        },
      })
    }
    const pageOffset = coverPages + tocPages
    void pageOffset

    // ---- running header/footer ----
    const totalPagesEstimate = coverPages + tocPages + Math.max(bodyPagesTotal, 1)
    const stampHeaderFooter = (pageNo: number) => {
      if (spec.design?.layout?.headerEnabled !== false) {
        doc.font(bodyFont).fontSize(8).fillColor(mutedFg)
        doc.text(spec.title, margin, 28, { width: pageW - margin * 2, align: 'right', lineBreak: false })
      }
      if (spec.design?.layout?.footerEnabled !== false) {
        doc.font(bodyFont).fontSize(8.5).fillColor(mutedFg)
        const label =
          theme.footer === 'page-of'
            ? `Page ${pageNo} of ${totalPagesEstimate}`
            : theme.footer === 'brand-page'
              ? `${theme.tokens.label}`
              : `${pageNo}`
        if (theme.footer === 'brand-page') {
          doc.text(label, margin, pageH - 40, { width: pageW - margin * 2, align: 'left', lineBreak: false })
          doc.text(`${pageNo}`, margin, pageH - 40, { width: pageW - margin * 2, align: 'right', lineBreak: false })
        } else {
          doc.text(label, margin, pageH - 40, { width: pageW - margin * 2, align: 'center', lineBreak: false })
        }
      }
    }

    // Stamp cover-adjacent front matter is handled inside drawToc (pdfkit
    // can only draw on the current page — retroactive stamping is impossible).

    this.figureNo = 0
    // The body MUST start on a fresh page after cover/TOC front matter —
    // otherwise the first chapter would render on top of the TOC page.
    if (coverPages + tocPages > 0) doc.addPage() // pageAdded stamps this page
    await this.renderBody(doc, document, contentSections, {
      theme,
      pageW,
      pageH,
      margin,
      contentBottom: pageH - 64,
      bodyFont,
      headingFont,
      recordSectionPage: () => {},
      onPageStart: (pageNo: number) => stampHeaderFooter(pageNo),
      pageOffset,
    })
    stampHeaderFooter(coverPages + tocPages + Math.max(bodyPagesTotal, 1))
    doc.end()
    const buffer = await done

    return {
      buffer,
      filename: `${slugify(spec.title)}.pdf`,
      mimeType: 'application/pdf',
      size: buffer.length,
    }
  }

  // ==================== BODY LAYOUT (shared by both passes) ====================

  private async renderBody(
    doc: any,
    document: RenderableDocument,
    contentSections: any[],
    opts: {
      theme: DerivedTheme
      pageW: number
      pageH: number
      margin: number
      contentBottom: number
      bodyFont: string
      headingFont: string
      recordSectionPage: (idx: number) => void
      onPageStart?: (pageNo: number) => void
      pageOffset?: number
    }
  ): Promise<void> {
    const { theme, margin, contentBottom, bodyFont, headingFont } = opts
    const colors = theme.colors
    const width = opts.pageW - margin * 2
    const fg = withHash(colors.foreground, '#1F2937')

    let cursorY = margin + 8
    this.figureNo = 0
    let renderedIdx = 0

    const ensureSpaceAt = (currentY: number, needed: number): number => {
      if (currentY + needed > contentBottom) {
        doc.addPage()
        cursorY = margin + 8
        return margin + 8
      }
      return currentY
    }

    let lastPageSeen = doc.bufferedPageRange().count
    doc.on('pageAdded', () => {
      lastPageSeen = doc.bufferedPageRange().count
      if (!opts.onPageStart) return
      // CRITICAL: pdfkit fires pageAdded from INSIDE a flowed paragraph's
      // line loop. The header/footer stamp moves doc.y (footer lands below
      // maxY), so without saving/restoring the flow state pdfkit resumes the
      // paragraph at the footer position — every subsequent line overflows
      // the page, addPage fires per line, and the document explodes to
      // thousands of near-blank pages.
      const savedY = doc.y
      const savedX = doc.x
      opts.onPageStart(lastPageSeen)
      doc.y = savedY
      doc.x = savedX
    })

    for (let i = 0; i < contentSections.length; i++) {
      const section = contentSections[i]
      const components = (document.sections.find((s) => s.id === section.id)?.components ?? [])
        .slice()
        .sort((a: CanonicalComponent, b: CanonicalComponent) => a.order - b.order)
      const level = String(section.level || 'chapter').toLowerCase()
      const num = section.number as string | undefined
      const isPart = level === 'part'
      const isSub = level === 'section' || level === 'subsection'

      opts.recordSectionPage(i)

      // Pagination: parts + chapters start on a fresh page (professional
      // reports/notes); sub-sections flow.
      if (renderedIdx > 0 && !isSub) {
        doc.addPage()
        cursorY = margin + 8
      } else if (renderedIdx > 0) {
        cursorY += 18
      }

      // ---- heading (ornament-driven) ----
      const headingText = isPart
        ? num
          ? `Part ${num} — ${section.title}`
          : section.title
        : isSub
          ? num
            ? `${num}  ${section.title}`
            : section.title
          : num
            ? `${num}.  ${section.title}`
            : section.title
      cursorY = this.drawSectionHeading(doc, headingText, { isPart, isSub, theme, y: cursorY, margin, width, headingFont, colors: { primary: withHash(colors.primary, '#1E3A5F'), accent: withHash(colors.accent, '#3B82F6'), fg } })

      for (const component of components) {
        cursorY = await this.renderComponent(doc, component, {
          theme,
          y: cursorY,
          ensureSpace: ensureSpaceAt,
          contentBottom,
          ctx: { pageW: opts.pageW, margin, fg, primary: withHash(colors.primary, '#1E3A5F'), accent: withHash(colors.accent, '#3B82F6'), mutedFg: withHash(colors.mutedForeground, '#64748B'), borderCol: withHash(colors.border, '#E2E8F0'), bodyFont, headingFont },
          document,
          subFontScale: isPart ? 0.95 : 1,
        })
      }
      renderedIdx++
    }
  }

  // ==================== COVER (5 layouts) ====================

  private drawCover(
    doc: any,
    document: RenderableDocument,
    theme: DerivedTheme,
    c: PdfThemeColors,
    opts: { pageW: number; pageH: number; margin: number; bodyFont: string; headingFont: string; coverSectionTitle: string; coverSubtitle?: string }
  ): number {
    const { pageW, pageH, margin, bodyFont, headingFont } = opts
    const title = opts.coverSectionTitle
    const subtitle = (opts.coverSubtitle || '').slice(0, 300)
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const meta = [document.branding?.companyName, date].filter(Boolean).join('  ·  ')

    switch (theme.cover) {
      case 'sidebar': {
        const sidebarW = pageW * 0.36
        doc.rect(0, 0, sidebarW, pageH).fill(c.primary)
        doc.fillColor('#FFFFFF').font(headingFont).fontSize(11)
        doc.text(theme.tokens.label.toUpperCase(), 28, pageH - 120, { width: sidebarW - 48 })
        doc.font(bodyFont).fontSize(9).fillOpacity(0.75)
        doc.text(document.branding?.companyName ?? '', 28, pageH - 92, { width: sidebarW - 48 })
        doc.fillOpacity(1)
        doc.fillColor(c.primary).font(headingFont)
        doc.fontSize(32)
        doc.text(title, sidebarW + 40, pageH * 0.32, { width: pageW - sidebarW - 80 })
        if (subtitle) {
          doc.font(bodyFont).fontSize(12).fillColor(c.mutedFg)
          doc.text(subtitle, sidebarW + 40, doc.y + 18, { width: pageW - sidebarW - 80 })
        }
        doc.rect(sidebarW + 40, pageH * 0.26, 64, 4).fill(c.accent)
        doc.font(bodyFont).fontSize(10).fillColor(c.accent)
        doc.text(date, sidebarW + 40, pageH * 0.27, { width: 200 })
        doc.addPage()
        return 1
      }
      case 'centered': {
        doc.rect(margin, pageH * 0.3, pageW - margin * 2, 1.2).fill(c.primary)
        doc.font(headingFont).fontSize(30).fillColor(c.primary)
        doc.text(title, margin, pageH * 0.36, { width: pageW - margin * 2, align: 'center' })
        if (subtitle) {
          doc.moveDown(0.7)
          doc.font(bodyFont).fontSize(12.5).fillColor(c.mutedFg)
          doc.text(subtitle, margin, doc.y, { width: pageW - margin * 2, align: 'center' })
        }
        doc.moveDown(1.4)
        doc.rect(margin, doc.y + 4, pageW - margin * 2, 1.2).fill(c.primary)
        doc.font(bodyFont).fontSize(10).fillColor(c.mutedFg)
        doc.text(meta, margin, doc.y + 14, { width: pageW - margin * 2, align: 'center' })
        doc.addPage()
        return 1
      }
      case 'minimal': {
        doc.font(bodyFont).fontSize(10).fillColor(c.mutedFg)
        doc.text(theme.tokens.label.toUpperCase(), margin, pageH * 0.3, { width: pageW - margin * 2, align: 'center', characterSpacing: 3 })
        doc.font(headingFont).fontSize(34).fillColor(c.fg)
        doc.text(title, margin, pageH * 0.36, { width: pageW - margin * 2, align: 'center' })
        const ruleY = doc.y + 16
        doc.rect(pageW / 2 - 36, ruleY, 72, 2.4).fill(c.accent)
        if (subtitle) {
          doc.font(bodyFont).fontSize(11.5).fillColor(c.mutedFg)
          doc.text(subtitle, margin, ruleY + 22, { width: pageW - margin * 2, align: 'center' })
        }
        doc.font(bodyFont).fontSize(9.5).fillColor(c.mutedFg)
        doc.text(meta, margin, pageH * 0.82, { width: pageW - margin * 2, align: 'center' })
        doc.addPage()
        return 1
      }
      case 'gradient-bar': {
        const seg = pageW / 3
        doc.rect(0, 0, seg, 14).fill(c.primary)
        doc.rect(seg, 0, seg, 14).fill(c.accent)
        doc.rect(seg * 2, 0, seg, 14).fill(tint(c.accent, 0.55))
        doc.font(bodyFont).fontSize(10).fillColor(c.accent)
        doc.text(theme.tokens.label.toUpperCase(), margin, pageH * 0.3, { width: pageW - margin * 2, characterSpacing: 2 })
        doc.font(headingFont).fontSize(32).fillColor(c.fg)
        doc.text(title, margin, pageH * 0.35, { width: pageW - margin * 2 })
        if (subtitle) {
          doc.moveDown(0.6)
          doc.font(bodyFont).fontSize(12).fillColor(c.mutedFg)
          doc.text(subtitle, margin, doc.y, { width: pageW - margin * 2 })
        }
        doc.font(bodyFont).fontSize(9.5).fillColor(c.mutedFg)
        doc.text(meta, margin, pageH * 0.85, { width: pageW - margin * 2 })
        doc.addPage()
        return 1
      }
      case 'banner':
      default: {
        doc.rect(0, 0, pageW, 150).fill(c.primary)
        doc.font(headingFont).fontSize(27).fillColor('#FFFFFF')
        doc.text(title, margin + 4, 52, { width: pageW - (margin + 8) * 2 })
        if (subtitle) {
          doc.font(bodyFont).fontSize(11).fillColor('#E6EBF2')
          doc.text(subtitle.slice(0, 180), margin + 4, doc.y + 8, { width: pageW - (margin + 8) * 2 })
        }
        doc.rect(margin, pageH * 0.5, 72, 4).fill(c.accent)
        doc.font(bodyFont).fontSize(10).fillColor(c.mutedFg)
        doc.text(meta, margin, pageH * 0.52 + 12, { width: pageW - margin * 2 })
        doc.addPage()
        return 1
      }
    }
  }

  // ==================== TABLE OF CONTENTS ====================

  private drawToc(
    doc: any,
    entries: Array<{ level: string; number?: string; title: string; page: number }>,
    opts: { pageW: number; pageH: number; margin: number; bodyFont: string; headingFont: string; colors: PdfThemeColors; offset: number; stamp: (pageNo: number) => void }
  ): number {
    const { pageW, pageH, margin, bodyFont, headingFont, colors } = opts
    const width = pageW - margin * 2
    const usable = pageH - margin - 60
    const entryH = 19

    opts.stamp(doc.bufferedPageRange().count)
    doc.font(headingFont).fontSize(21).fillColor(colors.primary)
    doc.text('Table of Contents', margin, margin + 6, { width })
    doc.rect(margin, doc.y + 4, 64, 2.6).fill(colors.accent)
    let y = doc.y + 24

    let pages = 1
    for (const e of entries) {
      if (y + entryH > margin + usable) {
        doc.addPage()
        pages++
        opts.stamp(doc.bufferedPageRange().count)
        y = margin + 8
      }
      const isPart = e.level === 'part'
      const isSub = e.level === 'section' || e.level === 'subsection'
      const indent = isPart ? 0 : isSub ? 32 : 16
      const label = e.number ? (isPart ? `Part ${e.number} — ${e.title}` : isSub ? `${e.number}  ${e.title}` : `${e.number}.  ${e.title}`) : e.title
      const printedPage = e.page + opts.offset + 1 // body-relative → absolute (1-based)
      doc.font(headingFont).fontSize(isPart ? 11.5 : 10).fillColor(isPart ? colors.primary : colors.fg)
      const labelW = doc.widthOfString(label)
      const pageLabelW = doc.widthOfString(String(printedPage))
      const dotsStart = margin + indent + labelW + 6
      const dotsEnd = margin + width - pageLabelW - 8
      doc.text(label, margin + indent, y, { width: width - indent - 40, lineBreak: false, ellipsis: true })
      doc.font(bodyFont).fontSize(9).fillColor(colors.mutedFg)
      if (dotsEnd > dotsStart) {
        const dot = ' .'
        const dotW = doc.widthOfString(dot)
        let dx = dotsStart
        while (dx + dotW < dotsEnd) {
          doc.text(dot, dx, y + 1.5, { lineBreak: false })
          dx += dotW
        }
      }
      doc.font(bodyFont).fontSize(10).fillColor(colors.fg)
      doc.text(String(printedPage), margin + width - pageLabelW, y, { lineBreak: false, align: 'right' })
      y += entryH
    }
    return pages
  }

  // ==================== SECTION HEADINGS (ornaments) ====================

  private drawSectionHeading(
    doc: any,
    text: string,
    o: { isPart: boolean; isSub: boolean; theme: DerivedTheme; y: number; margin: number; width: number; headingFont: string; colors: { primary: string; accent: string; fg: string } }
  ): number {
    const { y, margin, width, headingFont, colors, theme } = o
    let cy = y
    const size = o.isPart ? 24 : o.isSub ? 13.5 : 18
    switch (theme.ornament) {
      case 'band': {
        if (o.isPart) {
          const h = size + 26
          doc.rect(margin, cy, width, h).fill(colors.primary)
          doc.font(headingFont).fontSize(size).fillColor('#FFFFFF')
          doc.text(text, margin + 14, cy + 12, { width: width - 28, lineBreak: false, ellipsis: true })
          return cy + h + 20
        }
        const h = size + 16
        doc.rect(margin, cy, width, h).fill(tint(colors.primary, 0.92))
        doc.rect(margin, cy, 4, h).fill(colors.primary)
        doc.font(headingFont).fontSize(size).fillColor(colors.primary)
        doc.text(text, margin + 14, cy + 8, { width: width - 28, lineBreak: false, ellipsis: true })
        return cy + h + 16
      }
      case 'left-bar': {
        doc.rect(margin, cy + 2, 3.5, size + 8).fill(colors.accent)
        doc.font(headingFont).fontSize(size).fillColor(colors.primary)
        doc.text(text, margin + 14, cy, { width: width - 14 })
        return doc.y + (o.isPart ? 14 : 10)
      }
      case 'kicker': {
        doc.font(headingFont).fontSize(8).fillColor(colors.accent)
        doc.text((o.isPart ? 'PART' : 'SECTION').toUpperCase(), margin, cy, { width, characterSpacing: 2.5 })
        doc.font(headingFont).fontSize(size).fillColor(colors.fg)
        doc.text(text, margin, cy + 14, { width })
        return doc.y + (o.isPart ? 12 : 8)
      }
      case 'underline': {
        doc.font(headingFont).fontSize(size).fillColor(colors.primary)
        doc.text(text, margin, cy, { width })
        doc.rect(margin, doc.y + 3, o.isPart ? width : Math.min(width, 160), o.isPart ? 2 : 1.4).fill(colors.primary)
        return doc.y + (o.isPart ? 18 : 12)
      }
      case 'none': {
        doc.font(headingFont).fontSize(size).fillColor(colors.primary)
        doc.text(text, margin, cy, { width })
        return doc.y + (o.isPart ? 14 : 10)
      }
      case 'rule':
      default: {
        doc.font(headingFont).fontSize(size).fillColor(colors.primary)
        doc.text(text, margin, cy, { width })
        doc.rect(margin, doc.y + 4, o.isPart ? width : 64, o.isPart ? 2.2 : 2).fill(colors.accent)
        return doc.y + (o.isPart ? 18 : 14)
      }
    }
  }

  // ==================== COMPONENTS ====================

  private async renderComponent(
    doc: any,
    component: CanonicalComponent,
    opts: {
      theme: DerivedTheme
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
      subFontScale?: number
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
        doc.font(headingFont).fontSize(13.5).fillColor(primary)
        doc.text(text, margin, y, { width })
        return doc.y + 12
      }

      case 'paragraph': {
        const text = asString(component.content)
        if (!text) return y
        doc.font(bodyFont).fontSize(10.5).fillColor(fg)
        const height = doc.heightOfString(text, { width, lineGap: 3 })
        // A paragraph taller than one page: flow it with pdfkit's own
        // pagination instead of ensureSpace (which would loop forever).
        if (height > opts.contentBottom - margin - 8) {
          doc.text(text, margin, y, { width, align: 'justify', lineGap: 3 })
          return doc.y + 10
        }
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
          if (!item) continue
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
        return this.drawTable(doc, rows, { y, ensureSpace, contentBottom: opts.contentBottom, margin, width, bodyFont, headingFont, theme, colors: { fg, primary, accent, mutedFg, borderCol } })
      }

      case 'equation': {
        const image = await renderComponentImage(component, theme)
        if (image) {
          const eqScale = Math.min(1, (width * 0.8) / image.width)
          const w = image.width * eqScale
          const h = image.height * eqScale
          y = ensureSpace(y, h + 16)
          doc.image(image.png, margin + (width - w) / 2, y, { width: w, height: h })
          return y + h + 14
        }
        const latexRaw = equationLatexOf(component.content)
        if (!latexRaw) return y
        doc.font('Courier').fontSize(10).fillColor(fg)
        const h2 = doc.heightOfString(latexRaw, { width: width - 24 })
        y = ensureSpace(y, h2 + 16)
        doc.rect(margin, y, width, h2 + 12).fillAndStroke('#F8FAFC', borderCol)
        doc.fillColor(fg).text(latexRaw, margin + 12, y + 6, { width: width - 24 })
        return y + h2 + 16
      }

      case 'chart':
      case 'timeline':
      case 'diagram': {
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
          this.figureNo += 1
          doc.font(bodyFont).fontSize(8.5).fillColor(mutedFg)
          doc.text(`Figure ${this.figureNo} — ${image.caption}`, margin, y + h + 4, { width, align: 'center' })
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

  // ==================== THEMED TABLE ====================

  private drawTable(
    doc: any,
    rows: Array<Array<string | number | null>>,
    o: {
      y: number
      ensureSpace: (currentY: number, needed: number) => number
      contentBottom: number
      margin: number
      width: number
      bodyFont: string
      headingFont: string
      theme: DerivedTheme
      colors: { fg: string; primary: string; accent: string; mutedFg: string; borderCol: string }
    }
  ): number {
    const { margin, width, bodyFont, headingFont, theme, colors } = o
    let y = o.y
    const [header, ...data] = rows
    const cols = Math.max(header.length, 1)

    const rawW = header.map((_h: unknown, i: number) => {
      let maxLen = String(header[i] ?? '').length
      for (const row of data) maxLen = Math.max(maxLen, String(row[i] ?? '').length)
      return Math.min(maxLen, 28)
    })
    const totalRaw = rawW.reduce((s: number, v: number) => s + v, 0) || 1
    const minColW = Math.min(52, width / cols)
    const colWidths = rawW.map((w: number) => Math.max(minColW, (w / totalRaw) * width))
    const scaleW = width / colWidths.reduce((s: number, v: number) => s + v, 0)
    for (let i = 0; i < colWidths.length; i++) colWidths[i] *= scaleW

    const drawHeaderBand = (bandY: number) => {
      switch (theme.table) {
        case 'minimal':
        case 'editorial': {
          doc.font(headingFont).fontSize(9).fillColor(colors.primary)
          let hx = margin
          header.forEach((cell: unknown, i: number) => {
            doc.text(String(cell ?? ''), hx + 5, bandY + 6, { width: colWidths[i] - 10, lineBreak: false, ellipsis: true })
            hx += colWidths[i]
          })
          const ruleW = theme.table === 'editorial' ? width : Math.min(width, 99999)
          doc.rect(margin, bandY + 20, ruleW, theme.table === 'editorial' ? 2 : 1.2).fill(colors.primary)
          if (theme.table === 'editorial') doc.rect(margin, bandY, width, 1).fill(colors.primary)
          doc.font(bodyFont).fontSize(9)
          return bandY + 28
        }
        case 'dark-header': {
          doc.rect(margin, bandY, width, 24).fill(colors.fg)
          doc.font(headingFont).fontSize(9).fillColor('#FFFFFF')
          let hx = margin
          header.forEach((cell: unknown, i: number) => {
            doc.text(String(cell ?? ''), hx + 5, bandY + 8, { width: colWidths[i] - 10, lineBreak: false, ellipsis: true })
            hx += colWidths[i]
          })
          doc.font(bodyFont).fontSize(9)
          return bandY + 24
        }
        case 'boxed':
        case 'banded':
        default: {
          doc.rect(margin, bandY, width, 24).fill(colors.primary)
          doc.font(headingFont).fontSize(9).fillColor('#FFFFFF')
          let hx = margin
          header.forEach((cell: unknown, i: number) => {
            doc.text(String(cell ?? ''), hx + 5, bandY + 8, { width: colWidths[i] - 10, lineBreak: false, ellipsis: true })
            hx += colWidths[i]
          })
          doc.font(bodyFont).fontSize(9)
          return bandY + 24
        }
      }
    }

    y = o.ensureSpace(y, 30 + 24)
    let ry = drawHeaderBand(y)

    const colXs: number[] = [margin]
    for (let i = 0; i < colWidths.length - 1; i++) colXs.push(colXs[i] + colWidths[i])

    const matrix = rows as CellMatrix
    const cellText = (cell: string | number | null): string => {
      if (typeof cell === 'string' && /^=/.test(cell.trim())) {
        const computed = evaluateFormula(cell.trim(), matrix)
        return computed !== null ? formatNumberForPdf(computed) : cell.trim()
      }
      return String(cell ?? '')
    }

    doc.font(bodyFont).fontSize(9)
    data.forEach((row: Array<string | number | null>, rIdx: number) => {
      const rowH = Math.max(
        20,
        ...row.map((cell: string | number | null, i: number) => doc.heightOfString(cellText(cell), { width: colWidths[i] - 12, lineGap: 1 }) + 10)
      )
      if (ry + rowH > o.contentBottom) {
        y = o.ensureSpace(ry, rowH + 24 + 24)
        ry = drawHeaderBand(y)
      }
      // row backgrounds
      if (theme.table === 'banded' && rIdx % 2 === 1) doc.rect(margin, ry, width, rowH).fill(tint(colors.primary, 0.96))
      if (theme.table === 'dark-header' && rIdx % 2 === 1) doc.rect(margin, ry, width, rowH).fill(tint('#64748B', 0.85))
      if (theme.table === 'editorial' && rIdx % 2 === 1) doc.rect(margin, ry, width, rowH).fill(tint(colors.primary, 0.95))
      // borders
      if (theme.table === 'boxed') doc.rect(margin, ry, width, rowH).stroke(colors.borderCol)
      else {
        doc.rect(margin, ry, width, rowH).lineWidth(0.4).stroke(colors.borderCol)
      }
      row.forEach((cell: string | number | null, i: number) => {
        doc.fillColor(colors.fg).text(cellText(cell), colXs[i] + 6, ry + 5, { width: colWidths[i] - 12, lineGap: 1 })
      })
      ry += rowH
    })
    return ry + 16
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

/** Compact, locale-stable number rendering for computed table cells. */
function formatNumberForPdf(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-US')
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
