// =============================================================================
// DOCX RENDERER (spec §12) — native, editable Word output via the `docx` package
// =============================================================================
// Professional native DOCX generation (NEVER a PDF→DOCX conversion):
//   • themed cover page with accent bar, subtitle, date, company
//   • table of contents (Word field — updates natively in Word)
//   • themed headings/paragraphs/tables (header fill, zebra rows, borders)
//   • metric grids, callouts, quotes, key-takeaway boxes, two-column comparisons
//   • charts + diagrams embedded as crisp PNG images with numbered captions
//   • NATIVE Word equations (OMML math zone) with PNG fallback for exotic LaTeX
//   • headers/footers with page numbers, page breaks between sections
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
  TableRow,
  TextRun,
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
  latexToOmml,
  renderComponentImage,
  tint,
} from './shared'
import { evaluateFormula } from '@/services/formula-evaluator'
import type { CellMatrix } from '@/services/formula-evaluator'

const TWIPS_PER_INCH = 1440

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

    // ---------------- COVER PAGE ----------------
    const hasCover = spec.sections[0]?.type === 'cover' || spec.sections.length >= 3
    if (hasCover) {
      children.push(...this.coverPage(spec.title, spec.description, document))
    }

    // ---------------- TABLE OF CONTENTS ----------------
    if (spec.sections.length >= 4) {
      children.push(
        new Paragraph({ text: 'Contents', heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 240 } }),
        new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
        new Paragraph({ children: [new PageBreak()] })
      )
    }

    // ---------------- SECTIONS ----------------
    const sectionsToRender = spec.sections[0]?.type === 'cover' ? spec.sections.slice(1) : spec.sections
    let figureNo = 0

    for (const section of sectionsToRender) {
      const components = (document.sections.find((s) => s.id === section.id)?.components ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)

      // Section heading
      children.push(
        new Paragraph({
          text: section.title,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 8, color: hex6(colors.accent, '3B82F6'), space: 4 },
          },
        })
      )

      for (const component of components) {
        const rendered = await this.renderComponent(component, theme, headingFont, bodyFont, {
          figureNo: () => ++figureNo,
        })
        children.push(...rendered)
      }

      // Page break between sections (not after the last)
      if (section !== sectionsToRender[sectionsToRender.length - 1]) {
        children.push(new Paragraph({ children: [new PageBreak()] }))
      }
    }

    const headerFooterEnabled = spec.design?.layout?.headerEnabled !== false
    const companyName = document.branding?.companyName

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
                  children: [
                    new TextRun({
                      text: companyName || spec.title,
                      italics: true,
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
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: '', children: [PageNumber.CURRENT], size: 18, color: hex6(colors.mutedForeground, '64748B'), font: bodyFont }),
                  ],
                }),
              ],
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
            run: { font: headingFont, size: 32, bold: true, color: hex6(colors.primary, '1E3A5F') },
            paragraph: { spacing: { before: 360, after: 180 } },
          },
          heading2: {
            run: { font: headingFont, size: 26, bold: true, color: hex6(colors.primary, '1E3A5F') },
            paragraph: { spacing: { before: 280, after: 140 } },
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

  // ---------------- COVER ----------------

  private coverPage(title: string, subtitle: string | undefined, document: RenderableDocument): (Paragraph | Table)[] {
    const theme = deriveTheme(document.specification)
    const colors = theme.colors
    const companyName = document.branding?.companyName
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

    return [
      // Accent bar
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                shading: { type: ShadingType.CLEAR, fill: hex6(colors.primary, '1E3A5F') },
                children: [new Paragraph({ text: '' })],
                borders: {
                  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                },
              }),
            ],
            height: { value: 260, rule: HeightRule.EXACT },
          }),
        ],
      }),
      new Paragraph({ text: '', spacing: { after: 2400 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({ text: title, bold: true, size: 72, font: document.specification.design?.typography?.headingFont || 'Calibri', color: hex6(colors.primary, '1E3A5F') }),
        ],
      }),
      ...(subtitle
        ? [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 300 },
              children: [new TextRun({ text: subtitle, size: 28, color: hex6(colors.mutedForeground, '64748B'), italics: true })],
            }),
          ]
        : []),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: [companyName, date].filter(Boolean).join('  ·  '),
            size: 20,
            color: hex6(colors.mutedForeground, '64748B'),
          }),
        ],
      }),
      new Paragraph({ children: [new PageBreak()] }),
    ]
  }

  // ---------------- COMPONENTS ----------------

  private async renderComponent(
    component: CanonicalComponent,
    theme: ReturnType<typeof deriveTheme>,
    headingFont: string,
    bodyFont: string,
    ctx?: { figureNo?: () => number }
  ): Promise<(Paragraph | Table)[]> {
    const colors = theme.colors
    const out: (Paragraph | Table)[] = []

    switch (component.type) {
      case 'heading': {
        out.push(
          new Paragraph({
            text: asString(component.content),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 280, after: 140 },
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
        // Emphasis box: shaded single-cell table carrying the takeaways —
        // the previous implementation rendered plain bullets and then
        // REPLACED the last one with an empty paragraph (a defect).
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
          out.push(this.metricTable(metrics, colors.primary, colors.accent, headingFont))
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
          out.push(this.dataTable(rows, colors))
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

  private dataTable(rows: Array<Array<string | number | null>>, colors: ReturnType<typeof deriveTheme>['colors']): Table {
    const [header, ...data] = rows
    const width = Math.max(header?.length ?? 1, 1)
    const colWidth = Math.floor(9000 / width)

    // Page-safety: ≥7 columns needs a smaller body font to stay inside the
    // printable width; the QA validator caps columns at 12.
    const bodySize = width >= 9 ? 16 : width >= 7 ? 18 : 20
    const headSize = width >= 9 ? 16 : width >= 7 ? 18 : 20

    const tableStyle = themeTableStyle(colors, 'banded')

    const headerRow = new TableRow({
      tableHeader: true,
      children:
        header?.map(
          (cell) =>
            new TableCell({
              width: { size: colWidth, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: hex6(tableStyle.headerFill, '1E3A5F') },
              margins: { top: 80, bottom: 80, left: 100, right: 100 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: String(cell ?? ''), bold: true, size: headSize, color: 'FFFFFF' })],
                }),
              ],
            })
        ) ?? [],
    })

    // Formula-aware data rows: table cells may carry spreadsheet formulas
    // ("=SUM(B2:B5)") for numeric columns. DOCX has no formula engine, so we
    // COMPUTE the value against the table itself — a formula we cannot
    // evaluate stays visible as its formula text (honest), never a wrong
    // number and never a silent drop.
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
              tableStyle.zebra && idx % 2 === 1
                ? { type: ShadingType.CLEAR, fill: tint(tableStyle.headerFill, 0.94).slice(1).toUpperCase() }
                : undefined,
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

/** Table styling hints derived from theme tokens. */
export function themeTableStyle(colors: ReturnType<typeof deriveTheme>['colors'], fallback: string): { headerFill: string; zebra: boolean } {
  return { headerFill: colors.primary, zebra: fallback === 'banded' || fallback === 'dark-header' || fallback === 'boxed' }
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
