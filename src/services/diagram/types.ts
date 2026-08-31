// =============================================================================
// FILO DIAGRAM ENGINE v2 — SEMANTIC TYPES
// =============================================================================
// The AI describes WHAT the diagram means (nodes, edges, roles, direction).
// This engine decides HOW it looks (positions, routing, sizes, colors, fonts).
// The AI never emits SVG — every pixel is computed here, deterministically.
// =============================================================================

/** Semantic diagram kinds. Legacy kinds (process/hierarchy/timeline) are kept. */
export type DiagramKind =
  | 'flowchart'
  | 'process'
  | 'decision_tree'
  | 'hierarchy'
  | 'org_chart'
  | 'timeline'
  | 'architecture'
  | 'network'
  | 'sequence'
  | 'er'
  | 'comparison'
  | 'concept_map'

/** Node visual role — inferred from content when the AI omits it. */
export type DiagramNodeShape = 'rect' | 'rounded' | 'stadium' | 'diamond' | 'entity'

export interface DiagramNode {
  /** Stable id. Synthesized (n1, n2, …) when the AI omits ids. */
  id: string
  label: string
  description?: string
  /** ER entities / sequence participants may carry attribute lines. */
  attributes?: string[]
  shape?: DiagramNodeShape
  /** Architecture layers / comparison columns / swimlanes. */
  group?: string
  /** Explicit visual emphasis (derived automatically when omitted). */
  emphasis?: 'primary' | 'muted' | 'none'
}

export interface DiagramEdge {
  /** Node id, label prefix, or 1-based index ("2") of the source node. */
  from: string
  to: string
  /** Decision branches ("Yes"/"No"), cardinality ("1..*"), message text. */
  label?: string
  dashed?: boolean
}

/** Timeline sugar — normalized into nodes internally. */
export interface DiagramStep {
  label?: string
  description?: string
}

/** Comparison sugar: 2–4 side-by-side columns. */
export interface ComparisonColumn {
  title?: string
  points?: string[]
}

export interface DiagramSpec {
  kind: DiagramKind
  direction?: 'TB' | 'LR'
  title?: string
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  /** Ordered messages for sequence diagrams (subset of edges with text). */
  steps?: DiagramStep[]
  columns?: ComparisonColumn[]
  /** Mechanical repairs applied during validation — surfaced in QA. */
  repairs?: string[]
}

/** Theme-derived colors the renderers paint with (never raw AI colors). */
export interface DiagramPalette {
  primary: string
  accent: string
  fg: string
  muted: string
  mutedForeground: string
  border: string
  card: string
  /** Canvas behind the whole diagram. */
  canvas: string
  /** Edge stroke color. */
  edge: string
}

export interface DiagramRenderOptions {
  width?: number
  colors?: Partial<DiagramPalette>
  background?: string
}

export interface RenderedDiagram {
  /** Rasterized PNG (2× density) for DOCX/PDF/PPTX embedding. */
  png: Buffer | null
  /** Logical (CSS px) size of the artwork. */
  width: number
  height: number
  /** The generated SVG — inline-able in HTML/browser previews. */
  svg: string
  kind: DiagramKind
  repairs?: string[]
}
