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
  asCodeBlock,
  asMetrics,
  asString,
  asStringArray,
  asTable,
  asTwoColumn,
  deriveTheme,
  equationLatexOf,
  isDarkColor,
  renderComponentImage,
  tint,
  withHash,
  type DerivedTheme,
} from './shared'
import { evaluateFormula } from '@/services/formula-evaluator'
import type { CellMatrix } from '@/services/formula-evaluator'
import { resolvePdfFonts } from '@/services/typography/fonts'
import { parseInlineMarkdown } from '@/services/typography/inline'
import { highlightCode, type CodeToken } from '@/services/typography/code'
import { existsSync, readFileSync } from 'node:fs'

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
 * FONT RESOLUTION moved to services/typography/fonts.ts — the bundled,
 * glyph-coverage-aware registry. The old implementation scanned absolute
 * /usr/share/fonts paths and silently fell back to Helvetica (Latin-1 only)
 * whenever they were missing — arrows, Greek, math symbols and CJK became
 * missing glyphs. Filo now ships its fonts and verifies the ENTIRE document
 * charset against the embedded font's cmap before using it.
 */
const SERIF_BODY_FONTS = /georgia|times|palatino|garamond|book|serif|cambria|minion/i

function isRealFontFile(p: string): boolean {
  try {
    const fd = readFileSync(p)
    if (fd.length < 8) return false
    const sig = fd.subarray(0, 4).toString('latin1')
    return sig === '\u0000\u0001\u0000\u0000' || sig === 'OTTO' || sig === 'ttcf' || sig === 'wOFF'
  } catch {
    return false
  }
}

function toFontPair(pair: { regular: string; bold: string; family: string } | null): FontPair | null {
  return pair ? { regular: pair.regular, bold: pair.bold } : null
}

/**
 * Resolve fonts for pdfkit embedding:
 *   1. FILO_PDF_FONT_PATH env override (deployment escape hatch)
 *   2. CJK detection → best available CJK font (env/host)
 *   3. theme metric twin (Liberation Serif / Carlito — BUNDLED) when its
 *      cmap covers the document charset
 *   4. DejaVu floor (BUNDLED) for full Latin/Greek/Cyrillic/arrows/math
 *   5. null → caller falls back to base-14 (QA-warning surfaced)
 */
function resolveDocumentFonts(themeBodyFont: string, sampleText: string): { pair: FontPair | null; mono: FontPair | null; reason: string; coverageFallback: boolean } {
  const env = process.env.FILO_PDF_FONT_PATH
  if (env && isRealFontFile(env)) {
    const boldCandidate = env.replace(/\.ttf$/i, '-Bold.ttf')
    const pair = { regular: env, bold: isRealFontFile(boldCandidate) ? boldCandidate : env }
    return { pair, mono: toFontPair(resolvePdfFonts(themeBodyFont, sampleText).mono), reason: 'FILO_PDF_FONT_PATH override', coverageFallback: false }
  }
  const resolved = resolvePdfFonts(themeBodyFont, sampleText)
  return { pair: toFontPair(resolved.body), mono: toFontPair(resolved.mono), reason: resolved.reason, coverageFallback: resolved.coverageFallback }
}

/** Parse '72pt' / '1in' / '96px' into PDF points. */
function parseMarginPt(v: string | undefined, fallback: number): number {
  const m = /([\d.]+)\s*(pt|in|px)?/.exec(String(v ?? ''))
  if (!m) return fallback
  const n = Number(m[1])
  if (m[2] === 'in') return Math.round(n * 72)
  if (m[2] === 'px') return Math.round(n * 0.75)
  return Math.round(n)
}

/**
 * Current 1-based page number of a pdfkit document. `bufferedPageRange()`
 * returns {start, count} where COUNT RESETS as completed pages flush to the
 * stream — reading `.count` alone made every page look like page 1 and every
 * TOC entry print the same number. The true page number is start + count.
 */
function currentPageNo(doc: any): number {
  const r = doc.bufferedPageRange()
  return (r.start ?? 0) + (r.count ?? 0)
}

/**
 * Inline-markdown-aware text drawing for pdfkit. Plain text takes the fast
 * path; styled prose renders as continued runs (bold/italic/code/link) with
 * per-segment fonts/colors. Height measurement uses the plain text — styling
 * never changes font size, so metrics stay within a line's tolerance.
 */
function hasInlineStyling(text: string): boolean {
  return /\*\*|__|~~|`|\[[^\]]+\]\(https?:|(?<![\w*])\*(?![\s*])/.test(text)
}

function drawStyledText(
  doc: any,
  text: string,
  x: number,
  yPos: number,
  opts: { width: number; align?: 'left' | 'justify' | 'center'; lineGap?: number; bodyFont: string; monoFont?: string; baseColor: string; size?: number }
): number {
  if (!hasInlineStyling(text)) {
    doc.text(text, x, yPos, { width: opts.width, align: opts.align, lineGap: opts.lineGap })
    return doc.y
  }
  const segments = parseInlineMarkdown(text)
  const mono = opts.monoFont
  let first = true
  for (const seg of segments) {
    const runOpts: Record<string, unknown> = {
      width: opts.width,
      align: opts.align,
      lineGap: opts.lineGap,
      continued: first ? undefined : true,
    }
    if (first) runOpts.x = x
    if (first && yPos !== undefined) runOpts.y = yPos
    if (seg.style === 'code' && mono) {
      doc.font(mono).fontSize(Math.max((opts.size ?? 10.5) - 0.5, 7)).fillColor('#0F172A')
    } else if (seg.style === 'bold') {
      const boldName = opts.bodyFont === 'FiloBody' ? 'FiloBodyBold' : `${opts.bodyFont}-Bold`
      doc.font(boldName).fontSize(opts.size).fillColor(opts.baseColor)
    } else if (seg.style === 'link') {
      doc.font(opts.bodyFont).fontSize(opts.size).fillColor('#2563EB')
    } else {
      doc.font(opts.bodyFont).fontSize(opts.size).fillColor(opts.baseColor)
    }
    doc.text(seg.text, runOpts)
    first = false
  }
  return doc.y
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
    // MARGINS FROM THE THEME (was hardcoded 56 — visibly tighter than the
    // DOCX twin and cramped against the footer).
    const margin = Math.min(96, Math.max(48, parseMarginPt(layout?.margins?.left, 72)))
    const bottomMargin = Math.min(96, Math.max(40, parseMarginPt(layout?.margins?.bottom, 64)))
    const contentBottom = pageH - bottomMargin - 14 // keep clear of the footer zone

    const sections = spec.sections
    const coverSection = sections[0]?.type === 'cover' ? sections[0] : null
    const hasCover = Boolean(coverSection) || sections.length >= 3
    const contentSections = coverSection ? sections.slice(1) : sections
    const hasParts = contentSections.some((s) => (s.level || 'chapter') === 'part')

    // Sample text drives CJK font detection + glyph-coverage checks + body
    // size / line height tokens. Coverage runs over the FULL document text —
    // every string component, every table cell, every label — so the embedded
    // font provably contains a glyph for every character that will be drawn.
    const sampleParts: string[] = [spec.title, spec.description ?? '']
    for (const s of document.sections) {
      sampleParts.push(s.title)
      for (const c of s.components) {
        if (typeof c.content === 'string') sampleParts.push(c.content)
        else if (Array.isArray(c.content)) {
          for (const row of c.content) {
            if (Array.isArray(row)) sampleParts.push(row.map(String).join(' '))
            else sampleParts.push(String(row))
          }
        } else if (c.content && typeof c.content === 'object') {
          sampleParts.push(JSON.stringify(c.content))
        }
      }
    }
    const sampleText = sampleParts.join('\n').slice(0, 400_000)
    const bodyFontSize = Math.min(12, Math.max(9.5, theme.typography?.bodySize ? theme.typography.bodySize - 0.5 : 10.5))
    const bodyLineGap = Math.max(2, Math.round((theme.typography?.lineHeight ?? 1.45) * bodyFontSize - bodyFontSize - 1))

    // ---------------- PASS 1: layout probe ----------------
    // Render the body into a throwaway document to learn where every section
    // lands and how many pages the body needs. Deterministic because pass 2
    // repeats the identical layout from an identical starting state.
    const probe = new pdfkit({
      size: sizeKey === 'LEGAL' ? 'LEGAL' : sizeKey === 'LETTER' ? 'LETTER' : 'A4',
      margins: { top: margin, bottom: bottomMargin, left: margin, right: margin },
      info: { Title: spec.title, Producer: 'Filo' },
      autoFirstPage: false,
    })
    probe.addPage()
    const probeChunks: Buffer[] = []
    probe.on('data', (c: Buffer) => probeChunks.push(c))
    const probeDone = new Promise<Buffer>((resolve) => {
      probe.on('end', () => resolve(Buffer.concat(probeChunks)))
      probe.on('error', () => resolve(Buffer.concat(probeChunks)))
    })
    const sectionStartPages: number[] = []
    let bodyPagesTotal = 0
    const registerFonts = (doc: any): { bodyFont: string; headingFont: string; monoFont: string | null } => {
      let bodyFont = 'Helvetica'
      let headingFont = 'Helvetica-Bold'
      let monoFont: string | null = null
      const { pair, mono } = resolveDocumentFonts(theme.typography?.bodyFont || '', sampleText)
      try {
        if (pair) {
          doc.registerFont('FiloBody', pair.regular)
          doc.registerFont('FiloBodyBold', pair.bold)
          doc.registerFont('FiloHeading', pair.bold)
          bodyFont = 'FiloBody'
          headingFont = 'FiloHeading'
        }
        if (mono) {
          doc.registerFont('FiloMono', mono.regular)
          doc.registerFont('FiloMonoBold', mono.bold)
          monoFont = 'FiloMono'
        }
      } catch {
        // fall back to base-14
      }
      return { bodyFont, headingFont, monoFont }
    }
    {
      const { bodyFont, headingFont } = registerFonts(probe)
      await this.renderBody(probe, document, contentSections, {
        theme,
        pageW,
        pageH,
        margin,
        contentBottom,
        bodyFont,
        headingFont,
        bodyFontSize,
        bodyLineGap,
        recordSectionPage: (idx: number) => sectionStartPages.push(idx),
      })
      bodyPagesTotal = currentPageNo(probe)
      probe.end()
      await probeDone
    }
    void hasParts

    // ---------------- TOC ENTRY LIST ----------------
    // sectionStartPages[i] is the body-relative page (1-based) where section i
    // starts — recorded AFTER the pagination decision in renderBody, so the
    // numbers are exact. NO shift() here: the cover was already sliced off,
    // and the old shift() deleted the FIRST REAL CHAPTER from the TOC.
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

    const { bodyFont, headingFont, monoFont } = registerFonts(doc)
    const fg = withHash(colors.foreground, '#1F2937')
    const primary = withHash(colors.primary, '#1E3A5F')
    const accent = withHash(colors.accent, '#3B82F6')
    const mutedFg = withHash(colors.mutedForeground, '#64748B')
    const borderCol = withHash(colors.border, '#E2E8F0')
    const themeColors: PdfThemeColors = { fg, primary, accent, mutedFg, borderCol }

    // ---- running header/footer (UNIFIED stamping) ----
    // Every page AFTER the cover is stamped exactly once via the pageAdded
    // handler + explicit stamping of the first front-matter page. The old
    // code double-stamped the last page and never stamped the first body
    // page (registered the handler too late).
    let coverPages = 0
    let tocPages = 0
    const stampHeaderFooter = (pageNo: number) => {
      // The footer draws BELOW the content area (pageH - 36 < maxY). Without
      // this guard, pdfkit auto-paginates DURING stamping → pageAdded fires
      // again → stamp again → infinite recursion (RangeError: Maximum call
      // stack size exceeded). Zeroing the page's bottom margin for the
      // duration of the stamp makes maxY the page edge — no auto-pagination.
      const savedBottom = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      try {
        // Total-page estimate is computed LAZILY (bodyPagesTotal is known by
        // the time any page is stamped) and includes cover + TOC pages.
        const totalPagesEstimate = coverPages + tocPages + Math.max(bodyPagesTotal, 1)
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
            doc.text(label, margin, pageH - 36, { width: pageW - margin * 2, align: 'left', lineBreak: false })
            doc.text(`${pageNo}`, margin, pageH - 36, { width: pageW - margin * 2, align: 'right', lineBreak: false })
          } else {
            doc.text(label, margin, pageH - 36, { width: pageW - margin * 2, align: 'center', lineBreak: false })
          }
        }
      } finally {
        doc.page.margins.bottom = savedBottom
      }
    }
    // pageAdded fires for every addPage from here on (TOC continuations +
    // body pages); save/restore flow state so stamping never corrupts an
    // in-flight paragraph.
    doc.on('pageAdded', () => {
      const savedY = doc.y
      const savedX = doc.x
      stampHeaderFooter(currentPageNo(doc))
      doc.y = savedY
      doc.x = savedX
    })

    // ---- cover (drawn first; cover itself is NEVER stamped) ----
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
    // drawCover ended with addPage → the current page is fresh front matter.
    // If there is NO TOC the body starts right here — stamp it explicitly,
    // because no addPage will fire before the first body content.
    const needToc = tocEntries.length >= 3
    if (needToc) {
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
      // Stamp the first TOC page (it exists already — no pageAdded fired).
      stampHeaderFooter(coverPages + 1)
      this.drawToc(doc, tocEntries, {
        pageW,
        pageH,
        margin,
        bodyFont,
        headingFont,
        colors: themeColors,
        // printed page = body page + cover + toc pages (absolute, 1-based)
        offset: coverPages + tocPages,
      })
    } else if (coverPages > 0) {
      stampHeaderFooter(coverPages + 1)
    }
    const pageOffset = coverPages + tocPages
    void pageOffset

    this.figureNo = 0
    // The body MUST start on a fresh page after the TOC (drawToc consumed the
    // current page). Without a TOC the current page is already fresh — adding
    // another one used to ship a BLANK PAGE 2.
    if (tocPages > 0) doc.addPage()
    await this.renderBody(doc, document, contentSections, {
      theme,
      pageW,
      pageH,
      margin,
      contentBottom,
      bodyFont,
      headingFont,
      bodyFontSize,
      bodyLineGap,
      monoFont,
      recordSectionPage: () => {},
      pageOffset,
    })
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
      bodyFontSize: number
      bodyLineGap: number
      monoFont?: string | null
      /** Called with the 1-based BODY page each section starts on. */
      recordSectionPage: (pageNo: number) => void
      pageOffset?: number
    }
  ): Promise<void> {
    const { theme, margin, contentBottom, bodyFont, headingFont, bodyFontSize, bodyLineGap } = opts
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

    for (let i = 0; i < contentSections.length; i++) {
      const section = contentSections[i]
      const components = (document.sections.find((s) => s.id === section.id)?.components ?? [])
        .slice()
        .sort((a: CanonicalComponent, b: CanonicalComponent) => a.order - b.order)
      const level = String(section.level || 'chapter').toLowerCase()
      const num = section.number as string | undefined
      const isPart = level === 'part'
      const isSub = level === 'section' || level === 'subsection'

      // Pagination FIRST, then record the page the section actually starts
      // on. Recording before addPage used to make every page-broken chapter
      // report page N−1 and the TOC print wrong numbers.
      if (renderedIdx > 0 && !isSub) {
        doc.addPage()
        cursorY = margin + 8
      } else if (renderedIdx > 0) {
        cursorY += 18
      }
      opts.recordSectionPage(currentPageNo(doc))

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
          bodyFontSize,
          bodyLineGap,
          monoFont: opts.monoFont ?? null,
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
    opts: { pageW: number; pageH: number; margin: number; bodyFont: string; headingFont: string; colors: PdfThemeColors; offset: number }
  ): number {
    const { pageW, pageH, margin, bodyFont, headingFont, colors } = opts
    const width = pageW - margin * 2
    const usable = pageH - margin - 60
    const entryH = 19

    doc.font(headingFont).fontSize(21).fillColor(colors.primary)
    doc.text('Table of Contents', margin, margin + 6, { width })
    doc.rect(margin, doc.y + 4, 64, 2.6).fill(colors.accent)
    let y = doc.y + 24

    let pages = 1
    for (const e of entries) {
      if (y + entryH > margin + usable) {
        doc.addPage()
        pages++
        y = margin + 8
      }
      const isPart = e.level === 'part'
      const isSub = e.level === 'section' || e.level === 'subsection'
      const indent = isPart ? 0 : isSub ? 32 : 16
      const label = e.number ? (isPart ? `Part ${e.number} — ${e.title}` : isSub ? `${e.number}  ${e.title}` : `${e.number}.  ${e.title}`) : e.title
      // body-relative page + cover/TOC offset = absolute 1-based page. The
      // stray "+1" that shifted every printed number is GONE.
      const printedPage = e.page + opts.offset
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
      bodyFontSize: number
      bodyLineGap: number
      monoFont?: string | null
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
    const { theme, ensureSpace, ctx, bodyFontSize, bodyLineGap } = opts
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
        doc.font(bodyFont).fontSize(bodyFontSize).fillColor(fg)
        const height = doc.heightOfString(text, { width, lineGap: bodyLineGap })
        // A paragraph taller than one page: flow it with pdfkit's own
        // pagination instead of ensureSpace (which would loop forever).
        if (height > opts.contentBottom - margin - 8) {
          drawStyledText(doc, text, margin, y, { width, align: 'justify', lineGap: bodyLineGap, bodyFont, monoFont: opts.monoFont || undefined, baseColor: fg, size: bodyFontSize })
          return doc.y + 10
        }
        y = ensureSpace(y, height + 10)
        drawStyledText(doc, text, margin, y, { width, align: 'justify', lineGap: bodyLineGap, bodyFont, monoFont: opts.monoFont || undefined, baseColor: fg, size: bodyFontSize })
        return doc.y + 10
      }

      case 'list':
      case 'key_takeaways': {
        const items = asStringArray(component.content)
        if (items.length === 0) return y
        doc.font(bodyFont).fontSize(bodyFontSize).fillColor(fg)
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
          // Card fill derives from the THEME (hardcoded #FAFBFC ignored the
          // palette entirely on warm/editorial themes).
          doc.rect(x, y, cardW, cardH).fillAndStroke(tint(primary, 0.965), borderCol)
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

      case 'code': {
        // FIRST-CLASS CODE BLOCK: theme-shaded monospace panel with a language
        // label and an accent rule — the PDF twin of the DOCX code block.
        // Line-by-line layout (measure → paginate → draw) so the panel splits
        // cleanly across pages with no trapped paragraphs.
        const block = asCodeBlock(component.content)
        if (!block) return y
        const mono = opts.monoFont || 'Courier'
        const monoLabel = opts.monoFont ? 'FiloMonoBold' : 'Courier-Bold'
        // Bundled Shiki token stream — colors render in the PDF text layer.
        const tokenLines = await highlightCode(block.code, block.language).catch(() => null)
        const allLines: Array<Array<{ text: string; color: string }>> =
          tokenLines && tokenLines.length > 0
            ? tokenLines
            : block.code.split('\n').map((l) => [{ text: l, color: fg.replace('#', '').toUpperCase() }])
        const lines = allLines.slice(0, 400)
        const truncated = allLines.length - lines.length
        const fontSize = 8.5
        const lineGap = 2.5
        const padX = 14
        const padY = 9
        const textW = width - padX * 2 - 4
        doc.font(mono).fontSize(fontSize)
        // Measure every source line's wrapped height ONCE (heightOfString
        // draws nothing — safe for measurement).
        const lineHeights = lines.map((line) => {
          const raw = Array.isArray(line) ? line.map((t) => t.text).join('') : String(line)
          return raw.length ? doc.heightOfString(raw, { width: textW, lineGap }) : fontSize
        })
        const labelH = block.language ? 16 : 0

        let idx = 0
        let panelY = y
        let firstSegment = true
        while (idx < lines.length) {
          const top = firstSegment ? panelY : margin
          const avail = opts.contentBottom - top - padY * 2 - (firstSegment ? labelH : 0)
          // Fit as many whole lines as possible on this segment.
          let take = 0
          let used = 0
          while (idx + take < lines.length && used + lineHeights[idx + take] <= avail) {
            used += lineHeights[idx + take]
            take++
          }
          if (take === 0) take = 1 // single oversized line still progresses
          if (!firstSegment) {
            doc.addPage()
            panelY = margin
          }
          const segH = used + padY * 2 + (firstSegment ? labelH : 0)
          doc.rect(margin, panelY, width, segH).fill(tint(primary, 0.96))
          doc.rect(margin, panelY, 3.5, segH).fill(accent)
          doc.rect(margin, panelY, width, 0.8).fill(borderCol)
          doc.rect(margin, panelY + segH - 0.8, width, 0.8).fill(borderCol)
          let ty = panelY + padY
          if (firstSegment && block.language) {
            doc.font(monoLabel).fontSize(7).fillColor(mutedFg)
            doc.text(block.language.toUpperCase(), margin + padX, ty, { width: textW, lineBreak: false })
            ty += labelH
          }
          doc.font(mono).fontSize(fontSize)
          for (let k = 0; k < take; k++) {
            const toks = lines[idx + k]
            if (toks.length && toks.some((t) => t.text.length)) {
              let firstTok = true
              for (const tok of toks) {
                if (!tok.text) continue
                doc.fillColor(`#${tok.color}`)
                doc.text(tok.text, margin + padX + 2, ty, {
                  width: textW,
                  lineGap,
                  lineBreak: false,
                  ...(firstTok ? {} : { continued: true }),
                })
                firstTok = false
              }
              // Close the continued run so the next line starts fresh.
              doc.text('', { continued: false })
            } else {
              doc.fillColor(fg)
              doc.text(' ', margin + padX + 2, ty, { width: textW, lineGap })
            }
            ty += lineHeights[idx + k]
          }
          idx += take
          panelY = panelY + segH + 2
          firstSegment = false
        }
        if (truncated > 0) {
          doc.font(mono).fontSize(7.5).fillColor(mutedFg)
          doc.text(`… ${truncated} more lines truncated`, margin + padX, panelY + 2, { width: width - padX * 2 })
          panelY = doc.y + 4
        }
        return panelY + 12
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
        // Honest fallback: string content renders as prose; object content
        // from unknown component types renders as a labeled muted block —
        // never a raw JSON dump, never a silent drop.
        const text = asString(component.content)
        if (text) {
          doc.font(bodyFont).fontSize(10.5).fillColor(fg)
          doc.text(text, margin, y, { width, lineGap: 3 })
          return doc.y + 10
        }
        const serialized = component.content && typeof component.content === 'object' ? JSON.stringify(component.content) : ''
        if (!serialized || serialized === 'null' || serialized === '{}' || serialized === '[]') return y
        y = ensureSpace(y, 44)
        doc.font(bodyFont).fontSize(8.5).fillColor(mutedFg)
        doc.text(`[Unsupported component: ${component.type}]`, margin, y, { width })
        doc.font(bodyFont).fontSize(8).fillColor(mutedFg)
        doc.text(serialized.slice(0, 800), margin, doc.y + 2, { width })
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
          // Luminance guard (missing here while DOCX had one): a light
          // 'dark-header' fill with white text rendered an INVISIBLE header.
          const fill = isDarkColor(colors.fg) ? colors.fg : isDarkColor(colors.primary) ? colors.primary : '#334155'
          doc.rect(margin, bandY, width, 24).fill(fill)
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
      // row backgrounds — banding keyed off the theme PRIMARY, not a
      // hardcoded gray (tinting '#64748B' ignored every palette).
      if (theme.table === 'banded' && rIdx % 2 === 1) doc.rect(margin, ry, width, rowH).fill(tint(colors.primary, 0.96))
      if (theme.table === 'dark-header' && rIdx % 2 === 1) doc.rect(margin, ry, width, rowH).fill(tint(colors.primary, 0.94))
      if (theme.table === 'editorial' && rIdx % 2 === 1) doc.rect(margin, ry, width, rowH).fill(tint(colors.primary, 0.95))
      // borders: boxed = full cell rectangles; every other dialect draws
      // ONLY the horizontal rule under the row (the old code stroked a full
      // rect around every row, defeating the dialect).
      if (theme.table === 'boxed') {
        doc.rect(margin, ry, width, rowH).lineWidth(0.6).stroke(colors.borderCol)
      } else {
        doc.save()
        doc.moveTo(margin, ry + rowH).lineTo(margin + width, ry + rowH).lineWidth(0.5).strokeColor(colors.borderCol).stroke()
        doc.restore()
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
