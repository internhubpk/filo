// =============================================================================
// FILO AGENT ROUTER - Intelligent Document Generation Pipeline
// =============================================================================
// The Agent Router is the orchestrator that takes a user prompt and produces
// a real, downloadable document file (DOCX/PDF/XLSX/PPTX/CSV).
//
// Pipeline: Prompt → Type Detection → AI Planning → AI Content Generation
//          → Quality Check → File Rendering → Output
// =============================================================================

import type {
  ArtifactSpecification,
  ArtifactSection,
  OutputFormat,
  ArtifactType,
  DesignSpecification,
  GeneratedComponent,
} from '@/types'
import { renderArtifact, type RendererOutput } from './document-renderer'
import { aiRouter } from './ai'
import type { AiTask } from './ai'

// ==================== TYPES ====================

export type DocumentFormat = 'DOCX' | 'PDF' | 'XLSX' | 'PPTX' | 'CSV'

export interface AgentRouterInput {
  prompt: string
  outputFormat?: DocumentFormat
  artifactType?: string
  userId: string
  workspaceId: string
  files?: Array<{ filename: string; content: string; mimeType: string }>
  brandConfig?: {
    companyName?: string
    logoUrl?: string
    footerText?: string
    colors?: { primary?: string; secondary?: string; accent?: string }
    fonts?: { heading?: string; body?: string }
  }
}

export interface AgentRouterOutput {
  success: boolean
  artifact?: {
    id: string
    title: string
    type: string
    format: DocumentFormat
    content: string
    specification: ArtifactSpecification
    fileData?: string // Base64 encoded file
    fileSize?: number
    fileName?: string
    mimeType?: string
  }
  tokensUsed?: number
  generationTimeMs?: number
  error?: string
  code?: string
  stages?: RouterStage[]
}

export interface RouterStage {
  id: string
  label: string
  status: 'pending' | 'active' | 'completed' | 'error'
  detail?: string
  startedAt?: number
  completedAt?: number
}

// ==================== AI CONFIG ====================
// NOTE: Direct OpenRouter configuration was removed — all AI calls now flow
// through the canonical aiRouter (src/services/ai/) with Gemini as the
// primary provider and OpenRouter/OpenAI as optional fallbacks. The env vars
// below are honored by the AI layer itself (see src/services/ai/*.ts).

// ==================== AGENT ROUTER ====================

export class AgentRouter {
  private stages: RouterStage[] = []
  private totalTokensUsed = 0
  private startTime = 0

  /**
   * Main entry point: Generate a complete document from a prompt
   */
  async generate(input: AgentRouterInput): Promise<AgentRouterOutput> {
    this.startTime = Date.now()
    this.totalTokensUsed = 0
    this.initStages()

    try {
      // Stage 1: Detect artifact type & format
      this.updateStage('1', 'Analyzing request', 'active')
      const detected = this.detectTypeAndFormat(input.prompt, input.outputFormat, input.artifactType)
      this.completeStage('1', `Detected: ${detected.type} → ${detected.format}`)

      // Stage 2: Plan document structure
      this.updateStage('2', 'Planning document structure', 'active')
      const specification = await this.planDocument(input.prompt, detected.type, detected.format)
      this.completeStage('2', `Planned ${specification.sections.length} sections`)

      // Stage 3: Generate content for each section
      this.updateStage('3', 'Generating content', 'active')
      const components = await this.generateAllContent(specification, input.prompt)
      this.completeStage('3', `Generated ${components.length} components`)

      // Stage 4: Render to file
      this.updateStage('4', 'Creating document file', 'active')
      const rendered = await this.renderToFile(specification, components, detected.format)
      this.completeStage('4', `Created ${rendered.filename} (${(rendered.size / 1024).toFixed(1)} KB)`)

      // Stage 5: Quality check
      this.updateStage('5', 'Quality check', 'active')
      const qualityScore = this.runQualityCheck(specification, components)
      this.completeStage('5', `Quality score: ${qualityScore}/100`)

      // Stage 6: Finalize
      this.updateStage('6', 'Finalizing', 'active')
      const artifactId = `artifact_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

      // Extract text content for storage/preview
      const textContent = this.extractTextContent(specification, components)

      this.completeStage('6', 'Done')

      return {
        success: true,
        artifact: {
          id: artifactId,
          title: specification.title,
          type: detected.type,
          format: detected.format,
          content: textContent,
          specification,
          fileData: rendered.buffer.toString('base64'),
          fileSize: rendered.size,
          fileName: rendered.filename,
          mimeType: rendered.mimeType,
        },
        tokensUsed: this.totalTokensUsed,
        generationTimeMs: Date.now() - this.startTime,
        stages: this.stages,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      const errorCode = this.getErrorCode(error)

      // Mark current active stage as error
      const activeStage = this.stages.find(s => s.status === 'active')
      if (activeStage) {
        activeStage.status = 'error'
        activeStage.detail = errorMsg
      }

      return {
        success: false,
        error: errorMsg,
        code: errorCode,
        tokensUsed: this.totalTokensUsed,
        generationTimeMs: Date.now() - this.startTime,
        stages: this.stages,
      }
    }
  }

  // ==================== TYPE DETECTION ====================

  private detectTypeAndFormat(
    prompt: string,
    requestedFormat?: DocumentFormat,
    requestedType?: string
  ): { type: string; format: DocumentFormat } {
    const lower = prompt.toLowerCase()

    // Use requested type if provided
    if (requestedType) {
      return {
        type: requestedType.toUpperCase(),
        format: requestedFormat || this.inferFormatFromType(requestedType, lower),
      }
    }

    // Detect from prompt keywords
    if (lower.includes('presentation') || lower.includes('slide') || lower.includes('deck')) {
      return { type: 'PRESENTATION', format: requestedFormat || 'PPTX' }
    }
    if (lower.includes('spreadsheet') || lower.includes('excel') || lower.includes('budget') || lower.includes('financial statement') || lower.includes('tracker')) {
      return { type: 'SPREADSHEET', format: requestedFormat || 'XLSX' }
    }
    if (lower.includes('invoice')) {
      return { type: 'INVOICE', format: requestedFormat || 'DOCX' }
    }
    if (lower.includes('resume') || lower.includes('cv')) {
      return { type: 'RESUME', format: requestedFormat || 'DOCX' }
    }
    if (lower.includes('lesson plan') || lower.includes('course plan') || lower.includes('syllabus')) {
      return { type: 'LESSON_PLAN', format: requestedFormat || 'DOCX' }
    }
    if (lower.includes('proposal') || lower.includes('business plan') || lower.includes('pitch deck')) {
      return { type: 'PROPOSAL', format: requestedFormat || 'DOCX' }
    }
    if (lower.includes('report') || lower.includes('analysis') || lower.includes('research')) {
      return { type: 'REPORT', format: requestedFormat || 'DOCX' }
    }
    if (lower.includes('contract') || lower.includes('agreement') || lower.includes('terms')) {
      return { type: 'CONTRACT', format: requestedFormat || 'DOCX' }
    }
    if (lower.includes('email') || lower.includes('letter')) {
      return { type: 'EMAIL', format: requestedFormat || 'DOCX' }
    }
    if (lower.includes('csv') || lower.includes('data export')) {
      return { type: 'DOCUMENT', format: 'CSV' }
    }

    // Default
    return { type: 'DOCUMENT', format: requestedFormat || 'DOCX' }
  }

  private inferFormatFromType(type: string, promptLower: string): DocumentFormat {
    if (type.toUpperCase() === 'PRESENTATION') return 'PPTX'
    if (type.toUpperCase() === 'SPREADSHEET') return 'XLSX'
    if (promptLower.includes('pdf')) return 'PDF'
    return 'DOCX'
  }

  // ==================== AI PLANNING ====================

  private async planDocument(
    prompt: string,
    artifactType: string,
    outputFormat: DocumentFormat
  ): Promise<ArtifactSpecification> {
    const systemPrompt = this.getPlanningSystemPrompt(artifactType, outputFormat)

    const response = await this.callAI(systemPrompt, prompt, {
      temperature: 0.7,
      maxTokens: 4096,
      responseFormat: 'json_object',
      task: 'reasoning',
    })

    return this.parsePlanResponse(response, artifactType, outputFormat)
  }

  private getPlanningSystemPrompt(type: string, format: DocumentFormat): string {
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

  private parsePlanResponse(
    aiContent: string,
    artifactType: string,
    outputFormat: DocumentFormat
  ): ArtifactSpecification {
    let parsed: any

    try {
      parsed = JSON.parse(aiContent)
    } catch {
      const jsonMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1])
      } else {
        throw new Error('Failed to parse AI planning response')
      }
    }

    const sections: ArtifactSection[] = (parsed.sections || []).map((s: any, idx: number) => ({
      id: s.id || crypto.randomUUID(),
      type: s.type || 'content',
      title: s.title || `Section ${idx + 1}`,
      order: s.order ?? idx,
      components: (s.components || []).map((c: any, cIdx: number) => ({
        id: c.id || crypto.randomUUID(),
        type: c.type || 'paragraph',
        order: c.order ?? cIdx,
        content: c.content || null,
        data: c.note ? { note: c.note } : undefined,
      })),
    }))

    // Ensure at least one section
    if (sections.length === 0) {
      sections.push({
        id: crypto.randomUUID(),
        type: 'content',
        title: 'Content',
        order: 0,
        components: [],
      })
    }

    return {
      id: crypto.randomUUID(),
      type: artifactType as ArtifactType,
      title: parsed.title || 'Generated Document',
      description: parsed.description,
      outputFormat: outputFormat as OutputFormat,
      sections,
      design: this.getDefaultDesign(outputFormat),
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

  // ==================== CONTENT GENERATION ====================

  private async generateAllContent(
    specification: ArtifactSpecification,
    originalPrompt: string
  ): Promise<GeneratedComponent[]> {
    const allComponents: GeneratedComponent[] = []

    for (const section of specification.sections) {
      const components = await this.generateSectionContent(section, specification, originalPrompt)
      allComponents.push(...components)
    }

    return allComponents
  }

  private async generateSectionContent(
    section: ArtifactSection,
    spec: ArtifactSpecification,
    originalPrompt: string
  ): Promise<GeneratedComponent[]> {
    const systemPrompt = `You are Filo's content generator. Generate professional, high-quality content for a document section.

Document Title: ${spec.title}
Document Type: ${spec.type}
Output Format: ${spec.outputFormat}

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

    const userPrompt = `Generate content for this section:

Section Title: ${section.title}
Section Type: ${section.type}
${section.components.length > 0 ? `Component Notes: ${section.components.map(c => { const d = c.data as { note?: string } | null | undefined; return d?.note || ''; }).filter(Boolean).join('; ')}` : ''}

Original Request: ${originalPrompt}

Generate the actual content now. Be thorough and professional.`

    try {
      const response = await this.callAI(systemPrompt, userPrompt, {
        temperature: 0.7,
        maxTokens: 4096,
        responseFormat: 'json_object',
      })

      const parsed = JSON.parse(response)
      const rawComponents = parsed.components || []

      return rawComponents.map((comp: any, idx: number) => {
        // AI returns { type: "paragraph", content: "..." } — extract the actual content
        const rawContent = comp.content
        return {
          sectionId: section.id,
          componentId: crypto.randomUUID(),
          type: this.normalizeComponentType(comp.type),
          content: rawContent,
          order: idx,
        }
      })
    } catch (error) {
      console.error(`Content generation failed for section ${section.title}:`, error)
      return [{
        sectionId: section.id,
        componentId: crypto.randomUUID(),
        type: 'PARAGRAPH' as any,
        content: `Content generation failed for: ${section.title}`,
        order: 0,
      }]
    }
  }

  private normalizeComponentType(type: string): string {
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

  // ==================== FILE RENDERING ====================

  private async renderToFile(
    specification: ArtifactSpecification,
    components: GeneratedComponent[],
    format: DocumentFormat
  ): Promise<RendererOutput> {
    return renderArtifact(specification, components, format as OutputFormat)
  }

  // ==================== QUALITY CHECK ====================

  private runQualityCheck(
    spec: ArtifactSpecification,
    components: GeneratedComponent[]
  ): number {
    let score = 100

    // Check title
    if (!spec.title || spec.title === 'Untitled Artifact' || spec.title === 'Generated Document') {
      score -= 10
    }

    // Check sections
    if (spec.sections.length < 2) {
      score -= 15
    }

    // Check components
    if (components.length < 3) {
      score -= 20
    }

    // Check for placeholder content
    const contentStr = components.map(c => JSON.stringify(c.content)).join(' ')
    const placeholders = ['lorem ipsum', 'placeholder', '[insert', 'todo:', 'tbd']
    for (const p of placeholders) {
      if (contentStr.toLowerCase().includes(p)) {
        score -= 10
      }
    }

    // Check content depth
    const avgContentLength = components.reduce((sum, c) => {
      const len = typeof c.content === 'string' ? c.content.length : JSON.stringify(c.content).length
      return sum + len
    }, 0) / Math.max(components.length, 1)

    if (avgContentLength < 50) {
      score -= 15
    }

    return Math.max(0, Math.min(100, score))
  }

  // ==================== TEXT EXTRACTION ====================

  private extractTextContent(
    spec: ArtifactSpecification,
    components: GeneratedComponent[]
  ): string {
    let text = `# ${spec.title}\n\n`

    for (const section of spec.sections) {
      text += `## ${section.title}\n\n`

      const sectionComponents = components
        .filter(c => c.sectionId === section.id)
        .sort((a, b) => a.order - b.order)

      for (const comp of sectionComponents) {
        if (typeof comp.content === 'string') {
          text += comp.content + '\n\n'
        } else if (Array.isArray(comp.content)) {
          if (comp.type === 'table') {
            for (const row of comp.content) {
              text += (Array.isArray(row) ? row.join(' | ') : String(row)) + '\n'
            }
            text += '\n'
          } else {
            for (const item of comp.content) {
              text += `- ${typeof item === 'string' ? item : JSON.stringify(item)}\n`
            }
            text += '\n'
          }
        } else if (comp.content && typeof comp.content === 'object' && 'text' in comp.content) {
          text += (comp.content as { text: string }).text + '\n\n'
        }
      }
    }

    return text.trim()
  }

  // ==================== AI CALL ====================

  /**
   * Single AI choke point for the AgentRouter.
   *
   * Previously this made a raw fetch() to OpenRouter with the key read here.
   * It now delegates to the canonical aiRouter (src/services/ai/) which
   * owns provider selection (Gemini primary), retry with backoff, provider
   * fallback, timeouts, and the typed error hierarchy. Retry/fallback are
   * centralized in the router so this method stays a thin adapter.
   */
  private async callAI(
    systemPrompt: string,
    userPrompt: string,
    options: {
      temperature?: number
      maxTokens?: number
      responseFormat?: string
      task?: AiTask
    } = {}
  ): Promise<string> {
    const response = await aiRouter.generate(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        options: {
          temperature: options.temperature ?? 0.7,
          maxTokens: options.maxTokens,
          responseFormat:
            options.responseFormat === 'json_object'
              ? { type: 'json' as const }
              : { type: 'text' as const },
        },
      },
      {
        // Planning calls benefit from a reasoning-grade model; content
        // generation uses the default generation profile.
        task: options.task || 'generation',
      }
    )

    this.totalTokensUsed += response.usage.totalTokens
    return response.content || '{}'
  }

  // ==================== STAGE MANAGEMENT ====================

  private initStages() {
    this.stages = [
      { id: '1', label: 'Analyzing request', status: 'pending' },
      { id: '2', label: 'Planning document structure', status: 'pending' },
      { id: '3', label: 'Generating content', status: 'pending' },
      { id: '4', label: 'Creating document file', status: 'pending' },
      { id: '5', label: 'Quality check', status: 'pending' },
      { id: '6', label: 'Finalizing', status: 'pending' },
    ]
  }

  private updateStage(id: string, label: string, status: RouterStage['status']) {
    const stage = this.stages.find(s => s.id === id)
    if (stage) {
      stage.status = status
      if (status === 'active') stage.startedAt = Date.now()
    }
  }

  private completeStage(id: string, detail?: string) {
    const stage = this.stages.find(s => s.id === id)
    if (stage) {
      stage.status = 'completed'
      stage.completedAt = Date.now()
      if (detail) stage.detail = detail
    }
  }

  // ==================== HELPERS ====================

  private getDefaultDesign(format: DocumentFormat): DesignSpecification {
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

  private getErrorCode(error: unknown): string {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('API key') || msg.includes('not configured')) return 'API_KEY_MISSING'
    if (msg.includes('rate limit') || msg.includes('429')) return 'RATE_LIMITED'
    if (msg.includes('timeout') || msg.includes('timed out')) return 'TIMEOUT'
    if (msg.includes('parse')) return 'PLANNING_FAILED'
    if (msg.includes('provider') || msg.includes('AI provider')) return 'PROVIDER_ERROR'
    return 'GENERATION_FAILED'
  }
}

// ==================== EXPORT SINGLETON ====================

export const agentRouter = new AgentRouter()
