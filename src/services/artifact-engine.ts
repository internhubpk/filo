// Artifact Engine - Core of Filo
// Handles: Planning → Specification → Validation → Rendering → Output

import type {
  ArtifactSpecification,
  ArtifactSection,
  SectionType,
  ComponentType,
  DesignSpecification,
  BrandingConfig,
  ArtifactType,
  OutputFormat,
  ValidationRules,
  ArtifactGenerationContext,
  JobStage,
} from '@/types'
import { aiService } from './ai'
import { TASK_CONFIGS, getBestModelForTask } from '@/config/ai'

// ==================== ARTIFACT PLANNER ====================

export interface PlannerInput {
  userRequest: string
  artifactType?: ArtifactType
  outputFormat?: OutputFormat
  files?: Array<{ filename: string; content: string; mimeType: string }>
  brandConfig?: BrandingConfig
  knowledgeContext?: string
  additionalInstructions?: string
}

export interface PlannerOutput {
  specification: ArtifactSpecification
  confidence: number // 0-1 how confident the AI is in the plan
  clarifyingQuestions?: string[]
  warnings?: string[]
}

/**
 * AI Planner - Converts user request into structured artifact specification
 */
export async function planArtifact(input: PlannerInput): Promise<PlannerOutput> {
  const taskConfig = TASK_CONFIGS['artifact.generation']
  
  const systemPrompt = `${taskConfig.systemPrompt}

You are currently in the PLANNING phase. Your job is to:
1. Understand what the user wants to create
2. Determine the best artifact type and format
3. Plan the structure and sections
4. Define the design approach
5. Create a complete specification

You must respond with a JSON object containing:
- specification: The full ArtifactSpecification
- confidence: Your confidence level (0-1)
- clarifyingQuestions: Any questions you need answered (if confidence < 0.8)
- warnings: Any potential issues you foresee`

  const userMessage = formatPlannerPrompt(input)

  try {
    const response = await aiService.generateWithRetry({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      options: {
        model: getBestModelForTask(
          input.artifactType || 'DOCUMENT',
          input.outputFormat || 'DOCX',
          {
            hasFiles: (input.files?.length || 0) > 0,
            requiresReasoning: true,
            isComplexTask: true,
          }
        ).id,
        temperature: taskConfig.temperature,
        maxTokens: taskConfig.maxTokens,
        responseFormat: taskConfig.responseFormat,
      },
    })

    // Parse the response
    const result = parseArtifactResponse(response.content)
    
    return {
      specification: applyDefaults(result.specification, input),
      confidence: result.confidence || 0.8,
      clarifyingQuestions: result.clarifyingQuestions,
      warnings: result.warnings,
    }
  } catch (error) {
    console.error('Artifact planning failed:', error)
    throw new Error(`Failed to plan artifact: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

function formatPlannerPrompt(input: PlannerInput): string {
  let prompt = `Create an artifact based on this request:\n\n${input.request}\n\n`

  if (input.artifactType) {
    prompt += `Requested Type: ${input.artifactType}\n`
  }
  
  if (input.outputFormat) {
    prompt += `Output Format: ${input.outputFormat}\n`
  }

  if (input.files && input.files.length > 0) {
    prompt += `\nUploaded Files:\n`
    input.files.forEach((file, i) => {
      prompt += `\n${i + 1}. ${file.filename} (${file.mimeType}):\n`
      prompt += `${file.content.substring(0, 2000)}${file.content.length > 2000 ? '...(truncated)' : ''}\n`
    })
  }

  if (input.brandConfig) {
    prompt += `\nBranding Configuration:\n${JSON.stringify(input.brandConfig, null, 2)}\n`
  }

  if (input.knowledgeContext) {
    prompt += `\nRelevant Knowledge/Context:\n${input.knowledgeContext.substring(0, 3000)}\n`
  }

  if (input.additionalInstructions) {
    prompt += `\nAdditional Instructions:\n${input.additionalInstructions}\n`
  }

  prompt += `\nPlease create a detailed specification for this artifact.`

  return prompt
}

function parseArtifactResponse(content: string): {
  specification: Partial<ArtifactSpecification>
  confidence?: number
  clarifyingQuestions?: string[]
  warnings?: string[]
} {
  try {
    // Try to parse as JSON directly
    return JSON.parse(content)
  } catch {
    // Try to extract JSON from markdown code block
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1])
    }
    
    // Return a basic fallback specification
    return {
      specification: {
        title: 'Generated Artifact',
        type: 'DOCUMENT',
        outputFormat: 'DOCX',
        sections: [],
        design: getDefaultDesign(),
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
          language: 'en',
          tags: [],
          keywords: [],
        },
        validation: getDefaultValidation(),
      },
      confidence: 0.5,
      warnings: ['Could not parse AI response properly, using fallback specification'],
    }
  }
}

// ==================== SPECIFICATION DEFAULTS ====================

function applyDefaults(
  spec: Partial<ArtifactSpecification>,
  input: PlannerInput
): ArtifactSpecification {
  return {
    id: spec.id || crypto.randomUUID(),
    type: spec.type || input.artifactType || 'DOCUMENT',
    title: spec.title || 'Untitled Artifact',
    description: spec.description,
    outputFormat: spec.outputFormat || input.outputFormat || 'DOCX',
    sections: spec.sections || [],
    design: spec.design || getDefaultDesign(),
    branding: spec.branding || input.brandConfig,
    metadata: spec.metadata || {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      language: 'en',
      tags: [],
      keywords: [],
    },
    validation: spec.validation || getDefaultValidation(),
  }
}

export function getDefaultDesign(): DesignSpecification {
  return {
    theme: {
      name: 'Professional Default',
      variant: 'professional',
      primaryStyle: 'formal',
    },
    typography: {
      headingFont: 'Inter',
      bodyFont: 'Inter',
      monoFont: 'JetBrains Mono',
      headingSizes: {
        h1: 28,
        h2: 22,
        h3: 18,
        h4: 16,
        h5: 14,
        h6: 12,
      },
      bodySize: 11,
      lineHeight: 1.6,
      scale: 1.25,
    },
    spacing: {
      unit: '8px',
      pageMargin: '72pt', // 1 inch
      sectionSpacing: '24pt',
      paragraphSpacing: '12pt',
      itemSpacing: '6pt',
    },
    colors: {
      primary: '#2563eb',
      secondary: '#64748b',
      accent: '#0ea5e9',
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
      orientation: 'portrait',
      columns: 1,
      margins: {
        top: '72pt',
        right: '72pt',
        bottom: '72pt',
        left: '72pt',
      },
      headerEnabled: true,
      footerEnabled: true,
      pageNumberPosition: 'bottom',
    },
  }
}

function getDefaultValidation(): ValidationRules {
  return {
    requireTitle: true,
    maxSections: 50,
    minSections: 1,
    requiredSections: [],
    forbiddenContent: ['lorem ipsum', 'placeholder text', '[insert here]'],
    maxLength: 100000,
    mustIncludeBranding: false,
    validateCalculations: true,
    validateReferences: false,
  }
}

// ==================== CONTENT GENERATOR ====================

export interface GenerationInput {
  specification: ArtifactSpecification
  context: ArtifactGenerationContext
  onStageChange?: (stage: JobStage) => void
  onProgress?: (progress: number) => void
}

export interface GenerationOutput {
  specification: ArtifactSpecification
  generatedComponents: GeneratedComponent[]
  qualityReport: QualityReport
  tokensUsed: number
  generationTimeMs: number
}

interface GeneratedComponent {
  sectionId: string
  componentId: string
  type: ComponentType
  content: unknown
  style?: Record<string, unknown>
  order: number
}

interface QualityReport {
  score: number // 0-100
  issues: QualityIssue[]
  passedChecks: string[]
}

interface QualityIssue {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  component?: string
  suggestion?: string
}

/**
 * Content Generator - Fills in the specification with actual content
 */
export async function generateContent(input: GenerationInput): Promise<GenerationOutput> {
  const startTime = Date.now()
  let totalTokensUsed = 0
  
  input.onStageChange?.('planning_artifact')
  input.onProgress?.(10)

  const generatedComponents: GeneratedComponent[] = []
  const allIssues: QualityIssue[] = []
  const passedChecks: string[] = []

  try {
    // Generate content for each section
    for (let i = 0; i < input.specification.sections.length; i++) {
      const section = input.specification.sections[i]
      
      input.onStageChange?.('generating_content')
      input.onProgress?.(20 + (i / input.specification.sections.length) * 50)

      const sectionResult = await generateSectionContent(section, input.specification, input.context)
      generatedComponents.push(...sectionResult.components)
      totalTokensUsed += sectionResult.tokensUsed
      
      if (sectionResult.issues.length > 0) {
        allIssues.push(...sectionResult.issues)
      }
    }

    input.onStageChange?.('checking_quality')
    input.onProgress?.(80)

    // Run quality checks
    const qualityReport = await runQualityChecks(
      input.specification,
      generatedComponents,
      input.context
    )

    passedChecks.push(...qualityReport.passedChecks)
    allIssues.push(...qualityReport.issues)

    // Attempt auto-repair for fixable issues
    if (qualityReport.issues.some(i => i.severity === 'error')) {
      input.onStageChange?.('repairing_issues')
      input.onProgress?.(90)
      
      const repairedComponents = await attemptRepairs(
        qualityReport.issues.filter(i => i.severity === 'error'),
        generatedComponents,
        input.context
      )
      
      // Update components with repaired versions
      repairedComponents.forEach(repaired => {
        const index = generatedComponents.findIndex(c => c.componentId === repaired.componentId)
        if (index !== -1) {
          generatedComponents[index] = repaired
        }
      })
    }

    input.onStageChange?.('finalizing')
    input.onProgress?.(100)

    return {
      specification: input.specification,
      generatedComponents,
      qualityReport: {
        score: calculateQualityScore(allIssues, passedChecks),
        issues: allIssues,
        passedChecks,
      },
      tokensUsed: totalTokensUsed,
      generationTimeMs: Date.now() - startTime,
    }
  } catch (error) {
    console.error('Content generation failed:', error)
    throw new Error(`Failed to generate content: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

async function generateSectionContent(
  section: ArtifactSection,
  spec: ArtifactSpecification,
  context: ArtifactGenerationContext
): Promise<{
  components: GeneratedComponent[]
  tokensUsed: number
  issues: QualityIssue[]
}> {
  const taskConfig = TASK_CONFIGS['artifact.generation']
  const issues: QualityIssue[] = []

  const prompt = `Generate the content for this section of a ${spec.type}:

Section: ${section.title}
Type: ${section.type}
Order: ${section.order}

Overall Document: ${spec.title}
Document Type: ${spec.type}
Output Format: ${spec.outputFormat}

Design Theme: ${spec.design.theme.variant}
Style: ${spec.design.theme.primaryStyle}

${context.knowledgeContext ? `\nRelevant Context:\n${context.knowledgeContext.substring(0, 2000)}\n` : ''}
${context.brandContext ? `\nBranding:\nCompany: ${context.brandContext.companyName || 'N/A'}\n` : ''}

Generate professional, complete content for this section. Include all necessary details.
Respond with JSON containing the generated components array.`

  try {
    const response = await aiService.generateWithRetry({
      messages: [
        { role: 'system', content: taskConfig.systemPrompt },
        { role: 'user', content: prompt },
      ],
      options: {
        temperature: taskConfig.temperature,
        maxTokens: Math.min(taskConfig.maxTokens, 8192),
        responseFormat: 'json_object',
      },
    })

    const parsed = JSON.parse(response.content)
    const components: GeneratedComponent[] = (parsed.components || []).map((comp: unknown, idx: number) => ({
      sectionId: section.id,
      componentId: crypto.randomUUID(),
      type: (comp as Record<string, unknown>).type as ComponentType || 'PARAGRAPH',
      content: comp,
      order: idx,
    }))

    return {
      components,
      tokensUsed: response.usage.totalTokens,
      issues,
    }
  } catch (error) {
    issues.push({
      severity: 'error',
      code: 'GENERATION_FAILED',
      message: `Failed to generate content for section: ${section.title}`,
      component: section.id,
      suggestion: 'Try regenerating this section',
    })

    return {
      components: [{
        sectionId: section.id,
        componentId: crypto.randomUUID(),
        type: 'PARAGRAPH',
        content: { text: `[Content generation failed for: ${section.title}]` },
        order: 0,
      }],
      tokensUsed: 0,
      issues,
    }
  }
}

// ==================== QUALITY CONTROL ====================

async function runQualityChecks(
  spec: ArtifactSpecification,
  components: GeneratedComponent[],
  context: ArtifactGenerationContext
): Promise<QualityReport> {
  const issues: QualityIssue[] = []
  const passedChecks: string[] = []

  // Check 1: All sections have content
  if (components.length === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_CONTENT',
      message: 'No content was generated',
      suggestion: 'Regenerate the entire artifact',
    })
  } else {
    passedChecks.push('Content exists')
  }

  // Check 2: Title is present and valid
  if (!spec.title || spec.title.trim().length === 0) {
    issues.push({
      severity: 'error',
      code: 'MISSING_TITLE',
      message: 'Artifact has no title',
    })
  } else if (spec.title.toLowerCase().includes('untitled')) {
    issues.push({
      severity: 'warning',
      code: 'GENERIC_TITLE',
      message: 'Title appears to be generic',
      suggestion: 'Provide a more specific title',
    })
  } else {
    passedChecks.push('Valid title')
  }

  // Check 3: No placeholder content
  const contentStrings = components.map(c => JSON.stringify(c.content)).join(' ')
  const placeholders = ['lorem ipsum', 'placeholder', '[insert', 'todo:', 'tbd']
  placeholders.forEach(placeholder => {
    if (contentStrings.toLowerCase().includes(placeholder)) {
      issues.push({
        severity: 'error',
        code: 'PLACEHOLDER_CONTENT',
        message: `Found placeholder text: "${placeholder}"`,
        suggestion: 'Replace with actual content',
      })
    }
  })
  if (!placeholders.some(p => contentStrings.toLowerCase().includes(p))) {
    passedChecks.push('No placeholder content')
  }

  // Check 4: Required sections exist
  if (spec.validation.requiredSections && spec.validation.requiredSections.length > 0) {
    const sectionTitles = spec.sections.map(s => s.title.toLowerCase())
    spec.validation.requiredSections.forEach(required => {
      if (!sectionTitles.some(t => t.includes(required.toLowerCase()))) {
        issues.push({
          severity: 'warning',
          code: 'MISSING_REQUIRED_SECTION',
          message: `Required section missing: ${required}`,
        })
      }
    })
  }

  // Check 5: Content length check
  if (spec.validation.maxLength && contentStrings.length > spec.validation.maxLength) {
    issues.push({
      severity: 'warning',
      code: 'CONTENT_TOO_LONG',
      message: `Content exceeds maximum length (${contentStrings.length}/${spec.validation.maxLength})`,
    })
  }

  // Check 6: Section count check
  if (spec.validation.minSections && spec.sections.length < spec.validation.minSections) {
    issues.push({
      severity: 'error',
      code: 'TOO_FEW_SECTIONS',
      message: `Not enough sections (${spec.sections.length}/${spec.validation.minSections})`,
    })
  }
  if (spec.validation.maxSections && spec.sections.length > spec.validation.maxSections) {
    issues.push({
      severity: 'warning',
      code: 'TOO_MANY_SECTIONS',
      message: `Too many sections (${spec.sections.length}/${spec.validation.maxSections})`,
    })
  }

  // Check 7: Forbidden content
  if (spec.validation.forbiddenContent && spec.validation.forbiddenContent.length > 0) {
    spec.validation.forbiddenContent.forEach(forbidden => {
      if (contentStrings.toLowerCase().includes(forbidden.toLowerCase())) {
        issues.push({
          severity: 'error',
          code: 'FORBIDDEN_CONTENT',
          message: `Found forbidden content: "${forbidden}"`,
        })
      }
    })
  }

  // Check 8: Formatting consistency (basic)
  const hasHeadings = components.some(c => c.type === 'HEADING')
  const hasParagraphs = components.some(c => c.type === 'PARAGRAPH')
  if (hasHeadings && hasParagraphs) {
    passedChecks.push('Has structure with headings and paragraphs')
  }

  return {
    score: calculateQualityScore(issues, passedChecks),
    issues,
    passedChecks,
  }
}

function calculateQualityScore(issues: QualityIssue[], passedChecks: string[]): number {
  let score = 100
  
  issues.forEach(issue => {
    switch (issue.severity) {
      case 'error':
        score -= 15
        break
      case 'warning':
        score -= 5
        break
      case 'info':
        score -= 1
        break
    }
  })
  
  // Bonus for passed checks
  score += Math.min(passedChecks.length * 2, 10)
  
  return Math.max(0, Math.min(100, score))
}

// ==================== AUTO-REPAIR ====================

async function attemptRepairs(
  errors: QualityIssue[],
  components: GeneratedComponent[],
  context: ArtifactGenerationContext
): Promise<GeneratedComponent[]> {
  const repaired: GeneratedComponent[] = []

  for (const error of errors) {
    if (!error.component) continue

    const component = components.find(c => c.componentId === error.component)
    if (!component) continue

    switch (error.code) {
      case 'PLACEHOLDER_CONTENT':
      case 'NO_CONTENT':
        try {
          // Try to regenerate just this component
          const repairPrompt = `Fix this issue: ${error.message}. ${error.suggestion || ''}`
          
          const response = await aiService.generateWithRetry({
            messages: [
              { role: 'system', content: 'You are repairing an artifact component. Fix the specific issue described.' },
              { role: 'user', content: repairPrompt },
            ],
            options: {
              temperature: 0.3,
              maxTokens: 2048,
            },
          })

          repaired.push({
            ...component,
            content: { text: response.content },
          })
        } catch {
          // If repair fails, keep original
          repaired.push(component)
        }
        break
      
      default:
        // Can't automatically repair other types
        repaired.push(component)
    }
  }

  return repaired
}

// ==================== EXPORT HELPERS ====================

/**
 * Convert specification to renderable format for document generators
 */
export function prepareForRendering(
  specification: ArtifactSpecification,
  components: GeneratedComponent[]
): RenderableDocument {
  // Group components by section
  const sections: RenderableSection[] = specification.sections.map(section => ({
    ...section,
    components: components
      .filter(c => c.sectionId === section.id)
      .sort((a, b) => a.order - b.order)
      .map(c => ({
        id: c.componentId,
        type: c.type,
        content: c.content,
        style: c.style,
      })),
  }))

  return {
    specification,
    sections,
    branding: specification.branding,
  }
}

export interface RenderableDocument {
  specification: ArtifactSpecification
  sections: RenderableSection[]
  branding?: BrandingConfig
}

export interface RenderableSection extends ArtifactSection {
  components: RenderableComponent[]
}

export interface RenderableComponent {
  id: string
  type: ComponentType
  content: unknown
  style?: Record<string, unknown>
}
