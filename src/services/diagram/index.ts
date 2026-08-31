// =============================================================================
// FILO DIAGRAM ENGINE v2 — FACADE
// =============================================================================
// normalize → choose layout → SVG → PNG. This is the single entry point the
// renderers call. Kind → layout routing:
//
//   flowchart · decision_tree · hierarchy · org_chart · network · concept_map
//     → dagre graph layout (layout-graph.ts)
//   process
//     → chevron strip (≤6 steps) else dagre LR
//   timeline · sequence · comparison · architecture
//     → bespoke deterministic layouts (layout-custom.ts)
//
// All layouts share one visual language (palette, fonts, arrowheads, chips).
// =============================================================================

import type { ColorPalette } from '@/types'
import type { DiagramKind, DiagramPalette, DiagramSpec, RenderedDiagram } from './types'
import { buildPalette, renderSpec, type LayoutFn } from './svg'
import { layoutGraph } from './layout-graph'
import { layoutTimeline, layoutSequence, layoutComparison, layoutArchitecture, layoutProcess } from './layout-custom'
import { normalizeDiagramSpec } from './validate'

export type { DiagramKind, DiagramNode, DiagramEdge, DiagramSpec, DiagramStep, DiagramPalette, RenderedDiagram } from './types'
export { normalizeDiagramSpec } from './validate'

const DAGRE_KINDS = new Set<DiagramKind>([
  'flowchart',
  'decision_tree',
  'hierarchy',
  'org_chart',
  'network',
  'concept_map',
  'er',
])

function layoutFor(spec: DiagramSpec): LayoutFn {
  switch (spec.kind) {
    case 'timeline':
      return layoutTimeline
    case 'sequence':
      return layoutSequence
    case 'comparison':
      return layoutComparison
    case 'architecture':
      return layoutArchitecture
    case 'process':
      // Short processes read best as a horizontal chevron strip.
      return spec.nodes.length <= 6 ? layoutProcess : (s, p) => layoutGraph({ ...s, direction: s.direction ?? 'LR' }, p)
    default:
      return layoutGraph
  }
}

/**
 * Render a diagram spec (any accepted AI shape) to SVG + PNG.
 * Returns null only when the spec is unusable — callers must fall back to a
 * visible honest representation, never a silent drop.
 */
export async function renderDiagram(
  content: unknown,
  opts?: { width?: number; colors?: Partial<ColorPalette> | Partial<DiagramPalette>; background?: string }
): Promise<RenderedDiagram | null> {
  const spec = normalizeDiagramSpec(content)
  if (!spec) return null
  return renderSpec(spec, layoutFor(spec), {
    width: opts?.width,
    colors: opts?.colors as Partial<ColorPalette> | undefined,
    background: opts?.background,
  })
}

/** SVG-only render (browser previews / HTML artifacts) — no rasterization. */
export function renderDiagramSvg(content: unknown, opts?: { colors?: Partial<ColorPalette>; background?: string }): { svg: string; width: number; height: number; kind: DiagramKind } | null {
  const spec = normalizeDiagramSpec(content)
  if (!spec) return null
  const pal = buildPalette(opts?.colors as Partial<ColorPalette> | undefined, opts?.background)
  const result = layoutFor(spec)(spec, pal)
  return { svg: result.svg, width: result.width, height: result.height, kind: spec.kind }
}
