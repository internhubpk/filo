// =============================================================================
// FILO CHART ENGINE v3 (spec §18)
// =============================================================================
// Structured chart data → Apache ECharts (SSR SVG) → sharp PNG / inline SVG.
// The AI supplies DATA and a chart-type intent; this engine owns every visual
// decision: typography (bundled DejaVu — tofu impossible even on bare
// containers), scales, gridlines, tick density, legends, label formatting.
//
// READABILITY CONTRACT (v3):
//   • explicit fontFamily everywhere — rasterization never depends on the host;
//   • series/categories always aligned; all-zero series rejected;
//   • pie/donut slices cap at 8 with "Other";
//   • percent/currency/compact number formatting (renderer-owned);
//   • combo charts (bar + line, dual axis when ranges diverge);
//   • no overlapping labels (hideOverlap + rotation), no clipped content
//     (containLabel), no decorative noise.
// =============================================================================

import type { ColorPalette } from '@/types'
import { RASTER_FONT_STACK } from '@/services/typography/fonts'
import { ensureRasterizerFonts } from '@/services/typography/fonts'

export type ChartKind = 'bar' | 'line' | 'pie' | 'donut' | 'area' | 'hbar' | 'stacked' | 'scatter' | 'combo'

export interface ChartFormat {
  type?: 'number' | 'percent' | 'currency'
  currency?: string
  decimals?: number
  prefix?: string
  suffix?: string
}

export interface ChartSpec {
  chartType?: string
  title?: string
  categories?: string[]
  series?: Array<{ name?: string; data: Array<number | string | null> }>
  /** combo charts: names of series rendered as lines over the bars. */
  lineSeries?: string[]
  note?: string
  xLabel?: string
  yLabel?: string
  format?: ChartFormat
}

/** Normalized chart — series always present after validation. */
export interface NormalizedChart {
  chartType: ChartKind
  title: string
  categories: string[]
  series: Array<{ name: string; data: Array<number | null> }>
  lineSeries?: string[]
  note?: string
  xLabel?: string
  yLabel?: string
  format?: ChartFormat
  /** Data-shape repairs surfaced in the renderer QA summary (never silent). */
  repairs?: string[]
}

export interface RenderedChart {
  png: Buffer
  width: number
  height: number
  svg: string
  kind: ChartKind
  title: string
}

const DEFAULT_PALETTE = ['#1e3a5f', '#3b82f6', '#0d9488', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16']

const MAX_PIE_SLICES = 8

function normalizeKind(raw: unknown): ChartKind {
  const k = String(raw || 'bar').toLowerCase()
  if (k === 'line' || k === 'pie' || k === 'donut' || k === 'area') return k as ChartKind
  if (k === 'doughnut') return 'donut'
  if (k === 'hbar' || k === 'horizontal-bar' || k === 'horizontal_bar' || k === 'horizontalbar') return 'hbar'
  if (k === 'stacked' || k === 'stacked-bar' || k === 'stackedbar') return 'stacked'
  if (k === 'scatter' || k === 'xy') return 'scatter'
  if (k === 'combo' || k === 'mixed' || k === 'bar-line') return 'combo'
  return 'bar'
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$€£¥₨,%\s]/g, '')
    const n = Number(cleaned)
    if (Number.isFinite(n) && cleaned !== '') return n
  }
  return null
}

/** A series of identical zero values carries zero information — reject it. */
function isConstantZeroSeries(data: Array<number | null>): boolean {
  const values = data.filter((d): d is number => d !== null)
  if (values.length < 2) return false
  return values.every((v) => v === 0)
}

/** Validate + normalize AI chart data; returns null when unusable. */
export function normalizeChartSpec(content: unknown): NormalizedChart | null {
  if (!content || typeof content !== 'object') return null
  const c = content as Record<string, unknown>
  const kind = normalizeKind(c.chartType)
  const repairs: string[] = []

  let categories = Array.isArray(c.categories) ? c.categories.map((x) => String(x).trim()).filter(Boolean) : []
  const series = (Array.isArray(c.series) ? c.series : [])
    .map((s) => {
      const so = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
      return {
        name: typeof so.name === 'string' && so.name.trim() ? so.name.trim() : '',
        data: Array.isArray(so.data) ? so.data.map(toNumber) : ([] as Array<number | null>),
      }
    })
    .filter((s) => s.data.some((d) => d !== null))

  if (series.length === 0) return null

  // ---- CATEGORY/SERIES ALIGNMENT (the "nonsense chart" killer) ----
  if (categories.length > 0 && !['pie', 'donut', 'scatter'].includes(kind)) {
    const maxLen = Math.max(...series.map((s) => s.data.length))
    const target = Math.min(categories.length, maxLen)
    if (target < categories.length) {
      categories = categories.slice(0, target)
      repairs.push(`categories truncated to ${target} to match series length`)
    }
    let truncatedSeries = 0
    for (const s of series) {
      if (s.data.length > target) {
        s.data = s.data.slice(0, target)
        truncatedSeries++
      }
    }
    if (truncatedSeries > 0) repairs.push(`${truncatedSeries} series truncated to ${target} points`)
    if (target < 2) return null
  } else if (categories.length === 0 && ['bar', 'stacked', 'hbar', 'combo'].includes(kind)) {
    const n = Math.max(...series.map((s) => s.data.length))
    categories = Array.from({ length: n }, (_, i) => `#${i + 1}`)
    repairs.push('missing categories synthesized as index labels')
  }

  // Reject series that plot a flat zero line.
  const beforeZero = series.length
  const kept = series.filter((s) => !isConstantZeroSeries(s.data))
  if (kept.length < beforeZero) repairs.push(`${beforeZero - kept.length} all-zero series dropped`)
  if (kept.length === 0) return null

  // Deduplicate empty/identical series names (legend must disambiguate).
  const seen = new Map<string, number>()
  for (const s of kept) {
    if (!s.name) s.name = 'Series'
    const n = seen.get(s.name) ?? 0
    seen.set(s.name, n + 1)
    if (n > 0) s.name = `${s.name} ${n + 1}`
  }

  const lineSeries = Array.isArray(c.lineSeries)
    ? (c.lineSeries as unknown[]).map((s) => String(s).trim()).filter(Boolean)
    : undefined
  const format = normalizeFormat(c.format)

  if (kind === 'pie' || kind === 'donut') {
    const s = kept[0]
    const paired = s.data
      .map((v, i) => ({ name: categories[i] || `Item ${i + 1}`, value: v }))
      .filter((d): d is { name: string; value: number } => d.value !== null)
    if (paired.length < 2) return null
    let slices = paired
    if (paired.length > MAX_PIE_SLICES) {
      const sorted = [...paired].sort((a, b) => b.value - a.value)
      const top = sorted.slice(0, MAX_PIE_SLICES - 1)
      const restTotal = sorted.slice(MAX_PIE_SLICES - 1).reduce((sum, d) => sum + d.value, 0)
      top.push({ name: 'Other', value: restTotal })
      slices = top
      repairs.push(`${paired.length - MAX_PIE_SLICES + 1} small slices grouped into "Other"`)
    }
    return {
      chartType: kind,
      title: typeof c.title === 'string' ? c.title : '',
      series: [{ name: s.name, data: slices.map((d) => d.value) }],
      categories: slices.map((d) => d.name),
      note: typeof c.note === 'string' ? c.note : undefined,
      xLabel: typeof c.xLabel === 'string' ? c.xLabel : undefined,
      yLabel: typeof c.yLabel === 'string' ? c.yLabel : undefined,
      format,
      repairs: repairs.length > 0 ? repairs : undefined,
    }
  }

  if (kind === 'scatter') {
    const pts = kept[0]?.data.filter((d) => d !== null).length ?? 0
    if (pts < 3) return null
    return {
      chartType: kind,
      title: typeof c.title === 'string' ? c.title : '',
      series: kept,
      categories,
      note: typeof c.note === 'string' ? c.note : undefined,
      xLabel: typeof c.xLabel === 'string' ? c.xLabel : undefined,
      yLabel: typeof c.yLabel === 'string' ? c.yLabel : undefined,
      format,
      repairs: repairs.length > 0 ? repairs : undefined,
    }
  }

  // Cartesian charts need at least 2 categories or 3 points.
  const points = kept[0].data.filter((d) => d !== null).length
  if (points < 2 && categories.length < 2) return null
  return {
    chartType: kind,
    title: typeof c.title === 'string' ? c.title : '',
    series: kept,
    categories,
    lineSeries: kind === 'combo' && lineSeries && lineSeries.length ? lineSeries : kind === 'combo' ? [kept[kept.length - 1].name] : undefined,
    note: typeof c.note === 'string' ? c.note : undefined,
    xLabel: typeof c.xLabel === 'string' ? c.xLabel : undefined,
    yLabel: typeof c.yLabel === 'string' ? c.yLabel : undefined,
    format,
    repairs: repairs.length > 0 ? repairs : undefined,
  }
}

function normalizeFormat(raw: unknown): ChartFormat | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const f = raw as Record<string, unknown>
  const type = ['number', 'percent', 'currency'].includes(String(f.type)) ? (String(f.type) as ChartFormat['type']) : 'number'
  return {
    type,
    currency: typeof f.currency === 'string' ? f.currency.slice(0, 6) : undefined,
    decimals: typeof f.decimals === 'number' && f.decimals >= 0 && f.decimals <= 3 ? f.decimals : undefined,
    prefix: typeof f.prefix === 'string' ? f.prefix.slice(0, 6) : undefined,
    suffix: typeof f.suffix === 'string' ? f.suffix.slice(0, 6) : undefined,
  }
}

// ==================== VALUE FORMATTING ====================

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', PKR: '₨', INR: '₹', AUD: 'A$', CAD: 'C$',
}

function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** Compact axis numbers: 1_200_000 → 1.2M, 45_000 → 45k, 0.25 → 0.25. */
export function compactNumber(v: number): string {
  if (!Number.isFinite(v)) return ''
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000) return trimZero((v / 1_000_000_000).toFixed(1)) + 'B'
  if (abs >= 1_000_000) return trimZero((v / 1_000_000).toFixed(1)) + 'M'
  if (abs >= 10_000) return trimZero((v / 1_000).toFixed(1)) + 'k'
  if (abs >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (abs >= 1) return trimZero(v.toFixed(1))
  if (abs === 0) return '0'
  return v.toPrecision(2)
}

/** Formatter honoring the AI's declared data semantics. */
export function makeValueFormatter(format?: ChartFormat): (v: number) => string {
  const decimals = format?.decimals
  if (format?.type === 'percent') {
    return (v) => `${trimZero((v * (Math.abs(v) <= 1 ? 100 : 1)).toFixed(decimals ?? (Math.abs(v) <= 1 ? 1 : 0)))}%`
  }
  if (format?.type === 'currency') {
    const symbol = CURRENCY_SYMBOLS[(format.currency ?? 'USD').toUpperCase()] ?? (format.currency || '$')
    return (v) => `${symbol}${compactNumber(v)}`
  }
  if (format?.prefix || format?.suffix) {
    return (v) => `${format?.prefix ?? ''}${compactNumber(v)}${format?.suffix ?? ''}`
  }
  return compactNumber
}

// ==================== RENDER ====================

/** Render a validated chart spec to a PNG buffer (theme-aware). */
export async function renderChart(
  spec: NormalizedChart,
  opts?: { width?: number; height?: number; palette?: string[]; colors?: ColorPalette; returnSvgOnly?: boolean }
): Promise<RenderedChart | null> {
  const width = Math.min(Math.max(opts?.width ?? 620, 320), 1200)
  const height = Math.min(Math.max(opts?.height ?? 360, 240), 800)
  const palette = opts?.palette && opts.palette.length >= 3 ? opts.palette : DEFAULT_PALETTE
  const kind = normalizeKind(spec.chartType)
  const textColor = opts?.colors?.foreground ?? '#1f2937'
  const borderColor = opts?.colors?.border ?? '#e5e7eb'
  const mutedColor = opts?.colors?.mutedForeground ?? '#6b7280'
  const font = RASTER_FONT_STACK
  const valueFormatter = makeValueFormatter(spec.format)

  ensureRasterizerFonts()
  const echarts = await import('echarts')
  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width,
    height,
  })

  try {
    const singleNumeric = spec.series.length === 1 ? spec.series[0].data.filter((d) => d !== null) : []
    const showBarLabels = (kind === 'bar' || kind === 'combo') && spec.series.filter((s) => !spec.lineSeries?.includes(s.name)).length === 1 && singleNumeric.length <= 12
    const showLineLabels = kind === 'line' && spec.series.length === 1 && singleNumeric.length <= 8

    const valueLabel = {
      show: true,
      position: 'top' as const,
      color: mutedColor,
      fontSize: 10,
      fontFamily: font,
      formatter: (p: { value: number | Array<unknown> }) => {
        const v = Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value
        return typeof v === 'number' ? valueFormatter(v) : ''
      },
    }

    const isLineSeries = (name: string) => kind === 'combo' && (spec.lineSeries?.includes(name) ?? false)

    const seriesData =
      kind === 'pie' || kind === 'donut'
        ? [
            {
              type: 'pie' as const,
              radius: kind === 'donut' ? ['46%', '72%'] : '70%',
              center: ['50%', '54%'],
              label: {
                color: textColor,
                fontSize: 11,
                fontFamily: font,
                formatter: '{b}\n{d}%',
              },
              labelLine: { length: 12, length2: 10, lineStyle: { color: borderColor } },
              itemStyle: { borderColor: '#ffffff', borderWidth: 2 },
              data: (spec.categories ?? []).map((name, i) => ({
                name,
                value: spec.series[0].data[i] ?? 0,
              })),
            },
          ]
        : spec.series.map((s, i) => {
            const asLine = isLineSeries(s.name)
            return {
              type: asLine ? ('line' as const) : kind === 'scatter' ? ('scatter' as const) : kind === 'area' || kind === 'line' ? ('line' as const) : ('bar' as const),
              name: s.name || `Series ${i + 1}`,
              yAxisIndex: asLine && kind === 'combo' && hasDualAxis(spec) ? 1 : 0,
              smooth: asLine || kind === 'line' || kind === 'area' ? true : undefined,
              showSymbol: asLine || kind === 'line' || kind === 'area',
              symbolSize: kind === 'scatter' ? 11 : 6,
              symbol: 'circle',
              lineStyle: asLine ? { width: 2.5 } : { width: 2.2 },
              areaStyle: kind === 'area' && !asLine ? { opacity: 0.18 } : undefined,
              stack: kind === 'stacked' && !asLine ? 'total' : undefined,
              barMaxWidth: 38,
              barGap: '28%',
              label:
                (showBarLabels && !asLine) || showLineLabels
                  ? valueLabel
                  : undefined,
              itemStyle:
                kind === 'hbar'
                  ? { borderRadius: [0, 4, 4, 0] }
                  : !asLine && (kind === 'bar' || kind === 'combo' || kind === 'stacked')
                    ? { borderRadius: kind === 'stacked' ? [0, 0, 0, 0] : [3.5, 3.5, 0, 0] }
                    : undefined,
              data:
                kind === 'scatter'
                  ? (s.data.filter((d): d is number => d !== null) as unknown as number[]).map((y, idx) => [
                      Number(spec.categories?.[idx] ?? idx + 1) || idx + 1,
                      y,
                    ])
                  : s.data,
            }
          })

    const hasLegend = kind !== 'pie' && kind !== 'donut' && spec.series.length > 1

    chart.setOption({
      animation: false,
      backgroundColor: '#ffffff',
      color: palette,
      textStyle: { fontFamily: font },
      title: spec.title
        ? {
            text: spec.title,
            left: 'center',
            top: 8,
            textStyle: { fontSize: 15, fontWeight: 700, color: textColor, fontFamily: font },
          }
        : undefined,
      tooltip: { show: false },
      legend: hasLegend
        ? {
            bottom: 4,
            textStyle: { color: mutedColor, fontSize: 11, fontFamily: font },
            itemWidth: 14,
            itemHeight: 9,
            itemGap: 16,
            icon: 'roundRect',
          }
        : undefined,
      // containLabel: true — axis labels participate in the grid box, so long
      // y-axis numbers or rotated x labels NEVER clip outside the image.
      grid: {
        left: 16,
        right: 24,
        top: spec.title ? 48 : 20,
        bottom: (hasLegend ? 34 : 16) + (spec.xLabel ? 16 : 0),
        containLabel: true,
      },
      xAxis:
        kind === 'pie' || kind === 'donut'
          ? undefined
          : kind === 'hbar'
            ? {
                type: 'value',
                name: spec.xLabel || undefined,
                nameTextStyle: { color: mutedColor, fontSize: 10.5, fontFamily: font },
                splitLine: { lineStyle: { color: borderColor, type: [3, 4], width: 1 } },
                axisLabel: { color: mutedColor, fontSize: 11, fontFamily: font, formatter: (v: number) => valueFormatter(v) },
                axisLine: { show: false },
                axisTick: { show: false },
                splitNumber: 4,
              }
            : {
                type: kind === 'scatter' ? 'value' : 'category',
                data: kind === 'scatter' ? undefined : spec.categories ?? [],
                name: spec.xLabel || undefined,
                nameLocation: 'middle',
                nameGap: 28,
                nameTextStyle: { color: mutedColor, fontSize: 10.5, fontFamily: font },
                axisLine: { lineStyle: { color: borderColor, width: 1.2 } },
                axisTick: { show: false },
                axisLabel: {
                  color: mutedColor,
                  fontSize: 11,
                  fontFamily: font,
                  interval: 0,
                  hideOverlap: true,
                  rotate: (spec.categories?.length ?? 0) > 7 ? 28 : 0,
                  formatter: kind === 'combo' || kind === 'bar' || kind === 'line' || kind === 'area' || kind === 'stacked' ? undefined : undefined,
                },
              },
      yAxis: buildYAxes(spec, kind, mutedColor, borderColor, font, valueFormatter, hasDualAxis(spec)),
      series: seriesData as never,
    })

    const svg = chart.renderToSVGString()
    if (opts?.returnSvgOnly) {
      return { png: Buffer.alloc(0), width, height, svg, kind, title: spec.title || '' }
    }
    ensureRasterizerFonts()
    const sharp = (await import('sharp')).default
    // Rasterize at 2x for crisp embedding.
    const png = await sharp(Buffer.from(svg), { density: 192 }).png().toBuffer()
    return { png, width, height, svg, kind, title: spec.title || '' }
  } catch {
    return null
  } finally {
    // echarts SSR keeps the event loop alive unless disposed.
    chart.dispose()
  }
}

/** Dual Y axis for combo charts when bar/line ranges diverge by >6×. */
function hasDualAxis(spec: NormalizedChart): boolean {
  if (spec.chartType !== 'combo' || spec.series.length < 2) return false
  const extent = (data: Array<number | null>) => {
    const vals = data.filter((d): d is number => d !== null)
    return vals.length ? Math.max(...vals.map(Math.abs)) : 0
  }
  const barNames = spec.series.filter((s) => !spec.lineSeries?.includes(s.name)).map((s) => s.name)
  const lineNames = spec.series.filter((s) => spec.lineSeries?.includes(s.name)).map((s) => s.name)
  const barMax = Math.max(0, ...spec.series.filter((s) => barNames.includes(s.name)).map((s) => extent(s.data)))
  const lineMax = Math.max(0, ...spec.series.filter((s) => lineNames.includes(s.name)).map((s) => extent(s.data)))
  if (!barMax || !lineMax) return false
  const ratio = barMax > lineMax ? barMax / lineMax : lineMax / barMax
  return ratio > 6
}

function buildYAxes(
  spec: NormalizedChart,
  kind: ChartKind,
  mutedColor: string,
  borderColor: string,
  font: string,
  valueFormatter: (v: number) => string,
  dual: boolean
): unknown {
  if (kind === 'pie' || kind === 'donut') return undefined
  if (kind === 'hbar') {
    return {
      type: 'category',
      data: spec.categories ?? [],
      name: spec.yLabel || undefined,
      nameTextStyle: { color: mutedColor, fontSize: 10.5, fontFamily: font },
      axisLine: { lineStyle: { color: borderColor, width: 1.2 } },
      axisTick: { show: false },
      axisLabel: { color: mutedColor, fontSize: 11, fontFamily: font, hideOverlap: true },
    }
  }
  const valueAxis = (useFormatter: boolean) => ({
    type: 'value',
    name: spec.yLabel || undefined,
    nameTextStyle: { color: mutedColor, fontSize: 10.5, fontFamily: font },
    splitLine: { lineStyle: { color: borderColor, type: [3, 4], width: 1 } },
    axisLine: { show: false },
    axisTick: { show: false },
    splitNumber: 4,
    axisLabel: { color: mutedColor, fontSize: 11, fontFamily: font, formatter: useFormatter ? (v: number) => valueFormatter(v) : (v: number) => compactNumber(v) },
  })
  if (dual) return [valueAxis(true), { ...valueAxis(true), splitLine: { show: false } }]
  return valueAxis(true)
}
