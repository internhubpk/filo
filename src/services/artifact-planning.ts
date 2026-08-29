// =============================================================================
// FILO Artifact Planning Helpers (shared, pure)
// =============================================================================
// Pure planning/parsing helpers used by BOTH runtimes:
//
//   • the legacy synchronous AgentRouter (Next.js server), and
//   • the durable Convex worker (convex/worker.ts, "use node") that generates
//     documents in the background.
//
// Deliberately imports NOTHING from document-renderer / 'docx' so the Convex
// action bundle stays tiny — only type imports from '@/types'.
// =============================================================================

import type {
  ArtifactSpecification,
  ArtifactSection,
  OutputFormat,
  ArtifactType,
  DesignSpecification,
} from '@/types'
import { scaleForPrompt, type DocumentScale, type VisualAssignment, assignSectionNumbers, enforceVisualCadence } from './doc-scale'

export type DocumentFormat = 'DOCX' | 'PDF' | 'XLSX' | 'PPTX' | 'CSV'

// ==================== PROMPTS ====================

export interface PlanningDesignContext {
  theme: string
  audience: string
  tone: string
  density: string
  visualPriority: string[]
  useCharts: boolean
  useTables: boolean
  useMetrics: boolean
}

export function buildPlanningSystemPrompt(
  type: string,
  format: DocumentFormat,
  design?: PlanningDesignContext,
  scale?: DocumentScale
): string {
  const formatHints: Record<string, string> = {
    DOCX: 'This will be rendered as a Word document (.docx). Plan sections that work well in a document format with headings, paragraphs, lists, tables, charts, diagrams, equations, metric highlights, callouts, and a cover page.',
    PDF: 'This will be rendered as a PDF. Plan sections that work well in a paginated format with clear hierarchy, a designed cover page, and visually distinct blocks (metrics, callouts, charts, diagrams, equations).',
    XLSX: 'This will be rendered as an Excel spreadsheet. Plan sections as logical data groups, each becoming a worksheet. Include table data with headers, computed columns with formulas, and a summary sheet first. Charts become real native Excel charts driven by the table data.',
    PPTX: 'This will be rendered as a PowerPoint presentation. Plan each section as a slide. The first section should be the title/cover slide, the last a closing slide. Keep text concise - slides must not be text-heavy.',
    CSV: 'This will be rendered as CSV. Plan sections as data tables with consistent columns. Exactly one primary data table should dominate the document.',
  }

  const designContext = design
    ? `\nDESIGN DIRECTION (decided by the designer stage — follow it):\n- Theme: ${design.theme}\n- Audience: ${design.audience} · Tone: ${design.tone} · Density: ${design.density}\n- Visual priority: ${design.visualPriority.join(', ')}\n- Charts ${design.useCharts ? 'encouraged' : 'not needed'} · Tables ${design.useTables ? 'encouraged' : 'minimal'} · Metric highlights ${design.useMetrics ? 'encouraged' : 'not needed'}\n- Density guidance: light = fewer, punchier sections; medium = balanced; dense = thorough sections.\n`
    : ''

  const scaleContext = scale ? `\n${scaleForPrompt(scale, format)}\n` : ''

  const componentVocabulary = `
COMPONENT VOCABULARY (use these types in section components):
- paragraph: rich text body (string, 3-5 sentences)
- heading: sub-heading inside a section (short string)
- list: bullet points (array of strings)
- table: data table (2D array, first row = headers)
- quote: notable quotation (string)
- metric_grid: 2-4 headline KPIs (array of {label, value, change?, unit?} objects)
- callout: highlighted note/insight (string) — use for key takeaways, warnings, insights
- chart: data visualization (object {chartType: "bar|line|pie|donut|area|hbar|stacked|scatter", title, categories: string[], series: [{name, data: number[]}], note?, xLabel?, yLabel?})
- timeline: chronological steps (array of {label, description})
- diagram: structural visual (object {kind: "flowchart|process|hierarchy", title?, steps: [{label, description?}]}) — use for workflows, decision flows, org structures, architectures
- equation: real mathematical formula (object {latex: "LaTeX source", display: true}) — use for scientific/mathematical/financial content: fractions, powers, roots, summations, integrals, Greek symbols
- key_takeaways: executive summary bullets (array of strings)
- two_column: side-by-side comparison (object {leftTitle, leftPoints: string[], rightTitle, rightPoints: string[]})

Use metric_grid in the opening section of business/report documents. Use charts when data relationships matter. Use diagrams when structure/flow matters (processes, hierarchies, decision flows). Use equations when the content is mathematical — never write formulas as plain text. Use callout sparingly for emphasis. For XLSX prefer table-heavy sections; for PPTX prefer list/metric_grid/chart with minimal paragraph text.`

  const hierarchyRules = `SECTION HIERARCHY (for long documents):
- sections[] is a FLAT ordered list; use the "level" field to express hierarchy:
  • "part" — a major division header (for ${type === 'presentation' ? 'decks: an agenda item' : 'documents of 10+ sections; carries no body content, 1-2 sentence description only'})
  • "chapter" — a normal content section (DEFAULT)
  • "section" — a sub-section of the preceding chapter (for deep treatments)
- Every section needs its own components; a "part" carries 0-1 components.`

  return `You are Filo's document architect. Create a detailed structural plan for a ${type} document.

OUTPUT FORMAT (authoritative — every downstream prompt, renderer and section plan depends on this exact value): ${format}

${formatHints[format] || formatHints.DOCX}${designContext}${scaleContext}${hierarchyRules}${componentVocabulary}

CRITICAL RULES:
1. Respond ONLY with valid JSON
2. Respect the DOCUMENT SCALE block above — the section count bounds are mandatory, not suggestions
3. Each section needs a unique id (uuid-style string)
4. For XLSX: Make sections represent data categories, suggest table headers
5. For PPTX: Each section = 1 slide. First section = cover. Keep it concise.
6. For DOCX/PDF: Professional document structure with clear hierarchy
7. Use creative, specific section titles - NOT generic ones like "Section 1"
8. The type field in sections should be one of: cover, heading, content, table, list, references, appendix
9. Attach "visuals" to sections that must carry a visual: "visuals": [{"kind": "chart|table|diagram|metrics|timeline|two_column", "hint": "what it shows, e.g. 'line: revenue trend over 6 quarters'"}]. The content generator treats these as MANDATORY.
10. Vary chart types across the document (bar, line, area, pie) — never emit the same chart type more than twice in a row.
11. Section titles must be information-bearing ("How Transformer Attention Replaces Recurrence", not "Attention Mechanisms Overview 1")

You must respond with a JSON object:
{
  "title": "Professional Document Title",
  "description": "Brief one-line description",
  "sections": [
    {
      "id": "unique-id-1",
      "level": "part|chapter|section",
      "type": "cover|heading|content|table|list|references|appendix",
      "title": "Section Title",
      "order": 0,
      "visuals": [{"kind": "chart", "hint": "line: quarterly revenue trend"}],
      "components": [
        {
          "id": "comp-id-1",
          "type": "paragraph|heading|list|table|quote|metric_grid|callout|chart|timeline|diagram|equation|key_takeaways|two_column",
          "order": 0,
          "content": null,
          "note": "Brief note about what content should go here"
        }
      ]
    }
  ]
}`
}

export interface SectionPromptInput {
  sectionTitle: string
  sectionType: string
  componentNotes: string[]
  documentTitle: string
  documentType: string
  outputFormat: string
  originalPrompt: string
  globalContext?: string
  /** Structured content extracted from user-uploaded files (spec §21-22). */
  sourceContext?: string | null
  /** Theme/audience/tone direction from the designer stage (spec §8). */
  designDirection?: string | null
  /** Deterministic heading number computed from the outline (e.g. "2.1"). */
  sectionNumber?: string | null
  /** Section level from the outline: part | chapter | section. */
  sectionLevel?: string | null
  /** MANDATORY word budget for this unit (from the document scale). */
  wordTarget?: { min: number; max: number } | null
  /** MANDATORY visual components this section must include. */
  visuals?: VisualAssignment[] | null
}

export function buildSectionContentPrompt(input: SectionPromptInput): {
  system: string
  user: string
} {
  const isDeck = input.outputFormat === 'PPTX'
  const isSheet = input.outputFormat === 'XLSX' || input.outputFormat === 'CSV'
  const level = (input.sectionLevel || 'chapter').toLowerCase()

  // ---- word budget + mandatory visuals (the anti-thin-content core) ----
  const budget = input.wordTarget
  const minWords = budget?.min ?? (isDeck ? 60 : 300)
  const maxWords = budget?.max ?? (isDeck ? 160 : 900)

  const visualRules: string[] = []
  for (const v of input.visuals || []) {
    switch (v.kind) {
      case 'chart':
        visualRules.push(
          `MANDATORY chart component — ${v.hint || 'pick the best type for the data'}. Shape: {"type":"chart","content":{"chartType":"bar|line|area|pie|hbar|stacked","title":"…","categories":["…"],"series":[{"name":"…","data":[numbers]}],"note":"source/assumption in ≤12 words"}}. Data must be realistic, internally consistent, and consistent with any table in this section.`
        )
        break
      case 'table':
        visualRules.push(
          `MANDATORY table component — ${v.hint || 'a decision-ready data table'}. 3-6 columns × 5-8 data rows; first row = headers; numeric cells as numbers (no units inside numbers).`
        )
        break
      case 'diagram':
        visualRules.push(
          `MANDATORY diagram component — ${v.hint || 'the structure/flow described'}. Shape: {"type":"diagram","content":{"kind":"flowchart|process|hierarchy","title":"…","steps":[{"label":"…","description":"…"}]}} (4-7 steps).`
        )
        break
      case 'metrics':
        visualRules.push(
          `MANDATORY metric_grid component — ${v.hint || 'headline numbers'}. 3-4 objects {"label","value","change?","unit?"} with realistic values.`
        )
        break
      case 'timeline':
        visualRules.push(
          `MANDATORY timeline component — ${v.hint || 'the phases described'}. 4-6 objects {"label","description"}.`
        )
        break
      case 'two_column':
        visualRules.push(
          `MANDATORY two_column comparison — ${v.hint || 'the trade-off described'}. {"leftTitle","leftPoints":[3-5],"rightTitle","rightPoints":[3-5]}.`
        )
        break
    }
  }

  const system = `You are Filo's content generator. Generate professional, publication-grade content for ONE section of a larger document.

Document Title: ${input.documentTitle}
Document Type: ${input.documentType}
Output Format: ${input.outputFormat}
${input.designDirection ? `\nDesign direction: ${input.designDirection}\n` : ''}
ABSOLUTE CONTENT RULES:
1. Generate COMPLETE, PROFESSIONAL content — NO placeholders, NO lorem ipsum, NO meta commentary ("as an AI", "this section will")
2. WORD BUDGET (hard requirement): this section's paragraphs must total ${minWords}-${maxWords} words${isDeck ? ' — slides are the exception: keep bullets tight (deck brevity beats the budget)' : isSheet ? ' — spreadsheets express depth through DATA, so grow the table rows instead of prose' : '. Write 3-6 substantial paragraphs of 4-6 full sentences each; develop ONE complete idea per paragraph with concrete specifics, examples, numbers, or mechanisms'}
3. For table type: return content as a 2D array (array of arrays) with headers as the first row. Cells may be plain values or formula strings like "=SUM(B2:B10)" when the format is XLSX and a computed column makes sense.
4. For list type: return content as an array of strings (each item a full, information-bearing clause — never 2-word stubs)
5. For paragraph type: return content as a plain text string
6. For heading type: return content as a short string (the heading text)
7. For quote type: return content as a string with the quote text
8. For metric_grid type: return an array of 2-4 objects, each {"label": "Revenue", "value": "$1.2M", "change": "+18% YoY", "unit": "USD"}
9. For callout type: return a string — one high-impact insight or note
10. For chart type: return an object {"chartType": "bar|line|pie|donut|area|hbar|stacked|scatter", "title": "Chart title", "categories": ["Q1","Q2","Q3","Q4"], "series": [{"name": "Revenue", "data": [120, 135, 150, 180]}], "note": "optional caption", "xLabel": "optional", "yLabel": "optional"}. ${isDeck ? 'For decks omit xLabel/yLabel.' : 'Include xLabel/yLabel when axes carry units.'}
11. For timeline type: return an array of {"label": "Phase name", "description": "what happens"}
12. For diagram type: return an object {"kind": "flowchart|process|hierarchy", "title": "Diagram title", "steps": [{"label": "Step", "description": "details"}]} — minimum 3 steps, labels ≤4 words, descriptions ≤14 words
13. For equation type: return an object {"latex": "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}", "display": true} — VALID LaTeX; fractions as \\frac{}{}, powers as ^, subscripts as _, summation as \\sum_{}^{}, Greek as \\alpha etc. NEVER write math as plain text
14. For key_takeaways type: return an array of 3-5 concise strings
15. For two_column type: return {"leftTitle": "...", "leftPoints": ["..."], "rightTitle": "...", "rightPoints": ["..."]}
16. Tables: ≥3 data rows; numeric columns carry numbers, not words; no placeholder "TBD"/"N/A" cells unless the domain genuinely requires them
17. CHART↔TABLE CONSISTENCY: when a section has both a chart and a table covering the same metric, the numbers MUST agree
18. In XLSX tables, cells in computed columns may be formula strings like "=SUM(B2:B10)" or "=C2*D2" using your OWN table's coordinates (row 1 = header). Keep formulas simple: SUM/AVERAGE/MIN/MAX/COUNT and +-*/ arithmetic over the table's real cells
19. When source material is provided, GROUND the content in it — reuse its facts, figures and terminology instead of inventing new ones
20. Do NOT repeat content from the previously-written sections listed in the context — advance the document
${visualRules.length ? `\nMANDATORY VISUALS FOR THIS SECTION (the blueprint requires them — output each as its own component in a sensible position, usually after the first or second paragraph):\n${visualRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n` : ''}
RESPOND WITH JSON:
{
  "components": [
    {
      "type": "paragraph|heading|list|table|quote|metric_grid|callout|chart|timeline|diagram|equation|key_takeaways|two_column",
      "content": "the actual content here"
    }
  ]
}`

  const notes =
    input.componentNotes.length > 0
      ? `Component Notes: ${input.componentNotes.filter(Boolean).join('; ')}`
      : ''

  const numberedTitle = input.sectionNumber && level !== 'part' ? `${input.sectionNumber} ${input.sectionTitle}` : input.sectionTitle

  const user = `Generate content for this section:

Section: ${numberedTitle}
Section Level: ${level}
Section Type: ${input.sectionType}
${notes}
${input.sourceContext ? `\nSOURCE MATERIAL EXTRACTED FROM THE USER'S FILES (ground the content in these facts where relevant — do not contradict them):\n${input.sourceContext.slice(0, 12000)}\n` : ''}
${input.globalContext ? `\nPreviously written content (for continuity, do not repeat):\n${input.globalContext}\n` : ''}
Original Request: ${input.originalPrompt}

Generate the actual content now. ${level === 'part' ? 'This is a PART divider — write exactly one short orienting paragraph (2-3 sentences) that frames the part; do not add lists, tables or charts.' : isDeck ? 'Keep each bullet ≤16 words; slides must not carry prose paragraphs.' : 'Meet the word budget with substantive, specific, well-developed prose.'}`

  return { system, user }
}

// ==================== PARSING ====================

/**
 * Extract a JSON object from an AI response — BULLETPROOF edition.
 *
 * Models wrap JSON in prose ("Here is your plan:"), fence it with ```json,
 * emit trailing commas, leak raw control characters into strings, and —
 * when maxTokens or thinking eats the budget — TRUNCATE the output mid-object.
 * Every one of those used to throw "Failed to parse AI planning response"
 * and FAIL a fully-paid job after all content had already been generated.
 *
 * Strategy (first match wins):
 *   1. strip BOM/zero-width, direct JSON.parse
 *   2. try every ```json fenced block
 *   3. brace-balanced scan (string/escape aware) for the outermost {...}
 *   4. deterministic repairs on the extracted text: remove trailing commas,
 *      strip raw control chars inside strings
 *   5. truncation rescue: auto-close an unterminated object/string and parse
 */
export function extractJsonObject(aiContent: string): Record<string, unknown> {
  const text = String(aiContent ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()

  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s)
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  const repairCommon = (s: string): string =>
    s
      // trailing commas before } or ]
      .replace(/,\s*([}\]])/g, '$1')
      // Raw C0 control characters (including \n \r \t) are INVALID inside
      // JSON strings and must be escaped — models leak them constantly.
      // Folding ALL of them to spaces is always JSON-safe: outside strings
      // whitespace is legal anyway, inside strings it repairs the leak.
      .replace(/[\u0000-\u001F]+/g, ' ')

  // ---- 1. direct parse -----------------------------------------------------
  const direct = tryParse(text) ?? tryParse(repairCommon(text))
  if (direct) return direct

  // ---- 2. fenced blocks (all of them, longest first) -----------------------
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
    .map((m) => m[1].trim())
    .sort((a, b) => b.length - a.length)
  for (const block of fences) {
    const parsed = tryParse(block) ?? tryParse(repairCommon(block))
    if (parsed) return parsed
  }

  // ---- 3+4. brace-balanced scan from the first '{' --------------------------
  const start = text.indexOf('{')
  if (start >= 0) {
    let depth = 0
    let inString = false
    let escaped = false
    let end = -1
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }

    const candidates: string[] = []
    if (end > start) candidates.push(text.slice(start, end))
    else if (depth > 0) candidates.push(text.slice(start)) // truncated — repaired below
    for (const cand of candidates) {
      const parsed = tryParse(cand) ?? tryParse(repairCommon(cand))
      if (parsed) return parsed
    }

    // ---- 5. truncation rescue (output hit maxTokens mid-object) -----------
    // Close an unterminated string, then close every open { / [ in order.
    // Re-scan from scratch (string state must NOT be inherited from the
    // balanced scan above — that scan already consumed the entire text, so
    // its final state says nothing about the start of the buffer).
    const raw = end > start ? text.slice(start, end) : text.slice(start)
    if (end < 0 || depth > 0) {
      const stack: string[] = []
      let s = false
      let e = false
      for (const ch of raw) {
        if (s) {
          if (e) e = false
          else if (ch === '\\') e = true
          else if (ch === '"') s = false
          continue
        }
        if (ch === '"') s = true
        else if (ch === '{') stack.push('}')
        else if (ch === '[') stack.push(']')
        else if (ch === '}' || ch === ']') stack.pop()
      }
      let repaired = repairCommon(raw)
      if (s) repaired += '"'
      // Drop a dangling partial token so we don't glue garbage to a closer.
      repaired = repaired.replace(/,\s*$/, '').replace(/:\s*$/, ': null')
      while (stack.length > 0) repaired += stack.pop()
      const rescued = tryParse(repaired)
      if (rescued) return rescued
    }
  }

  // ---- give up, but DIAGNOSE instead of a blind throw ----------------------
  const snippet = text.slice(0, 160).replace(/\s+/g, ' ')
  throw new Error(
    `Failed to parse AI planning response (length=${text.length}, ` +
      `starts with: "${snippet}")`
  )
}

function uuid(): string {
  // crypto.randomUUID is available in Node 18+ and all modern browsers.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Parse the planning response into a full ArtifactSpecification. */
export function parsePlanResponse(
  aiContent: string,
  artifactType: string,
  outputFormat: DocumentFormat,
  designOverrides?: {
    design?: DesignSpecification
    sourceContext?: string | null
    metadata?: Record<string, unknown>
    /** Document scale — drives numbering + visual cadence normalization. */
    scale?: import('./doc-scale').DocumentScale
  }
): ArtifactSpecification {
  // Parsed loosely (same as the legacy pipeline) — AI JSON is normalized
  // field-by-field below rather than trusted structurally.
  const parsed = extractJsonObject(aiContent) as {
    title?: string
    description?: string
    sections?: Array<Record<string, any>>
  }

  const scale = designOverrides?.scale
  const isDeck = outputFormat === 'PPTX'

  const sections: ArtifactSection[] = (parsed.sections || []).map((s, idx) => {
    // Normalize the section level: valid values only, default chapter.
    const rawLevel = String(s.level || '').toLowerCase()
    const level = ['part', 'chapter', 'section', 'subsection'].includes(rawLevel) ? rawLevel : 'chapter'
    // Normalize the blueprint's mandatory visuals (kind whitelist + hints).
    const rawVisuals = Array.isArray(s.visuals) ? s.visuals : []
    const visuals = rawVisuals
      .map((v: unknown) => {
        const vo = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
        const kind = String(vo.kind || '').toLowerCase()
        const validKinds = ['chart', 'table', 'diagram', 'metrics', 'timeline', 'two_column']
        return validKinds.includes(kind)
          ? { kind, hint: typeof vo.hint === 'string' ? vo.hint.slice(0, 200) : undefined }
          : null
      })
      .filter(Boolean) as Array<{ kind: string; hint?: string }>

    return {
      id: s.id || uuid(),
      type: (s.type || (level === 'part' ? 'heading' : 'content')) as ArtifactSection['type'],
      title: s.title || `Section ${idx + 1}`,
      order: s.order ?? idx,
      level,
      visuals,
      components: (s.components || []).map((c: Record<string, any>, cIdx: number) => ({
        id: c.id || uuid(),
        type: c.type || 'paragraph',
        order: c.order ?? cIdx,
        content: c.content || null,
        data: c.note ? { note: c.note } : undefined,
      })),
    } as ArtifactSection & { level?: string; visuals?: Array<{ kind: string; hint?: string }> }
  }) as ArtifactSection[]

  // Ensure at least one section
  if (sections.length === 0) {
    sections.push({
      id: uuid(),
      type: 'content',
      title: 'Content',
      order: 0,
      components: [],
    })
  }

  // ---- deterministic normalization pass (order-independent of AI mood) ----
  const withMeta: Array<Partial<ArtifactSection> & { id: string; visuals?: ArtifactSection['visuals']; number?: string; level?: string }> = sections
  if (scale && !isDeck && outputFormat !== 'CSV') {
    enforceVisualCadence(withMeta, scale, {
      businessLike: /report|business|financial|budget|proposal|plan|performance|revenue|market/i.test(
        `${parsed.title || ''} ${parsed.description || ''}`
      ),
    })
  }
  // Numbering: documents get hierarchical numbers; decks stay clean.
  if (!isDeck) assignSectionNumbers(withMeta)

  return {
    id: uuid(),
    type: artifactType as ArtifactType,
    title: parsed.title || 'Generated Document',
    description: parsed.description,
    outputFormat: outputFormat as OutputFormat,
    sections,
    design: designOverrides?.design ?? getDefaultDesign(outputFormat),
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      language: 'en',
      tags: [],
      keywords: [],
      ...(designOverrides?.metadata ?? {}),
    },
    validation: {
      requireTitle: true,
      maxSections: 80,
      minSections: 1,
      requiredSections: [],
      forbiddenContent: ['lorem ipsum', 'placeholder', '[insert here]'],
      maxLength: 400000,
      mustIncludeBranding: false,
      validateCalculations: true,
      validateReferences: false,
    },
  }
}

/** Well-known component types emitted by the content stage (spec §10). */
export const COMPONENT_TYPES = [
  'PARAGRAPH',
  'HEADING',
  'LIST',
  'TABLE',
  'QUOTE',
  'METRIC_GRID',
  'CALLOUT',
  'CHART',
  'TIMELINE',
  'DIAGRAM',
  'EQUATION',
  'KEY_TAKEAWAYS',
  'TWO_COLUMN',
] as const

export type NormalizedComponentType = (typeof COMPONENT_TYPES)[number]

export function normalizeComponentType(type: string): string {
  const typeMap: Record<string, string> = {
    'paragraph': 'PARAGRAPH',
    'text': 'PARAGRAPH',
    'heading': 'HEADING',
    'list': 'LIST',
    'table': 'TABLE',
    'quote': 'QUOTE',
    'metric_grid': 'METRIC_GRID',
    'metricgrid': 'METRIC_GRID',
    'metrics': 'METRIC_GRID',
    'callout': 'CALLOUT',
    'chart': 'CHART',
    'timeline': 'TIMELINE',
    'diagram': 'DIAGRAM',
    'flowchart': 'DIAGRAM',
    'process': 'DIAGRAM',
    'hierarchy': 'DIAGRAM',
    'org_chart': 'DIAGRAM',
    'equation': 'EQUATION',
    'math': 'EQUATION',
    'formula': 'EQUATION',
    'latex': 'EQUATION',
    'key_takeaways': 'KEY_TAKEAWAYS',
    'keytakeaways': 'KEY_TAKEAWAYS',
    'two_column': 'TWO_COLUMN',
    'twocolumn': 'TWO_COLUMN',
    // Legacy/plain types degrade gracefully to paragraph
    'code': 'PARAGRAPH',
    'image': 'PARAGRAPH',
  }
  return typeMap[type?.toLowerCase()] || 'PARAGRAPH'
}

export function getDefaultDesign(format: DocumentFormat): DesignSpecification {
  const isSpreadsheet = format === 'XLSX' || format === 'CSV'
  const isPresentation = format === 'PPTX'

  return {
    theme: {
      name: isPresentation ? 'Modern Presentation' : 'Professional Default',
      variant: 'professional',
      primaryStyle: 'formal',
    },
    typography: {
      headingFont: 'Arial',
      bodyFont: 'Arial',
      monoFont: 'Courier New',
      headingSizes: { h1: 28, h2: 22, h3: 18, h4: 16, h5: 14, h6: 12 },
      bodySize: 11,
      lineHeight: 1.6,
      scale: 1.25,
    },
    spacing: {
      unit: '8px',
      pageMargin: '72pt',
      sectionSpacing: '24pt',
      paragraphSpacing: '12pt',
      itemSpacing: '6pt',
    },
    colors: {
      primary: '#1a1a1a',
      secondary: '#333333',
      accent: '#3B82F6',
      background: '#ffffff',
      foreground: '#0f172a',
      muted: '#f1f5f9',
      mutedForeground: '#64748b',
      border: '#e2e8f0',
      card: '#ffffff',
      cardForeground: '#0f172a',
      success: '#16a34a',
      warning: '#f59e0b',
      error: '#dc2626',
      info: '#2563eb',
    },
    layout: {
      pageSize: 'A4',
      orientation: isSpreadsheet ? 'landscape' : 'portrait',
      columns: 1,
      margins: { top: '72pt', right: '72pt', bottom: '72pt', left: '72pt' },
      headerEnabled: !isSpreadsheet,
      footerEnabled: !isSpreadsheet,
      pageNumberPosition: 'bottom',
    },
  }
}
