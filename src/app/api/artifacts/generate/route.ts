import { NextRequest, NextResponse } from 'next/server'
import { planArtifact, generateContent } from '@/services/artifact-engine'
import type { ArtifactType, OutputFormat } from '@/types'
import { ConvexHttpClient } from 'convex/browser'

// POST /api/artifacts/generate - Generate a new artifact (with Pro subscription check)
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
      userId, // Required for subscription check
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

    // ==================== SUBSCRIPTION CHECK (CRITICAL) ====================
    // AI generation requires an active Pro subscription
    if (userId && process.env.NEXT_PUBLIC_CONVEX_URL) {
      try {
        const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL)
        
        const subscriptionStatus = await convex.query(
          'subscriptions:hasActiveSubscription',
          { userId }
        )

        if (!subscriptionStatus?.hasActive) {
          return NextResponse.json(
            {
              error: 'Pro subscription required',
              code: 'SUBSCRIPTION_REQUIRED',
              message: 'AI generation requires an active Pro subscription.',
              reason: subscriptionStatus?.reason || 'No active subscription found',
              upgradeUrl: '/pricing',
            },
            { status: 402 } // Payment Required
          )
        }

        // Check generation limits if applicable
        const canGenerate = await convex.query(
          'subscriptions:canGenerateAI',
          { userId }
        )

        if (!canGenerate?.allowed) {
          return NextResponse.json(
            {
              error: 'Generation limit reached',
              code: 'LIMIT_EXCEEDED',
              message: 'You have reached your AI generation limit for this billing period.',
              remaining: canGenerate?.remaining || 0,
              limit: canGenerate?.limit || 0,
              resetDate: canGenerate?.resetDate,
            },
            { status: 429 } // Too Many Requests
          )
        }
      } catch (subError) {
        // If subscription check fails, allow generation in development mode
        console.warn('[GENERATION] Subscription check failed:', subError)
        
        if (process.env.NODE_ENV === 'production') {
          return NextResponse.json(
            {
              error: 'Unable to verify subscription',
              code: 'SUBSCRIPTION_CHECK_FAILED',
              message: 'Could not verify your subscription status. Please try again.',
            },
            { status: 503 } // Service Unavailable
          )
        }
      }
    } else if (process.env.NODE_ENV === 'production') {
      // In production, require userId for subscription checks
      return NextResponse.json(
        {
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
          message: 'Please sign in to generate artifacts.',
        },
        { status: 401 }
      )
    }
    // =====================================================================

    // Create job ID for tracking
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

    // Start async generation process
    const generationResult = await performGeneration({
      prompt,
      artifactType,
      outputFormat,
      files,
      workspaceId,
      brandConfig,
      knowledgeContext,
      jobId,
      userId,
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

// GET /api/artifacts/generate - Health check / info endpoint
export async function GET() {
  return NextResponse.json({
    service: 'filo-artifact-generator',
    version: '2.0.0',
    endpoint: '/api/artifacts/generate',
    features: {
      aiGeneration: true,
      documentExport: ['DOCX', 'PDF', 'XLSX', 'PPTX', 'CSV'],
      fileUpload: true,
      branding: true,
      multiFormat: true,
    },
    requirements: {
      authentication: process.env.NODE_ENV === 'production' ? 'required' : 'optional',
      subscription: 'Pro plan required for AI generation',
    },
    supportedTypes: [
      'document',
      'presentation',
      'spreadsheet',
      'report',
      'proposal',
      'contract',
      'email',
      'creative',
    ],
  })
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
  userId?: string
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
      userId: input.userId || 'anonymous-user',
      knowledgeContext: input.knowledgeContext,
      brandContext: input.brandConfig as never,
      fileContents: input.files,
    },
  })

  // Generate unique ID using crypto (available in Node.js)
  let artifactId: string
  try {
    const crypto = await import('crypto')
    artifactId = crypto.randomUUID()
  } catch {
    // Fallback UUID generation
    artifactId = `${input.jobId}_${Date.now()}`
  }

  // Return result (in production, save to DB and R2)
  return {
    artifact: {
      id: artifactId,
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
    if (error.message.includes('subscription')) return 'SUBSCRIPTION_ERROR'
  }
  return 'GENERATION_ERROR'
}
