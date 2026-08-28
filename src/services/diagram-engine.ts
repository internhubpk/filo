// =============================================================================
// FILO DIAGRAM ENGINE (spec §19)
// =============================================================================
// Structured SVG diagram generation with deterministic layout — flowcharts,
// process flows, timelines and hierarchies render as crisp SVG (converted to
// PNG via sharp for office formats). No generative image model is ever asked
// to draw structure; the geometry is computed here.
// =============================================================================

import type { ColorPalette } from '@/types'

export type DiagramKind = 'flowchart' | 'process' | 'timeline' | 'hierarchy'

export interface DiagramStep {
  label?: string
  description?: string
}

export interface DiagramSpec {
  kind: DiagramKind
  title?: string
  steps: DiagramStep[]
}

/** Validate + normalize AI diagram content; null when unusable. */
export function normalizeDiagramSpec(content: unknown): DiagramSpec | null {
  if (!content || typeof content !== 'object') return null
  const c = content as Record<string, unknown>
  let kind: DiagramKind = 'flowchart'
  const rawKind = String(c.kind || c.diagramType || c.type || 'flowchart').toLowerCase()
  if (rawKind === 'process' || rawKind === 'timeline' || rawKind === 'hierarchy' || rawKind === 'flowchart') {
    kind = rawKind as DiagramKind
  }
  const stepsRaw = Array.isArray(c.steps) ? c.steps : Array.isArray(c.nodes) ? c.nodes : []
  const steps: DiagramStep[] = stepsRaw
    .map((s) => {
      if (typeof s === 'string') return { label: s, description: undefined }
      const so = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
      return {
        label: typeof so.label === 'string' ? so.label : typeof so.title === 'string' ? so.title : '',
        description: typeof so.description === 'string' ? so.description : undefined,
      }
    })
    .filter((s) => s.label && s.label.trim())
    .slice(0, 10)
  if (steps.length < 2) return null
  return { kind, title: typeof c.title === 'string' ? c.title : undefined, steps }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars) {
      if (line) lines.push(line)
      line = w
      if (lines.length >= maxLines) break
    } else {
      line = (line + ' ' + w).trim()
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  return lines.slice(0, maxLines)
}

/** Deterministic vertical flowchart / process diagram. */
function renderFlowchart(spec: DiagramSpec, colors: { primary: string; accent: string; fg: string; bg: string; border: string }, width: number): string {
  const boxW = Math.min(width - 80, 420)
  const boxH = 64
  const gap = 36
  const titleH = spec.title ? 44 : 12
  const height = titleH + spec.steps.length * (boxH + gap) + 16
  const x = (width - boxW) / 2
  const parts: string[] = []
  parts.push(`<rect width="${width}" height="${height}" fill="${colors.bg}" rx="8"/>`)
  if (spec.title) {
    parts.push(`<text x="${width / 2}" y="30" text-anchor="middle" font-family="Arial" font-size="16" font-weight="600" fill="${colors.fg}">${esc(spec.title)}</text>`)
  }
  spec.steps.forEach((step, i) => {
    const y = titleH + 4 + i * (boxH + gap)
    const isLast = i === spec.steps.length - 1
    const fill = i === 0 ? colors.primary : isLast ? colors.accent : '#ffffff'
    const stroke = i === 0 || isLast ? fill : colors.border
    const textFill = i === 0 || isLast ? '#ffffff' : colors.fg
    parts.push(`<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`)
    const labelLines = wrap(step.label || `Step ${i + 1}`, 42, 2)
    let ty = y + (boxH - (labelLines.length - 1) * 7 + (step.description ? -2 : 8)) / 2 + 8
    for (const ln of labelLines) {
      parts.push(`<text x="${width / 2}" y="${ty}" text-anchor="middle" font-family="Arial" font-size="13" font-weight="600" fill="${textFill}">${esc(ln)}</text>`)
      ty += 15
    }
    if (step.description) {
      const descLines = wrap(step.description, 56, 1)
      let dy = ty + 2
      for (const ln of descLines) {
        parts.push(`<text x="${width / 2}" y="${dy}" text-anchor="middle" font-family="Arial" font-size="10" fill="${i === 0 || isLast ? '#f0f0f0' : '#6b7280'}">${esc(ln)}</text>`)
        dy += 12
      }
    }
    if (!isLast) {
      const ay = y + boxH
      parts.push(
        `<line x1="${width / 2}" y1="${ay + 4}" x2="${width / 2}" y2="${ay + gap - 4}" stroke="${colors.accent}" stroke-width="2"/>` +
        `<polygon points="${width / 2 - 5},${ay + gap - 10} ${width / 2 + 5},${ay + gap - 10} ${width / 2},${ay + gap - 3}" fill="${colors.accent}"/>`
      )
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
}

/** Deterministic horizontal timeline. */
function renderTimeline(spec: DiagramSpec, colors: { primary: string; accent: string; fg: string; bg: string; border: string }, width: number): string {
  const n = spec.steps.length
  const titleH = spec.title ? 44 : 16
  const laneY = titleH + 70
  const height = titleH + 170
  const margin = 48
  const usable = width - margin * 2
  const step = n > 1 ? usable / (n - 1) : 0
  const parts: string[] = []
  parts.push(`<rect width="${width}" height="${height}" fill="${colors.bg}" rx="8"/>`)
  if (spec.title) {
    parts.push(`<text x="${width / 2}" y="30" text-anchor="middle" font-family="Arial" font-size="16" font-weight="600" fill="${colors.fg}">${esc(spec.title)}</text>`)
  }
  parts.push(`<line x1="${margin}" y1="${laneY}" x2="${width - margin}" y2="${laneY}" stroke="${colors.border}" stroke-width="3"/>`)
  spec.steps.forEach((s, i) => {
    const cx = margin + step * i
    const above = i % 2 === 0
    parts.push(`<circle cx="${cx}" cy="${laneY}" r="9" fill="${i === 0 ? colors.primary : colors.accent}" stroke="#ffffff" stroke-width="2.5"/>`)
    const labelLines = wrap(s.label || `Step ${i + 1}`, 20, 3)
    const descLines = s.description ? wrap(s.description, 24, 2) : []
    const blockH = labelLines.length * 13 + descLines.length * 11 + 8
    const ty = above ? laneY - 22 - blockH : laneY + 34
    let yy = ty + 12
    for (const ln of labelLines) {
      parts.push(`<text x="${cx}" y="${yy}" text-anchor="middle" font-family="Arial" font-size="11.5" font-weight="600" fill="${colors.fg}">${esc(ln)}</text>`)
      yy += 13
    }
    for (const ln of descLines) {
      parts.push(`<text x="${cx}" y="${yy}" text-anchor="middle" font-family="Arial" font-size="9.5" fill="#6b7280">${esc(ln)}</text>`)
      yy += 11
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
}

/** Deterministic top-down hierarchy (org chart). */
function renderHierarchy(spec: DiagramSpec, colors: { primary: string; accent: string; fg: string; bg: string; border: string }, width: number): string {
  const [root, ...children] = spec.steps
  const titleH = spec.title ? 44 : 12
  const boxW = Math.min(200, (width - 60) / Math.max(children.length, 1) - 16)
  const boxH = 56
  const rootY = titleH + 8
  const childY = rootY + boxH + 60
  const height = childY + boxH + 16
  const rootX = width / 2 - 110
  const parts: string[] = []
  parts.push(`<rect width="${width}" height="${height}" fill="${colors.bg}" rx="8"/>`)
  if (spec.title) {
    parts.push(`<text x="${width / 2}" y="30" text-anchor="middle" font-family="Arial" font-size="16" font-weight="600" fill="${colors.fg}">${esc(spec.title)}</text>`)
  }
  parts.push(`<rect x="${rootX}" y="${rootY}" width="220" height="${boxH}" rx="8" fill="${colors.primary}"/>`)
  const rootLines = wrap(root.label || 'Root', 26, 2)
  let ry = rootY + boxH / 2 - (rootLines.length - 1) * 7 + 5
  for (const ln of rootLines) {
    parts.push(`<text x="${width / 2}" y="${ry}" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#ffffff">${esc(ln)}</text>`)
    ry += 14
  }
  const n = children.length
  const spacing = n > 0 ? (width - 60) / n : 0
  children.forEach((c, i) => {
    const cx = 30 + spacing * i + spacing / 2
    const bx = cx - boxW / 2
    // connectors: root bottom → child top
    parts.push(`<path d="M ${width / 2} ${rootY + boxH} V ${rootY + boxH + 30} H ${cx} V ${childY}" fill="none" stroke="${colors.border}" stroke-width="1.8"/>`)
    parts.push(`<rect x="${bx}" y="${childY}" width="${boxW}" height="${boxH}" rx="6" fill="#ffffff" stroke="${colors.border}" stroke-width="1.5"/>`)
    const lines = wrap(c.label || `Node ${i + 1}`, 22, 3)
    let yy = childY + boxH / 2 - (lines.length - 1) * 7 + 5
    for (const ln of lines) {
      parts.push(`<text x="${cx}" y="${yy}" text-anchor="middle" font-family="Arial" font-size="11.5" font-weight="600" fill="${colors.fg}">${esc(ln)}</text>`)
      yy += 14
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
}

export interface RenderedDiagram {
  png: Buffer
  width: number
  height: number
  svg: string
  kind: DiagramKind
}

/** Render a validated diagram spec to PNG (theme-aware). */
export async function renderDiagram(
  spec: DiagramSpec,
  opts?: { width?: number; colors?: ColorPalette; background?: string }
): Promise<RenderedDiagram | null> {
  const width = Math.min(Math.max(opts?.width ?? 620, 360), 1000)
  const pal = opts?.colors
  const colors = {
    primary: pal?.primary ?? '#1e3a5f',
    accent: pal?.accent ?? '#3b82f6',
    fg: pal?.foreground ?? '#1f2937',
    bg: opts?.background ?? '#ffffff',
    border: pal?.border ?? '#d1d5db',
  }

  let svg: string
  switch (spec.kind) {
    case 'timeline':
      svg = renderTimeline(spec, colors, width)
      break
    case 'hierarchy':
      svg = renderHierarchy(spec, colors, width)
      break
    case 'process':
    case 'flowchart':
    default:
      svg = renderFlowchart(spec, colors, width)
      break
  }

  try {
    const sharp = (await import('sharp')).default
    const height = Number(svg.match(/height="(\d+)"/)?.[1] ?? 300)
    const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer()
    return { png, width, height, svg, kind: spec.kind }
  } catch {
    return null
  }
}
