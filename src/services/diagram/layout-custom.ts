// =============================================================================
// FILO DIAGRAM ENGINE v2 — BESPOKE LAYOUTS
// =============================================================================
// Structured diagrams whose geometry is clearer hand-computed than forced
// through a graph solver: horizontal/vertical timelines, sequence diagrams,
// comparison columns, layered architecture bands and the chevron process
// strip. All deterministic, all glyph-measured, all theme-painted.
// =============================================================================

import type { DiagramPalette, DiagramSpec } from './types'
import {
  drawNode,
  esc,
  openSvg,
  closeSvg,
  rasterSafeText,
  readableOn,
  shapeFor,
  sizeNode,
  svgTitle,
  textWidth,
  tint,
  type LayoutResult,
  type NodeSizing,
} from './svg'

const SIZING: NodeSizing = {
  labelSize: 12.5,
  descSize: 10.5,
  padX: 16,
  padY: 12,
  lineHeight: 1.32,
  maxTextWidth: 150,
  maxLines: 3,
  maxDescLines: 3,
}

// ==================== TIMELINE ====================

function layoutTimeline(spec: DiagramSpec, pal: DiagramPalette): LayoutResult {
  const nodes = spec.nodes
  const n = nodes.length
  const vertical = n > 6
  const titleH = spec.title ? 46 : 22
  const margin = 34

  if (!vertical) {
    // ---- horizontal, alternating cards ----
    const cardW = Math.min(190, Math.max(120, textWidth('M'.repeat(18), 12.5, 600)))
    const meas = nodes.map((node) => sizeNode({ ...node, description: node.description }, shapeFor(node, 'timeline'), { ...SIZING, maxTextWidth: cardW - 28 }))
    const cardH = Math.max(...meas.map((m) => m.h))
    // Center-to-center spacing keeps every card fully inside the canvas.
    const spacing = Math.max(cardW + 26, 120)
    const laneY = titleH + cardH + 52
    const width = Math.round(margin * 2 + cardW + spacing * (n - 1))
    const height = Math.round(laneY + cardH + 46)

    const { head, markerId } = openSvg(width, height, pal)
    const parts: string[] = [head]
    if (spec.title) parts.push(svgTitle(spec.title, pal))

    // Axis line + gradient hint.
    parts.push(`<line x1="${margin - 10}" y1="${laneY}" x2="${width - margin + 10}" y2="${laneY}" stroke="${pal.border}" stroke-width="2.4"/>`)

    nodes.forEach((node, i) => {
      const cx = Math.round(margin + cardW / 2 + spacing * i)
      const above = i % 2 === 0
      const m = meas[i]
      const cardY = above ? laneY - 34 - m.h : laneY + 34
      // Stem.
      parts.push(`<line x1="${cx}" y1="${above ? cardY + m.h : laneY}" x2="${cx}" y2="${above ? laneY : cardY}" stroke="${pal.border}" stroke-width="1.6"/>`)
      // Milestone dot.
      const dotFill = i === 0 ? pal.primary : pal.accent
      parts.push(`<circle cx="${cx}" cy="${laneY}" r="7" fill="${dotFill}" stroke="${pal.canvas}" stroke-width="2.4"/>`)
      // Card.
      const geometry = { x: Math.round(cx - m.w / 2), y: Math.round(cardY), w: m.w, h: m.h }
      const emphasis = i === 0 ? 'primary' : 'none'
      parts.push(
        drawNode(
          {
            node,
            shape: 'rounded',
            geometry,
            labelLines: m.labelLines,
            descLines: m.descLines,
            attrLines: [],
            fill: emphasis === 'primary' ? pal.primary : pal.card,
            stroke: emphasis === 'primary' ? pal.primary : pal.border,
            textFill: emphasis === 'primary' ? readableOn(pal.primary) : pal.fg,
            labelSize: SIZING.labelSize,
            descSize: SIZING.descSize,
          },
          pal
        )
      )
    })
    void markerId
    return { svg: closeSvg(parts), width, height }
  }

  // ---- vertical spine (7+ milestones) ----
  const meas = nodes.map((node) => sizeNode(node, shapeFor(node, 'timeline'), { ...SIZING, maxTextWidth: 330 }))
  const rowGap = 18
  const spineX = 60
  const width = Math.round(Math.max(...meas.map((m) => m.w)) + spineX + 60)
  let y = titleH + 8
  const rows: Array<{ y: number; h: number }> = []
  for (const m of meas) {
    rows.push({ y, h: m.h })
    y += m.h + rowGap
  }
  const height = Math.round(y - rowGap + 24)

  const { head } = openSvg(width, height, pal)
  const parts: string[] = [head]
  if (spec.title) parts.push(svgTitle(spec.title, pal))
  parts.push(`<line x1="${spineX}" y1="${titleH}" x2="${spineX}" y2="${height - 16}" stroke="${pal.border}" stroke-width="2.4"/>`)

  nodes.forEach((node, i) => {
    const m = meas[i]
    const row = rows[i]
    const dotFill = i === 0 ? pal.primary : pal.accent
    parts.push(`<circle cx="${spineX}" cy="${row.y + m.h / 2}" r="6" fill="${dotFill}" stroke="${pal.canvas}" stroke-width="2.2"/>`)
    parts.push(`<line x1="${spineX + 6}" y1="${row.y + m.h / 2}" x2="${spineX + 24}" y2="${row.y + m.h / 2}" stroke="${pal.border}" stroke-width="1.6"/>`)
    parts.push(
      drawNode(
        {
          node,
          shape: 'rounded',
          geometry: { x: spineX + 24, y: row.y, w: m.w, h: m.h },
          labelLines: m.labelLines,
          descLines: m.descLines,
          attrLines: [],
          fill: i === 0 ? pal.primary : pal.card,
          stroke: i === 0 ? pal.primary : pal.border,
          textFill: i === 0 ? readableOn(pal.primary) : pal.fg,
          labelSize: SIZING.labelSize,
          descSize: SIZING.descSize,
        },
        pal
      )
    )
  })
  return { svg: closeSvg(parts), width, height }
}

// ==================== SEQUENCE ====================

function layoutSequence(spec: DiagramSpec, pal: DiagramPalette): LayoutResult {
  const actors = spec.nodes
  const titleH = spec.title ? 46 : 24
  const headerH = 44
  const margin = 34
  // Pill width per actor, then enough canvas for the widest pill + spacing.
  const pillW = actors.map((a) => Math.min(200, Math.max(84, textWidth(a.label, 12.5, 600) + 26)))
  const maxPillW = Math.max(...pillW)
  const actorGap = Math.max(maxPillW + 24, 120)
  const width = Math.round(maxPillW / 2 + margin + actorGap * (actors.length - 1) + maxPillW / 2)
  const msgRowH = 40
  const height = Math.round(titleH + headerH + spec.edges.length * msgRowH + 34)

  const { head, markerId } = openSvg(width, height, pal)
  const parts: string[] = [head]
  if (spec.title) parts.push(svgTitle(spec.title, pal))

  const centerX = (i: number) => Math.round(maxPillW / 2 + margin + actorGap * i)

  // Lifelines first.
  actors.forEach((_, i) => {
    parts.push(`<line x1="${centerX(i)}" y1="${titleH + headerH}" x2="${centerX(i)}" y2="${height - 22}" stroke="${pal.border}" stroke-width="1.4" stroke-dasharray="5 5"/>`)
  })
  // Actor headers.
  actors.forEach((actor, i) => {
    const w = pillW[i]
    const x = centerX(i) - w / 2
    const y = titleH + 6
    const fill = i === 0 ? pal.primary : pal.card
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${headerH - 12}" rx="${(headerH - 12) / 2}" fill="${fill}" stroke="${i === 0 ? pal.primary : pal.border}" stroke-width="1.4"/>`)
    const lines = rasterSafeText(actor.label)
    parts.push(`<text x="${centerX(i)}" y="${y + (headerH - 12) / 2 + 4.5}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="${lines.length > 16 ? 10.5 : 12}" font-weight="600" fill="${i === 0 ? readableOn(pal.primary) : pal.fg}">${esc(lines.slice(0, 26))}</text>`)
  })
  // Messages in order.
  spec.edges.forEach((edge, idx) => {
    const fromIdx = actors.findIndex((a) => a.id === edge.from)
    const toIdx = actors.findIndex((a) => a.id === edge.to)
    if (fromIdx < 0 || toIdx < 0) return
    const y = titleH + headerH + msgRowH * idx + msgRowH / 2
    const x1 = centerX(fromIdx)
    const x2 = centerX(toIdx)
    const selfMessage = fromIdx === toIdx
    if (selfMessage) {
      const r = 16
      parts.push(`<path d="M ${x1} ${y - 6} h ${r} a ${r / 2} ${r / 2} 0 0 1 0 ${12} h -${r}" fill="none" stroke="${pal.edge}" stroke-width="1.6" marker-end="url(#${markerId})"/>`)
    } else {
      parts.push(`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${pal.edge}" stroke-width="1.6" marker-end="url(#${markerId})"${edge.dashed ? ' stroke-dasharray="6 4"' : ''}/>`)
    }
    if (edge.label) {
      const safe = rasterSafeText(edge.label)
      const labelW = Math.min(textWidth(safe, 10.5, 400) + 10, Math.abs(x2 - x1) - 12 || 120)
      const lx = selfMessage ? x1 + 30 : (x1 + x2) / 2
      parts.push(`<text x="${lx}" y="${y - 7}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="10.5" fill="${pal.mutedForeground}">${esc(safe)}</text>`)
    }
  })
  return { svg: closeSvg(parts), width, height }
}

// ==================== COMPARISON ====================

function layoutComparison(spec: DiagramSpec, pal: DiagramPalette): LayoutResult {
  const columns = spec.columns ?? []
  const titleH = spec.title ? 46 : 22
  const margin = 30
  const gap = 18
  const colW = Math.min(250, Math.max(150, (900 - margin * 2 - gap * (columns.length - 1)) / columns.length))

  const measuredCols = columns.map((col) => {
    const points = (col.points ?? []).map((p) => {
      const lines = rasterSafeText(p).split(/\n+/)
      return lines.flatMap((l) => wrapToWidth(l, colW - 42, 11, 3))
    })
    const titleLines = wrapToWidth(rasterSafeText(col.title ?? ''), colW - 32, 13.5, 2)
    return { titleLines, points, height: 44 + points.reduce((sum, ls) => sum + ls.length * 15 + 10, 0) }
  })
  const colH = Math.max(...measuredCols.map((c) => c.height))
  const width = Math.round(margin * 2 + colW * columns.length + gap * (columns.length - 1))
  const height = Math.round(titleH + colH + 26)

  const { head } = openSvg(width, height, pal)
  const parts: string[] = [head]
  if (spec.title) parts.push(svgTitle(spec.title, pal))

  columns.forEach((col, i) => {
    const m = measuredCols[i]
    const x = margin + i * (colW + gap)
    const y = titleH
    // Column card.
    parts.push(`<rect x="${x}" y="${y}" width="${colW}" height="${colH}" rx="12" fill="${pal.card}" stroke="${pal.border}" stroke-width="1.4"/>`)
    // Header band.
    const bandFill = i === 0 ? pal.primary : i === columns.length - 1 && columns.length > 2 ? pal.accent : tint(pal.primary, 0.9)
    parts.push(`<path d="M ${x} ${y + 40} H ${x + colW}" stroke="${pal.border}" stroke-width="1"/>`)
    parts.push(`<rect x="${x}" y="${y}" width="${colW}" height="40" rx="12" fill="${bandFill}"/>`)
    parts.push(`<rect x="${x}" y="${y + 26}" width="${colW}" height="14" fill="${bandFill}"/>`)
    const bandText = readableOn(bandFill)
    m.titleLines.slice(0, 1).forEach((line, li) => {
      parts.push(`<text x="${x + colW / 2}" y="${y + 25 + li * 2}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="13" font-weight="700" fill="${bandText}">${esc(line)}</text>`)
    })
    // Points with accent bullets.
    let py = y + 62
    m.points.forEach((lines) => {
      parts.push(`<circle cx="${x + 22}" cy="${py - 4}" r="2.6" fill="${pal.accent}"/>`)
      lines.forEach((line, li) => {
        parts.push(`<text x="${x + 34}" y="${py + li * 15 - (li === 0 ? 4 : 0)}" text-anchor="start" font-family="DejaVu Sans, sans-serif" font-size="11" fill="${pal.fg}">${esc(li === 0 ? line : '  ' + line)}</text>`)
      })
      py += lines.length * 15 + 10
    })
  })
  return { svg: closeSvg(parts), width, height }
}

function wrapToWidth(text: string, maxWidthPx: number, fontSize: number, maxLines: number): string[] {
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (textWidth(candidate, fontSize, 400) <= maxWidthPx || !line) line = candidate
    else {
      lines.push(line)
      line = word
      if (lines.length >= maxLines) break
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  return lines.slice(0, maxLines)
}

// ==================== ARCHITECTURE (layered bands) ====================

interface BandGeom {
  label: string
  x: number
  y: number
  w: number
  h: number
}

function layoutArchitecture(spec: DiagramSpec, pal: DiagramPalette): LayoutResult {
  const titleH = spec.title ? 46 : 22
  const margin = 30
  const bandGap = 28
  const nodeGap = 12
  const bandLabelH = 26

  // Group nodes by `group` preserving first-appearance order.
  const groups: Array<{ label: string; nodes: typeof spec.nodes }> = []
  for (const node of spec.nodes) {
    const label = node.group ?? ''
    let g = groups.find((x) => x.label === label)
    if (!g) {
      g = { label, nodes: [] }
      groups.push(g)
    }
    g.nodes.push(node)
  }

  const dirLR = (spec.direction ?? 'LR') === 'LR'
  const meas = new Map<string, ReturnType<typeof sizeNode>>()
  for (const node of spec.nodes) {
    meas.set(node.id, sizeNode(node, shapeFor(node, 'architecture'), { ...SIZING, maxTextWidth: 168, maxDescLines: 2 }))
  }

  const maxNodeW = Math.max(...spec.nodes.map((n) => meas.get(n.id)!.w))
  const maxNodeH = Math.max(...spec.nodes.map((n) => meas.get(n.id)!.h))

  let width: number
  let height: number
  if (dirLR) {
    const bandsW = groups.length * (maxNodeW + 30) + (groups.length - 1) * bandGap
    const tallest = Math.max(...groups.map((g) => g.nodes.length))
    width = Math.round(margin * 2 + bandsW)
    height = Math.round(titleH + 16 + bandLabelH + tallest * (maxNodeH + nodeGap) + 20)
  } else {
    const bandsH = groups.reduce((s, g) => s + bandLabelH + g.nodes.length * (maxNodeH + nodeGap) + 14, 0) + (groups.length - 1) * bandGap
    width = Math.round(margin * 2 + maxNodeW + 60)
    height = Math.round(titleH + 16 + bandsH + 8)
  }

  const { head, markerId } = openSvg(width, height, pal)
  const parts: string[] = [head]
  if (spec.title) parts.push(svgTitle(spec.title, pal))

  // Bands and node slots.
  const posById = new Map<string, { x: number; y: number; w: number; h: number }>()
  const bandRects: BandGeom[] = []
  let cursor = margin
  const bandTop = titleH + 10
  groups.forEach((g, gi) => {
    const bandTint = gi % 2 === 0 ? tint(pal.primary, 0.965) : tint(pal.accent, 0.96)
    let bw: number, bh: number
    if (dirLR) {
      bw = maxNodeW + 30
      bh = height - bandTop - 14
    } else {
      bw = width - margin * 2
      bh = bandLabelH + g.nodes.length * (maxNodeH + nodeGap) + 6
    }
    parts.push(`<rect x="${cursor}" y="${bandTop}" width="${bw}" height="${bh}" rx="12" fill="${bandTint}" stroke="${pal.border}" stroke-width="1.1"/>`)
    if (g.label) {
      parts.push(
        `<text x="${cursor + bw / 2}" y="${bandTop + 17}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="10.5" font-weight="700" letter-spacing="1.5" fill="${pal.mutedForeground}">${esc(g.label.toUpperCase())}</text>`
      )
    }
    bandRects.push({ label: g.label, x: cursor, y: bandTop, w: bw, h: bh })

    // Slot nodes inside the band.
    const slotW = bw - 24
    const slotTop = bandTop + bandLabelH + 4
    g.nodes.forEach((node, ni) => {
      const m = meas.get(node.id)!
      const x = dirLR ? cursor + 12 + (slotW - m.w) / 2 : cursor + (bw - m.w) / 2
      const y = slotTop + ni * (maxNodeH + nodeGap) + (maxNodeH - m.h) / 2
      posById.set(node.id, { x: Math.round(x), y: Math.round(y), w: m.w, h: m.h })
    })
    cursor += bw + bandGap
  })

  // Orthogonal connectors (drawn under the nodes).
  spec.edges.forEach((edge) => {
    const a = posById.get(edge.from)
    const b = posById.get(edge.to)
    if (!a || !b) return
    let points: Array<{ x: number; y: number }>
    if (dirLR) {
      const sx = a.x + a.w
      const sy = a.y + a.h / 2
      const tx = b.x
      const ty = b.y + b.h / 2
      const midX = (sx + tx) / 2
      points = [{ x: sx, y: sy }, { x: midX, y: sy }, { x: midX, y: ty }, { x: tx, y: ty }]
    } else {
      const sx = a.x + a.w / 2
      const sy = a.y + a.h
      const tx = b.x + b.w / 2
      const ty = b.y
      const midY = (sy + ty) / 2
      points = [{ x: sx, y: sy }, { x: sx, y: midY }, { x: tx, y: midY }, { x: tx, y: ty }]
    }
    parts.push(
      `<path d="${points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}" fill="none" stroke="${pal.edge}" stroke-width="1.7" marker-end="url(#${markerId})"${edge.dashed ? ' stroke-dasharray="6 4"' : ''}/>`
    )
    if (edge.label) {
      const safe = rasterSafeText(edge.label)
      const mid = points[1] && points[2] ? { x: (points[1].x + points[2].x) / 2, y: (points[1].y + points[2].y) / 2 } : points[0]
      parts.push(`<text x="${mid.x}" y="${mid.y - 5}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="10" fill="${pal.mutedForeground}">${esc(safe)}</text>`)
    }
  })

  // Nodes.
  for (const node of spec.nodes) {
    const c = posById.get(node.id)
    const m = meas.get(node.id)!
    if (!c) continue
    const isEntry = spec.edges.length > 0 && !spec.edges.some((e) => e.to === node.id)
    parts.push(
      drawNode(
        {
          node,
          shape: 'rounded',
          geometry: { x: c.x, y: c.y, w: c.w, h: c.h },
          labelLines: m.labelLines,
          descLines: m.descLines,
          attrLines: [],
          fill: isEntry ? pal.primary : pal.card,
          stroke: isEntry ? pal.primary : pal.border,
          textFill: isEntry ? readableOn(pal.primary) : pal.fg,
          labelSize: SIZING.labelSize,
          descSize: SIZING.descSize,
        },
        pal
      )
    )
  }
  return { svg: closeSvg(parts), width, height }
}

// ==================== PROCESS (chevron strip) ====================

function layoutProcess(spec: DiagramSpec, pal: DiagramPalette): LayoutResult {
  const nodes = spec.nodes
  const titleH = spec.title ? 46 : 22
  const margin = 30
  const arrowLen = 34

  // One row of up to 6 steps; larger flows wrap into two rows (serpentine).
  const rows: typeof nodes[] = []
  if (nodes.length <= 6) {
    rows.push(nodes)
  } else {
    const perRow = Math.ceil(nodes.length / 2)
    rows.push(nodes.slice(0, perRow), nodes.slice(perRow))
  }

  const meas = nodes.map((node) => sizeNode(node, shapeFor(node, 'process'), { ...SIZING, maxTextWidth: 150, maxDescLines: 2 }))
  const rowH = Math.max(...meas.map((m) => m.h))
  const rowWidths = rows.map((row) => row.reduce((s, n) => s + meas[nodes.indexOf(n)].w, 0) + arrowLen * Math.max(row.length - 1, 0))
  const width = Math.round(margin * 2 + Math.max(...rowWidths))
  const rowGap = 40
  const height = Math.round(titleH + 18 + rows.length * rowH + (rows.length - 1) * rowGap + 10)

  const { head, markerId } = openSvg(width, height, pal)
  const parts: string[] = [head]
  if (spec.title) parts.push(svgTitle(spec.title, pal))

  let nodeIdx = 0
  rows.forEach((row, ri) => {
    const rowW = rowWidths[ri]
    let x = margin + (width - margin * 2 - rowW) / 2
    const y = titleH + 12 + ri * (rowH + rowGap)
    const reverse = rows.length > 1 && ri % 2 === 1
    const ordered = reverse ? [...row].reverse() : row
    ordered.forEach((node, ii) => {
      const m = meas[nodes.indexOf(node)]
      const cx = reverse ? x + rowW - (ordered.slice(0, ii).reduce((s, n) => s + meas[nodes.indexOf(n)].w, 0) + arrowLen * ii) - m.w : x + ordered.slice(0, ii).reduce((s, n) => s + meas[nodes.indexOf(n)].w, 0) + arrowLen * ii
      const isFirst = nodeIdx === 0
      const isLast = nodeIdx === nodes.length - 1
      parts.push(
        drawNode(
          {
            node,
            shape: 'rounded',
            geometry: { x: Math.round(cx), y, w: m.w, h: m.h },
            labelLines: m.labelLines,
            descLines: m.descLines,
            attrLines: [],
            fill: isFirst ? pal.primary : isLast ? tint(pal.accent, 0.82) : pal.card,
            stroke: isFirst ? pal.primary : isLast ? pal.accent : pal.border,
            textFill: isFirst ? readableOn(pal.primary) : isLast ? pal.fg : pal.fg,
            labelSize: SIZING.labelSize,
            descSize: SIZING.descSize,
          },
          pal
        )
      )
      // Arrow to the next node in this row.
      if (ii < ordered.length - 1) {
        const nextM = meas[nodes.indexOf(ordered[ii + 1])]
        const ax1 = reverse ? cx - arrowLen + 5 : cx + m.w + 5
        const ax2 = reverse ? cx - 5 : cx + m.w + arrowLen - 5
        const ay = y + m.h / 2
        parts.push(`<line x1="${ax1}" y1="${ay}" x2="${ax2}" y2="${ay}" stroke="${pal.edge}" stroke-width="1.8" marker-end="url(#${markerId})"/>`)
        void nextM
      }
      nodeIdx++
    })
  })
  return { svg: closeSvg(parts), width, height }
}

export const CUSTOM_LAYOUTS: Record<string, ((spec: DiagramSpec, pal: DiagramPalette) => LayoutResult) | undefined> = {
  timeline: layoutTimeline,
  sequence: layoutSequence,
  comparison: layoutComparison,
  architecture: layoutArchitecture,
  process: undefined, // decided dynamically in the facade (chevron vs dagre)
}

export { layoutProcess, layoutTimeline, layoutSequence, layoutComparison, layoutArchitecture }
