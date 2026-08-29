// =============================================================================
// RENDERER SHARED HELPERS
// =============================================================================
// Component-content coercion (AI JSON → renderable primitives), theme-token
// derivation, and the shared image pipeline (charts + diagrams → PNG) used by
// the DOCX / PDF / PPTX renderers.
// =============================================================================

import type { ArtifactSpecification, BrandingConfig, ColorPalette } from '@/types'
import { THEMES, getTheme, chartPaletteFor, type ThemeTokens } from '@/services/themes'
import { normalizeChartSpec, renderChart, type NormalizedChart } from '@/services/chart-engine'
import { normalizeDiagramSpec, renderDiagram, type DiagramSpec } from '@/services/diagram-engine'
import { renderEquation, equationLatexOf } from '@/services/math-engine'
import type { RenderedEquation } from '@/services/math-engine'
import type { MathComponent } from 'docx'
import { latexToOmml } from '@/services/math-omml'

export type { RenderedEquation }
export { renderEquation, equationLatexOf, latexToOmml }
export type { MathComponent }

// ==================== RENDERER CONTRACT ====================

export interface RendererOutput {
  buffer: Buffer
  filename: string
  mimeType: string
  size: number
  /**
   * Renderer-level QA findings (formula fallbacks, data-relationship
   * corrections, chart placements). Surfaced in the job's QA summary so a
   * mechanical repair is never silent.
   */
  qa?: Record<string, unknown>
}

export interface DocumentRenderer {
  format: string
  render(document: RenderableDocument): Promise<RendererOutput>
}

// ==================== CANONICAL COMPONENT MODEL ====================

export type CanonicalComponentType =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'table'
  | 'quote'
  | 'metric_grid'
  | 'callout'
  | 'chart'
  | 'timeline'
  | 'key_takeaways'
  | 'two_column'
  | 'equation'
  | 'diagram'

export interface CanonicalComponent {
  sectionId: string
  componentId: string
  type: CanonicalComponentType
  content: unknown
  order: number
}

export interface RenderableSection {
  id: string
  type: string
  title: string
  order: number
  components: CanonicalComponent[]
}

export interface RenderableDocument {
  specification: ArtifactSpecification
  sections: RenderableSection[]
  branding?: BrandingConfig
}

const LOWER_MAP: Record<string, CanonicalComponentType> = {
  paragraph: 'paragraph',
  text: 'paragraph',
  heading: 'heading',
  list: 'list',
  table: 'table',
  quote: 'quote',
  metric_grid: 'metric_grid',
  callout: 'callout',
  chart: 'chart',
  timeline: 'timeline',
  key_takeaways: 'key_takeaways',
  two_column: 'two_column',
  equation: 'equation',
  math: 'equation',
  formula: 'equation',
  latex: 'equation',
  diagram: 'diagram',
  flowchart: 'diagram',
  process: 'diagram',
  hierarchy: 'diagram',
  org_chart: 'diagram',
  orgchart: 'diagram',
}

export function canonicalType(raw: string): CanonicalComponentType {
  const lower = String(raw || 'paragraph').toLowerCase()
  return LOWER_MAP[lower] ?? 'paragraph'
}

// ==================== CONTENT COERCION ====================

export function asString(content: unknown, fallback = ''): string {
  if (typeof content === 'string') return content
  if (typeof content === 'number') return String(content)
  if (content && typeof content === 'object') return ''
  return fallback
}

export function asStringArray(content: unknown): string[] {
  if (Array.isArray(content)) {
    return content
      .map((v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : v && typeof v === 'object' ? '' : ''))
      .filter((s) => s.trim().length > 0)
  }
  if (typeof content === 'string' && content.trim()) return [content]
  return []
}

export type TableCell = string | number | null

export function asTable(content: unknown): TableCell[][] {
  if (!Array.isArray(content)) return []
  return content
    .map((row) =>
      Array.isArray(row)
        ? row.map((cell) => (cell === null || cell === undefined ? null : typeof cell === 'number' ? cell : String(cell)))
        : [String(row)])
    .filter((row) => row.length > 0)
}

export interface MetricItem {
  label: string
  value: string
  change?: string
  unit?: string
}

export function asMetrics(content: unknown): MetricItem[] {
  if (!Array.isArray(content)) {
    if (content && typeof content === 'object') {
      const o = content as Record<string, unknown>
      if (o.metrics && Array.isArray(o.metrics)) return asMetrics(o.metrics)
    }
    return []
  }
  const items: MetricItem[] = []
  for (const m of content) {
    if (typeof m === 'string') {
      items.push({ label: '', value: m })
    } else if (m && typeof m === 'object') {
      const o = m as Record<string, unknown>
      items.push({
        label: String(o.label ?? o.name ?? ''),
        value: String(o.value ?? o.metric ?? ''),
        change: o.change ? String(o.change) : undefined,
        unit: o.unit ? String(o.unit) : undefined,
      })
    }
  }
  return items.filter((m) => m.value !== '')
}

export interface TwoColumnData {
  leftTitle: string
  leftPoints: string[]
  rightTitle: string
  rightPoints: string[]
}

export function asTwoColumn(content: unknown): TwoColumnData | null {
  if (!content || typeof content !== 'object') return null
  const o = content as Record<string, unknown>
  const left = Array.isArray(o.leftPoints) ? asStringArray(o.leftPoints) : []
  const right = Array.isArray(o.rightPoints) ? asStringArray(o.rightPoints) : []
  if (left.length === 0 && right.length === 0) return null
  return {
    leftTitle: String(o.leftTitle ?? 'Option A'),
    leftPoints: left,
    rightTitle: String(o.rightTitle ?? 'Option B'),
    rightPoints: right,
  }
}

export function asChart(content: unknown): NormalizedChart | null {
  return normalizeChartSpec(content)
}

// ==================== THEME DERIVATION ====================

export interface DerivedTheme {
  tokens: ThemeTokens
  colors: ColorPalette
  accent: string
  chartPalette: string[]
}

/**
 * Derive renderer hints from a specification's design. Matches the design's
 * theme name against the registry; falls back to deriving tokens from the
 * design's own colors so legacy blueprints (pre-theme-engine) still render.
 */
export function deriveTheme(spec: ArtifactSpecification): DerivedTheme {
  const design = spec.design
  const themeName = design?.theme?.name
  let tokens: ThemeTokens
  if (themeName && THEMES.some((t) => t.id === themeName.toLowerCase())) {
    tokens = getTheme(themeName)
  } else {
    tokens = getTheme('executive')
  }
  const colors: ColorPalette = {
    ...tokens.colors,
    ...(design?.colors ?? {}),
  }
  const accent = colors.accent || tokens.colors.accent
  return {
    tokens,
    colors,
    accent,
    chartPalette: chartPaletteFor(tokens, accent),
  }
}

// ==================== IMAGE PIPELINE (charts + diagrams) ====================

export interface RenderedImage {
  png: Buffer
  width: number
  height: number
  caption?: string
}

/**
 * Normalize a DIAGRAM component (flowchart/process/hierarchy) into a
 * DiagramSpec. Bare arrays become timelines (AI-canonical shape); objects
 * carry an explicit kind. Returns null when fewer than 2 usable steps.
 */
export function asDiagram(content: unknown): DiagramSpec | null {
  return normalizeDiagramSpec(content)
}

/** Rasterize a CHART, TIMELINE, DIAGRAM or EQUATION component to a PNG. */
export async function renderComponentImage(
  component: CanonicalComponent,
  theme: DerivedTheme,
  opts?: { width?: number; pptx?: boolean; display?: boolean }
): Promise<RenderedImage | null> {
  if (component.type === 'equation') {
    const eq = await renderEquation(component.content, {
      color: withHash(theme.colors.foreground, '#1F2937'),
      display: opts?.display ?? true,
    })
    if (eq) {
      return {
        png: eq.png,
        width: eq.width,
        height: eq.height,
        caption: undefined,
      }
    }
    // MathJax refused the expression — the renderer renders the raw LaTeX
    // visibly (honest fallback), never a silent drop.
    return null
  }
  if (component.type === 'diagram') {
    const spec = asDiagram(component.content)
    if (!spec) return null
    const diagram = await renderDiagram(spec, {
      width: opts?.width ?? (opts?.pptx ? 600 : 620),
      colors: theme.colors,
    })
    if (!diagram) return null
    return {
      png: diagram.png,
      width: diagram.width,
      height: diagram.height,
      caption: spec.title?.trim() || undefined,
    }
  }
  if (component.type === 'chart') {
    const spec = asChart(component.content)
    if (!spec) return null
    const chart = await renderChart(spec, {
      width: opts?.width ?? (opts?.pptx ? 560 : 620),
      height: opts?.pptx ? 320 : 360,
      palette: theme.chartPalette,
      colors: theme.colors,
    })
    if (!chart) return null
    // Caption carries the chart TITLE (not just the note): the title is the
    // identity of the figure in the document text layer — it must be
    // selectable/searchable text, not pixels inside the PNG.
    const caption = [spec.title?.trim(), spec.note?.trim()].filter(Boolean).join(' — ') || undefined
    return { png: chart.png, width: chart.width, height: chart.height, caption }
  }
  if (component.type === 'timeline') {
    const content = component.content
    // A bare array is the AI-canonical timeline shape (planning rule 10) —
    // do NOT spread it into an object (spread loses array elements).
    const spec = normalizeDiagramSpec(
      Array.isArray(content) ? { kind: 'timeline', steps: content } : { kind: 'timeline', ...(content && typeof content === 'object' ? (content as Record<string, unknown>) : {}) }
    )
    if (!spec) return null
    const diagram = await renderDiagram(spec, { width: opts?.width ?? (opts?.pptx ? 600 : 620), colors: theme.colors })
    if (!diagram) return null
    return { png: diagram.png, width: diagram.width, height: diagram.height }
  }
  return null
}

// ==================== COLOR / TEXT UTILS ====================

/** '#1e3a5f' → '1E3A5F' (docx/pptx want hex WITHOUT the hash). */
export function hex6(color: string | undefined, fallback = '1E3A5F'): string {
  const c = String(color || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.slice(1).toUpperCase()
  if (/^[0-9a-fA-F]{6}$/.test(c)) return c.toUpperCase()
  return fallback
}

export function withHash(color: string | undefined, fallback = '#1e3a5f'): string {
  const c = String(color || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c
  if (/^[0-9a-fA-F]{6}$/.test(c)) return `#${c}`
  return fallback
}

/** Lighten a hex color by mixing toward white (factor 0..1). */
export function tint(color: string, factor: number): string {
  const base = withHash(color).slice(1)
  const r = parseInt(base.slice(0, 2), 16)
  const g = parseInt(base.slice(2, 4), 16)
  const b = parseInt(base.slice(4, 6), 16)
  const mix = (v: number) => Math.round(v + (255 - v) * factor)
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Professional filename (spec §44): Title Case → Snake_Case + year + ext. */
export function buildArtifactFilename(title: string, format: string): string {
  const year = new Date().getFullYear()
  const base =
    String(title || 'Generated_Document')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/['’]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'Generated_Document'
  const ext = String(format || 'docx').toLowerCase()
  const withYear = /_\d{4}$/.test(base) ? base : `${base}_${year}`
  return `${withYear}.${ext}`
}

export const MIME_BY_FORMAT: Record<string, string> = {
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  PDF: 'application/pdf',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  CSV: 'text/csv',
  TXT: 'text/plain',
  HTML: 'text/html',
  MD: 'text/markdown',
}
