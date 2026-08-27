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

export type DocumentFormat = 'DOCX' | 'PDF' | 'XLSX' | 'PPTX' | 'CSV'

// ==================== PROMPTS ====================

export function buildPlanningSystemPrompt(type: string, format: DocumentFormat): string {
  const formatHints: Record<string, string> = {
    DOCX: 'This will be rendered as a Word document (.docx). Plan sections that work well in a document format with headings, paragraphs, lists, and tables.',
    PDF: 'This will be rendered as a PDF. Plan sections that work well in a paginated format with clear hierarchy.',
    XLSX: 'This will be rendered as an Excel spreadsheet. Plan sections as logical data groups, each becoming a worksheet. Include table data with headers.',
    PPTX: 'This will be rendered as a PowerPoint presentation. Plan each section as a slide. The first section should be the title/cover slide. Keep text concise - slides should not be text-heavy.',
    CSV: 'This will be rendered as CSV. Plan sections as data tables with consistent columns.',
  }

  return `You are Filo's document architect. Create a detailed structural plan for a ${type} document.

${formatHints[format] || formatHints.DOCX}

CRITICAL RULES:
1. Respond ONLY with valid JSON
2. Include 3-8 sections (more for presentations, fewer for simple docs)
3. Each section needs a unique id (uuid-style string)
4. For XLSX: Make sections represent data categories, suggest table headers
5. For PPTX: Each section = 1 slide. First section = cover. Keep it concise.
6. For DOCX/PDF: Professional document structure with clear hierarchy
7. Use creative, specific section titles - NOT generic ones like "Section 1"
8. The type field in sections should be one of: cover, heading, content, table, list, references, appendix

You must respond with a JSON object:
{
  "title": "Professional Document Title",
  "description": "Brief one-line description",
  "sections": [
    {
      "id": "unique-id-1",
      "type": "cover|heading|content|table|list|references|appendix",
      "title": "Section Title",
      "order": 0,
      "components": [
        {
          "id": "comp-id-1",
          "type": "heading|paragraph|list|table|quote",
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
}

export function buildSectionContentPrompt(input: SectionPromptInput): {
  system: string
  user: string
} {
  const system = `You are Filo's content generator. Generate professional, high-quality content for a document section.

Document Title: ${input.documentTitle}
Document Type: ${input.documentType}
Output Format: ${input.outputFormat}

RULES:
1. Generate COMPLETE, PROFESSIONAL content - NO placeholders, NO lorem ipsum
2. For table type: return content as a 2D array (array of arrays) with headers as the first row
3. For list type: return content as an array of strings
4. For paragraph type: return content as a plain text string
5. For heading type: return content as a short string (the heading text)
6. For quote type: return content as a string with the quote text
7. Keep content substantial - each paragraph should be 3-5 sentences minimum
8. Tables should have at least 3 rows of data
9. Lists should have at least 3 items

RESPOND WITH JSON:
{
  "components": [
    {
      "type": "paragraph|heading|list|table|quote",
      "content": "the actual content here"
    }
  ]
}`

  const notes =
    input.componentNotes.length > 0
      ? `Component Notes: ${input.componentNotes.filter(Boolean).join('; ')}`
      : ''

  const user = `Generate content for this section:

Section Title: ${input.sectionTitle}
Section Type: ${input.sectionType}
${notes}
${input.globalContext ? `\nPreviously written content (for continuity, do not repeat):\n${input.globalContext}\n` : ''}
Original Request: ${input.originalPrompt}

Generate the actual content now. Be thorough and professional.`

  return { system, user }
}

// ==================== PARSING ====================

/** Extract a JSON object from an AI response (raw JSON or fenced code block). */
export function extractJsonObject(aiContent: string): Record<string, unknown> {
  try {
    return JSON.parse(aiContent)
  } catch {
    const jsonMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1])
    }
    throw new Error('Failed to parse AI planning response')
  }
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
  outputFormat: DocumentFormat
): ArtifactSpecification {
  // Parsed loosely (same as the legacy pipeline) — AI JSON is normalized
  // field-by-field below rather than trusted structurally.
  const parsed = extractJsonObject(aiContent) as {
    title?: string
    description?: string
    sections?: Array<Record<string, any>>
  }

  const sections: ArtifactSection[] = (parsed.sections || []).map((s, idx) => ({
    id: s.id || uuid(),
    type: (s.type || 'content') as ArtifactSection['type'],
    title: s.title || `Section ${idx + 1}`,
    order: s.order ?? idx,
    components: (s.components || []).map((c: Record<string, any>, cIdx: number) => ({
      id: c.id || uuid(),
      type: c.type || 'paragraph',
      order: c.order ?? cIdx,
      content: c.content || null,
      data: c.note ? { note: c.note } : undefined,
    })),
  })) as ArtifactSection[]

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

  return {
    id: uuid(),
    type: artifactType as ArtifactType,
    title: parsed.title || 'Generated Document',
    description: parsed.description,
    outputFormat: outputFormat as OutputFormat,
    sections,
    design: getDefaultDesign(outputFormat),
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      language: 'en',
      tags: [],
      keywords: [],
    },
    validation: {
      requireTitle: true,
      maxSections: 50,
      minSections: 1,
      requiredSections: [],
      forbiddenContent: ['lorem ipsum', 'placeholder', '[insert here]'],
      maxLength: 100000,
      mustIncludeBranding: false,
      validateCalculations: true,
      validateReferences: false,
    },
  }
}

export function normalizeComponentType(type: string): string {
  const typeMap: Record<string, string> = {
    'paragraph': 'PARAGRAPH',
    'heading': 'HEADING',
    'list': 'LIST',
    'table': 'TABLE',
    'quote': 'PARAGRAPH',
    'text': 'PARAGRAPH',
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
