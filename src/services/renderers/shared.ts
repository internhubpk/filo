// =============================================================================
// RENDERER SHARED HELPERS
// =============================================================================
// Component-content coercion (AI JSON → renderable primitives), theme-token
// derivation, and the shared image pipeline (charts + diagrams → PNG) used by
// the DOCX / PDF / PPTX renderers.
// =============================================================================

import type { ArtifactSpecification, BrandingConfig, ColorPalette } from '@/types'
import {
  THEMES,
  getTheme,
  chartPaletteFor,
  headingOrnamentFor,
  footerStyleFor,
  type ThemeTokens,
  type HeadingOrnament,
  type FooterStyle,
} from '@/services/themes'
import { normalizeChartSpec, renderChart, type NormalizedChart } from '@/services/chart-engine'
import { normalizeDiagramSpec, renderDiagram, type DiagramSpec } from '@/services/diagram'
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

// The canonical component vocabulary + validators live in services/ast.ts —
// the single source of truth shared by renderers, QA and tests.
export {
  CANONICAL_COMPONENT_TYPES,
  canonicalType,
  validateChartContent,
  validateCodeContent,
  validateEquationContent,
  validateTableContent,
  validateComponent,
} from '@/services/ast'
import { canonicalType as canonicalTypeOf, type CanonicalComponentType as CanonicalType } from '@/services/ast'

export type CanonicalComponentType = CanonicalType
export type { CanonicalComponent as AstCanonicalComponent } from '@/services/ast'

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

export interface CodeBlockData {
  language: string
  code: string
}

/**
 * Coerce a CODE component into { language, code }. Accepts the canonical AI
 * shape ({language, code}), {language, content}, a bare string, or a legacy
 * string with a leading ```language fence (the model sometimes wraps code in
 * fences INSIDE the content — strip them so blocks are not double-fenced).
 */
export function asCodeBlock(content: unknown): CodeBlockData | null {
  let language = ''
  let code = ''
  if (typeof content === 'string') {
    code = content
  } else if (content && typeof content === 'object') {
    const o = content as Record<string, unknown>
    language = typeof o.language === 'string' ? o.language.trim() : ''
    const raw = o.code ?? o.content ?? o.text ?? o.source
    code = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map(String).join('\n') : ''
  }
  code = code.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '')
  // Strip a single wrapping fence (```lang\n ... \n```).
  const fence = /^```([A-Za-z0-9+#_-]*)\n([\s\S]*?)\n?```$/.exec(code)
  if (fence) {
    if (!language) language = fence[1] || ''
    code = fence[2]
  }
  if (!code.trim()) return null
  return { language: language.slice(0, 24), code }
}

// ==================== THEME DERIVATION ====================

export interface DerivedTheme {
  tokens: ThemeTokens
  colors: ColorPalette
  accent: string
  chartPalette: string[]
  /** Structural design dialect — renderers MUST honor these. */
  ornament: HeadingOrnament
  footer: FooterStyle
  cover: ThemeTokens['cover']
  table: ThemeTokens['table']
  headingCase: ThemeTokens['headingCase']
  /** Typography tokens (fonts/sizes/line-height) — renderers MUST consume. */
  typography: ThemeTokens['typography']
  /** Spacing tokens (paragraph/section spacing) — renderers MUST consume. */
  spacing: ThemeTokens['spacing']
}

/**
 * The generic fallback palette emitted by getDefaultDesign() for blueprints
 * that never went through the designer stage. When a blueprint carries these
 * EXACT colors, they are NOT an intentional design decision — they are the
 * absence of one. Spreading them over the resolved theme tokens used to
 * flatten every document to the same black/blue/slate look ("shitty
 * coloring on every document"), so they are detected and ignored.
 */
const GENERIC_FALLBACK_COLORS = new Set([
  '#1a1a1a', '#333333', '#3b82f6', '#ffffff', '#0f172a', '#f1f5f9',
  '#64748b', '#e2e8f0', '#16a34a', '#f59e0b', '#dc2626', '#2563eb',
])

function hasIntentionalColors(colors: ColorPalette | undefined): boolean {
  if (!colors) return false
  const entries = Object.entries(colors).filter(([k]) => k !== 'accent') as Array<[string, string]>
  if (entries.length === 0) return false
  const generic = entries.filter(([, v]) => GENERIC_FALLBACK_COLORS.has(String(v ?? '').toLowerCase()))
  // Accent is always allowed through (the designer may legitimately tune it).
  return generic.length < entries.length
}

/**
 * Derive renderer hints from a specification's design. Matches the design's
 * theme name against the registry; falls back to deriving tokens from the
 * design's own colors so legacy blueprints (pre-theme-engine) still render.
 */
export function deriveTheme(spec: ArtifactSpecification): DerivedTheme {
  const design = spec.design
  const themeName = design?.theme?.name
  const resolvesInRegistry = Boolean(themeName && THEMES.some((t) => t.id === themeName.toLowerCase()))
  const tokens = resolvesInRegistry ? getTheme(themeName) : getTheme('executive')

  // REGISTRY-FIRST COLORS: when the blueprint's theme resolves in the
  // registry, the registry palette IS the design. Only override it when the
  // blueprint carries INTENTIONAL colors (e.g. the designer's accent tune, a
  // brand palette); the generic default palette is ignored.
  const colors: ColorPalette = { ...tokens.colors }
  if (resolvesInRegistry) {
    if (design?.colors?.accent && /^#[0-9a-fA-F]{6}$/.test(design.colors.accent)) {
      colors.accent = design.colors.accent
    }
    if (hasIntentionalColors(design?.colors)) {
      Object.assign(colors, design?.colors)
    }
  } else if (hasIntentionalColors(design?.colors)) {
    Object.assign(colors, design?.colors)
  }
  const accent = colors.accent || tokens.colors.accent

  // PRINT-SAFETY REMAP: dark-canvas themes (professional-dark) are designed
  // for screens — PPTX paints their dark background, but DOCX/PDF render on
  // WHITE paper. Without this remap those documents shipped near-white
  // headings on white pages — invisible text. For paper formats we keep the
  // theme's accent identity and derive a light-canvas palette.
  const format = String(spec.outputFormat || '').toUpperCase()
  const isPaperFormat = format === 'DOCX' || format === 'PDF'
  if (isPaperFormat && isDarkColor(tokens.colors.background)) {
    const safePrimary = isDarkColor(accent) ? accent : '#334155'
    Object.assign(colors, {
      background: '#FFFFFF',
      card: '#FFFFFF',
      foreground: '#111827',
      primary: safePrimary,
      muted: '#F1F5F9',
      mutedForeground: '#64748B',
      border: '#E2E8F0',
    })
  }

  return {
    tokens,
    colors,
    accent,
    chartPalette: chartPaletteFor(tokens, accent),
    ornament: headingOrnamentFor(tokens),
    footer: footerStyleFor(tokens),
    cover: tokens.cover,
    table: tokens.table,
    headingCase: tokens.headingCase,
    typography: tokens.typography,
    spacing: tokens.spacing,
  }
}

/** Relative luminance (0=black, 1=white) of a hex color. */
export function luminance(color: string | undefined, fallback = '#FFFFFF'): number {
  let hex = String(color || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) hex = hex.slice(1)
  else if (/^[0-9a-fA-F]{6}$/.test(hex)) hex = hex
  else hex = fallback.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** True when the color is dark enough that white text on it stays readable. */
export function isDarkColor(color: string | undefined): boolean {
  return luminance(color) < 0.4
}

// ==================== IMAGE PIPELINE (charts + diagrams) ====================

export interface RenderedImage {
  png: Buffer
  width: number
  height: number
  caption?: string
  /** Mechanical repairs from the chart/diagram engines — surfaced in QA. */
  repairs?: string[]
}

/**
 * Normalize a DIAGRAM component (any accepted AI shape — semantic
 * nodes/edges or legacy steps) into a validated DiagramSpec. Bare arrays
 * become timelines (AI-canonical shape). Returns null when unusable.
 */
export function asDiagram(content: unknown) {
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
  if (component.type === 'diagram' || component.type === 'timeline') {
    const content = component.content
    // A bare array is the AI-canonical timeline shape (planning rule 10) —
    // do NOT spread it into an object (spread loses array elements).
    const prepared =
      component.type === 'timeline'
        ? Array.isArray(content)
          ? content
          : { kind: 'timeline', ...((content && typeof content === 'object') ? content as Record<string, unknown> : {}) }
        : content
    const spec = asDiagram(prepared)
    if (!spec) return null
    const diagram = await renderDiagram(prepared, {
      width: opts?.width ?? (opts?.pptx ? 600 : 620),
      colors: theme.colors,
    })
    if (!diagram || !diagram.png) return null
    return {
      png: diagram.png,
      width: diagram.width,
      height: diagram.height,
      caption: (spec as { title?: string }).title?.trim() || undefined,
      repairs: diagram.repairs,
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
    return { png: chart.png, width: chart.width, height: chart.height, caption, repairs: spec.repairs }
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
