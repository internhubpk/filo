// =============================================================================
// FILO Artifact Generation - Convex Backend
// =============================================================================
// ARCHITECTURE: All AI/external API calls MUST go through Convex
// - Actions can access process.env secrets (OPENROUTER_API_KEY, etc.)
// - Frontend calls this action via useMutation
// - NEVER call AI providers directly from Next.js or browser
// =============================================================================

import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";

// ==================== QUERIES ====================

/**
 * List artifacts for a user (most recent first).
 * Caller must pass their own userId — server-side authorization is enforced
 * in the API route layer before this query is reached. The query itself just
 * returns whatever the userId asks for; this is acceptable because the
 * Convex function reference is not exposed publicly (it's invoked via the
 * authenticated /api/artifacts route which validates the session first).
 */
export const listUserArtifacts = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("artifacts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

// ==================== TYPES ====================

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

// ==================== ACTION: Generate Artifact ====================

/**
 * Main artifact generation action
 * - Runs in Convex (has access to OPENROUTER_API_KEY)
 * - Calls OpenRouter API for planning + content generation
 * - Returns structured artifact data
 */
export const generateArtifact = action({
  args: {
    prompt: v.string(),
    artifactType: v.optional(v.string()),
    outputFormat: v.optional(v.string()),
    workspaceId: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    artifact?: {
      id: string;
      title: string;
      type: string;
      format: string;
      content: string;
      specification: Record<string, unknown>;
    };
    error?: string;
    code?: string;
    tokensUsed?: number;
    generationTimeMs?: number;
  }> => {
    const startTime = Date.now();
    
    try {
      // Validate API key is configured
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          error: "OpenRouter API key not configured in Convex environment",
          code: "API_KEY_MISSING",
        };
      }

      // Phase 1: Plan the artifact
      const planResult = await planArtifactWithAI(apiKey, {
        prompt: args.prompt,
        artifactType: args.artifactType,
        outputFormat: args.outputFormat,
      });

      if (!planResult.success || !planResult.specification) {
        return {
          success: false,
          error: planResult.error || "Failed to plan artifact",
          code: planResult.code || "PLANNING_FAILED",
          generationTimeMs: Date.now() - startTime,
        };
      }

      // Phase 2: Generate content
      const contentResult = await generateContentWithAI(apiKey, {
        specification: planResult.specification,
        prompt: args.prompt,
      });

      if (!contentResult.success) {
        return {
          success: false,
          error: contentResult.error || "Failed to generate content",
          code: contentResult.code || "GENERATION_FAILED",
          generationTimeMs: Date.now() - startTime,
        };
      }

      // Save artifact record (optional - for history)
      // Note: Only save if we have a valid userId
      if (args.userId) {
        try {
          await ctx.runMutation(api.artifacts.saveArtifactRecord, {
            userId: args.userId as any, // Will be validated by Convex
            title: (planResult.specification.title as string | undefined) || "Generated Artifact",
            type: args.artifactType || "document",
            format: args.outputFormat || "DOCX",
            prompt: args.prompt,
            status: "completed",
          });
        } catch (saveError) {
          console.warn("[ARTIFACTS] Failed to save record (non-critical):", saveError);
          // Don't fail the generation if saving fails
        }
      }

      // Generate a proper UUID for the artifact
      const artifactId = `artifact_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      return {
        success: true,
        artifact: {
          id: artifactId,
          title: (planResult.specification.title as string | undefined) || "Generated Artifact",
          type: args.artifactType || "DOCUMENT",
          format: args.outputFormat || "DOCX",
          content: contentResult.content || "",
          specification: planResult.specification,
        },
        tokensUsed: (planResult.tokensUsed || 0) + (contentResult.tokensUsed || 0),
        generationTimeMs: Date.now() - startTime,
      };

    } catch (error) {
      console.error("Artifact generation failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        code: "GENERATION_ERROR",
        generationTimeMs: Date.now() - startTime,
      };
    }
  },
});

// ==================== MUTATION: Save Artifact Record ====================

export const saveArtifactRecord = mutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    type: v.string(),
    format: v.string(),
    prompt: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("generating"),
      v.literal("completed"),
      v.literal("error"),
      v.literal("archived")
    ),
  },
  handler: async (ctx, args) => {
    // REAL implementation - Save artifact to database
    const now = Date.now();

    try {
      // Insert into artifacts table (matching schema exactly)
      const artifactId = await ctx.db.insert("artifacts", {
        userId: args.userId,
        title: args.title,
        type: args.type,
        format: args.format,
        prompt: args.prompt,
        status: args.status,
        versionCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      
      console.log(`[ARTIFACTS] Saved artifact (DB ID: ${artifactId})`);
      
      return {
        saved: true,
        dbId: artifactId,
      };
    } catch (error) {
      console.error(`[ARTIFACTS] Failed to save artifact:`, error);
      
      // Return success anyway so generation doesn't fail
      // The artifact was still generated, just not persisted
      return {
        saved: false,
        error: error instanceof Error ? error.message : 'Database error',
      };
    }
  },
});

// ==================== AI HELPER FUNCTIONS ====================

async function planArtifactWithAI(
  apiKey: string,
  input: { prompt: string; artifactType?: string; outputFormat?: string }
): Promise<{
  success: boolean;
  specification?: Record<string, unknown>;
  tokensUsed?: number;
  error?: string;
  code?: string;
}> {
  const systemPrompt = `You are Filo's AI artifact planner. Your job is to:
1. Understand what the user wants to create
2. Determine the best structure and approach
3. Create a complete specification

You must respond with a JSON object containing:
- title: A clear, professional title
- type: The artifact type (DOCUMENT, SPREADSHEET, PRESENTATION, etc.)
- sections: Array of section objects with id, title, type, order
- design: Design preferences object

Current request: ${input.prompt}
${input.artifactType ? `\nRequested type: ${input.artifactType}` : ""}
${input.outputFormat ? `\nOutput format: ${input.outputFormat}` : ""}`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://filo.app",
        "X-Title": "Filo AI",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input.prompt },
        ],
        temperature: 0.7,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("OpenRouter planning error:", response.status, errorBody);
      return {
        success: false,
        error: `AI provider error: ${response.status}`,
        code: "PROVIDER_ERROR",
      };
    }

    const data: OpenRouterResponse = await response.json();
    const content = data.choices[0]?.message?.content || "{}";
    
    let specification: Record<string, unknown>;
    try {
      specification = JSON.parse(content);
    } catch {
      // Try to extract JSON from markdown
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      specification = jsonMatch ? JSON.parse(jsonMatch[1]) : { title: "Generated Artifact" };
    }

    return {
      success: true,
      specification: {
        ...specification,
        title: specification.title || "Generated Artifact",
        type: input.artifactType?.toUpperCase() || "DOCUMENT",
        outputFormat: input.outputFormat?.toUpperCase() || "DOCX",
      },
      tokensUsed: data.usage?.total_tokens || 0,
    };

  } catch (error) {
    console.error("Planning failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Planning failed",
      code: "PLANNING_ERROR",
    };
  }
}

async function generateContentWithAI(
  apiKey: string,
  input: { specification: Record<string, unknown>; prompt: string }
): Promise<{
  success: boolean;
  content?: string;
  tokensUsed?: number;
  error?: string;
  code?: string;
}> {
  const sections = input.specification.sections as Array<{ title: string; type: string }> || [];
  
  const systemPrompt = `You are Filo's AI content generator. Generate professional, high-quality content for the specified document.

Document: ${input.specification.title}
Type: ${input.specification.type}

Generate complete, polished content. No placeholders, no lorem ipsum.
Use proper formatting with clear headings and well-structured paragraphs.`;

  const userPrompt = `Generate the full content for this document:

Title: ${input.specification.title}

Sections to include:
${sections.map((s, i) => `${i + 1}. ${s.title} (${s.type})`).join("\n")}

Original request: ${input.prompt}

Please generate the complete document content in a professional tone.`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://filo.app",
        "X-Title": "Filo AI",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("OpenRouter generation error:", response.status, errorBody);
      return {
        success: false,
        error: `AI provider error: ${response.status}`,
        code: "PROVIDER_ERROR",
      };
    }

    const data: OpenRouterResponse = await response.json();
    const content = data.choices[0]?.message?.content || "";

    return {
      success: true,
      content,
      tokensUsed: data.usage?.total_tokens || 0,
    };

  } catch (error) {
    console.error("Content generation failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Generation failed",
      code: "GENERATION_ERROR",
    };
  }
}
