// =============================================================================
// FILO DIAGRAM ENGINE v2 — SVG PRIMITIVES
// =============================================================================
// Deterministic drawing helpers shared by every diagram layout: theme palette
// derivation, glyph-accurate text measurement (bundled DejaVu via fontkit),
// wrapping, node shapes, orthogonal edge routing and PNG rasterization.
//
// SECURITY MODEL: every label passes through esc() before entering the SVG and
// all geometry is computed from numbers — the AI can never inject markup,
// scripts or external references into the artwork. Labels are additionally
// stripped of characters the bundled font cannot render, so raster output can
// never contain .notdef tofu boxes.
// =============================================================================

import type { ColorPalette } from '@/types'
import {
  RASTER_FONT_FAMILY,
  RASTER_FONT_STACK,
  ensureRasterizerFonts,
  measureText,
} from '@/services/typography/fonts'
import type { DiagramNode, DiagramNodeShape, DiagramPalette, RenderedDiagram } from './types'
import { normalizeDiagramSpec } from './validate'
import type { DiagramSpec } from './types'

export { RASTER_FONT_STACK as FONT_STACK }

// ==================== PALETTE ====================

const FALLBACK_PALETTE: DiagramPalette = {
  primary: '#1e3a5f',
  accent: '#3b82f6',
  fg: '#1f2937',
  muted: '#f1f5f9',
  mutedForeground: '#64748b',
  border: '#d7dee8',
  card: '#ffffff',
  canvas: '#ffffff',
  edge: '#8fa0b3',
}

export function buildPalette(colors?: Partial<ColorPalette>, background?: string): DiagramPalette {
  const c = colors ?? {}
  return {
    primary: withHash(c.primary, FALLBACK_PALETTE.primary),
    accent: withHash(c.accent, FALLBACK_PALETTE.accent),
    fg: withHash(c.foreground, FALLBACK_PALETTE.fg),
    muted: withHash(c.muted, FALLBACK_PALETTE.muted),
    mutedForeground: withHash(c.mutedForeground, FALLBACK_PALETTE.mutedForeground),
    border: withHash(c.border, FALLBACK_PALETTE.border),
    card: withHash(c.card, FALLBACK_PALETTE.card),
    canvas: background ? withHash(background, FALLBACK_PALETTE.canvas) : withHash(c.background, FALLBACK_PALETTE.card),
    edge: mix(withHash(c.mutedForeground, FALLBACK_PALETTE.mutedForeground), withHash(c.border, FALLBACK_PALETTE.border), 0.45),
  }
}

export function withHash(color: string | undefined, fallback: string): string {
  const c = String(color ?? '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c
  if (/^#[0-9a-fA-F]{3}$/.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`
  if (/^[0-9a-fA-F]{6}$/.test(c)) return `#${c}`
  return fallback
}

export function mix(a: string, b: string, t: number): string {
  const pa = hexRgb(a)
  const pb = hexRgb(b)
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `#${[ch(pa[0], pb[0]), ch(pa[1], pb[1]), ch(pa[2], pb[2])].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function tint(color: string, factor: number): string {
  return mix(color, '#ffffff', factor)
}

export function shade(color: string, factor: number): string {
  return mix(color, '#000000', factor)
}

function hexRgb(color: string): [number, number, number] {
  const c = withHash(color, '#888888').slice(1)
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]
}

/** Perceived luminance 0..1 — decides white vs dark text on fills. */
export function luminance(color: string): number {
  const [r, g, b] = hexRgb(color)
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function readableOn(background: string, dark = '#ffffff', light = '#1f2937'): string {
  return luminance(background) < 0.42 ? dark : light
}

// ==================== TEXT ====================

const MEASURE_FONT: { file: string | null } = { file: null }

function measureFontFile(): string | null {
  if (MEASURE_FONT.file === null) {
    // Lazily resolve the bundled DejaVu Sans for measurement (cached).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fonts = require('@/services/typography/fonts') as typeof import('@/services/typography/fonts')
      MEASURE_FONT.file = fonts.bundledFontPath('DejaVuSans.ttf')
    } catch {
      MEASURE_FONT.file = undefined as unknown as string | null
    }
  }
  return MEASURE_FONT.file
}

export function textWidth(text: string, fontSize: number, weight: 400 | 600 | 700 = 400): number {
  const file = measureFontFile()
  const w = file
    ? measureText(file, text, fontSize)
    : text.length * fontSize * 0.62
  // Bold advances ~6% wider in DejaVu.
  return weight === 400 ? w : w * 1.06
}

/** Greedy word wrap against a measured pixel width; …-truncates overflow. */
export function wrapText(text: string, maxWidthPx: number, fontSize: number, maxLines: number, weight: 400 | 600 | 700 = 400): string[] {
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  let line = ''
  let overflowed = false
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (textWidth(candidate, fontSize, weight) <= maxWidthPx || !line) {
      line = candidate
    } else {
      if (lines.length === maxLines - 1) {
        // This word (and the rest) will not fit — ellipsize the last line.
        overflowed = true
        break
      }
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (overflowed && lines.length) {
    let last = lines[maxLines - 1]
    while (last.length > 3 && textWidth(`${last}…`, fontSize, weight) > maxWidthPx) {
      last = last.slice(0, -1)
    }
    lines[maxLines - 1] = `${last}…`
  }
  return lines.slice(0, maxLines)
}

// ==================== SANITIZATION ====================

const ENTITY_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

export function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ENTITY_MAP[ch])
}

const uncoveredCache = new Map<number, boolean>()

/** True when the bundled raster font has a glyph for this codepoint. */
function fontHasChar(cp: number): boolean {
  const cached = uncoveredCache.get(cp)
  if (cached !== undefined) return cached
  let has = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fontkit = require('fontkit') as { openSync(p: string): { hasGlyphForCodePoint(cp: number): boolean } | null }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fonts = require('@/services/typography/fonts') as typeof import('@/services/typography/fonts')
    const file = fonts.bundledFontPath('DejaVuSans.ttf')
    has = file ? Boolean(fontkit.openSync(file)?.hasGlyphForCodePoint(cp)) : true
  } catch {
    has = true
  }
  uncoveredCache.set(cp, has)
  return has
}

/**
 * Remove characters the raster font cannot display (emoji, exotic symbols).
 * This is the final guarantee against tofu in rasterized artwork.
 */
export function rasterSafeText(text: string): string {
  return String(text ?? '')
    .replace(/\r\n/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .split('')
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0
      if (cp < 0x20) return false
      if (cp === 0xfeff || (cp >= 0x200b && cp <= 0x200d)) return false
      return fontHasChar(cp)
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

// ==================== SHAPES ====================

export interface NodeGeometry {
  x: number
  y: number
  w: number
  h: number
}

export interface RenderedNode {
  node: DiagramNode
  shape: DiagramNodeShape
  geometry: NodeGeometry
  labelLines: string[]
  descLines: string[]
  attrLines: string[]
  fill: string
  stroke: string
  textFill: string
  labelSize: number
  descSize: number
}

export function shapeFor(node: DiagramNode, kind: string): DiagramNodeShape {
  if (node.shape) return node.shape
  const label = node.label.toLowerCase()
  if (kind === 'er') return 'entity'
  if (kind === 'decision_tree' || kind === 'flowchart') {
    if (/^(start|begin|init)/.test(label) || /(start|begin)$/.test(label)) return 'stadium'
    if (/^(end|finish|complete|done|final|approved|rejected)/.test(label) || /(end|finish|complete|done|final|approved|rejected)$/.test(label)) return 'stadium'
    if (/\?$/.test(label) || /^(check|decide|review|evaluate|is |has |does |should )/.test(label)) return 'diamond'
  }
  if (kind === 'timeline' || kind === 'sequence') return 'rounded'
  return 'rounded'
}

export interface NodeSizing {
  labelSize: number
  descSize: number
  padX: number
  padY: number
  lineHeight: number
  maxTextWidth: number
  maxLines: number
  maxDescLines: number
}

/** Measure a node box for its wrapped content. */
export function sizeNode(nodeIn: DiagramNode, shape: DiagramNodeShape, s: NodeSizing): { w: number; h: number; labelLines: string[]; descLines: string[]; attrLines: string[] } {
  // Raster-safe text: strip anything the bundled font cannot render (emoji,
  // exotic symbols) so rasterized output can never contain tofu boxes.
  const node: DiagramNode = {
    ...nodeIn,
    label: rasterSafeText(nodeIn.label) || nodeIn.label.slice(0, 1),
    description: nodeIn.description ? rasterSafeText(nodeIn.description) : undefined,
    attributes: nodeIn.attributes?.map((a) => rasterSafeText(a)).filter(Boolean),
  }
  const labelLines = wrapText(node.label, s.maxTextWidth, s.labelSize, s.maxLines, 600)
  const descLines = node.description ? wrapText(node.description, s.maxTextWidth, s.descSize, s.maxDescLines, 400) : []
  const attrLines = node.attributes ? node.attributes.flatMap((a) => wrapText(a, s.maxTextWidth, s.descSize, 1, 400)) : []
  const textW = Math.max(
    ...labelLines.map((l) => textWidth(l, s.labelSize, 600)),
    ...(descLines.length ? descLines.map((l) => textWidth(l, s.descSize, 400)) : [0]),
    ...(attrLines.length ? attrLines.map((l) => textWidth(l, s.descSize, 400)) : [0]),
    24
  )
  const contentH =
    labelLines.length * s.labelSize * s.lineHeight +
    descLines.length * s.descSize * s.lineHeight +
    attrLines.length * s.descSize * s.lineHeight +
    (attrLines.length ? 6 : 0)
  let w = Math.ceil(textW + s.padX * 2)
  let h = Math.ceil(contentH + s.padY * 2)
  if (shape === 'diamond') {
    // A diamond needs ~1.9× the text box to keep glyphs inside the rhombus.
    w = Math.ceil(Math.max(w * 1.75, 130))
    h = Math.ceil(Math.max(h * 1.9, 76))
  }
  if (shape === 'stadium') {
    h = Math.ceil(Math.max(h, w * 0.32))
  }
  if (shape === 'entity') {
    h = Math.ceil(contentH + s.padY * 2 + 8)
  }
  return { w: Math.max(w, 64), h, labelLines, descLines, attrLines }
}

/** Draw a node (fill/stroke/text) at its geometry. All text is escaped. */
export function drawNode(rn: RenderedNode, pal: DiagramPalette): string {
  const { x, y, w, h } = rn.geometry
  const cx = x + w / 2
  const cy = y + h / 2
  const parts: string[] = []
  const fontAttr = `font-family="${RASTER_FONT_STACK}"`

  if (rn.shape === 'diamond') {
    const pts = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`
    parts.push(`<polygon points="${pts}" fill="${rn.fill}" stroke="${rn.stroke}" stroke-width="1.5"/>`)
  } else {
    const rx = rn.shape === 'stadium' ? h / 2 : rn.shape === 'entity' ? 4 : 10
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${rn.fill}" stroke="${rn.stroke}" stroke-width="1.4"/>`)
    if (rn.shape === 'entity') {
      // Title band for ER entities.
      const bandH = rn.labelLines.length * rn.labelSize * 1.3 + 14
      parts.push(`<path d="M ${x} ${y + bandH} H ${x + w}" stroke="${rn.stroke}" stroke-width="1.2"/>`)
    }
  }

  // Center the text block vertically.
  const lineH = (size: number) => size * 1.32
  const blockH =
    rn.labelLines.length * lineH(rn.labelSize) +
    rn.descLines.length * lineH(rn.descSize) +
    rn.attrLines.length * lineH(rn.descSize) +
    (rn.attrLines.length ? 8 : 0) +
    (rn.shape === 'entity' ? 6 : 0)
  let ty = cy - blockH / 2 + lineH(rn.labelSize) / 2 + 4
  if (rn.shape === 'entity') ty += 4

  for (const line of rn.labelLines) {
    parts.push(`<text x="${cx}" y="${ty}" text-anchor="middle" ${fontAttr} font-size="${rn.labelSize}" font-weight="600" fill="${rn.textFill}">${esc(line)}</text>`)
    ty += lineH(rn.labelSize)
  }
  for (const line of rn.descLines) {
    parts.push(`<text x="${cx}" y="${ty}" text-anchor="middle" ${fontAttr} font-size="${rn.descSize}" fill="${pal.mutedForeground === rn.fill ? pal.mutedForeground : shade(rn.textFill === '#ffffff' ? '#ffffff' : pal.fg, 0.05)}" opacity="${rn.textFill === '#ffffff' ? 0.82 : 0.85}">${esc(line)}</text>`)
    ty += lineH(rn.descSize)
  }
  if (rn.attrLines.length) ty += 2
  for (const line of rn.attrLines) {
    parts.push(`<text x="${x + 12}" y="${ty}" text-anchor="start" ${fontAttr} font-size="${rn.descSize}" fill="${pal.fg}" opacity="0.85">• ${esc(line)}</text>`)
    ty += lineH(rn.descSize)
  }
  return parts.join('')
}

// ==================== EDGES ====================

export interface EdgeDraw {
  points: Array<{ x: number; y: number }>
  label?: string
  dashed?: boolean
  color: string
  id: number
}

/** Polyline → path with rounded elbows (quadratic corners). */
export function edgePath(points: Array<{ x: number; y: number }>, radius = 9): string {
  if (points.length < 2) return ''
  const d: string[] = [`M ${points[0].x} ${points[0].y}`]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.min(radius, d1 / 2, d2 / 2)
    const p1 = { x: cur.x - ((cur.x - prev.x) / (d1 || 1)) * r, y: cur.y - ((cur.y - prev.y) / (d1 || 1)) * r }
    const p2 = { x: cur.x + ((next.x - cur.x) / (d2 || 1)) * r, y: cur.y + ((next.y - cur.y) / (d2 || 1)) * r }
    d.push(`L ${p1.x} ${p1.y}`, `Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`)
  }
  const last = points[points.length - 1]
  d.push(`L ${last.x} ${last.y}`)
  return d.join(' ')
}

let markerSeq = 0

/** Deterministic output: the per-render counter resets on every facade call. */
export function resetMarkerSequence(): void {
  markerSeq = 0
}

export function openSvg(width: number, height: number, pal: DiagramPalette): { head: string; markerId: string } {
  const markerId = `arrow-${++markerSeq}`
  ensureRasterizerFonts()
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse">` +
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="${pal.edge}"/></marker>` +
    `<marker id="${markerId}-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse">` +
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="${pal.accent}"/></marker></defs>` +
    `<rect width="${width}" height="${height}" fill="${pal.canvas}" rx="10"/>`
  return { head, markerId }
}

export function drawEdge(e: EdgeDraw, markerId: string, pal: DiagramPalette): string {
  const accent = e.color === 'accent'
  const stroke = accent ? pal.accent : e.color || pal.edge
  const marker = accent ? `${markerId}-a` : markerId
  const path = edgePath(e.points)
  const dash = e.dashed ? ` stroke-dasharray="6 4"` : ''
  let out = `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.7"${dash} marker-end="url(#${marker})"/>`
  if (e.label) {
    // Label chip at the polyline midpoint.
    const mid = e.points[Math.floor((e.points.length - 1) / 2)] ?? e.points[0]
    const safe = rasterSafeText(e.label)
    if (safe) {
      const lines = wrapText(safe, 110, 10.5, 2, 600)
      const w = Math.max(...lines.map((l) => textWidth(l, 10.5, 600))) + 12
      const h = lines.length * 13 + 6
      out += `<rect x="${mid.x - w / 2}" y="${mid.y - h / 2}" width="${w}" height="${h}" rx="6" fill="${pal.canvas}" stroke="${pal.border}" stroke-width="1"/>`
      let ly = mid.y - h / 2 + 12.5
      for (const line of lines) {
        out += `<text x="${mid.x}" y="${ly}" text-anchor="middle" font-family="${RASTER_FONT_STACK}" font-size="10.5" font-weight="600" fill="${pal.mutedForeground}">${esc(line)}</text>`
        ly += 13
      }
    }
  }
  return out
}

// ==================== CANVAS ====================

export function svgTitle(title: string, pal: DiagramPalette, y = 30): string {
  const safe = rasterSafeText(title)
  if (!safe) return ''
  return `<text x="50%" y="${y}" text-anchor="middle" font-family="${RASTER_FONT_STACK}" font-size="15" font-weight="700" fill="${pal.fg}">${esc(safe)}</text>`
}

export function closeSvg(parts: string[]): string {
  return `${parts.join('')}</svg>`
}

// ==================== RASTERIZATION ====================

/**
 * Rasterize the diagram SVG to PNG at 2× through sharp. Font bootstrap runs
 * BEFORE the first sharp import so librsvg always sees the bundled fonts.
 */
export async function rasterizeSvg(svg: string, logicalWidth: number, logicalHeight: number): Promise<Buffer | null> {
  try {
    ensureRasterizerFonts()
    const sharp = (await import('sharp')).default
    const png = await sharp(Buffer.from(svg), { density: 192 }).png().toBuffer()
    return png
  } catch {
    return null
  }
}

// ==================== FACADE SHARED WITH LAYOUTS ====================

export interface LayoutResult {
  svg: string
  width: number
  height: number
}

export type LayoutFn = (spec: DiagramSpec, pal: DiagramPalette) => LayoutResult

/** Shared facade: normalize → layout → rasterize. */
export async function renderSpec(normalized: DiagramSpec | null, layout: LayoutFn, opts?: { width?: number; colors?: Partial<ColorPalette>; background?: string }): Promise<RenderedDiagram | null> {
  // The caller (index.ts facade) normalizes ONCE — re-normalizing here would
  // discard the repairs recorded during the first pass.
  if (!normalized) return null
  resetMarkerSequence()
  const pal = buildPalette(opts?.colors as Partial<ColorPalette> | undefined, opts?.background)
  const result = layout(normalized, pal)
  const png = await rasterizeSvg(result.svg, result.width, result.height)
  return {
    png,
    width: result.width,
    height: result.height,
    svg: result.svg,
    kind: normalized.kind,
    repairs: normalized.repairs,
  }
}

export type { DiagramSpec }
