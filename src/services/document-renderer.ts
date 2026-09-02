// =============================================================================
// FILO DOCUMENT RENDERER — facade over the per-format renderer modules
// =============================================================================
// Public API (unchanged for callers):
//   • renderArtifact(specification, components, format) → RendererOutput
//   • getRenderer(format) / getSupportedFormats()
//   • RendererOutput / DocumentRenderer types (re-exported)
//
// The heavy lifting now lives in src/services/renderers/*:
//   docx-renderer.ts    — native editable DOCX (docx npm)      [spec §12]
//   pdf-renderer.ts     — themed paginated PDF (pdfkit)         [spec §13]
//   pptx-renderer.ts    — layout-first PPTX (pptxgenjs)         [spec §14]
//   xlsx-renderer.ts    — analyst-grade XLSX w/ formulas (ExcelJS) [spec §15]
//   text-renderers.ts   — CSV / TXT / HTML                      [spec §16, §17]
//
// The canonical component model (types normalized to lowercase, grouped by
// section, ordered) is built here via prepareForRendering — the previous
// implementation silently dropped 'PARAGRAPH' components into default
// branches; every known type now has an explicit renderer path.
// =============================================================================

import type { ArtifactSpecification, ArtifactSection, OutputFormat } from '@/types'
import {
  canonicalType,
  type CanonicalComponent,
  type DocumentRenderer,
  type RenderableDocument,
  type RenderableSection,
  type RendererOutput,
} from './renderers/shared'
import { DocxRenderer } from './renderers/docx-renderer'
import { PdfRenderer } from './renderers/pdf-renderer'
import { PptxRenderer } from './renderers/pptx-renderer'
import { XlsxRenderer } from './renderers/xlsx-renderer'
import { CsvRenderer, HtmlRenderer, TxtRenderer } from './renderers/text-renderers'

export type { DocumentRenderer, RendererOutput, RenderableDocument, RenderableSection, CanonicalComponent }

// ==================== PREPARE ====================

export interface RawComponent {
  sectionId: string
  componentId?: string
  type: string
  content: unknown
  order: number
}

/**
 * Normalized text key for duplicate detection: case/whitespace/markdown-emphasis
 * insensitive, trailing punctuation trimmed. Two components with the same key
 * ARE the same content as far as a reader is concerned.
 */
function duplicateKey(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, ' ')
    .replace(/[`*_~]/g, '')
    .trim()
    .replace(/[.!?:;,]+$/, '')
}

/**
 * De-duplicate a section's components (the "same paragraph twice" class of
 * defects observed in generated documents):
 *
 *   1. A leading HEADING that restates the section title (the renderer already
 *      draws the section heading — the AI copying it into the components list
 *      produced doubled chapter titles).
 *   2. A PARAGRAPH/HEADING/CALLOUT/QUOTE identical (normalized) to the one
 *      immediately before it.
 *   3. A PARAGRAPH whose full text is CONTAINED in the immediately preceding
 *      paragraph — the model re-emitting the tail of the previous paragraph as
 *      its own component (seen verbatim in generated books).
 *
 * Applied centrally so DOCX/PDF/PPTX/HTML/TXT all render the same cleaned
 * component stream.
 */
function dedupeComponents(components: CanonicalComponent[], sectionTitle: string): CanonicalComponent[] {
  const titleKey = duplicateKey(sectionTitle)
  const out: CanonicalComponent[] = []
  for (let i = 0; i < components.length; i++) {
    const c = components[i]
    const isTextual = c.type === 'paragraph' || c.type === 'heading' || c.type === 'callout' || c.type === 'quote'
    const text = typeof c.content === 'string' ? c.content : ''
    const key = duplicateKey(text)

    // 1. leading heading duplicating the section title
    if (c.type === 'heading' && out.length === 0 && titleKey && key === titleKey) continue

    if (isTextual && key && out.length > 0) {
      const prev = out[out.length - 1]
      const prevIsTextual =
        prev.type === 'paragraph' || prev.type === 'heading' || prev.type === 'callout' || prev.type === 'quote'
      if (prevIsTextual) {
        const prevText = typeof prev.content === 'string' ? prev.content : ''
        const prevKey = duplicateKey(prevText)
        // 2. exact adjacent duplicate
        // 3. this paragraph is a verbatim chunk of the previous one
        if (key === prevKey || (c.type === 'paragraph' && prev.type === 'paragraph' && key.length >= 120 && prevKey.includes(key))) {
          continue
        }
      }
    }
    out.push(c)
  }
  return out
}

/**
 * Group raw components by section, normalize types to the canonical
 * lowercase vocabulary, and order them. Sections without components still
 * render (renderers own their empty-section handling).
 */
export function prepareForRendering(
  specification: ArtifactSpecification,
  components: RawComponent[]
): RenderableDocument {
  const bySection = new Map<string, CanonicalComponent[]>()

  for (const raw of components) {
    const list = bySection.get(raw.sectionId) ?? []
    list.push({
      sectionId: raw.sectionId,
      componentId: raw.componentId ?? `${raw.sectionId}-${raw.order}-${list.length}`,
      type: canonicalType(raw.type),
      content: raw.content,
      order: raw.order,
    })
    bySection.set(raw.sectionId, list)
  }

  const sections: RenderableSection[] = (specification.sections || []).map((section: ArtifactSection) => ({
    id: section.id,
    type: section.type ?? 'content',
    title: section.title ?? '',
    order: section.order ?? 0,
    components: dedupeComponents(
      (bySection.get(section.id) ?? []).slice().sort((a, b) => a.order - b.order),
      section.title ?? ''
    ),
  }))

  // Include any components whose sectionId didn't match a spec section
  // (defensive — the render route matches by sequence so this should not
  // happen, but content must never be silently dropped).
  const knownIds = new Set(sections.map((s) => s.id))
  for (const [sectionId, list] of bySection) {
    if (!knownIds.has(sectionId) && list.length > 0) {
      sections.push({
        id: sectionId,
        type: 'content',
        title: '',
        order: sections.length,
        components: dedupeComponents(list.slice().sort((a, b) => a.order - b.order), ''),
      })
    }
  }

  return {
    specification,
    sections,
    branding: specification.branding,
  }
}

// ==================== REGISTRY ====================

const renderers = new Map<OutputFormat, DocumentRenderer>()
renderers.set('DOCX', new DocxRenderer())
renderers.set('PDF', new PdfRenderer())
renderers.set('XLSX', new XlsxRenderer())
renderers.set('PPTX', new PptxRenderer())
renderers.set('CSV', new CsvRenderer())
renderers.set('TXT', new TxtRenderer())
renderers.set('HTML', new HtmlRenderer())

export function getRenderer(format: OutputFormat): DocumentRenderer {
  const renderer = renderers.get(format)
  if (!renderer) {
    throw new Error(`No renderer available for format ${format}`)
  }
  return renderer
}

export function getSupportedFormats(): OutputFormat[] {
  return Array.from(renderers.keys())
}

// ==================== ENTRY POINT ====================

/**
 * Render an artifact to real file bytes.
 * Components accept permissive `type: string` — normalized internally.
 */
export async function renderArtifact(
  specification: ArtifactSpecification,
  components: RawComponent[],
  format: OutputFormat
): Promise<RendererOutput> {
  const normalizedFormat = String(format || 'DOCX').toUpperCase() as OutputFormat
  const renderer = getRenderer(normalizedFormat)
  const document = prepareForRendering(specification, components)
  const output = await renderer.render(document)
  return {
    ...output,
    buffer: Buffer.isBuffer(output.buffer) ? output.buffer : Buffer.from(output.buffer),
  }
}
