// =============================================================================
// FILO DIAGRAM ENGINE v2 — GRAPH LAYOUTS (dagre-backed)
// =============================================================================
// Flowcharts, decision trees, hierarchies/org charts, processes, networks,
// concept maps and ER diagrams share one proven layout core: @dagrejs/dagre
// computes node positions and edge routes; this module sizes every node from
// glyph-accurate text metrics, draws themed shapes (rounded / stadium /
// decision diamonds / ER entities), routes edges with rounded elbows and
// label chips, and assembles the final SVG.
//
// dagre is deterministic for a given input graph — same spec in, same pixels
// out. Edges are always set with an explicit label object (a graphlib quirk:
// undefined edge labels crash dagre's input-graph sync).
// =============================================================================

import dagre from '@dagrejs/dagre'
import type { DiagramNode, DiagramPalette, DiagramSpec } from './types'
import {
  drawEdge,
  drawNode,
  esc,
  openSvg,
  closeSvg,
  rasterSafeText,
  shapeFor,
  sizeNode,
  svgTitle,
  tint,
  readableOn,
  type LayoutResult,
  type NodeSizing,
} from './svg'

// ==================== NODE STYLING PER KIND ====================

interface NodeStyle {
  fill: string
  stroke: string
  textFill: string
}

function styleFor(node: DiagramNode, shape: string, spec: DiagramSpec, pal: DiagramPalette, degree: number): NodeStyle {
  const onDark = readableOn(pal.canvas) === '#ffffff' // canvas is dark
  const base: NodeStyle = {
    fill: onDark ? tint(pal.card, onDark ? -0.0 : 0) : pal.card,
    stroke: pal.border,
    textFill: pal.fg,
  }

  // Emphasis override from the AI (validated vocabulary).
  if (node.emphasis === 'primary') {
    return { fill: pal.primary, stroke: pal.primary, textFill: readableOn(pal.primary) }
  }
  if (node.emphasis === 'muted') {
    return { fill: pal.muted, stroke: pal.border, textFill: pal.mutedForeground }
  }

  switch (spec.kind) {
    case 'decision_tree': {
      if (shape === 'stadium') return { fill: pal.primary, stroke: pal.primary, textFill: readableOn(pal.primary) }
      if (shape === 'diamond') return { fill: tint(pal.accent, 0.88), stroke: pal.accent, textFill: pal.fg }
      return base
    }
    case 'flowchart':
    case 'process': {
      if (shape === 'stadium') {
        const isEnd = /^(end|finish|complete|done|final|approved|rejected)/i.test(node.label)
        return isEnd
          ? { fill: tint(pal.accent, 0.82), stroke: pal.accent, textFill: pal.fg }
          : { fill: pal.primary, stroke: pal.primary, textFill: readableOn(pal.primary) }
      }
      if (shape === 'diamond') return { fill: tint(pal.accent, 0.88), stroke: pal.accent, textFill: pal.fg }
      return base
    }
    case 'hierarchy':
    case 'org_chart': {
      const roots = spec.nodes.filter((n) => !spec.edges.some((e) => e.to === n.id))
      if (roots.length === 0 || roots.includes(node)) {
        return { fill: pal.primary, stroke: pal.primary, textFill: readableOn(pal.primary) }
      }
      return base
    }
    case 'network':
    case 'concept_map': {
      // Hubs (highest degree) carry the accent identity.
      const maxDegree = Math.max(1, ...spec.nodes.map((n) => degreeOf(n.id, spec)))
      if (degree === maxDegree && spec.nodes.length > 3) {
        return { fill: tint(pal.accent, 0.86), stroke: pal.accent, textFill: pal.fg }
      }
      return base
    }
    case 'er':
      return { fill: pal.card, stroke: pal.border, textFill: pal.fg }
    default:
      return base
  }
}

function degreeOf(id: string, spec: DiagramSpec): number {
  let d = 0
  for (const e of spec.edges) {
    if (e.from === id) d++
    if (e.to === id) d++
  }
  return d
}

// ==================== SIZING PROFILES ====================

function sizingFor(spec: DiagramSpec): NodeSizing {
  const dense = spec.nodes.length > 10
  const base: NodeSizing = {
    labelSize: 12.5,
    descSize: 10.5,
    padX: 16,
    padY: 12,
    lineHeight: 1.32,
    maxTextWidth: spec.direction === 'LR' || (spec.direction ?? defaultDirection(spec.kind)) === 'LR' ? 150 : 170,
    maxLines: 3,
    maxDescLines: 2,
  }
  if (spec.kind === 'er') {
    return { ...base, maxTextWidth: 150, maxDescLines: 0, padY: 10 }
  }
  if (spec.kind === 'network' || spec.kind === 'concept_map') {
    return { ...base, maxTextWidth: 120, maxLines: 3, maxDescLines: 0, padX: 12, padY: 9 }
  }
  if (dense) return { ...base, maxTextWidth: 140, labelSize: 12, descSize: 10 }
  return base
}

function defaultDirection(kind: string): 'TB' | 'LR' {
  switch (kind) {
    case 'process':
    case 'decision_tree':
      return 'LR'
    case 'hierarchy':
    case 'org_chart':
      return 'TB'
    default:
      return 'TB'
  }
}

// ==================== DAGRE LAYOUT ====================

export function layoutGraph(spec: DiagramSpec, pal: DiagramPalette): LayoutResult {
  const direction = spec.direction ?? defaultDirection(spec.kind)
  const sizing = sizingFor(spec)
  const n = spec.nodes.length

  // Pre-measure every node.
  const measured = new Map<string, { w: number; h: number; labelLines: string[]; descLines: string[]; attrLines: string[]; shape: string }>()
  for (const node of spec.nodes) {
    const shape = shapeFor(node, spec.kind)
    const sized = sizeNode(node, shape, sizing)
    measured.set(node.id, { ...sized, shape })
  }

  const isTree = spec.kind === 'hierarchy' || spec.kind === 'org_chart'
  const graph = new dagre.graphlib.Graph({ multigraph: true, compound: false })
  graph.setGraph({
    rankdir: direction,
    nodesep: isTree ? 26 : n > 12 ? 22 : 34,
    ranksep: direction === 'LR' ? 54 : 44,
    marginx: 0,
    marginy: 0,
    ranker: 'network-simplex',
  })
  for (const node of spec.nodes) {
    const m = measured.get(node.id)!
    graph.setNode(node.id, { width: m.w, height: m.h })
  }
  for (const edge of spec.edges) {
    const labelW = edge.label ? Math.min(rasterSafeText(edge.label).length * 6 + 14, 120) : 0
    graph.setEdge(edge.from, edge.to, { width: labelW, height: edge.label ? 16 : 0, labelpos: 'c' }, 'e' + graph.edgeCount())
  }
  dagre.layout(graph)

  // Canvas assembly.
  const g = graph.graph()
  const titleH = spec.title ? 46 : 20
  const margin = 30
  const contentW = Math.ceil((g.width ?? 0) + margin * 2)
  const contentH = Math.ceil((g.height ?? 0) + titleH + margin)
  const width = Math.max(420, contentW)
  const height = Math.max(200, contentH)
  const offsetX = (width - contentW) / 2 + margin
  const offsetY = titleH + margin / 2

  const { head, markerId } = openSvg(width, height, pal)
  const parts: string[] = [head]
  if (spec.title) parts.push(svgTitle(spec.title, pal))

  // Edges first (under the nodes).
  const edgeIndex = new Map<string, { v: string; w: string; name?: string }>()
  graph.edges().forEach((e) => edgeIndex.set(`${e.v}\u0000${e.w}`, e))
  spec.edges.forEach((edge) => {
    const ge = edgeIndex.get(`${edge.from}\u0000${edge.to}`)
    if (!ge) return
    const label = graph.edge(ge) as { points?: Array<{ x: number; y: number }>; x?: number; y?: number }
    let points = (label.points ?? []).map((p) => ({ x: p.x + offsetX, y: p.y + offsetY }))
    if (points.length < 2) return
    // Trim the polyline ends back to the node borders (dagre intersects the
    // node bounding box; for diamonds the arrow visually touches air).
    points = trimToNode(points, measured.get(edge.from)!, offsetX, offsetY, true)
    points = trimToNode(points, measured.get(edge.to)!, offsetX, offsetY, false)
    const accent = spec.kind === 'decision_tree' && Boolean(edge.label)
    parts.push(drawEdge({ points, label: edge.label, dashed: edge.dashed, color: accent ? 'accent' : '' , id: 0 }, markerId, pal))
  })

  // Nodes.
  for (const node of spec.nodes) {
    const m = measured.get(node.id)!
    const gn = graph.node(node.id) as { x: number; y: number }
    const geometry = {
      x: Math.round(gn.x + offsetX - m.w / 2),
      y: Math.round(gn.y + offsetY - m.h / 2),
      w: m.w,
      h: m.h,
    }
    const style = styleFor(node, m.shape, spec, pal, degreeOf(node.id, spec))
    parts.push(
      drawNode(
        {
          node,
          shape: m.shape as never,
          geometry,
          labelLines: m.labelLines,
          descLines: m.descLines,
          attrLines: m.attrLines,
          fill: style.fill,
          stroke: style.stroke,
          textFill: style.textFill,
          labelSize: sizing.labelSize,
          descSize: sizing.descSize,
        },
        pal
      )
    )
  }

  return { svg: closeSvg(parts), width, height }
}

/** Pull the first/last polyline point to the node border so arrows touch shapes. */
function trimToNode(
  points: Array<{ x: number; y: number }>,
  m: { w: number; h: number; shape: string },
  offsetX: number,
  offsetY: number,
  atSource: boolean
): Array<{ x: number; y: number }> {
  if (points.length < 2) return points
  const idx = atSource ? 0 : points.length - 1
  const inner = atSource ? points[1] : points[points.length - 2]
  const border = atSource ? points[0] : points[points.length - 1]
  // dagre already intersects the box; for diamonds pull the point 6px closer
  // to the inner point so the arrowhead meets the rhombus edge.
  if (m.shape !== 'diamond') return points
  const dx = inner.x - border.x
  const dy = inner.y - border.y
  const len = Math.hypot(dx, dy) || 1
  const adjusted = [...points]
  adjusted[idx] = { x: border.x + (dx / len) * 7, y: border.y + (dy / len) * 7 }
  return adjusted
}

export { esc }
