// =============================================================================
// FILO AI — Prompt Templates (versioned)
// =============================================================================
// Every prompt Filo sends lives here. Prompts are pure functions of their
// inputs so they're unit-testable and diffable. Version numbers live in the
// exported PROMPT_VERSIONS map so we can correlate output-quality regressions
// with prompt changes.
// =============================================================================

import type { Blueprint } from './schemas'

export const PROMPT_VERSIONS = {
  blueprint: '2.0.0',
  section: '2.0.0',
  polish: '1.1.0',
  consistency: '1.0.0',
} as const

/** Shared system preamble for every generation call. */
function baseSystemPrompt(role: string): string {
  return [
    `You are ${role}, part of Filo's document generation pipeline.`,
    `Produce production-quality, factually careful, well-structured output.`,
    `Never mention that you are an AI. Never pad with filler.`,
    `When asked for JSON, output ONLY valid JSON — no markdown fences, no commentary.`,
  ].join(' ')
}

// ==================== BLUEPRINT (PLANNING) PROMPT ====================

export interface BlueprintPromptInput {
  userRequest: string
  artifactType?: string
  outputFormat?: string
  audience?: string
  tone?: string
  estimatedLengthPages?: number
  files?: Array<{ filename: string; mimeType: string; content: string }>
  knowledgeContext?: string
  additionalInstructions?: string
}

export function buildBlueprintPrompt(input: BlueprintPromptInput): {
  system: string
  user: string
} {
  const parts: string[] = []

  parts.push(`Create a detailed blueprint (outline + section specs) for the following document request:`)
  parts.push('')
  parts.push(`REQUEST:\n${input.userRequest}`)
  parts.push('')

  if (input.artifactType) parts.push(`Artifact type: ${input.artifactType}`)
  if (input.outputFormat) parts.push(`Output format: ${input.outputFormat}`)
  if (input.audience) parts.push(`Target audience: ${input.audience}`)
  if (input.tone) parts.push(`Tone: ${input.tone}`)
  if (input.estimatedLengthPages) {
    parts.push(
      `Target length: approximately ${input.estimatedLengthPages} pages ` +
        `(plan roughly ${Math.max(3, Math.ceil(input.estimatedLengthPages * 1.2))} sections)`
    )
  }
  parts.push('')

  if (input.files && input.files.length > 0) {
    parts.push('UPLOADED FILES (extracted content):')
    input.files.forEach((f, i) => {
      const truncated =
        f.content.length > 4000
          ? `${f.content.slice(0, 4000)}\n...(truncated, ${f.content.length} chars total)`
          : f.content
      parts.push(`\n--- File ${i + 1}: ${f.filename} (${f.mimeType}) ---\n${truncated}`)
    })
    parts.push('')
  }

  if (input.knowledgeContext) {
    parts.push(`RELEVANT KNOWLEDGE/CONTEXT:\n${input.knowledgeContext.slice(0, 6000)}`)
    parts.push('')
  }

  if (input.additionalInstructions) {
    parts.push(`ADDITIONAL INSTRUCTIONS:\n${input.additionalInstructions}`)
    parts.push('')
  }

  parts.push(
    'Return JSON with this structure:',
    JSON.stringify(
      {
        title: 'string — document title',
        description: 'string — one-paragraph summary',
        artifactType: 'one of: document | spreadsheet | presentation | proposal | invoice | resume | lesson_plan | report | contract | email | custom',
        audience: 'string — who reads this',
        tone: 'one of: professional | friendly | academic | persuasive | technical | casual',
        sections: [
          {
            id: 'stable-kebab-case-id',
            title: 'section title',
            summary: 'what this section covers and why it matters',
            targetWords: 400,
            components: [
              { type: 'text | heading | list | table | quote | code', note: 'what this component should contain' },
            ],
          },
        ],
        keyPoints: ['messages that MUST appear in the document'],
      },
      null,
      2
    )
  )

  return {
    system: baseSystemPrompt('the Document Planner'),
    user: parts.join('\n'),
  }
}

// ==================== SECTION GENERATION PROMPT ====================

export interface SectionPromptInput {
  blueprint: Blueprint
  sectionId: string
  globalContext: string
}

export function buildSectionPrompt(input: SectionPromptInput): {
  system: string
  user: string
} {
  const section = input.blueprint.sections.find((s) => s.id === input.sectionId)
  if (!section) {
    throw new Error(`buildSectionPrompt: unknown sectionId "${input.sectionId}"`)
  }

  const sectionIndex = input.blueprint.sections.findIndex((s) => s.id === input.sectionId)
  const neighboringTitles = input.blueprint.sections
    .map((s, i) => `${i + 1}. ${s.title}`)
    .join('\n')

  const parts: string[] = []
  parts.push(`You are writing ONE section of a larger document. Other sections are being written separately — do NOT write them.`)
  parts.push('')
  parts.push(`DOCUMENT TITLE: ${input.blueprint.title}`)
  parts.push(`DOCUMENT DESCRIPTION: ${input.blueprint.description}`)
  parts.push('')
  parts.push(`FULL OUTLINE (for context only — write ONLY section #${sectionIndex + 1}):`)
  parts.push(neighboringTitles)
  parts.push('')
  parts.push(`YOUR SECTION: "${section.title}"`)
  parts.push(`SECTION SUMMARY: ${section.summary}`)
  if (section.targetWords) {
    parts.push(`TARGET LENGTH: ~${section.targetWords} words`)
  }
  parts.push('')
  if (section.components.length > 0) {
    parts.push('SECTION COMPONENTS TO PRODUCE (in order):')
    section.components.forEach((c, i) => {
      parts.push(`${i + 1}. [${c.type}]${c.note ? ` — ${c.note}` : ''}`)
    })
    parts.push('')
  }
  if (input.blueprint.keyPoints.length > 0) {
    parts.push(`KEY MESSAGES TO WEAVE IN (across the whole doc; include the ones relevant to this section):`)
    input.blueprint.keyPoints.forEach((k) => parts.push(`- ${k}`))
    parts.push('')
  }
  if (input.globalContext) {
    parts.push(`CONTEXT FROM ALREADY-WRITTEN SECTIONS (match style, terminology, and avoid repetition):\n${input.globalContext.slice(0, 4000)}`)
    parts.push('')
  }
  parts.push(
    'Return JSON:',
    JSON.stringify(
      {
        sectionId: section.id,
        title: section.title,
        components: [
          {
            type: 'text | heading | list | table | quote | code',
            content:
              'text/heading/quote → string; list → array of strings; table → array of string arrays with the first row as the header',
          },
        ],
      },
      null,
      2
    )
  )

  return {
    system: baseSystemPrompt('the Section Writer'),
    user: parts.join('\n'),
  }
}

// ==================== CONSISTENCY / POLISH PROMPT ====================

export function buildConsistencyCheckPrompt(input: {
  blueprint: Blueprint
  sectionSummaries: Array<{ id: string; title: string; excerpt: string }>
}): { system: string; user: string } {
  const parts: string[] = []
  parts.push('Review these document sections for consistency problems:')
  parts.push('')
  input.sectionSummaries.forEach((s) => {
    parts.push(`### ${s.title} (${s.id})\n${s.excerpt.slice(0, 800)}\n`)
  })
  parts.push('Check for:')
  parts.push('- Contradictions between sections')
  parts.push('- Terminology drift (same concept called different names)')
  parts.push('- Duplicated content across sections')
  parts.push('- Tone mismatches')
  parts.push('')
  parts.push(
    'Return JSON: { "issues": [ { "severity": "high|medium|low", "sectionIds": ["..."], "description": "...", "suggestion": "..." } ], "overallConsistent": boolean }'
  )

  return {
    system: baseSystemPrompt('the Consistency Reviewer'),
    user: parts.join('\n'),
  }
}
