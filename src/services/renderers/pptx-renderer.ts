// =============================================================================
// PPTX RENDERER (spec §14) — presentation-grade slides via pptxgenjs
// =============================================================================
// v2 — DECK DESIGN SYSTEM:
//   • cover → AGENDA slide (decks with ≥5 content sections) → part dividers
//     with outline numbers → content slides → closing slide
//   • theme-dialect styling: headingCase, dark mode, accent geometry, footer
//     with deck title + slide number on every content slide
//   • layout variety driven by component mix: chart-focus, table-focus,
//     big-number KPI, two-column, quote, callout — never "bullets again"
//   • overflow guards: per-slide vertical budget, bullet caps, tables SPLIT
//     across continuation slides (rows AND columns — nothing is silently
//     dropped), repeated header row on every chunk
// =============================================================================

import type { RendererOutput, DocumentRenderer, RenderableDocument, CanonicalComponent } from './shared'
import {
  asChart,
  asCodeBlock,
  asMetrics,
  asString,
  asStringArray,
  asTable,
  asTwoColumn,
  deriveTheme,
  equationLatexOf,
  hex6,
  renderComponentImage,
} from './shared'

const SLIDE_W = 10 // inches (16:9)
const SLIDE_H = 5.625
const MARGIN = 0.5
const CONTENT_W = SLIDE_W - MARGIN * 2
const MIN_BODY_PT = 12
const MAX_BULLETS = 6
const MAX_TABLE_COLS = 6

export class PptxRenderer implements DocumentRenderer {
  format = 'PPTX' as const

  async render(document: RenderableDocument): Promise<RendererOutput> {
    const pptxgen = (await import('pptxgenjs')).default
    const pres = new pptxgen()
    const spec = document.specification
    const theme = deriveTheme(spec)
    const colors = theme.colors
    const dark = theme.tokens.id === 'professional-dark'

    pres.defineLayout({ name: 'FILO16x9', width: SLIDE_W, height: SLIDE_H })
    pres.layout = 'FILO16x9'
    pres.author = 'Filo'
    pres.title = spec.title

    const bg = dark ? '0B1220' : 'FFFFFF'
    const fg = hex6(colors.foreground, '1F2937')
    const primary = hex6(colors.primary, '1E3A5F')
    const accent = hex6(colors.accent, '3B82F6')
    const muted = hex6(colors.mutedForeground, '64748B')
    const headingFont = spec.design?.typography?.headingFont || 'Calibri'
    const bodyFont = spec.design?.typography?.bodyFont || 'Calibri'
    const upperHeadings = theme.headingCase === 'upper'
    const titleCase = (t: string) => (upperHeadings ? t.toUpperCase() : t)

    const sections = spec.sections
    const coverSection = sections[0]?.type === 'cover' ? sections[0] : null
    const contentSections = coverSection ? sections.slice(1) : sections

    // ---------------- COVER SLIDE ----------------
    const cover = pres.addSlide()
    cover.background = { color: dark ? '0B1220' : hex6(colors.muted, 'F8FAFC') }
    // accent geometry per theme ornament dialect
    if (theme.ornament === 'band') {
      cover.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 1.6, fill: { color: primary } })
      cover.addText(titleCase(coverSection?.title ?? (spec.title || 'Untitled')), {
        x: MARGIN,
        y: 0.2,
        w: CONTENT_W,
        h: 1.2,
        fontSize: 36,
        bold: true,
        color: 'FFFFFF',
        fontFace: headingFont,
        valign: 'middle',
      })
    } else if (theme.ornament === 'left-bar') {
      cover.addShape('rect', { x: 0, y: 0, w: 0.22, h: SLIDE_H, fill: { color: primary } })
      cover.addShape('rect', { x: 0.22, y: 0, w: 0.06, h: SLIDE_H, fill: { color: accent } })
      cover.addText(titleCase(coverSection?.title ?? (spec.title || 'Untitled')), {
        x: MARGIN + 0.25,
        y: 1.5,
        w: CONTENT_W - 0.3,
        h: 1.6,
        fontSize: 40,
        bold: true,
        color: dark ? 'F8FAFC' : primary,
        fontFace: headingFont,
        valign: 'middle',
      })
    } else {
      cover.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.18, fill: { color: primary } })
      cover.addShape('rect', { x: MARGIN, y: SLIDE_H - 0.75, w: 2.2, h: 0.06, fill: { color: accent } })
      cover.addText(titleCase(coverSection?.title ?? (spec.title || 'Untitled')), {
        x: MARGIN,
        y: 1.5,
        w: CONTENT_W,
        h: 1.6,
        fontSize: 40,
        bold: true,
        color: dark ? 'F8FAFC' : primary,
        fontFace: headingFont,
        valign: 'middle',
      })
    }
    const coverComponents = document.sections.find((s) => s.id === coverSection?.id)?.components ?? []
    const coverSubtitle =
      asString(coverComponents.find((c) => c.type === 'paragraph')?.content) || spec.description || ''
    if (coverSubtitle) {
      cover.addText(coverSubtitle.slice(0, 220), {
        x: MARGIN,
        y: 3.1,
        w: CONTENT_W,
        h: 0.7,
        fontSize: 16,
        color: dark ? '94A3B8' : muted,
        fontFace: bodyFont,
      })
    }
    cover.addText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' }), {
      x: MARGIN,
      y: SLIDE_H - 0.55,
      w: 4,
      h: 0.3,
      fontSize: 11,
      color: dark ? '94A3B8' : muted,
      fontFace: bodyFont,
    })
    if (document.branding?.companyName) {
      cover.addText(document.branding.companyName, {
        x: SLIDE_W - 3.5,
        y: SLIDE_H - 0.55,
        w: 3,
        h: 0.3,
        fontSize: 11,
        color: dark ? '94A3B8' : muted,
        align: 'right',
        fontFace: bodyFont,
      })
    }

    let slideCount = 1 // cover already added

    const addFooter = (slide: any) => {
      slideCount++
      slide.addText(spec.title?.slice(0, 48) ?? '', {
        x: MARGIN,
        y: SLIDE_H - 0.42,
        w: 4.6,
        h: 0.3,
        fontSize: 8.5,
        color: dark ? '475569' : '94A3B8',
        fontFace: bodyFont,
        align: 'left',
      })
      slide.addText(String(slideCount), {
        x: SLIDE_W - 0.7,
        y: SLIDE_H - 0.42,
        w: 0.4,
        h: 0.3,
        fontSize: 10,
        color: dark ? '64748B' : '94A3B8',
        align: 'right',
      })
    }

    // ---------------- AGENDA SLIDE ----------------
    const agendaEntries = contentSections.filter(
      (s) => (s.level || 'chapter') !== 'part'
    )
    if (agendaEntries.length >= 5 && agendaEntries.length <= 12) {
      const agenda = pres.addSlide()
      agenda.background = { color: bg }
      agenda.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.1, fill: { color: accent } })
      agenda.addText(titleCase('Agenda'), {
        x: MARGIN,
        y: 0.28,
        w: CONTENT_W,
        h: 0.55,
        fontSize: 24,
        bold: true,
        color: dark ? 'F8FAFC' : primary,
        fontFace: headingFont,
      })
      const half = Math.ceil(agendaEntries.length / 2)
      const colW = (CONTENT_W - 0.4) / 2
      const mkAgendaCol = (entries: { number?: string; title: string }[], x: number) => {
        agenda.addText(
          entries.map((e) => ({
            text: e.number ? `${e.number}  ${e.title}` : e.title,
            options: { bullet: { characterCode: '2022' }, breakLine: true },
          })),
          {
            x,
            y: 1.05,
            w: colW,
            h: 3.9,
            fontSize: Math.max(MIN_BODY_PT, 13),
            color: dark ? 'E2E8F0' : fg,
            fontFace: bodyFont,
            valign: 'top',
            lineSpacingMultiple: 1.25,
          }
        )
      }
      mkAgendaCol(agendaEntries.slice(0, half).map((s: any) => ({ number: s.number, title: String(s.title) })), MARGIN)
      mkAgendaCol(
        agendaEntries.slice(half).map((s: any) => ({ number: s.number, title: String(s.title) })),
        MARGIN + colW + 0.4
      )
      addFooter(agenda)
    }

    // ---------------- CONTENT SLIDES ----------------
    for (const section of contentSections) {
      const components = (document.sections.find((s) => s.id === section.id)?.components ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
      const level = ((section as { level?: string }).level || 'chapter').toLowerCase()
      const num = (section as { number?: string }).number

      // ---- PART DIVIDER ----
      if (level === 'part' && components.length <= 1) {
        const divider = pres.addSlide()
        divider.background = { color: dark ? '0B1220' : hex6(colors.primary, '1E3A5F') }
        const onDark = dark || true
        if (num) {
          divider.addText(`PART ${num}`, {
            x: MARGIN,
            y: SLIDE_H / 2 - 1.15,
            w: CONTENT_W,
            h: 0.4,
            fontSize: 15,
            bold: true,
            color: onDark ? hex6(colors.accent, '3B82F6') : accent,
            fontFace: bodyFont,
            charSpacing: 4,
          })
        }
        divider.addText(titleCase(section.title), {
          x: MARGIN,
          y: SLIDE_H / 2 - 0.7,
          w: CONTENT_W,
          h: 1.4,
          fontSize: 32,
          bold: true,
          color: 'FFFFFF',
          fontFace: headingFont,
          valign: 'middle',
        })
        divider.addShape('rect', { x: MARGIN, y: SLIDE_H / 2 + 0.85, w: 1.6, h: 0.05, fill: { color: accent } })
        continue
      }

      // ---- Section divider for 'heading'-type sections with no real content
      if (section.type === 'heading' && components.length <= 1 && level !== 'part') {
        const divider = pres.addSlide()
        divider.background = { color: bg }
        divider.addShape('rect', { x: MARGIN, y: SLIDE_H / 2 - 0.6, w: 0.08, h: 1.2, fill: { color: accent } })
        divider.addText(titleCase(section.title), {
          x: MARGIN + 0.3,
          y: SLIDE_H / 2 - 0.8,
          w: CONTENT_W - 0.4,
          h: 1.6,
          fontSize: 30,
          bold: true,
          color: dark ? 'F8FAFC' : primary,
          fontFace: headingFont,
          valign: 'middle',
        })
        addFooter(divider)
        continue
      }

      // Partition components into slide-sized groups (overflow guard).
      const groups = this.groupComponents(components)
      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi]
        const isFirstSlice = gi === 0
        const st = isFirstSlice ? section.title : `${section.title} (cont.)`
        const slide = pres.addSlide()
        slide.background = { color: bg }
        // Title bar per theme dialect
        if (theme.ornament === 'left-bar') {
          slide.addShape('rect', { x: 0, y: 0, w: 0.14, h: SLIDE_H, fill: { color: primary } })
        } else {
          slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.1, fill: { color: accent } })
        }
        slide.addText(titleCase(st), {
          x: MARGIN,
          y: 0.28,
          w: CONTENT_W,
          h: 0.55,
          fontSize: 24,
          bold: true,
          color: dark ? 'F8FAFC' : primary,
          fontFace: headingFont,
        })

        let y = 1.05
        const bottomLimit = SLIDE_H - 0.35
        let speakerNotes = ''

        // Wide tables spawn chrome-identical continuation slides.
        const addContinuationSlide = (draw: (s: any) => void, contTitle: string) => {
          const cont = pres.addSlide()
          cont.background = { color: bg }
          if (theme.ornament === 'left-bar') {
            cont.addShape('rect', { x: 0, y: 0, w: 0.14, h: SLIDE_H, fill: { color: primary } })
          } else {
            cont.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.1, fill: { color: accent } })
          }
          cont.addText(titleCase(`${section.title}${contTitle}`), {
            x: MARGIN,
            y: 0.28,
            w: CONTENT_W,
            h: 0.55,
            fontSize: 24,
            bold: true,
            color: dark ? 'F8FAFC' : primary,
            fontFace: headingFont,
          })
          draw(cont)
          addFooter(cont)
        }

        for (const component of group) {
          if (y > bottomLimit - 0.4) break
          const consumed = await this.addComponent(slide, component, {
            y,
            bottomLimit,
            colors: { fg, primary, accent, muted, dark, bg },
            fonts: { headingFont, bodyFont },
            theme,
            addContinuationSlide,
          })
          y += consumed
          if (typeof component.content === 'string') {
            speakerNotes += `${component.content.slice(0, 200)} `
          }
        }

        addFooter(slide)

        if (speakerNotes.trim()) {
          slide.addNotes(speakerNotes.trim().slice(0, 900))
        }
      }
    }

    // ---------------- CLOSING SLIDE ----------------
    slideCount++
    const closing = pres.addSlide()
    closing.background = { color: dark ? '0B1220' : hex6(colors.muted, 'F8FAFC') }
    closing.addShape('rect', { x: 0, y: SLIDE_H - 0.18, w: SLIDE_W, h: 0.18, fill: { color: primary } })
    closing.addText('Thank you', {
      x: MARGIN,
      y: SLIDE_H / 2 - 0.9,
      w: CONTENT_W,
      h: 1.0,
      fontSize: 36,
      bold: true,
      color: dark ? 'F8FAFC' : primary,
      fontFace: headingFont,
      align: 'center',
    })
    if (spec.title) {
      closing.addText(spec.title, {
        x: MARGIN,
        y: SLIDE_H / 2 + 0.15,
        w: CONTENT_W,
        h: 0.4,
        fontSize: 14,
        color: dark ? '94A3B8' : muted,
        fontFace: bodyFont,
        align: 'center',
      })
    }

    const out = await pres.write({ outputType: 'nodebuffer' })
    const buffer = Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer)
    return {
      buffer,
      filename: `${slugify(spec.title)}.pptx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      size: buffer.length,
    }
  }

  // ---------------- SLIDE GROUPING (overflow guard) ----------------

  private groupComponents(components: CanonicalComponent[]): CanonicalComponent[][] {
    const groups: CanonicalComponent[][] = []
    let current: CanonicalComponent[] = []
    let budget = 4.0 // vertical inches available under the title

    for (const c of components) {
      const cost = this.componentCost(c)
      if (current.length > 0 && budget - cost < 0) {
        groups.push(current)
        current = []
        budget = 4.0
      }
      if (cost > 4.0) continue // skip impossible components rather than break layout
      current.push(c)
      budget -= cost
    }
    if (current.length > 0) groups.push(current)
    return groups.length > 0 ? groups : [[]]
  }

  private componentCost(c: CanonicalComponent): number {
    switch (c.type) {
      case 'chart':
      case 'timeline':
      case 'diagram':
        return 3.1
      case 'equation':
        return 1.2
      case 'code': {
        const lines = asCodeBlock(c.content)?.code.split('\n').length ?? 0
        return Math.min(4, 0.4 + Math.min(lines, 16) * 0.21)
      }
      case 'table': {
        const rows = asTable(c.content).length
        return Math.min(4, 0.4 + rows * 0.28)
      }
      case 'metric_grid':
        return 1.6
      case 'two_column':
        return 1.8
      case 'quote':
        return 1.0
      case 'callout':
        return 0.8
      case 'list':
      case 'key_takeaways': {
        const n = asStringArray(c.content).length
        return Math.min(4, 0.3 + n * 0.32)
      }
      case 'heading':
        return 0.4
      default: {
        const len = Math.min(asString(c.content).length, 380) // slides cap prose
        return Math.min(4, 0.3 + (len / 90) * 0.42)
      }
    }
  }

  /**
   * NATIVE pptxgenjs chart (editable data in PowerPoint) with theme palette.
   * Returns false when the chart kind is not natively expressible — the caller
   * then falls back to the ECharts PNG pipeline.
   */
  private addNativeChart(
    slide: any,
    spec: { chartType: string; categories: string[]; series: Array<{ name: string; data: Array<number | null> }> },
    o: {
      y: number
      h: number
      colors: { fg: string; accent: string; muted: string; dark: boolean }
      fonts: { bodyFont: string }
      theme: ReturnType<typeof deriveTheme>
    }
  ): boolean {
    const kind = String(spec.chartType || 'bar').toLowerCase()
    const palette = o.theme.chartPalette.map((c) => hex6(c))
    const axisColor = o.colors.dark ? '94A3B8' : o.colors.muted
    const gridColor = o.colors.dark ? '334155' : 'E2E8F0'
    const base = {
      x: MARGIN,
      y: o.y,
      w: CONTENT_W,
      h: o.h,
      chartColors: palette,
      // Axes: readable labels, subtle dashed gridlines, no chart-junk.
      catAxisLabelColor: axisColor,
      catAxisLabelFontSize: 10,
      valAxisLabelColor: axisColor,
      valAxisLabelFontSize: 10,
      catAxisLineColor: gridColor,
      valAxisLineShow: false,
      valGridLine: { color: gridColor, style: 'dash' as const, size: 1 },
      catGridLine: { style: 'none' as const },
      legendFontSize: 10,
      legendColor: axisColor,
      dataLabelColor: axisColor,
      dataLabelFontSize: 9,
      catAxisLabelFontFace: o.fonts.bodyFont,
      valAxisLabelFontFace: o.fonts.bodyFont,
      legendFontFace: o.fonts.bodyFont,
      dataLabelFontFace: o.fonts.bodyFont,
    }
    try {
      if (kind === 'pie' || kind === 'donut' || kind === 'doughnut') {
        const labels = spec.categories.slice(0, 8)
        const values = (spec.series[0]?.data ?? []).slice(0, labels.length).map((v) => v ?? 0)
        slide.addChart(kind === 'pie' ? 'pie' : 'doughnut', [{ name: spec.series[0]?.name || 'Series', labels, values }], {
          ...base,
          showPercent: true,
          showLegend: true,
          legendPos: 'r',
          dataBorder: { pt: 1.5, color: o.colors.dark ? '0B1220' : 'FFFFFF' },
          holeSize: kind === 'donut' ? 55 : undefined,
        })
        return true
      }
      const data = spec.series.map((s) => ({ name: s.name, labels: spec.categories, values: s.data.map((v) => v ?? 0) }))
      const multi = spec.series.length > 1
      if (kind === 'line' || kind === 'area') {
        slide.addChart(kind === 'line' ? 'line' : 'area', data, {
          ...base,
          lineSize: 2.5,
          lineSmooth: true,
          lineDataSymbol: 'circle',
          lineDataSymbolSize: 6,
          showLegend: multi,
          legendPos: 'b',
        })
        return true
      }
      if (kind === 'bar' || kind === 'hbar' || kind === 'stacked') {
        slide.addChart('bar', data, {
          ...base,
          barDir: kind === 'hbar' ? 'bar' : 'col',
          barGrouping: kind === 'stacked' ? 'stacked' : 'clustered',
          barGapWidthPct: 60,
          showLegend: multi,
          legendPos: 'b',
          // Value labels on single-series bars only (multi-series labels collide).
          showValue: !multi && data[0] && data[0].values.length <= 12,
        })
        return true
      }
      return false // scatter → PNG fallback
    } catch {
      return false
    }
  }

  // ---------------- COMPONENT RENDERING ----------------

  private async addComponent(
    slide: any,
    component: CanonicalComponent,
    ctx: {
      y: number
      bottomLimit: number
      colors: { fg: string; primary: string; accent: string; muted: string; dark: boolean; bg: string }
      fonts: { headingFont: string; bodyFont: string }
      theme: ReturnType<typeof deriveTheme>
      /** Spawns a chrome-identical continuation slide (wide-table columns). */
      addContinuationSlide?: (draw: (s: any) => void, contTitle: string) => void
    }
  ): Promise<number> {
    const { y, bottomLimit, colors, fonts, theme } = ctx
    const availH = bottomLimit - y
    if (availH <= 0.25) return 0

    switch (component.type) {
      case 'heading': {
        const text = asString(component.content)
        if (!text) return 0
        slide.addText(text, {
          x: MARGIN,
          y,
          w: CONTENT_W,
          h: 0.35,
          fontSize: 15,
          bold: true,
          color: colors.accent,
          fontFace: fonts.headingFont,
        })
        return 0.45
      }

      case 'paragraph': {
        const text = asString(component.content)
        if (!text) return 0
        // SLIDE BREVITY: paragraphs are capped hard — a deck is not a document.
        // The FULL paragraph still lands in the slide's speaker notes below.
        const capped = text.length > 380 ? `${text.slice(0, 340).trimEnd()}…` : text
        const lines = Math.ceil(capped.length / 95)
        const h = Math.min(availH, 0.3 + lines * 0.26)
        slide.addText(capped, {
          x: MARGIN,
          y,
          w: CONTENT_W,
          h,
          fontSize: Math.max(MIN_BODY_PT, 13),
          color: colors.dark ? 'CBD5E1' : colors.fg,
          fontFace: fonts.bodyFont,
          valign: 'top',
        })
        return h + 0.12
      }

      case 'list':
      case 'key_takeaways': {
        const items = asStringArray(component.content).slice(0, MAX_BULLETS)
        if (items.length === 0) return 0
        const h = Math.min(availH, 0.25 + items.length * 0.34)
        slide.addText(
          items.map((t) => ({ text: t.slice(0, 160), options: { bullet: { characterCode: '2022' }, breakLine: true } })),
          {
            x: MARGIN + 0.1,
            y,
            w: CONTENT_W - 0.2,
            h,
            fontSize: Math.max(MIN_BODY_PT, 14),
            color: colors.dark ? 'E2E8F0' : colors.fg,
            fontFace: fonts.bodyFont,
            valign: 'top',
          }
        )
        return h + 0.15
      }

      case 'quote': {
        const text = asString(component.content)
        if (!text) return 0
        slide.addShape('rect', { x: MARGIN, y, w: 0.06, h: Math.min(1, availH), fill: { color: colors.accent } })
        slide.addText(`“${text.slice(0, 260)}”`, {
          x: MARGIN + 0.25,
          y,
          w: CONTENT_W - 0.4,
          h: Math.min(1.1, availH),
          fontSize: 16,
          italic: true,
          color: colors.dark ? '94A3B8' : colors.muted,
          fontFace: fonts.bodyFont,
          valign: 'middle',
        })
        return Math.min(1.2, availH) + 0.15
      }

      case 'callout': {
        const text = asString(component.content)
        if (!text) return 0
        const h = Math.min(0.9, availH)
        slide.addShape('rect', {
          x: MARGIN,
          y,
          w: CONTENT_W,
          h,
          fill: { color: colors.dark ? '111C2E' : 'F1F5F9' },
          line: { color: colors.accent, width: 1 },
        })
        slide.addText(text.slice(0, 300), {
          x: MARGIN + 0.15,
          y,
          w: CONTENT_W - 0.3,
          h,
          fontSize: Math.max(MIN_BODY_PT, 13),
          bold: true,
          color: colors.dark ? 'E2E8F0' : colors.fg,
          fontFace: fonts.bodyFont,
          valign: 'middle',
        })
        return h + 0.18
      }

      case 'metric_grid': {
        const metrics = asMetrics(component.content).slice(0, 4)
        if (metrics.length === 0) return 0
        const cardW = (CONTENT_W - (metrics.length - 1) * 0.2) / metrics.length
        const h = 1.35
        metrics.forEach((m, i) => {
          const x = MARGIN + i * (cardW + 0.2)
          slide.addShape('rect', {
            x,
            y,
            w: cardW,
            h,
            fill: { color: colors.dark ? '111C2E' : 'FFFFFF' },
            line: { color: colors.dark ? '334155' : 'E2E8F0', width: 1 },
          })
          // accent top edge per card
          slide.addShape('rect', { x, y, w: cardW, h: 0.05, fill: { color: colors.accent } })
          slide.addText(m.label, {
            x: x + 0.08,
            y: y + 0.1,
            w: cardW - 0.16,
            h: 0.3,
            fontSize: 11,
            color: colors.muted,
            fontFace: fonts.bodyFont,
          })
          slide.addText(m.value, {
            x: x + 0.08,
            y: y + 0.38,
            w: cardW - 0.16,
            h: 0.55,
            fontSize: 26,
            bold: true,
            color: colors.accent,
            fontFace: fonts.headingFont,
          })
          if (m.change) {
            slide.addText(m.change, {
              x: x + 0.08,
              y: y + 0.95,
              w: cardW - 0.16,
              h: 0.3,
              fontSize: 11,
              color: colors.muted,
              fontFace: fonts.bodyFont,
            })
          }
        })
        return h + 0.2
      }

      case 'equation': {
        const image = await renderComponentImage(component, ctx.theme, { pptx: true })
        if (!image) {
          // Honest fallback: the raw LaTeX, visibly rendered.
          const latexRaw = equationLatexOf(component.content)
          if (!latexRaw) return 0
          const h = Math.min(0.6, availH)
          slide.addText(latexRaw.slice(0, 120), {
            x: MARGIN,
            y,
            w: CONTENT_W,
            h,
            fontSize: Math.max(MIN_BODY_PT, 14),
            italic: true,
            fontFace: 'Cambria Math',
            color: colors.dark ? 'E2E8F0' : colors.fg,
            align: 'center',
            valign: 'middle',
          })
          return h + 0.15
        }
        const maxW = CONTENT_W * 0.86
        const maxH = Math.min(availH, 1.9)
        const scale = Math.min(maxW / image.width, maxH / image.height)
        const w = image.width * scale
        const h = image.height * scale
        slide.addImage({
          data: `image/png;base64,${image.png.toString('base64')}`,
          x: (SLIDE_W - w) / 2,
          y,
          w,
          h,
        })
        return h + 0.2
      }

      case 'chart': {
        // NATIVE PowerPoint charts (editable data, theme palette) — charts
        // used to ship as rasterized PNGs, uneditable and unsearchable.
        // Falls back to the rendered PNG only for shapes pptxgenjs cannot
        // express natively.
        const spec = asChart(component.content)
        if (spec) {
          const chartH = Math.min(availH, 3.3)
          const native = this.addNativeChart(slide, spec, {
            y,
            h: chartH,
            colors: ctx.colors,
            fonts: ctx.fonts,
            theme,
          })
          if (native) {
            const caption = [spec.title?.trim(), spec.note?.trim()].filter(Boolean).join(' — ')
            if (caption) {
              slide.addText(caption.slice(0, 140), {
                x: MARGIN,
                y: y + chartH + 0.02,
                w: CONTENT_W,
                h: 0.25,
                fontSize: 10,
                color: colors.muted,
                align: 'center',
                fontFace: fonts.bodyFont,
              })
              return chartH + 0.32
            }
            return chartH + 0.12
          }
        }
        // FALLBACK: rasterized image (scatter and any unparsed spec).
        const image = await renderComponentImage(component, ctx.theme, { pptx: true })
        if (!image) return 0
        const maxW = CONTENT_W
        const maxH = Math.min(availH, 3.3)
        const scale = Math.min(maxW / image.width, maxH / image.height)
        const w = image.width * scale
        const h = image.height * scale
        slide.addImage({
          data: `image/png;base64,${image.png.toString('base64')}`,
          x: (SLIDE_W - w) / 2,
          y,
          w,
          h,
        })
        if (image.caption) {
          slide.addText(image.caption.slice(0, 120), {
            x: MARGIN,
            y: y + h + 0.02,
            w: CONTENT_W,
            h: 0.25,
            fontSize: 10,
            color: colors.muted,
            align: 'center',
            fontFace: fonts.bodyFont,
          })
        }
        return h + (image.caption ? 0.32 : 0.12)
      }

      case 'timeline':
      case 'diagram': {
        const image = await renderComponentImage(component, ctx.theme, { pptx: true })
        if (!image) return 0
        const maxW = CONTENT_W * 0.86
        const maxH = Math.min(availH, 3.1)
        const scale = Math.min(maxW / image.width, maxH / image.height)
        const w = image.width * scale
        const h = image.height * scale
        slide.addImage({
          data: `image/png;base64,${image.png.toString('base64')}`,
          x: (SLIDE_W - w) / 2,
          y,
          w,
          h,
        })
        if (image.caption) {
          slide.addText(image.caption.slice(0, 120), {
            x: MARGIN,
            y: y + h + 0.02,
            w: CONTENT_W,
            h: 0.25,
            fontSize: 10,
            color: colors.muted,
            align: 'center',
            fontFace: fonts.bodyFont,
          })
        }
        return h + (image.caption ? 0.32 : 0.12)
      }

      case 'code': {
        // CODE BLOCK slide element: monospace panel with a language tag.
        const block = asCodeBlock(component.content)
        if (!block) return 0
        const lines = block.code.split('\n').slice(0, 16)
        const truncated = block.code.split('\n').length - lines.length
        const lineCount = lines.length + (truncated > 0 ? 1 : 0)
        const h = Math.min(availH, 0.34 + lineCount * 0.21)
        slide.addShape('roundRect', {
          x: MARGIN,
          y,
          w: CONTENT_W,
          h,
          fill: { color: colors.dark ? '111C2E' : 'F8FAFC' },
          line: { color: colors.dark ? '334155' : 'E2E8F0', width: 1 },
          rectRadius: 0.05,
        })
        slide.addShape('rect', { x: MARGIN, y, w: 0.06, h, fill: { color: colors.accent } })
        const runs: Array<{ text: string; options?: Record<string, unknown> }> = []
        if (block.language) {
          runs.push({ text: block.language.toUpperCase(), options: { fontSize: 9, bold: true, color: colors.muted, breakLine: true } })
        }
        for (const l of lines) {
          runs.push({ text: l.length ? l : ' ', options: { breakLine: true } })
        }
        if (truncated > 0) {
          runs.push({ text: `… ${truncated} more lines`, options: { fontSize: 9, italic: true, color: colors.muted, breakLine: true } })
        }
        slide.addText(runs, {
          x: MARGIN + 0.18,
          y: y + 0.06,
          w: CONTENT_W - 0.36,
          h: h - 0.12,
          fontSize: 11,
          fontFace: 'Consolas',
          color: colors.dark ? 'E2E8F0' : colors.fg,
          valign: 'top',
        })
        return h + 0.18
      }

      case 'table': {
        // Tables are NEVER silently truncated: rows AND columns split across
        // continuation slides with the header row repeated on every chunk.
        const rows = asTable(component.content)
        if (rows.length === 0) return 0
        const [header, ...dataRows] = rows
        const colGroups: number[][] = []
        for (let cStart = 0; cStart < header.length; cStart += MAX_TABLE_COLS) {
          colGroups.push(
            Array.from({ length: Math.min(MAX_TABLE_COLS, header.length - cStart) }, (_, k) => cStart + k)
          )
        }
        const maxDataRows = Math.max(3, Math.min(6, Math.floor((availH - 0.4) / 0.3)))
        const drawChunk = (target: any, cols: number[], rowSlice: Array<Array<string | number | null>>) => {
          const tableRows = [header, ...rowSlice].map((r, ri) =>
            cols.map((ci) => ({
              text: String(r[ci] ?? ''),
              options: ri === 0
                ? { bold: true, color: 'FFFFFF', fill: { color: colors.primary }, fontSize: 11 }
                : { color: colors.dark ? 'E2E8F0' : colors.fg, fontSize: Math.max(MIN_BODY_PT, 11) },
            }))
          )
          target.addTable(tableRows, {
            x: MARGIN,
            y,
            w: CONTENT_W,
            border: { type: 'solid', color: colors.dark ? '334155' : 'E2E8F0', pt: 0.5 },
            rowH: 0.3,
            valign: 'middle',
          })
        }
        const chunk = dataRows.slice(0, maxDataRows)
        drawChunk(slide, colGroups[0], chunk)
        const h = Math.min(availH, 0.4 + (chunk.length + 1) * 0.3)
        let consumed = h + 0.2
        const moreRows = dataRows.length - chunk.length
        // Column groups beyond the first get their own continuation slides;
        // leftover rows get a final continuation slide.
        if (colGroups.length > 1 && ctx.addContinuationSlide) {
          for (let g = 1; g < colGroups.length; g++) {
            const label = ` (columns ${colGroups[g][0] + 1}–${colGroups[g][colGroups[g].length - 1] + 1})`
            ctx.addContinuationSlide((s) => drawChunk(s, colGroups[g], chunk), label)
          }
          if (moreRows > 0) {
            ctx.addContinuationSlide((s) => drawChunk(s, colGroups[0], dataRows.slice(maxDataRows)), ' (continued)')
          }
          slide.addText('table continues on the following slide(s)', {
            x: MARGIN,
            y: y + h + 0.02,
            w: CONTENT_W,
            h: 0.25,
            fontSize: 9,
            italic: true,
            color: colors.muted,
          })
          consumed = h + 0.32
        } else if (moreRows > 0) {
          slide.addText(`${moreRows} more rows in the source data`, {
            x: MARGIN,
            y: y + h + 0.02,
            w: CONTENT_W,
            h: 0.25,
            fontSize: 9,
            italic: true,
            color: colors.muted,
          })
          consumed = h + 0.32
        }
        return consumed
      }

      case 'two_column': {
        const data = asTwoColumn(component.content)
        if (!data) return 0
        const colW = (CONTENT_W - 0.3) / 2
        const mk = (title: string, points: string[], x: number) => {
          slide.addShape('rect', {
            x,
            y,
            w: colW,
            h: 1.6,
            fill: { color: colors.dark ? '111C2E' : 'FFFFFF' },
            line: { color: colors.dark ? '334155' : 'E2E8F0', width: 1 },
          })
          slide.addShape('rect', { x, y, w: colW, h: 0.05, fill: { color: colors.accent } })
          slide.addText(title, {
            x: x + 0.12,
            y: y + 0.08,
            w: colW - 0.24,
            h: 0.35,
            fontSize: 14,
            bold: true,
            color: colors.accent,
            fontFace: fonts.headingFont,
          })
          slide.addText(
            points.slice(0, 4).map((t) => ({ text: t.slice(0, 90), options: { bullet: { characterCode: '2022' }, breakLine: true } })),
            {
              x: x + 0.12,
              y: y + 0.45,
              w: colW - 0.24,
              h: 1.05,
              fontSize: Math.max(MIN_BODY_PT, 11),
              color: colors.dark ? 'CBD5E1' : colors.fg,
              fontFace: fonts.bodyFont,
              valign: 'top',
            }
          )
        }
        mk(data.leftTitle, data.leftPoints, MARGIN)
        mk(data.rightTitle, data.rightPoints, MARGIN + colW + 0.3)
        return 1.8
      }

      default: {
        const text = asString(component.content) || (component.content && typeof component.content === 'object' ? '' : '')
        if (!text) return 0
        return this.addComponent(slide, { ...component, type: 'paragraph' }, ctx)
      }
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
