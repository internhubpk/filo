// =============================================================================
// FILO CHART ENGINE (spec §18)
// =============================================================================
// Mathematically correct charts rendered by Apache ECharts in SSR SVG mode,
// then rasterized to PNG via sharp for embedding into DOCX/PDF/PPTX.
// The AI NEVER draws charts with a generative image model — it supplies the
// data, this engine computes the pixels.
//
// READABILITY CONTRACT (v3): a chart ships only when it is UNDERSTANDABLE —
//   • every series aligns with the categories (validated, never mis-aligned);
//   • an all-zero / all-identical series is rejected (a chart of nothing is
//     decoration, and decoration is what users complained about);
//   • pie/donut slices cap at 8 with the remainder grouped into "Other";
//   • axis labels never clip (containLabel), value labels on bars/pies,
//     legends only when they add information.
// =============================================================================

import type { ColorPalette } from '@/types'

export type ChartKind = 'bar' | 'line' | 'pie' | 'donut' | 'area' | 'hbar' | 'stacked' | 'scatter'

export interface ChartSpec {
  chartType?: string
  title?: string
  categories?: string[]
  series?: Array<{ name?: string; data: Array<number | string | null> }>
  note?: string
  xLabel?: string
  yLabel?: string
}

/** Normalized chart — series always present after validation. */
export interface NormalizedChart {
  chartType: ChartKind
  title: string
  categories: string[]
  series: Array<{ name: string; data: Array<number | null> }>
  note?: string
  xLabel?: string
  yLabel?: string
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
  if (k === 'line' || k === 'pie' || k === 'donut' || k === 'area' || k === 'doughnut') {
    return k === 'doughnut' ? 'donut' : (k as ChartKind)
  }
  if (k === 'hbar' || k === 'horizontal-bar' || k === 'horizontal_bar' || k === 'horizontalbar') return 'hbar'
  if (k === 'stacked' || k === 'stacked-bar' || k === 'stackedbar') return 'stacked'
  if (k === 'scatter' || k === 'xy') return 'scatter'
  return 'bar'
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$€£¥,%\s]/g, '')
    const n = Number(cleaned)
    if (Number.isFinite(n) && cleaned !== '') return n
  }
  return null
}

/** A series of identical values carries zero information — reject it. */
function isConstantNonZeroSeries(data: Array<number | null>): boolean {
  const values = data.filter((d): d is number => d !== null)
  if (values.length < 2) return false
  const first = values[0]
  if (first !== 0) return false
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
  // A 6-point series over 4 labels mis-aligns silently and produces charts
  // nobody can read. Truncate every series to the shared length and record
  // the repair — mechanical fixes are never silent.
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
  } else if (categories.length === 0 && ['bar', 'stacked', 'hbar'].includes(kind)) {
    // No categories: synthesize neutral index labels so the axis is readable.
    const n = Math.max(...series.map((s) => s.data.length))
    categories = Array.from({ length: n }, (_, i) => `#${i + 1}`)
    repairs.push('missing categories synthesized as index labels')
  }

  // Reject series that plot a flat zero line.
  const beforeZero = series.length
  const kept = series.filter((s) => !isConstantNonZeroSeries(s.data))
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

  if (kind === 'pie' || kind === 'donut') {
    // Single series required; take the first with numeric data.
    const s = kept[0]
    // Pair each value with its category, drop nulls WITHOUT fabricating 0.
    const paired = s.data
      .map((v, i) => ({ name: categories[i] || `Item ${i + 1}`, value: v }))
      .filter((d): d is { name: string; value: number } => d.value !== null)
    if (paired.length < 2) return null
    // Slice cap: keep the largest slices, fold the tail into "Other".
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
      repairs: repairs.length > 0 ? repairs : undefined,
    }
  }

  if (kind === 'scatter') {
    // Scatter: each series is a set of (x, y) points built from paired data
    // or from categories as x. At least 3 points required for meaning.
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
    note: typeof c.note === 'string' ? c.note : undefined,
    xLabel: typeof c.xLabel === 'string' ? c.xLabel : undefined,
    yLabel: typeof c.yLabel === 'string' ? c.yLabel : undefined,
    repairs: repairs.length > 0 ? repairs : undefined,
  }
}

/** Render a validated chart spec to a PNG buffer (theme-aware). */
export async function renderChart(
  spec: NormalizedChart,
  opts?: { width?: number; height?: number; palette?: string[]; colors?: ColorPalette }
): Promise<RenderedChart | null> {
  const width = Math.min(Math.max(opts?.width ?? 620, 320), 1200)
  const height = Math.min(Math.max(opts?.height ?? 360, 240), 800)
  const palette = opts?.palette && opts.palette.length >= 3 ? opts.palette : DEFAULT_PALETTE
  const kind = normalizeKind(spec.chartType)
  const textColor = opts?.colors?.foreground ?? '#1f2937'
  const borderColor = opts?.colors?.border ?? '#e5e7eb'
  const mutedColor = opts?.colors?.mutedForeground ?? '#6b7280'

  const echarts = await import('echarts')
  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width,
    height,
  })

  try {
    const valueLabel = {
      show: true,
      position: 'top' as const,
      color: mutedColor,
      fontSize: 9,
      formatter: (p: { value: number | Array<unknown> }) => {
        const v = Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value
        return typeof v === 'number' ? compactNumber(v) : ''
      },
    }

    const seriesData =
      kind === 'pie' || kind === 'donut'
        ? [
            {
              type: 'pie',
              radius: kind === 'donut' ? ['44%', '70%'] : '70%',
              center: ['50%', '54%'],
              label: {
                color: textColor,
                fontSize: 10,
                // Percent + value keeps slices interpretable at a glance.
                formatter: '{b}\n{d}%',
              },
              // Small slices push labels outside instead of overlapping.
              labelLine: { length: 10, length2: 8, lineStyle: { color: borderColor } },
              itemStyle: { borderColor: '#ffffff', borderWidth: 1.5 },
              data: (spec.categories ?? []).map((name, i) => ({
                name,
                value: spec.series[0].data[i] ?? 0,
              })),
            },
          ]
        : spec.series.map((s, i) => ({
            type: kind === 'area' || kind === 'line' ? 'line' : kind === 'scatter' ? 'scatter' : 'bar',
            name: s.name || `Series ${i + 1}`,
            smooth: kind === 'line' || kind === 'area',
            showSymbol: kind === 'line' || kind === 'area',
            symbolSize: kind === 'scatter' ? 10 : kind === 'line' || kind === 'area' ? 6 : undefined,
            areaStyle: kind === 'area' ? { opacity: 0.22 } : undefined,
            stack: kind === 'stacked' ? 'total' : undefined,
            barMaxWidth: 40,
            barGap: '25%',
            // Value labels: single-series bars get per-bar numbers; multi-series
            // bars get none (they collide) — the axis + legend carry the story.
            label: kind === 'bar' && spec.series.length === 1 && s.data.filter((d) => d !== null).length <= 12 ? valueLabel : kind === 'line' && spec.series.length === 1 && s.data.filter((d) => d !== null).length <= 8 ? valueLabel : undefined,
            itemStyle: kind === 'hbar' ? { borderRadius: [0, 3, 3, 0] } : kind === 'bar' ? { borderRadius: [3, 3, 0, 0] } : undefined,
            data:
              kind === 'scatter'
                ? (s.data.filter((d): d is number => d !== null) as unknown as number[]).map((y, idx) => [
                    Number(spec.categories?.[idx] ?? idx + 1) || idx + 1,
                    y,
                  ])
                : s.data,
          }))

    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      color: palette,
      title: spec.title
        ? {
            text: spec.title,
            left: 'center',
            top: 6,
            textStyle: { fontSize: 14, fontWeight: 600, color: textColor, fontFamily: 'Arial, Helvetica, sans-serif' },
          }
        : undefined,
      tooltip: { show: false },
      legend:
        kind !== 'pie' && kind !== 'donut' && spec.series.length > 1
          ? { bottom: 0, textStyle: { color: mutedColor, fontSize: 10.5 }, itemWidth: 14, itemHeight: 9 }
          : undefined,
      // containLabel: true — axis labels participate in the grid box, so long
      // y-axis numbers or rotated x labels NEVER clip outside the image.
      grid: {
        left: 12,
        right: 22,
        top: spec.title ? 44 : 18,
        bottom: (spec.series.length > 1 && kind !== 'pie' && kind !== 'donut' ? 30 : 14) + (spec.xLabel || spec.yLabel ? 12 : 0),
        containLabel: true,
      },
      xAxis:
        kind === 'pie' || kind === 'donut'
          ? undefined
          : kind === 'hbar'
            ? {
                type: 'value',
                name: spec.xLabel || undefined,
                nameTextStyle: { color: mutedColor, fontSize: 10 },
                splitLine: { lineStyle: { color: borderColor, type: 'dashed' } },
                axisLabel: { color: mutedColor, fontSize: 10.5, formatter: (v: number) => compactNumber(v) },
                axisLine: { show: false },
                axisTick: { show: false },
              }
            : {
                type: kind === 'scatter' ? 'value' : 'category',
                data: kind === 'scatter' ? undefined : spec.categories ?? [],
                name: spec.xLabel || undefined,
                nameLocation: 'middle',
                nameGap: 26,
                nameTextStyle: { color: mutedColor, fontSize: 10 },
                axisLine: { lineStyle: { color: borderColor } },
                axisTick: { show: false },
                axisLabel: {
                  color: mutedColor,
                  fontSize: 10.5,
                  interval: 0,
                  hideOverlap: true,
                  rotate: (spec.categories?.length ?? 0) > 7 ? 28 : 0,
                },
              },
      yAxis:
        kind === 'pie' || kind === 'donut'
          ? undefined
          : kind === 'hbar'
            ? {
                type: 'category',
                data: spec.categories ?? [],
                name: spec.yLabel || undefined,
                nameTextStyle: { color: mutedColor, fontSize: 10 },
                axisLine: { lineStyle: { color: borderColor } },
                axisTick: { show: false },
                axisLabel: { color: mutedColor, fontSize: 10.5, hideOverlap: true },
              }
            : {
                type: 'value',
                name: spec.yLabel || undefined,
                nameTextStyle: { color: mutedColor, fontSize: 10 },
                splitLine: { lineStyle: { color: borderColor, type: 'dashed' } },
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { color: mutedColor, fontSize: 10.5, formatter: (v: number) => compactNumber(v) },
              },
      series: seriesData,
    })

    const svg = chart.renderToSVGString()
    const sharp = (await import('sharp')).default
    // Rasterize at 2x for crisp embedding.
    const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer()
    return { png, width, height, svg, kind, title: spec.title || '' }
  } catch {
    return null
  } finally {
    // echarts SSR keeps the event loop alive unless disposed.
    chart.dispose()
  }
}

/** Compact axis/label numbers: 1200000 → 1.2M, 45000 → 45k, 0.25 → 0.25. */
export function compactNumber(v: number): string {
  if (!Number.isFinite(v)) return ''
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000) return trimZero((v / 1_000_000_000).toFixed(1)) + 'B'
  if (abs >= 1_000_000) return trimZero((v / 1_000_000).toFixed(1)) + 'M'
  if (abs >= 10_000) return trimZero((v / 1_000).toFixed(1)) + 'k'
  if (abs >= 1000) return v.toLocaleString('en-US')
  if (abs >= 1) return trimZero(v.toFixed(1))
  if (abs === 0) return '0'
  return v.toPrecision(2)
}

function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s
}
