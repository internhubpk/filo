// =============================================================================
// FILO DIAGRAM ENGINE v2 — VALIDATION / NORMALIZATION
// =============================================================================
// One choke point between AI output and the renderers. Accepts:
//   • the CANONICAL semantic shape  { kind, direction, nodes, edges, … }
//   • every LEGACY shape still emitted by older prompts and fixtures:
//       – { kind, steps: [{label, description}] }        (linear flow)
//       – a BARE ARRAY of {label, description}            (timeline)
//       – { kind:'sequence', actors, messages }           (sequence sugar)
//       – { kind:'er', entities, relations }              (ER sugar)
//       – { kind:'comparison', columns }                  (comparison sugar)
// Every accepted input is repaired deterministically; every repair is
// recorded so QA can surface it. Returns null only when nothing renderable
// remains (fewer than 2 usable nodes for graph kinds, etc.).
// =============================================================================

import type {
  ComparisonColumn,
  DiagramEdge,
  DiagramKind,
  DiagramNode,
  DiagramSpec,
  DiagramStep,
} from './types'

const GRAPH_KINDS: DiagramKind[] = [
  'flowchart', 'process', 'decision_tree', 'hierarchy', 'org_chart',
  'network', 'concept_map', 'er',
]
const ALL_KINDS: DiagramKind[] = [...GRAPH_KINDS, 'timeline', 'sequence', 'architecture', 'comparison']

const MAX_NODES = 30
const MAX_EDGES = 60

function asTrimmedString(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim() : ''
}

function normalizeKind(raw: unknown): DiagramKind {
  const k = asTrimmedString(raw).toLowerCase().replace(/[\s_-]+/g, '-')
  switch (k) {
    case 'flowchart': case 'flow': case 'flow-chart': return 'flowchart'
    case 'process': case 'pipeline': case 'workflow': return 'process'
    case 'decision': case 'decision-tree': case 'decisiontree': case 'decision-tree': return 'decision_tree'
    case 'hierarchy': case 'tree': return 'hierarchy'
    case 'org-chart': case 'orgchart': case 'org': case 'organization': return 'org_chart'
    case 'timeline': case 'roadmap': case 'milestones': return 'timeline'
    case 'architecture': case 'system': case 'layers': case 'system-architecture': return 'architecture'
    case 'network': case 'graph': case 'relationship': case 'relationships': return 'network'
    case 'sequence': case 'sequence-diagram': return 'sequence'
    case 'er': case 'entity-relationship': case 'erd': return 'er'
    case 'comparison': case 'versus': case 'vs': case 'side-by-side': return 'comparison'
    case 'concept-map': case 'conceptmap': case 'mindmap': case 'mind-map': return 'concept_map'
    default: return 'flowchart'
  }
}

function collectNodes(raw: unknown, repairs: string[]): DiagramNode[] {
  if (!Array.isArray(raw)) return []
  const nodes: DiagramNode[] = []
  raw.forEach((item, i) => {
    if (typeof item === 'string') {
      const label = asTrimmedString(item)
      if (label) nodes.push({ id: `n${nodes.length + 1}`, label: label.slice(0, 120) })
      return
    }
    if (!item || typeof item !== 'object') return
    const o = item as Record<string, unknown>
    const label = asTrimmedString(o.label ?? o.title ?? o.name ?? o.text)
    if (!label) return
    const attributes = Array.isArray(o.attributes)
      ? o.attributes.map((a) => asTrimmedString(a)).filter(Boolean).slice(0, 6)
      : undefined
    const shapeRaw = asTrimmedString(o.shape ?? o.nodeType).toLowerCase()
    const shape = ['rect', 'rounded', 'stadium', 'diamond', 'entity'].includes(shapeRaw)
      ? (shapeRaw as DiagramNode['shape'])
      : undefined
    nodes.push({
      id: asTrimmedString(o.id).slice(0, 40) || `n${nodes.length + 1}`,
      label: label.slice(0, 120),
      description: asTrimmedString(o.description ?? o.details ?? o.summary).slice(0, 200) || undefined,
      attributes: attributes && attributes.length ? attributes : undefined,
      shape,
      group: asTrimmedString(o.group ?? o.layer ?? o.lane ?? o.column).slice(0, 60) || undefined,
      emphasis: o.emphasis === 'primary' || o.emphasis === 'muted' ? o.emphasis : undefined,
    })
    if (nodes.length >= MAX_NODES) {
      repairs.push(`node count capped at ${MAX_NODES}`)
      return
    }
  })
  return nodes
}

function collectEdges(raw: unknown, nodes: DiagramNode[], repairs: string[]): DiagramEdge[] {
  if (!Array.isArray(raw)) return []
  const byId = new Map<string, string>() // lowercase id AND lowercase label → node id
  nodes.forEach((n, i) => {
    byId.set(n.id.toLowerCase(), n.id)
    byId.set(n.label.toLowerCase(), n.id)
    byId.set(String(i + 1), n.id) // 1-based index sugar
  })
  const resolve = (refRaw: unknown): string | null => {
    if (typeof refRaw === 'number' && Number.isFinite(refRaw)) {
      const n = nodes[refRaw - 1] ?? nodes[refRaw]
      return n ? n.id : null
    }
    const ref = asTrimmedString(refRaw)
    if (!ref) return null
    return byId.get(ref.toLowerCase()) ?? null
  }
  const edges: DiagramEdge[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const from = resolve(o.from ?? o.source ?? o.src)
    const to = resolve(o.to ?? o.target ?? o.dst)
    if (!from || !to) {
      repairs.push(`edge "${asTrimmedString(o.from) || '?'}" → "${asTrimmedString(o.to) || '?'}" dropped (unknown endpoint)`)
      continue
    }
    if (from === to && !asTrimmedString(o.label)) continue // pointless self-loop
    edges.push({
      from,
      to,
      label: asTrimmedString(o.label ?? o.text ?? o.cardinality).slice(0, 32) || undefined,
      dashed: o.dashed === true || o.style === 'dashed',
    })
    if (edges.length >= MAX_EDGES) {
      repairs.push(`edge count capped at ${MAX_EDGES}`)
      break
    }
  }
  return edges
}

/** Legacy linear steps → nodes chained with edges. */
function stepsToNodesAndEdges(steps: DiagramStep[], kind: DiagramKind, repairs: string[]): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const nodes: DiagramNode[] = steps
    .map((s) => ({ label: asTrimmedString(s.label), description: asTrimmedString(s.description) || undefined }))
    .filter((s) => s.label)
    .slice(0, MAX_NODES)
    .map((s, i) => ({
      id: `n${i + 1}`,
      label: s.label.slice(0, 120),
      description: s.description,
    }))
  if (nodes.length < steps.length) repairs.push('empty steps dropped')
  const edges: DiagramEdge[] = []
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i].id, to: nodes[i + 1].id })
  if (kind === 'hierarchy' || kind === 'org_chart') {
    // Legacy hierarchy: first step = root, remaining = children of root.
    const [, ...children] = nodes
    return { nodes, edges: children.map((c) => ({ from: nodes[0].id, to: c.id })) }
  }
  return { nodes, edges }
}

/** Normalize any accepted AI shape into a validated DiagramSpec. */
export function normalizeDiagramSpec(content: unknown): DiagramSpec | null {
  if (!content) return null

  const repairs: string[] = []

  // ---- bare array → timeline (the AI-canonical timeline shape) ----
  if (Array.isArray(content)) {
    const { nodes, edges } = stepsToNodesAndEdges(content as DiagramStep[], 'timeline', repairs)
    if (nodes.length < 2) return null
    return { kind: 'timeline', nodes, edges, repairs: [...repairs] }
  }
  if (typeof content !== 'object') return null
  const c = content as Record<string, unknown>

  const kind = normalizeKind(c.kind ?? c.diagramType ?? c.type)

  // ---- comparison sugar ----
  if (kind === 'comparison' && Array.isArray(c.columns)) {
    const columns: ComparisonColumn[] = (c.columns as unknown[])
      .map((col): ComparisonColumn | null => {
        if (!col || typeof col !== 'object') return null
        const o = col as Record<string, unknown>
        const title = asTrimmedString(o.title ?? o.label ?? o.name)
        const points = Array.isArray(o.points)
          ? o.points.map((p) => asTrimmedString(p)).filter(Boolean).slice(0, 8)
          : []
        if (!title && points.length === 0) return null
        return { title: title.slice(0, 60), points }
      })
      .filter((col): col is ComparisonColumn => col !== null)
      .slice(0, 4)
    if (columns.length < 2) return null
    return {
      kind: 'comparison',
      title: asTrimmedString(c.title).slice(0, 120) || undefined,
      nodes: [],
      edges: [],
      columns,
      repairs: [...repairs],
    }
  }

  // ---- sequence sugar: {actors, messages:[{from,to,label}]} ----
  if (kind === 'sequence' && Array.isArray(c.actors) && Array.isArray(c.messages)) {
    const nodes = collectNodes(c.actors, repairs).slice(0, 10)
    if (nodes.length < 2) return null
    const byLabel = new Map<string, string>()
    nodes.forEach((n, i) => {
      byLabel.set(n.id.toLowerCase(), n.id)
      byLabel.set(n.label.toLowerCase(), n.id)
      byLabel.set(String(i + 1), n.id)
    })
    const edges: DiagramEdge[] = []
    for (const m of c.messages as unknown[]) {
      if (!m || typeof m !== 'object') continue
      const o = m as Record<string, unknown>
      const from = byLabel.get(asTrimmedString(o.from ?? o.sender).toLowerCase())
      const to = byLabel.get(asTrimmedString(o.to ?? o.receiver).toLowerCase())
      if (!from || !to) continue
      edges.push({ from, to, label: asTrimmedString(o.label ?? o.text ?? o.message).slice(0, 80) || undefined, dashed: o.dashed === true })
      if (edges.length >= 20) break
    }
    if (edges.length === 0) return null
    return { kind: 'sequence', title: asTrimmedString(c.title).slice(0, 120) || undefined, nodes, edges, repairs: [...repairs] }
  }

  // ---- ER sugar: {entities, relations} ----
  if (kind === 'er' && Array.isArray(c.entities)) {
    const nodes: DiagramNode[] = []
    for (const e of c.entities as unknown[]) {
      if (!e || typeof e !== 'object' || nodes.length >= MAX_NODES) continue
      const o = e as Record<string, unknown>
      const name = asTrimmedString(o.name ?? o.entity ?? o.title ?? o.label)
      if (!name) continue
      const attrsRaw = (o.attributes ?? o.fields) as unknown
      const attributes = Array.isArray(attrsRaw)
        ? (attrsRaw as unknown[])
            .map((a) => asTrimmedString(typeof a === 'object' && a !== null ? (a as Record<string, unknown>).name : a))
            .filter(Boolean)
            .slice(0, 6)
        : undefined
      nodes.push({ id: `n${nodes.length + 1}`, label: name.slice(0, 60), attributes })
    }
    if (nodes.length < 2) return null
    const byName = new Map<string, string>()
    nodes.forEach((n) => byName.set(n.label.toLowerCase(), n.id))
    const edges: DiagramEdge[] = []
    const relations = Array.isArray(c.relations) ? c.relations : Array.isArray(c.relationships) ? c.relationships : []
    for (const r of relations as unknown[]) {
      if (!r || typeof r !== 'object') continue
      const o = r as Record<string, unknown>
      const from = byName.get(asTrimmedString(o.from ?? o.source).toLowerCase())
      const to = byName.get(asTrimmedString(o.to ?? o.target).toLowerCase())
      if (!from || !to) continue
      edges.push({ from, to, label: asTrimmedString(o.label ?? o.cardinality).slice(0, 24) || undefined })
    }
    return { kind: 'er', title: asTrimmedString(c.title).slice(0, 120) || undefined, nodes, edges, repairs: [...repairs] }
  }

  // ---- canonical nodes/edges ----
  let nodes = collectNodes(c.nodes, repairs)

  // ---- legacy steps (linear flow / timeline / hierarchy) ----
  let legacyEdges: DiagramEdge[] | null = null
  if (nodes.length === 0 && Array.isArray(c.steps)) {
    const legacyKind: DiagramKind = kind === 'timeline' ? 'timeline' : kind
    const converted = stepsToNodesAndEdges(c.steps as DiagramStep[], legacyKind, repairs)
    nodes = converted.nodes
    legacyEdges = converted.edges
  }

  if (nodes.length < 2) return null
  if (nodes.length < (Array.isArray(c.nodes) ? (c.nodes as unknown[]).length : 0)) {
    repairs.push('unlabeled/over-length nodes dropped')
  }

  let edges = collectEdges(c.edges, nodes, repairs)
  if (legacyEdges && edges.length === 0) edges = legacyEdges

  // ---- auto-chain linear kinds when the AI omitted edges ----
  const linearKinds: DiagramKind[] = ['flowchart', 'process', 'decision_tree', 'timeline']
  if (edges.length === 0 && linearKinds.includes(kind)) {
    edges = []
    for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i].id, to: nodes[i + 1].id })
    repairs.push('missing edges synthesized as a linear chain')
  }

  // Dangling nodes (no edges at all) are fine for network/concept maps but
  // confusing in strict flows — for flow kinds, drop them when >2 connected.
  if (['flowchart', 'process', 'decision_tree'].includes(kind) && edges.length > 0) {
    const connected = new Set<string>()
    edges.forEach((e) => { connected.add(e.from); connected.add(e.to) })
    if (connected.size >= 2 && connected.size < nodes.length) {
      const orphans = nodes.length - connected.size
      nodes = nodes.filter((n) => connected.has(n.id))
      repairs.push(`${orphans} disconnected node(s) removed`)
    }
  }

  const directionRaw = asTrimmedString(c.direction).toUpperCase()
  const direction = directionRaw === 'LR' || directionRaw === 'TB' ? (directionRaw as 'LR' | 'TB') : undefined

  const spec: DiagramSpec = {
    kind,
    direction,
    title: asTrimmedString(c.title).slice(0, 120) || undefined,
    nodes,
    edges,
  }
  if (Array.isArray(c.steps)) spec.steps = (c.steps as DiagramStep[]).slice(0, 20)
  if (repairs.length) spec.repairs = repairs
  return spec
}

/** All kinds that lay out through dagre. */
export function isGraphKind(kind: DiagramKind): boolean {
  return GRAPH_KINDS.includes(kind)
}
