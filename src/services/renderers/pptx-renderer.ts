// =============================================================================
// PPTX RENDERER (spec §14) — presentation-grade slides via pptxgenjs
// =============================================================================
// Layout-first slide construction with consistent theme tokens:
//   • cover slide with accent geometry + title/subtitle/date
//   • section dividers, bullet layouts, metric slides (big numbers),
//     chart slides (PNG from the chart engine), table slides, two-column,
//     timeline slides, quote slides, closing slide
//   • overflow guards: per-slide text budget, bullet caps, height tracking
//     with break-to-next-slide, min font sizes
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
} from './shared'

const SLIDE_W = 10 // inches (16:9)
const SLIDE_H = 5.625
const MARGIN = 0.5
const CONTENT_W = SLIDE_W - MARGIN * 2
const MIN_BODY_PT = 12
const MAX_BULLETS = 6

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
    const upperHeadings = theme.tokens.headingCase === 'upper'

    const sections = spec.sections
    const coverSection = sections[0]?.type === 'cover' ? sections[0] : null
    const contentSections = coverSection ? sections.slice(1) : sections

    // ---------------- COVER SLIDE ----------------
    const cover = pres.addSlide()
    cover.background = { color: dark ? '0B1220' : hex6(colors.muted, 'F8FAFC') }
    // accent geometry
    cover.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.18, fill: { color: primary } })
    cover.addShape('rect', { x: MARGIN, y: SLIDE_H - 0.75, w: 2.2, h: 0.06, fill: { color: accent } })
    const coverTitle = coverSection?.title ?? (spec.title || 'Untitled')
    cover.addText(upperHeadings ? coverTitle.toUpperCase() : coverTitle, {
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

    // ---------------- CONTENT SLIDES ----------------
    for (const section of contentSections) {
      const components = (document.sections.find((s) => s.id === section.id)?.components ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)

      // Section divider for 'heading'-type sections with no real content
      if (section.type === 'heading' && components.length <= 1) {
        const divider = pres.addSlide()
        divider.background = { color: dark ? '0B1220' : 'FFFFFF' }
        divider.addShape('rect', { x: MARGIN, y: SLIDE_H / 2 - 0.6, w: 0.08, h: 1.2, fill: { color: accent } })
        const dividerTitle = section.title
        divider.addText(upperHeadings ? dividerTitle.toUpperCase() : dividerTitle, {
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
        continue
      }

      // Partition components into slide-sized groups (overflow guard).
      const groups = this.groupComponents(components)
      for (const group of groups) {
        const slide = pres.addSlide()
        slide.background = { color: bg }
        // Title bar
        slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.1, fill: { color: accent } })
        const st = section.title
        slide.addText(upperHeadings ? st.toUpperCase() : st, {
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

        for (const component of group) {
          if (y > bottomLimit - 0.4) break
          const consumed = await this.addComponent(slide, component, {
            y,
            bottomLimit,
            colors: { fg, primary, accent, muted, dark },
            fonts: { headingFont, bodyFont },
            theme,
          })
          y += consumed
          if (typeof component.content === 'string') {
            speakerNotes += `${component.content.slice(0, 200)} `
          }
        }

        // Slide number
        slideCount++
        slide.addText(String(slideCount), {
          x: SLIDE_W - 0.7,
          y: SLIDE_H - 0.42,
          w: 0.4,
          h: 0.3,
          fontSize: 10,
          color: dark ? '64748B' : '94A3B8',
          align: 'right',
        })

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
        return 3.1
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
        const len = asString(c.content).length
        return Math.min(4, 0.3 + (len / 90) * 0.42)
      }
    }
  }

  // ---------------- COMPONENT RENDERING ----------------

  private async addComponent(
    slide: any,
    component: CanonicalComponent,
    ctx: {
      y: number
      bottomLimit: number
      colors: { fg: string; primary: string; accent: string; muted: string; dark: boolean }
      fonts: { headingFont: string; bodyFont: string }
      theme: ReturnType<typeof deriveTheme>
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
        const capped = text.slice(0, 700)
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

      case 'chart':
      case 'timeline': {
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

      case 'table': {
        const rows = asTable(component.content).slice(0, 7)
        if (rows.length === 0) return 0
        const tableRows = rows.map((r, ri) =>
          r.slice(0, 6).map((cell) => ({
            text: String(cell ?? ''),
            options: ri === 0
              ? { bold: true, color: 'FFFFFF', fill: { color: colors.primary }, fontSize: 11 }
              : { color: colors.dark ? 'E2E8F0' : colors.fg, fontSize: Math.max(MIN_BODY_PT, 11) },
          }))
        )
        const h = Math.min(availH, 0.4 + rows.length * 0.3)
        slide.addTable(tableRows, {
          x: MARGIN,
          y,
          w: CONTENT_W,
          border: { type: 'solid', color: colors.dark ? '334155' : 'E2E8F0', pt: 0.5 },
          rowH: 0.3,
          valign: 'middle',
        })
        return h + 0.2
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
