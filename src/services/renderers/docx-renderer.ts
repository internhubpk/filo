// =============================================================================
// DOCX RENDERER (spec §12) — native, editable Word output via the `docx` package
// =============================================================================
// v2 — THEME-DIALECT RENDERING. Every theme now renders as a visibly different
// document design, driven by ThemeTokens + design dialects (themes.ts):
//   • 5 cover layouts  (banner | centered | sidebar | minimal | gradient-bar)
//   • 6 heading ornaments (rule | kicker | band | left-bar | underline | none)
//   • 5 table styles   (banded | boxed | minimal | dark-header | editorial)
//   • 4 footer styles  (page | page-of | brand-page | minimal)
// plus document-scale structure:
//   • hierarchical headings — Part (H1) / chapter (H2|H1) / sub-section (H3)
//     with deterministic outline numbers ("2", "2.1", "Part II") from the
//     blueprint
//   • real Word TOC (headingStyleRange 1-3), updateable in Word
//   • page-break policy: parts + chapters start on a fresh page, subsections
//     flow — no more half-empty pages from blanket per-section breaks
//   • metric grids, callouts, quotes, takeaways, two-column, charts + diagrams
//     as crisp PNG with numbered captions, NATIVE OMML equations
// =============================================================================

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TabStopType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  Math as MathElement,
} from 'docx'
import type { ISectionOptions } from 'docx'
import type { RendererOutput, DocumentRenderer } from './shared'
import type { RenderableDocument, CanonicalComponent } from './shared'
import {
  asMetrics,
  asString,
  asStringArray,
  asTable,
  asTwoColumn,
  deriveTheme,
  equationLatexOf,
  hex6,
  isDarkColor,
  latexToOmml,
  renderComponentImage,
  tint,
  type DerivedTheme,
} from './shared'
import type { ColorPalette } from '@/types'
import { evaluateFormula } from '@/services/formula-evaluator'
import type { CellMatrix } from '@/services/formula-evaluator'

const TWIPS_PER_INCH = 1440
type DocxColor = ReturnType<typeof deriveTheme>['colors']

function pageMargins(layout: RenderableDocument['specification']['design']['layout']): { top: number; right: number; bottom: number; left: number } {
  const parse = (v: string | undefined, fallback: number) => {
    const m = /([\d.]+)\s*(pt|px|in)?/.exec(String(v ?? ''))
    if (!m) return fallback
    const n = Number(m[1])
    switch (m[2]) {
      case 'px':
        return Math.round(n * 15)
      case 'in':
        return Math.round(n * TWIPS_PER_INCH)
      default:
        return Math.round(n * 20) // pt → twips
    }
  }
  return {
    top: parse(layout?.margins?.top, 1440),
    right: parse(layout?.margins?.right, 1440),
    bottom: parse(layout?.margins?.bottom, 1440),
    left: parse(layout?.margins?.left, 1440),
  }
}

// ==================== TABLE DIALECTS ====================

interface TableDialect {
  headerFill?: string
  headerColor: string
  /** 'full' = every cell bordered, 'rows' = horizontal rules only, 'none' = no borders */
  borders: 'full' | 'rows' | 'none'
  /** Zebra row tint (hex WITH #), when the style uses banding. */
  zebra?: string
  /** Heavy rule under the header (editorial/academic look). */
  headerRule?: boolean
}

function tableDialectFor(theme: DerivedTheme): TableDialect {
  const c = theme.colors
  switch (theme.table) {
    case 'minimal':
      return { headerColor: hex6(c.primary), borders: 'rows', headerRule: true }
    case 'boxed':
      return { headerFill: hex6(c.primary), headerColor: 'FFFFFF', borders: 'full' }
    case 'dark-header': {
      // Luminance guard: a dark-header fill that is too light for white text
      // would render an invisible header row (dark-canvas themes on paper).
      const fill = isDarkColor(c.foreground) ? c.foreground : isDarkColor(c.primary) ? c.primary : '#334155'
      return { headerFill: hex6(fill), headerColor: 'FFFFFF', borders: 'rows', zebra: tint(c.muted, 0.35) }
    }
    case 'editorial':
      return { headerColor: hex6(c.primary), borders: 'rows', headerRule: true, zebra: tint(c.muted, 0.5) }
    case 'banded':
    default:
      return { headerFill: hex6(c.primary), headerColor: 'FFFFFF', borders: 'rows', zebra: tint(c.primary, 0.94) }
  }
}

export class DocxRenderer implements DocumentRenderer {
  format = 'DOCX' as const

  async render(document: RenderableDocument): Promise<RendererOutput> {
    const spec = document.specification
    const theme = deriveTheme(spec)
    const colors = theme.colors
    const typography = spec.design?.typography
    const headingFont = typography?.headingFont || 'Calibri'
    const bodyFont = typography?.bodyFont || 'Calibri'
    const margins = pageMargins(spec.design?.layout)

    const pageSize = spec.design?.layout?.pageSize?.toUpperCase() === 'LETTER' ? 'LETTER' : 'A4'
    const pageDims = pageSize === 'LETTER' ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 }

    const children: (Paragraph | Table)[] = []

    // ---------------- COVER PAGE (5 theme layouts) ----------------
    const hasCover = spec.sections[0]?.type === 'cover' || spec.sections.length >= 3
    if (hasCover) {
      children.push(...this.coverPage(document, theme, headingFont, bodyFont))
    }

    // ---------------- TABLE OF CONTENTS ----------------
    const contentSectionsForToc = spec.sections[0]?.type === 'cover' ? spec.sections.slice(1) : spec.sections
    const hasParts = contentSectionsForToc.some((s) => (s.level || 'chapter') === 'part')
    if (spec.sections.length >= 4) {
      children.push(
        new Paragraph({
          text: 'Contents',
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 360, after: 240 },
        }),
        new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' }),
        new Paragraph({ children: [new PageBreak()] })
      )
    }

    // ---------------- SECTIONS (hierarchy-aware) ----------------
    const sectionsToRender = spec.sections[0]?.type === 'cover' ? spec.sections.slice(1) : spec.sections
    let figureNo = 0
    let renderedAnything = false

    for (const section of sectionsToRender) {
      const components = (document.sections.find((s) => s.id === section.id)?.components ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
      const level = ((section as { level?: string }).level || 'chapter').toLowerCase()
      const num = (section as { number?: string }).number
      const isPart = level === 'part'
      const isSub = level === 'section' || level === 'subsection'

      // --- heading level mapping: with parts → H1 part / H2 chapter / H3 sub;
      //     without parts → H1 chapter / H2 sub.
      const headingLevel = isPart ? HeadingLevel.HEADING_1 : isSub ? (hasParts ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2) : hasParts ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1

      // --- page-break policy: parts + chapters start fresh; subsections flow.
      const needsBreak = !isSub && renderedAnything
      if (needsBreak) {
        children.push(new Paragraph({ children: [new PageBreak()] }))
      }

      // Heading text with deterministic outline number.
      const headingText = isPart
        ? num ? `Part ${num} — ${section.title}` : section.title
        : isSub
          ? num ? `${num}  ${section.title}` : section.title
          : num ? `${num}.  ${section.title}` : section.title

      children.push(...this.sectionHeading(headingText, headingLevel, isPart, theme, headingFont))

      for (const component of components) {
        const rendered = await this.renderComponent(component, theme, headingFont, bodyFont, {
          figureNo: () => ++figureNo,
          subHeadingLevel: isSub ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2,
          bodyFont,
        })
        children.push(...rendered)
      }

      renderedAnything = true
    }

    // ---------------- HEADERS / FOOTERS (4 theme dialects) ----------------
    const headerFooterEnabled = spec.design?.layout?.headerEnabled !== false
    const companyName = document.branding?.companyName
    const contentWidthTwips = pageDims.width - margins.left - margins.right

    const sectionOptions: ISectionOptions = {
      properties: {
        page: {
          size: pageDims,
          margin: margins,
        },
      },
      headers: headerFooterEnabled
        ? {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  border: theme.ornament === 'rule' || theme.ornament === 'band'
                    ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: hex6(colors.border, 'E2E8F0'), space: 4 } }
                    : undefined,
                  children: [
                    new TextRun({
                      text: companyName || spec.title,
                      italics: theme.ornament !== 'kicker',
                      size: 18,
                      color: hex6(colors.mutedForeground, '64748B'),
                      font: bodyFont,
                    }),
                  ],
                }),
              ],
            }),
          }
        : undefined,
      footers: spec.design?.layout?.footerEnabled !== false
        ? {
            default: new Footer({
              children: [this.footerParagraph(theme, colors, bodyFont, contentWidthTwips)],
            }),
          }
        : undefined,
      children,
    }

    const doc = new Document({
      creator: 'Filo',
      title: spec.title,
      description: spec.description,
      styles: {
        default: {
          document: {
            run: { font: bodyFont, size: 22, color: hex6(colors.foreground, '1F2937') },
          },
          heading1: {
            run: { font: headingFont, size: 34, bold: true, color: hex6(colors.primary, '1E3A5F') },
            paragraph: { spacing: { before: 400, after: 200 } },
          },
          heading2: {
            run: { font: headingFont, size: 27, bold: true, color: hex6(colors.primary, '1E3A5F') },
            paragraph: { spacing: { before: 320, after: 160 } },
          },
          heading3: {
            run: { font: headingFont, size: 23, bold: true, color: hex6(colors.accent, '3B82F6') },
            paragraph: { spacing: { before: 260, after: 130 } },
          },
          heading4: {
            run: { font: headingFont, size: 21, bold: true, color: hex6(colors.foreground, '1F2937') },
            paragraph: { spacing: { before: 220, after: 110 } },
          },
        },
      },
      sections: [sectionOptions],
    })

    const buffer = await Packer.toBuffer(doc)
    return {
      buffer: Buffer.from(buffer),
      filename: `${slugify(spec.title)}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: buffer.length,
    }
  }

  // ---------------- FOOTER DIALECTS ----------------

  private footerParagraph(theme: DerivedTheme, colors: DocxColor, bodyFont: string, contentWidthTwips: number): Paragraph {
    const muted = hex6(colors.mutedForeground, '64748B')
    switch (theme.footer) {
      case 'page-of':
        return new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'Page ', size: 18, color: muted, font: bodyFont }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: muted, font: bodyFont }),
            new TextRun({ text: ' of ', size: 18, color: muted, font: bodyFont }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: muted, font: bodyFont }),
          ],
        })
      case 'brand-page':
        return new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: contentWidthTwips }],
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: hex6(colors.border, 'E2E8F0'), space: 4 } },
          children: [
            new TextRun({ text: theme.tokens.label, size: 16, color: muted, font: bodyFont, smallCaps: true }),
            new TextRun({ text: '\t', size: 18 }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: muted, font: bodyFont }),
          ],
        })
      case 'minimal':
        return new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: [PageNumber.CURRENT], size: 16, color: muted, font: bodyFont })],
        })
      case 'page':
      default:
        return new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: muted, font: bodyFont })],
        })
    }
  }

  // ---------------- SECTION HEADINGS (6 ornaments) ----------------

  private sectionHeading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel], isPart: boolean, theme: DerivedTheme, headingFont: string): (Paragraph | Table)[] {
    const colors = theme.colors
    const accent = hex6(colors.accent, '3B82F6')
    const primary = hex6(colors.primary, '1E3A5F')
    const muted = hex6(colors.mutedForeground, '64748B')

    switch (theme.ornament) {
      case 'band': {
        // Full-width filled band — the heading lives inside a shaded table row.
        if (!isPart) {
          return [
            new Paragraph({
              text,
              heading: level,
              shading: { type: ShadingType.CLEAR, fill: tint(primary, 0.92).slice(1).toUpperCase() },
              spacing: { before: 320, after: 180 },
              border: { left: { style: BorderStyle.SINGLE, size: 24, color: primary, space: 8 } },
            }),
          ]
        }
        return [
          new Paragraph({
            heading: level,
            shading: { type: ShadingType.CLEAR, fill: hex6(primary, '1E3A5F') },
            spacing: { before: 360, after: 220 },
            children: [new TextRun({ text, color: 'FFFFFF' })],
          }),
        ]
      }
      case 'left-bar':
        return [
          new Paragraph({
            text,
            heading: level,
            border: { left: { style: BorderStyle.SINGLE, size: isPart ? 32 : 22, color: accent, space: 10 } },
            spacing: { before: isPart ? 360 : 300, after: isPart ? 200 : 150 },
          }),
        ]
      case 'kicker':
        return [
          new Paragraph({
            children: [
              new TextRun({ text: (isPart ? 'PART' : 'SECTION').toUpperCase(), bold: true, size: 16, color: accent, font: headingFont }),
            ],
            spacing: { before: isPart ? 360 : 260, after: 40 },
          }),
          new Paragraph({
            text,
            heading: level,
            spacing: { after: 140 },
          }),
        ]
      case 'underline':
        return [
          new Paragraph({
            text,
            heading: level,
            border: { bottom: { style: BorderStyle.SINGLE, size: isPart ? 14 : 8, color: primary, space: 6 } },
            spacing: { before: isPart ? 380 : 300, after: isPart ? 220 : 160 },
          }),
        ]
      case 'none':
        return [
          new Paragraph({
            text,
            heading: level,
            spacing: { before: isPart ? 400 : 300, after: isPart ? 220 : 150 },
          }),
        ]
      case 'rule':
      default:
        return [
          new Paragraph({
            text,
            heading: level,
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: isPart ? 12 : 6,
                color: isPart ? primary : accent,
                space: 4,
              },
            },
            spacing: { before: isPart ? 400 : 320, after: isPart ? 220 : 160 },
          }),
        ]
    }
    void muted
  }

  // ---------------- COVER (5 layouts) ----------------

  private coverPage(document: RenderableDocument, theme: DerivedTheme, headingFont: string, bodyFont: string): (Paragraph | Table)[] {
    const spec = document.specification
    const colors = theme.colors
    const companyName = document.branding?.companyName
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const title = spec.title || 'Untitled Document'
    const subtitle = spec.description || ''
    const meta = [companyName, date].filter(Boolean).join('  ·  ')

    const noBorders = {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    }
    const plain = (text: string, opts: { size?: number; bold?: boolean; color?: string; italics?: boolean; smallCaps?: boolean; font?: string; after?: number; before?: number; center?: boolean }) =>
      new Paragraph({
        alignment: opts.center ? AlignmentType.CENTER : undefined,
        spacing: { after: opts.after ?? 120, before: opts.before },
        children: [
          new TextRun({
            text,
            bold: opts.bold,
            italics: opts.italics,
            smallCaps: opts.smallCaps,
            size: opts.size ?? 24,
            color: opts.color ?? hex6(colors.foreground, '1F2937'),
            font: opts.font ?? bodyFont,
          }),
        ],
      })

    switch (theme.cover) {
      // ---- SIDEBAR: left color column, title block on the right ----
      case 'sidebar': {
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                height: { value: 13200, rule: HeightRule.EXACT },
                children: [
                  new TableCell({
                    width: { size: 3600, type: WidthType.DXA },
                    shading: { type: ShadingType.CLEAR, fill: hex6(colors.primary, '1E3A5F') },
                    verticalAlign: VerticalAlign.BOTTOM,
                    borders: noBorders,
                    margins: { top: 200, bottom: 200, left: 240, right: 200 },
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: theme.tokens.label, bold: true, size: 22, color: 'FFFFFF', font: headingFont, smallCaps: true })],
                      }),
                      ...(companyName
                        ? [new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: companyName, size: 18, color: hex6(colors.muted, 'F4F6F9') })] })]
                        : []),
                    ],
                  }),
                  new TableCell({
                    width: { size: 6200, type: WidthType.DXA },
                    verticalAlign: VerticalAlign.CENTER,
                    borders: noBorders,
                    margins: { top: 200, bottom: 200, left: 480, right: 120 },
                    children: [
                      new Paragraph({
                        spacing: { after: 200 },
                        children: [new TextRun({ text: ' ', size: 2 })],
                      }),
                      new Paragraph({
                        spacing: { after: 160 },
                        children: [new TextRun({ text: title, bold: true, size: 60, color: hex6(colors.primary, '1E3A5F'), font: headingFont })],
                      }),
                      ...(subtitle
                        ? [
                            new Paragraph({
                              spacing: { after: 400 },
                              children: [new TextRun({ text: subtitle.slice(0, 220), italics: true, size: 24, color: hex6(colors.mutedForeground, '64748B') })],
                            }),
                          ]
                        : []),
                      new Paragraph({
                        children: [new TextRun({ text: date, size: 20, color: hex6(colors.accent, '3B82F6'), bold: true })],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({ children: [new PageBreak()] }),
        ]
      }

      // ---- CENTERED: formal double-rule title block ----
      case 'centered': {
        return [
          plain(' ', { size: 2, after: 2600 }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 6, color: hex6(colors.primary, '1E3A5F'), space: 10 } },
            spacing: { after: 300 },
            children: [new TextRun({ text: ' ' })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [new TextRun({ text: title, bold: true, size: 68, color: hex6(colors.primary, '1E3A5F'), font: headingFont })],
          }),
          ...(subtitle
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 460 },
                  children: [new TextRun({ text: subtitle, italics: true, size: 26, color: hex6(colors.mutedForeground, '64748B') })],
                }),
              ]
            : []),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: hex6(colors.primary, '1E3A5F'), space: 10 } },
            spacing: { after: 300 },
            children: [new TextRun({ text: meta, smallCaps: true, size: 20, color: hex6(colors.mutedForeground, '64748B') })],
          }),
          new Paragraph({ children: [new PageBreak()] }),
        ]
      }

      // ---- MINIMAL: pure typography ----
      case 'minimal': {
        return [
          plain(' ', { size: 2, after: 3200 }),
          plain(theme.tokens.label.toUpperCase(), { size: 18, smallCaps: true, color: hex6(colors.mutedForeground, '64748B'), after: 200 }),
          plain(title, { size: 72, bold: true, color: hex6(colors.foreground, '111111'), after: 300 }),
          new Paragraph({
            spacing: { after: 360 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: hex6(colors.accent, '444444'), space: 1 } },
            children: [new TextRun({ text: ' ', size: 2 })],
          }),
          ...(subtitle ? [plain(subtitle, { size: 24, color: hex6(colors.mutedForeground, '737373'), after: 500 })] : []),
          plain(meta, { size: 20, color: hex6(colors.mutedForeground, '737373') }),
          new Paragraph({ children: [new PageBreak()] }),
        ]
      }

      // ---- GRADIENT-BAR: tri-tone progress band (no real gradients in DOCX) ----
      case 'gradient-bar': {
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                height: { value: 160, rule: HeightRule.EXACT },
                children: [
                  this.bandCell(hex6(colors.primary, '6D28D9'), 4000, noBorders),
                  this.bandCell(hex6(colors.accent, '06B6D4'), 4000, noBorders),
                  this.bandCell(tint(colors.accent, 0.55).slice(1).toUpperCase(), 2600, noBorders),
                ],
              }),
            ],
          }),
          plain(' ', { size: 2, after: 2600 }),
          plain(theme.tokens.label.toUpperCase(), { size: 18, smallCaps: true, bold: true, color: hex6(colors.accent, '06B6D4'), after: 160 }),
          plain(title, { size: 66, bold: true, color: hex6(colors.foreground, '18181B'), after: 260 }),
          ...(subtitle ? [plain(subtitle, { size: 24, color: hex6(colors.mutedForeground, '71717A'), after: 520 })] : []),
          plain(meta, { size: 20, color: hex6(colors.mutedForeground, '71717A') }),
          new Paragraph({ children: [new PageBreak()] }),
        ]
      }

      // ---- BANNER: solid top band + centered title (executive default) ----
      case 'banner':
      default: {
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                height: { value: 2000, rule: HeightRule.EXACT },
                children: [
                  new TableCell({
                    shading: { type: ShadingType.CLEAR, fill: hex6(colors.primary, '1E3A5F') },
                    verticalAlign: VerticalAlign.CENTER,
                    borders: noBorders,
                    margins: { top: 100, bottom: 100, left: 400, right: 400 },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({ text: title, bold: true, size: 52, color: 'FFFFFF', font: headingFont }),
                        ],
                      }),
                      ...(subtitle
                        ? [
                            new Paragraph({
                              spacing: { before: 120 },
                              children: [new TextRun({ text: subtitle.slice(0, 200), size: 22, color: hex6(colors.muted, 'F4F6F9'), italics: true })],
                            }),
                          ]
                        : []),
                    ],
                  }),
                ],
              }),
            ],
          }),
          plain(' ', { size: 2, after: 2400 }),
          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: ' ', size: 2 })],
          }),
          new Paragraph({
            border: { top: { style: BorderStyle.SINGLE, size: 18, color: hex6(colors.accent, 'B8860B'), space: 1 } },
            spacing: { after: 400 },
            children: [new TextRun({ text: ' ', size: 2 })],
          }),
          plain(meta, { size: 22, color: hex6(colors.mutedForeground, '64748B'), center: true }),
          new Paragraph({ children: [new PageBreak()] }),
        ]
      }
    }
  }

  private bandCell(fill: string, width: number, borders: object): TableCell {
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill },
      borders: borders as never,
      children: [new Paragraph({ text: '' })],
    })
  }

  // ---------------- COMPONENTS ----------------

  private async renderComponent(
    component: CanonicalComponent,
    theme: ReturnType<typeof deriveTheme>,
    headingFont: string,
    bodyFont: string,
    ctx?: { figureNo?: () => number; subHeadingLevel?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; bodyFont?: string }
  ): Promise<(Paragraph | Table)[]> {
    const colors = theme.colors
    const out: (Paragraph | Table)[] = []
    const inHeadingFont = headingFont

    switch (component.type) {
      case 'heading': {
        out.push(
          new Paragraph({
            text: asString(component.content),
            heading: ctx?.subHeadingLevel ?? HeadingLevel.HEADING_2,
            spacing: { before: 260, after: 130 },
          })
        )
        break
      }
      case 'paragraph': {
        const text = asString(component.content)
        if (text) {
          out.push(
            new Paragraph({
              text,
              spacing: { after: 160, line: 300 },
              alignment: AlignmentType.JUSTIFIED,
            })
          )
        }
        break
      }
      case 'list': {
        const items = asStringArray(component.content)
        items.forEach((item) => {
          out.push(
            new Paragraph({
              text: item,
              bullet: { level: 0 },
              spacing: { after: 80 },
            })
          )
        })
        break
      }
      case 'key_takeaways': {
        const items = asStringArray(component.content)
        if (items.length > 0) {
          out.push(this.takeawaysBox(items, colors.accent))
          out.push(new Paragraph({ text: '', spacing: { after: 120 } }))
        }
        break
      }
      case 'quote': {
        const text = asString(component.content)
        if (text) {
          out.push(
            new Paragraph({
              spacing: { before: 160, after: 160 },
              indent: { left: 720 },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: hex6(colors.accent, '3B82F6'), space: 12 } },
              children: [new TextRun({ text, italics: true, size: 24, color: hex6(colors.primary, '1E3A5F'), font: bodyFont })],
            })
          )
        }
        break
      }
      case 'callout': {
        const text = asString(component.content)
        if (text) {
          out.push(this.calloutTable(text, colors.accent))
          out.push(new Paragraph({ text: '', spacing: { after: 120 } }))
        }
        break
      }
      case 'metric_grid': {
        const metrics = asMetrics(component.content)
        if (metrics.length > 0) {
          out.push(this.metricTable(metrics, colors.primary, colors.accent, inHeadingFont))
          out.push(new Paragraph({ text: '', spacing: { after: 160 } }))
        }
        break
      }
      case 'two_column': {
        const data = asTwoColumn(component.content)
        if (data) {
          out.push(this.twoColumnTable(data, colors.primary, colors.accent))
          out.push(new Paragraph({ text: '', spacing: { after: 160 } }))
        }
        break
      }
      case 'table': {
        const rows = asTable(component.content)
        if (rows.length >= 1) {
          out.push(this.dataTable(rows, colors, theme))
          out.push(new Paragraph({ text: '', spacing: { after: 160 } }))
        }
        break
      }
      case 'equation': {
        // NATIVE Word math zone (editable OMML) when the LaTeX is inside the
        // supported subset; otherwise a crisp PNG of the exact expression;
        // otherwise the raw LaTeX shown visibly (never silently corrupted).
        const latex = equationLatexOf(component.content)
        if (!latex) break
        const omml = latexToOmml(latex)
        if (omml) {
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 160, after: 160 },
              children: [new MathElement({ children: omml })],
            })
          )
        } else {
          const image = await renderComponentImage(component, theme)
          if (image) {
            const eqScale = Math.min(1, 460 / image.width)
            out.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 160, after: 60 },
                children: [
                  new ImageRun({
                    data: image.png,
                    transformation: { width: Math.round(image.width * eqScale), height: Math.round(image.height * eqScale) },
                    type: 'png',
                  }),
                ],
              })
            )
          } else {
            out.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 120, after: 120 },
                children: [new TextRun({ text: latex, font: 'Cambria Math', size: 24, italics: true, color: hex6(colors.foreground, '1F2937') })],
              })
            )
          }
        }
        break
      }
      case 'chart':
      case 'timeline':
      case 'diagram': {
        const image = await renderComponentImage(component, theme)
        if (image) {
          const maxW = 600
          const scale = Math.min(1, maxW / image.width)
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 160, after: 60 },
              children: [
                new ImageRun({
                  data: image.png,
                  transformation: { width: Math.round(image.width * scale), height: Math.round(image.height * scale) },
                  type: 'png',
                }),
              ],
            })
          )
          if (image.caption) {
            const no = ctx?.figureNo?.() ?? 1
            out.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: `Figure ${no} — ${image.caption}`, italics: true, size: 18, color: hex6(colors.mutedForeground, '64748B') })],
              })
            )
          }
        }
        break
      }
      default: {
        const text = asString(component.content) || JSON.stringify(component.content)
        if (text && text !== 'null' && text !== '""' && text !== '[]' && text !== '{}') {
          out.push(new Paragraph({ text, spacing: { after: 160 } }))
        }
      }
    }

    return out
  }

  // ---------------- TABLE BUILDERS ----------------

  private calloutTable(text: string, accent: string): Table {
    const fill = tint(accent, 0.88).slice(1).toUpperCase()
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill },
              borders: {
                left: { style: BorderStyle.SINGLE, size: 24, color: hex6(accent, '3B82F6') },
                top: { style: BorderStyle.SINGLE, size: 4, color: fill },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: fill },
                right: { style: BorderStyle.SINGLE, size: 4, color: fill },
              },
              margins: { top: 160, bottom: 160, left: 240, right: 240 },
              children: [new Paragraph({ children: [new TextRun({ text, size: 22, bold: true })] })],
            }),
          ],
        }),
      ],
    })
  }

  /** Shaded key-takeaways emphasis box (title + bullets). */
  private takeawaysBox(items: string[], accent: string): Table {
    const fill = tint(accent, 0.9).slice(1).toUpperCase()
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill },
              borders: {
                left: { style: BorderStyle.SINGLE, size: 24, color: hex6(accent, '3B82F6') },
                top: { style: BorderStyle.SINGLE, size: 4, color: fill },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: fill },
                right: { style: BorderStyle.SINGLE, size: 4, color: fill },
              },
              margins: { top: 160, bottom: 160, left: 240, right: 240 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: 'Key Takeaways', bold: true, size: 22, color: hex6(accent, '3B82F6') })],
                  spacing: { after: 100 },
                }),
                ...items.map(
                  (item, i) =>
                    new Paragraph({
                      children: [new TextRun({ text: `${i + 1}.  ${item}`, size: 22 })],
                      spacing: { after: i === items.length - 1 ? 0 : 60 },
                    })
                ),
              ],
            }),
          ],
        }),
      ],
    })
  }

  private metricTable(metrics: Array<{ label: string; value: string; change?: string }>, primary: string, accent: string, headingFont: string): Table {
    const rows: TableRow[] = []
    const headerRow = new TableRow({
      children: metrics.map((m) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: tint(primary, 0.95).slice(1).toUpperCase() },
          margins: { top: 120, bottom: 40, left: 160, right: 160 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: m.label, bold: true, size: 18, color: hex6(primary, '1E3A5F'), font: headingFont })],
            }),
          ],
        })
      ),
    })
    rows.push(headerRow)

    const valueRow = new TableRow({
      children: metrics.map((m) =>
        new TableCell({
          margins: { top: 60, bottom: 60, left: 160, right: 160 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: m.value, bold: true, size: 40, color: hex6(accent, '3B82F6'), font: headingFont })],
            }),
          ],
        })
      ),
    })
    rows.push(valueRow)

    if (metrics.some((m) => m.change)) {
      rows.push(
        new TableRow({
          children: metrics.map((m) =>
            new TableCell({
              margins: { top: 40, bottom: 120, left: 160, right: 160 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: m.change ?? '', size: 18, italics: true, color: '64748B' })],
                }),
              ],
            })
          ),
        })
      )
    }

    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
  }

  private twoColumnTable(
    data: { leftTitle: string; leftPoints: string[]; rightTitle: string; rightPoints: string[] },
    primary: string,
    accent: string
  ): Table {
    const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' }
    const mkSide = (title: string, points: string[], fillTitle: string) =>
      new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        margins: { top: 120, bottom: 160, left: 200, right: 200 },
        borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
        children: [
          new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: 24, color: hex6(fillTitle, '1E3A5F') })],
            spacing: { after: 120 },
          }),
          ...points.map(
            (p) =>
              new Paragraph({
                text: `• ${p}`,
                spacing: { after: 60 },
              })
          ),
        ],
      })

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            mkSide(data.leftTitle, data.leftPoints, primary),
            mkSide(data.rightTitle, data.rightPoints, accent),
          ],
        }),
      ],
    })
  }

  /**
   * Data table with THEME DIALECT styling (banded / boxed / minimal /
   * dark-header / editorial). Formula cells are computed against the table
   * itself; an unevaluable formula stays visible as text — never a wrong
   * number, never a silent drop.
   */
  private dataTable(rows: Array<Array<string | number | null>>, colors: DocxColor, theme: DerivedTheme): Table {
    const [header, ...data] = rows
    const width = Math.max(header?.length ?? 1, 1)
    const colWidth = Math.floor(9000 / width)
    const dialect = tableDialectFor(theme)

    // Page-safety: ≥7 columns needs a smaller body font to stay inside the
    // printable width; the QA validator caps columns at 12.
    const bodySize = width >= 9 ? 16 : width >= 7 ? 18 : 20
    const headSize = width >= 9 ? 16 : width >= 7 ? 18 : 20

    const fullBorder = { style: BorderStyle.SINGLE, size: 4, color: hex6(colors.border, 'E2E8F0') }
    const cellBordersFor = (): object => {
      if (dialect.borders === 'full') {
        return { top: fullBorder, bottom: fullBorder, left: fullBorder, right: fullBorder }
      }
      if (dialect.borders === 'rows') {
        return { bottom: fullBorder }
      }
      return {}
    }

    const headerRow = new TableRow({
      tableHeader: true,
      children:
        header?.map(
          (cell) =>
            new TableCell({
              width: { size: colWidth, type: WidthType.DXA },
              shading: dialect.headerFill
                ? { type: ShadingType.CLEAR, fill: hex6(dialect.headerFill, '1E3A5F') }
                : undefined,
              borders: (() => {
                if (dialect.borders === 'full') {
                  return { top: fullBorder, bottom: fullBorder, left: fullBorder, right: fullBorder }
                }
                if (dialect.borders === 'rows') {
                  return {
                    bottom: { style: BorderStyle.SINGLE, size: dialect.headerRule ? 16 : 6, color: hex6(colors.primary, '1E3A5F') },
                    top: dialect.headerRule ? { style: BorderStyle.SINGLE, size: 12, color: hex6(colors.primary, '1E3A5F') } : undefined,
                  }
                }
                return {}
              })() as never,
              margins: { top: 80, bottom: 80, left: 100, right: 100 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: String(cell ?? ''),
                      bold: true,
                      size: headSize,
                      color: dialect.headerFill ? 'FFFFFF' : hex6(dialect.headerColor, '1E3A5F'),
                    }),
                  ],
                }),
              ],
            })
        ) ?? [],
    })

    const matrix = rows as CellMatrix
    const dataRows = data.map((row, idx) => {
      return new TableRow({
        children: Array.from({ length: width }, (_, i) => {
          const cell = row[i] ?? ''
          let displayText: string
          if (typeof cell === 'string' && /^=/.test(cell.trim())) {
            const computed = evaluateFormula(cell.trim(), matrix)
            displayText = computed !== null ? formatNumberForDoc(computed) : cell.trim()
          } else {
            displayText = String(cell)
          }
          return new TableCell({
            width: { size: colWidth, type: WidthType.DXA },
            shading:
              dialect.zebra && idx % 2 === 1
                ? { type: ShadingType.CLEAR, fill: dialect.zebra.replace('#', '').toUpperCase() }
                : undefined,
            borders: cellBordersFor() as never,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: displayText,
                    size: bodySize,
                    color: hex6(colors.foreground, '1F2937'),
                  }),
                ],
              }),
            ],
          })
        }),
      })
    })

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
    })
  }
}

/** Compact, locale-stable number rendering for computed table cells. */
function formatNumberForDoc(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-US')
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
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
