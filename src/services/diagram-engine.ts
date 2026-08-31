// =============================================================================
// FILO DIAGRAM ENGINE — backward-compatible entry point
// =============================================================================
// The v2 engine lives in src/services/diagram/. This shim keeps the historical
// import path (`@/services/diagram-engine`) working for the Convex worker
// wiring pins, the test harness and any legacy callers.
//
// v2 replaces the old three hand-rolled layouts (vertical box stack, flat
// timeline, two-level org chart) with a semantic, dagre-laid-out engine that
// supports flowcharts with branches/decisions, decision trees, deep org
// charts, timelines, sequence/ER/architecture/comparison/network diagrams —
// all glyph-measured against bundled fonts so tofu is impossible.
// =============================================================================

export {
  renderDiagram,
  renderDiagramSvg,
  normalizeDiagramSpec,
} from './diagram/index'
export type {
  DiagramKind,
  DiagramNode,
  DiagramEdge,
  DiagramSpec,
  DiagramStep,
  DiagramPalette,
  RenderedDiagram,
} from './diagram/index'
