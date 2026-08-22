import { NextRequest, NextResponse } from 'next/server'
import { planArtifact, generateContent } from '@/services/artifact-engine'
import type { ArtifactType, OutputFormat } from '@/types'

// POST /api/artifacts/generate - Generate a new artifact
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      prompt,
      artifactType,
      outputFormat,
      files,
      workspaceId,
      brandConfig,
      knowledgeContext,
    } = body

    // Validate required fields
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: 'Prompt is required', code: 'MISSING_PROMPT' },
        { status: 400 }
      )
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'Workspace ID is required', code: 'MISSING_WORKSPACE' },
        { status: 400 }
      )
    }

    // Create job ID for tracking
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Start async generation process
    // In production, this would be queued and processed in background
    const generationResult = await performGeneration({
      prompt,
      artifactType,
      outputFormat,
      files,
      workspaceId,
      brandConfig,
      knowledgeContext,
      jobId,
    })

    return NextResponse.json({
      success: true,
      jobId,
      artifact: generationResult.artifact,
      qualityReport: generationResult.qualityReport,
      tokensUsed: generationResult.tokensUsed,
      generationTimeMs: generationResult.generationTimeMs,
    })

  } catch (error) {
    console.error('Artifact generation error:', error)
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorCode = getErrorCode(error)
    
    return NextResponse.json(
      { 
        error: 'Generation failed', 
        code: errorCode,
        message: errorMessage 
      },
      { status: 500 }
    )
  }
}

// GET /api/artifacts - List artifacts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')
    const type = searchParams.get('type')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'Workspace ID is required', code: 'MISSING_WORKSPACE' },
        { status: 400 }
      )
    }

    // In production, query database
    return NextResponse.json({
      success: true,
      artifacts: [],
      total: 0,
      pagination: {
        page,
        limit,
        totalPages: 0,
      },
    })

  } catch (error) {
    console.error('Artifact list error:', error)
    return NextResponse.json(
      { error: 'Failed to list artifacts', code: 'LIST_ERROR' },
      { status: 500 }
    )
  }
}

// ==================== HELPER FUNCTIONS ====================

interface GenerationInput {
  prompt: string
  artifactType?: ArtifactType
  outputFormat?: OutputFormat
  files?: Array<{ filename: string; content: string; mimeType: string }>
  workspaceId: string
  brandConfig?: unknown
  knowledgeContext?: string
  jobId: string
}

async function performGeneration(input: GenerationInput) {
  // Phase 1: Plan the artifact
  const plan = await planArtifact({
    userRequest: input.prompt,
    artifactType: input.artifactType,
    outputFormat: input.outputFormat,
    files: input.files,
    brandConfig: input.brandConfig as never,
    knowledgeContext: input.knowledgeContext,
  })

  // Phase 2: Generate content
  const result = await generateContent({
    specification: plan.specification,
    context: {
      workspaceId: input.workspaceId,
      userId: 'current-user', // Would come from auth session
      knowledgeContext: input.knowledgeContext,
      brandContext: input.brandConfig as never,
      fileContents: input.files,
    },
  })

  // Return result (in production, save to DB and R2)
  return {
    artifact: {
      id: crypto.randomUUID(),
      title: plan.specification.title,
      type: plan.specification.type,
      format: plan.specification.outputFormat,
      status: 'completed',
      specification: plan.specification,
      components: result.generatedComponents,
    },
    qualityReport: result.qualityReport,
    tokensUsed: result.tokensUsed,
    generationTimeMs: result.generationTimeMs,
  }
}

function getErrorCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('API key')) return 'AI_CONFIG_ERROR'
    if (error.message.includes('rate limit')) return 'RATE_LIMITED'
    if (error.message.includes('timeout')) return 'TIMEOUT'
    if (error.message.includes('validation')) return 'VALIDATION_ERROR'
  }
  return 'GENERATION_ERROR'
}
