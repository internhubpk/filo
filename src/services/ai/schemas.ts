// =============================================================================
// FILO AI — Structured Output Schemas
// =============================================================================
// Zod-style schemas (plain objects — Gemini accepts a JSON-schema subset
// directly, and other providers accept it as a description in the prompt).
//
// These schemas are the CONTRACT for structured AI output. The generation
// pipeline (blueprint → sections → validation) depends on these shapes.
//
// NOTE: we intentionally do NOT import zod here to keep the AI layer
// dependency-free and runtime-agnostic (it must also run inside Convex
// actions). Validation happens in the pipeline layer with plain JS checks.
// =============================================================================

/** Gemini-compatible JSON schema for an artifact blueprint (the plan). */
export const BLUEPRINT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Document title' },
    description: { type: 'string', description: 'One-paragraph summary of the document' },
    artifactType: {
      type: 'string',
      enum: ['document', 'spreadsheet', 'presentation', 'proposal', 'invoice', 'resume', 'lesson_plan', 'report', 'contract', 'email', 'custom'],
      description: 'The kind of artifact to generate',
    },
    audience: { type: 'string', description: 'Who will read this document' },
    tone: {
      type: 'string',
      enum: ['professional', 'friendly', 'academic', 'persuasive', 'technical', 'casual'],
    },
    estimatedSections: { type: 'number', description: 'How many top-level sections' },
    sections: {
      type: 'array',
      description: 'Ordered top-level sections of the document',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string', description: 'What this section covers' },
          targetWords: { type: 'number', description: 'Approximate word count for this section' },
          components: {
            type: 'array',
            description: 'Ordered content blocks within the section',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['text', 'heading', 'list', 'table', 'quote', 'code'],
                },
                note: { type: 'string', description: 'Instruction for what this component contains' },
              },
              required: ['type'],
            },
          },
        },
        required: ['id', 'title', 'summary', 'components'],
      },
    },
    keyPoints: {
      type: 'array',
      items: { type: 'string' },
      description: 'Key messages that MUST appear in the document',
    },
    terminology: {
      type: 'object',
      description: 'Terms to use consistently throughout the document',
      properties: {
        term: { type: 'string' },
        definition: { type: 'string' },
      },
    },
  },
  required: ['title', 'description', 'artifactType', 'sections', 'keyPoints'],
} as const

/** Gemini-compatible JSON schema for one generated section. */
export const SECTION_SCHEMA = {
  type: 'object',
  properties: {
    sectionId: { type: 'string', description: 'Must match the blueprint section id' },
    title: { type: 'string' },
    components: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['text', 'heading', 'list', 'table', 'quote', 'code'],
          },
          content: {
            description: 'text/heading/quote: string; list: array of strings; table: array of string arrays (first row = header)',
          },
        },
        required: ['type', 'content'],
      },
    },
  },
  required: ['sectionId', 'title', 'components'],
} as const

/** TypeScript types mirroring the schemas above. */
export interface BlueprintComponentSpec {
  type: 'text' | 'heading' | 'list' | 'table' | 'quote' | 'code'
  note?: string
}

export interface BlueprintSectionSpec {
  id: string
  title: string
  summary: string
  targetWords?: number
  components: BlueprintComponentSpec[]
}

export interface Blueprint {
  title: string
  description: string
  artifactType: string
  audience?: string
  tone?: string
  estimatedSections?: number
  sections: BlueprintSectionSpec[]
  keyPoints: string[]
  terminology?: { term: string; definition: string }
}

export interface GeneratedSectionComponent {
  type: 'text' | 'heading' | 'list' | 'table' | 'quote' | 'code'
  content: unknown
}

export interface GeneratedSection {
  sectionId: string
  title: string
  components: GeneratedSectionComponent[]
}

// ==================== VALIDATORS (plain JS) ====================

/** Structural validation for a parsed blueprint. Returns a list of issues. */
export function validateBlueprint(bp: unknown): string[] {
  const issues: string[] = []
  const b = bp as Partial<Blueprint> | null
  if (!b || typeof b !== 'object') return ['blueprint is not an object']
  if (!b.title || typeof b.title !== 'string') issues.push('missing title')
  if (!b.description || typeof b.description !== 'string') issues.push('missing description')
  if (!b.artifactType || typeof b.artifactType !== 'string') issues.push('missing artifactType')
  if (!Array.isArray(b.sections) || b.sections.length === 0) {
    issues.push('sections must be a non-empty array')
  } else {
    b.sections.forEach((s, i) => {
      if (!s.id) issues.push(`sections[${i}] missing id`)
      if (!s.title) issues.push(`sections[${i}] missing title`)
      if (!Array.isArray(s.components)) issues.push(`sections[${i}] missing components array`)
    })
  }
  if (!Array.isArray(b.keyPoints)) issues.push('missing keyPoints array')
  return issues
}

/** Structural validation for a parsed generated section. */
export function validateSection(sec: unknown): string[] {
  const issues: string[] = []
  const s = sec as Partial<GeneratedSection> | null
  if (!s || typeof s !== 'object') return ['section is not an object']
  if (!s.sectionId) issues.push('missing sectionId')
  if (!s.title) issues.push('missing title')
  if (!Array.isArray(s.components) || s.components.length === 0) {
    issues.push('components must be a non-empty array')
  } else {
    s.components.forEach((c, i) => {
      if (!c.type) issues.push(`components[${i}] missing type`)
      if (c.content === undefined || c.content === null) {
        issues.push(`components[${i}] missing content`)
      }
    })
  }
  return issues
}
