// =============================================================================
// FILO DOCUMENT AST — canonical intermediate representation + validation
// =============================================================================
// The single source of truth for Filo's document node vocabulary:
//
//   AI ──▶ Artifact blueprint (sections) ──▶ Document AST (this module)
//        ──▶ Specialized renderers ──▶ DOCX / PDF / PPTX / XLSX / CSV / HTML
//
// Every renderer consumes the SAME canonical nodes — no format invents its own
// interpretation of a "chart" or "diagram". Content shapes carry structural
// validators (plain TS, zero dependencies — safe for the Convex bundle) so
// malformed AI output is repaired or rejected BEFORE a renderer ever sees it.
// Validators never throw: they return issues + repairs, and the renderers
// render an honest fallback instead of shipping a broken artifact.
//
// The AI owns WHAT the document contains (structure, semantics, chart/diagram
// type, theme id). The renderer owns HOW it looks (pixels, fonts, spacing,
// colors, routing). Low-level SVG/CSS from the AI is structurally impossible
// to inject: chart/diagram content validates as DATA only.
// =============================================================================

// ==================== CANONICAL NODE TYPES ====================

export const CANONICAL_COMPONENT_TYPES = [
  'paragraph',
  'heading',
  'list',
  'table',
  'quote',
  'metric_grid',
  'callout',
  'chart',
  'timeline',
  'key_takeaways',
  'two_column',
  'equation',
  'code',
  'diagram',
  'custom',
] as const

export type CanonicalComponentType = (typeof CANONICAL_COMPONENT_TYPES)[number]

/** Legacy/alias type names → canonical vocabulary. */
const ALIAS_MAP: Record<string, CanonicalComponentType> = {
  paragraph: 'paragraph',
  text: 'paragraph',
  body: 'paragraph',
  heading: 'heading',
  subheading: 'heading',
  list: 'list',
  bullets: 'list',
  bullet_list: 'list',
  numbered_list: 'list',
  table: 'table',
  quote: 'quote',
  blockquote: 'quote',
  metric_grid: 'metric_grid',
  metrics: 'metric_grid',
  kpi: 'metric_grid',
  callout: 'callout',
  note: 'callout',
  chart: 'chart',
  graph: 'chart',
  timeline: 'timeline',
  milestones: 'timeline',
  key_takeaways: 'key_takeaways',
  takeaways: 'key_takeaways',
  summary_points: 'key_takeaways',
  two_column: 'two_column',
  comparison: 'two_column',
  equation: 'equation',
  math: 'equation',
  formula: 'equation',
  latex: 'equation',
  code: 'code',
  code_block: 'code',
  codeblock: 'code',
  snippet: 'code',
  pre: 'code',
  diagram: 'diagram',
  flowchart: 'diagram',
  flow_chart: 'diagram',
  process: 'diagram',
  hierarchy: 'diagram',
  org_chart: 'diagram',
  orgchart: 'diagram',
  decision_tree: 'diagram',
  timeline_diagram: 'diagram',
  sequence: 'diagram',
  architecture: 'diagram',
  network: 'diagram',
  er: 'diagram',
  concept_map: 'diagram',
}

export function canonicalType(raw: string): CanonicalComponentType {
  return ALIAS_MAP[String(raw ?? '').toLowerCase().trim()] ?? 'custom'
}

// ==================== CONTENT SCHEMAS (structural) ====================

export interface ChartSeries {
  name: string
  data: Array<number | null>
}

export interface ChartContent {
  chartType: 'bar' | 'line' | 'pie' | 'donut' | 'area' | 'hbar' | 'stacked' | 'scatter' | 'combo'
  title: string
  categories: string[]
  series: ChartSeries[]
  /** bar+line dual-axis combo: which series draws as a line. */
  lineSeries?: string[]
  note?: string
  xLabel?: string
  yLabel?: string
  /** Value formatting intent — renderer-owned presentation of the same data. */
  format?: {
    type?: 'number' | 'percent' | 'currency'
    currency?: string
    decimals?: number
    prefix?: string
    suffix?: string
  }
}

export interface ValidationIssue {
  code: string
  message: string
  severity: 'error' | 'warning' | 'repair'
}

export interface ValidationResult<T> {
  ok: boolean
  value: T | null
  issues: ValidationIssue[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, max = 400): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$€£¥₨,%\s]/g, '')
    if (cleaned === '') return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Validate chart content (data-only; visuals are renderer-owned). */
export function validateChartContent(content: unknown): ValidationResult<ChartContent> {
  const issues: ValidationIssue[] = []
  if (!isRecord(content)) return { ok: false, value: null, issues: [{ code: 'CHART_NOT_OBJECT', message: 'chart content must be an object', severity: 'error' }] }

  const rawType = str(content.chartType ?? content.type, 24).toLowerCase()
  const typeAliases: Record<string, ChartContent['chartType']> = {
    bar: 'bar', column: 'bar', line: 'line', pie: 'pie', doughnut: 'donut', donut: 'donut',
    area: 'area', hbar: 'hbar', 'horizontal-bar': 'hbar', horizontalbar: 'hbar',
    stacked: 'stacked', 'stacked-bar': 'stacked', stackedbar: 'stacked',
    scatter: 'scatter', xy: 'scatter', combo: 'combo', mixed: 'combo',
  }
  const chartType = typeAliases[rawType] ?? 'bar'
  if (!typeAliases[rawType]) issues.push({ code: 'CHART_TYPE_DEFAULTED', message: `unknown chartType "${rawType}" — defaulted to bar`, severity: 'repair' })

  const categories = Array.isArray(content.categories)
    ? content.categories.map((c) => str(c, 60)).filter(Boolean)
    : []

  const rawSeries = Array.isArray(content.series) ? content.series : []
  const series: ChartSeries[] = []
  rawSeries.forEach((s, i) => {
    if (isRecord(s)) {
      const data = Array.isArray(s.data) ? s.data.map(toNumberOrNull) : []
      if (data.some((d) => d !== null)) series.push({ name: str(s.name, 60) || `Series ${i + 1}`, data })
    } else if (Array.isArray(s)) {
      const data = s.map(toNumberOrNull)
      if (data.some((d) => d !== null)) series.push({ name: `Series ${i + 1}`, data })
    }
  })

  if (series.length === 0) {
    return { ok: false, value: null, issues: [...issues, { code: 'CHART_NO_DATA', message: 'no series contained numeric data', severity: 'error' }] }
  }

  const lineSeries = Array.isArray(content.lineSeries) ? content.lineSeries.map((s) => str(s, 60)).filter(Boolean) : undefined
  const fmt = isRecord(content.format) ? content.format : undefined

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    value: {
      chartType,
      title: str(content.title, 140),
      categories,
      series,
      lineSeries: lineSeries && lineSeries.length ? lineSeries : undefined,
      note: str(content.note, 200) || undefined,
      xLabel: str(content.xLabel, 60) || undefined,
      yLabel: str(content.yLabel, 60) || undefined,
      format: fmt
        ? {
            type: ['number', 'percent', 'currency'].includes(str(fmt.type, 12)) ? (str(fmt.type, 12) as 'number' | 'percent' | 'currency') : 'number',
            currency: str(fmt.currency, 8) || undefined,
            decimals: typeof fmt.decimals === 'number' && fmt.decimals >= 0 && fmt.decimals <= 3 ? fmt.decimals : undefined,
            prefix: str(fmt.prefix, 8) || undefined,
            suffix: str(fmt.suffix, 8) || undefined,
          }
        : undefined,
    },
    issues,
  }
}

export interface EquationContent {
  latex: string
  display: boolean
}

/** Validate equation content: non-empty LaTeX, no runtime risk (text only). */
export function validateEquationContent(content: unknown): ValidationResult<EquationContent> {
  const issues: ValidationIssue[] = []
  const o = isRecord(content) ? content : { latex: content }
  const latex = str(o.latex ?? o.content ?? o.formula ?? (typeof content === 'string' ? content : ''), 2000)
  if (!latex) {
    return { ok: false, value: null, issues: [{ code: 'EQUATION_EMPTY', message: 'equation has no LaTeX source', severity: 'error' }] }
  }
  return { ok: true, value: { latex, display: o.display !== false }, issues }
}

export interface CodeContent {
  language: string
  code: string
}

export function validateCodeContent(content: unknown): ValidationResult<CodeContent> {
  const o = isRecord(content) ? content : { code: typeof content === 'string' ? content : '' }
  let code = typeof o.code === 'string' ? o.code : typeof o.content === 'string' ? o.content : typeof o.text === 'string' ? o.text : ''
  code = code.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '')
  const fence = /^```([A-Za-z0-9+#_-]*)\n([\s\S]*?)\n?```$/.exec(code)
  let language = str(o.language, 24)
  if (fence) {
    if (!language) language = fence[1]
    code = fence[2]
  }
  if (!code.trim()) {
    return { ok: false, value: null, issues: [{ code: 'CODE_EMPTY', message: 'code block is empty', severity: 'error' }] }
  }
  return { ok: true, value: { language: language || 'text', code: code.slice(0, 40000) }, issues: [] }
}

export interface TableCell {
  text: string
  value: number | null
}

export interface TableContent {
  rows: TableCell[][]
  header: boolean
}

/** Validate table content into a typed cell matrix (numbers kept numeric). */
export function validateTableContent(content: unknown): ValidationResult<TableContent> {
  const issues: ValidationIssue[] = []
  if (!Array.isArray(content) || content.length === 0) {
    return { ok: false, value: null, issues: [{ code: 'TABLE_EMPTY', message: 'table has no rows', severity: 'error' }] }
  }
  const width = Math.max(...content.map((r) => (Array.isArray(r) ? r.length : 1)))
  const rows: TableCell[][] = []
  content.forEach((row) => {
    const cells: TableCell[] = []
    const rowArr = Array.isArray(row) ? row : [row]
    for (let i = 0; i < width; i++) {
      const cell = rowArr[i]
      if (cell === null || cell === undefined || cell === '') {
        cells.push({ text: '', value: null })
      } else if (typeof cell === 'number' && Number.isFinite(cell)) {
        cells.push({ text: String(cell), value: cell })
      } else {
        const text = str(cell, 400)
        const numeric = toNumberOrNull(cell)
        // A numeric-looking STRING stays text if it has formatting (e.g. "12%")
        // — value captures the parsed number for column typing.
        cells.push({ text, value: typeof cell === 'string' && text !== '' ? numeric : null })
      }
    }
    rows.push(cells)
  })
  if (rows.length < 2) issues.push({ code: 'TABLE_TOO_SMALL', message: 'table has fewer than 2 rows', severity: 'warning' })
  return { ok: true, value: { rows, header: true }, issues }
}

// ==================== DOCUMENT-LEVEL VALIDATION ====================

export interface CanonicalComponent {
  componentId: string
  type: CanonicalComponentType
  content: unknown
  order: number
  issues?: ValidationIssue[]
}

export interface CanonicalSection {
  id: string
  title: string
  type?: string
  level?: string
  order: number
  components: CanonicalComponent[]
}

/**
 * Validate one component's content against its canonical type.
 * Returns the component unchanged when valid, with issues attached when
 * repairable, or ok=false when the renderer must fall back honestly.
 */
export function validateComponent(component: { type: string; content: unknown; componentId?: string; order?: number }): { component: CanonicalComponent; ok: boolean } {
  const type = canonicalType(component.type)
  let issues: ValidationIssue[] = []
  let ok = true

  switch (type) {
    case 'chart': {
      const r = validateChartContent(component.content)
      issues = r.issues
      ok = r.ok
      break
    }
    case 'equation': {
      const r = validateEquationContent(component.content)
      issues = r.issues
      ok = r.ok
      break
    }
    case 'code': {
      const r = validateCodeContent(component.content)
      issues = r.issues
      ok = r.ok
      break
    }
    case 'table': {
      const r = validateTableContent(component.content)
      issues = r.issues
      ok = r.ok
      break
    }
    case 'custom':
      ok = true // renders via the honest labeled fallback
      break
    default:
      break
  }

  if (type === 'custom') {
    issues = [{ code: 'COMPONENT_TYPE_UNKNOWN', message: `unknown component type "${component.type}" — renderer falls back honestly`, severity: 'warning' }]
  }

  return {
    component: {
      componentId: component.componentId ?? `comp-${component.order ?? 0}`,
      type,
      content: component.content,
      order: component.order ?? 0,
      issues: issues.length ? issues : undefined,
    },
    ok,
  }
}

/** Issue codes that MUST fail loudly (renderer renders an honest fallback). */
export const FATAL_ISSUE_CODES = new Set([
  'CHART_NOT_OBJECT',
  'CHART_NO_DATA',
  'EQUATION_EMPTY',
  'CODE_EMPTY',
  'TABLE_EMPTY',
])
