// =============================================================================
// FILO CHART ENGINE (spec §18)
// =============================================================================
// Mathematically correct charts rendered by Apache ECharts in SSR SVG mode,
// then rasterized to PNG via sharp for embedding into DOCX/PDF/PPTX.
// The AI NEVER draws charts with a generative image model — it supplies the
// data, this engine computes the pixels.
// =============================================================================

import type { ColorPalette } from '@/types'

export type ChartKind = 'bar' | 'line' | 'pie' | 'donut' | 'area'

export interface ChartSpec {
  chartType?: string
  title?: string
  categories?: string[]
  series?: Array<{ name?: string; data: Array<number | string | null> }>
  note?: string
}

/** Normalized chart — series always present after validation. */
export interface NormalizedChart {
  chartType: ChartKind
  title: string
  categories: string[]
  series: Array<{ name: string; data: Array<number | null> }>
  note?: string
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

function normalizeKind(raw: unknown): ChartKind {
  const k = String(raw || 'bar').toLowerCase()
  if (k === 'line' || k === 'pie' || k === 'donut' || k === 'area' || k === 'doughnut') {
    return k === 'doughnut' ? 'donut' : (k as ChartKind)
  }
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

/** Validate + normalize AI chart data; returns null when unusable. */
export function normalizeChartSpec(content: unknown): NormalizedChart | null {
  if (!content || typeof content !== 'object') return null
  const c = content as Record<string, unknown>
  const kind = normalizeKind(c.chartType)
  const rawSeries = Array.isArray(c.series) ? c.series : []
  const series = rawSeries
    .map((s) => {
      const so = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
      return {
        name: typeof so.name === 'string' ? so.name : 'Series',
        data: Array.isArray(so.data) ? so.data.map(toNumber) : [],
      }
    })
    .filter((s) => s.data.some((d) => d !== null))
  const categories = Array.isArray(c.categories) ? c.categories.map((x) => String(x)) : []

  if (series.length === 0) return null
  if (kind === 'pie' || kind === 'donut') {
    // Single series required; take the first with numeric data.
    const s = series[0]
    if (s.data.filter((d) => d !== null).length < 2) return null
    return { chartType: kind, title: typeof c.title === 'string' ? c.title : '', series: [s], categories, note: typeof c.note === 'string' ? c.note : undefined }
  }

  // Cartesian charts need at least 2 categories or 3 points.
  const points = series[0].data.filter((d) => d !== null).length
  if (points < 2 && categories.length < 2) return null
  return {
    chartType: kind,
    title: typeof c.title === 'string' ? c.title : '',
    series,
    categories,
    note: typeof c.note === 'string' ? c.note : undefined,
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
    const seriesData =
      kind === 'pie' || kind === 'donut'
        ? [
            {
              type: 'pie',
              radius: kind === 'donut' ? ['42%', '70%'] : '70%',
              center: ['50%', '54%'],
              label: { color: textColor, formatter: '{b}: {d}%' },
              data: (spec.series[0].data
                .map((v, i) => ({
                  name: spec.categories?.[i] ?? `Item ${i + 1}`,
                  value: v ?? 0,
                }))
                .filter((d) => d.value !== null) as Array<{ name: string; value: number }>),
            },
          ]
        : spec.series.map((s, i) => ({
            type: kind === 'area' ? 'line' : kind,
            name: s.name || `Series ${i + 1}`,
            smooth: kind === 'line' || kind === 'area',
            areaStyle: kind === 'area' ? { opacity: 0.25 } : undefined,
            barMaxWidth: 42,
            itemStyle: undefined,
            data: s.data,
          }))

    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      color: palette,
      title: spec.title
        ? {
            text: spec.title,
            left: 'center',
            top: 8,
            textStyle: { fontSize: 15, fontWeight: 600, color: textColor, fontFamily: 'Arial, Helvetica, sans-serif' },
          }
        : undefined,
      tooltip: { show: false },
      legend:
        kind !== 'pie' && kind !== 'donut' && spec.series.length > 1
          ? { bottom: 4, textStyle: { color: mutedColor, fontSize: 11 } }
          : undefined,
      grid: { left: 56, right: 24, top: spec.title ? 52 : 24, bottom: spec.series.length > 1 && kind !== 'pie' && kind !== 'donut' ? 44 : 32 },
      xAxis:
        kind === 'pie' || kind === 'donut'
          ? undefined
          : {
              type: 'category',
              data: spec.categories ?? [],
              axisLine: { lineStyle: { color: borderColor } },
              axisLabel: { color: mutedColor, fontSize: 11, interval: 0, rotate: (spec.categories?.length ?? 0) > 7 ? 30 : 0 },
            },
      yAxis:
        kind === 'pie' || kind === 'donut'
          ? undefined
          : { type: 'value', splitLine: { lineStyle: { color: borderColor, type: 'dashed' } }, axisLabel: { color: mutedColor, fontSize: 11 } },
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
