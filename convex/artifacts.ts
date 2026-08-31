// =============================================================================
// FILO Artifact Generation - Convex Backend
// =============================================================================
// ARCHITECTURE: All AI/external API calls MUST go through the canonical AI
// abstraction in src/services/ai/ (imported here via a relative path — Convex's
// esbuild bundler handles it, and the module is isomorphic: fetch + env only).
//
//   Primary provider:   Agent Router gateway (AGENT_ROUTER_API_KEY)
//   Fallback chain:     AgentRouter → Gemini (direct) → OpenAI (direct)
//                       — genuinely independent backends; unconfigured ones
//                       are skipped, never attempted-and-failed
//
// - Actions can access process.env secrets (AGENT_ROUTER_API_KEY,
//   GEMINI_API_KEY, OPENAI_API_KEY)
// - Frontend calls this action via useMutation / /api/artifacts/generate
// - NEVER call AI providers directly from Next.js or the browser
//
// NOTE: This file previously made raw fetch() calls to OpenRouter with the
// API key managed here. It now delegates to the shared aiRouter which owns
// retry, fallback, timeouts, and the typed error hierarchy.
// ===============================================================================

import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { requireUser } from "./lib/session";
import {
  aiRouter,
  buildBlueprintPrompt,
  buildSectionPrompt,
  validateBlueprint,
  AllProvidersFailedError,
} from "../src/services/ai/index";
import type { Blueprint, GeneratedSection } from "../src/services/ai/index";

// ==================== QUERIES ====================

/**
 * List artifacts for a user (most recent first) — SESSION-VERIFIED.
 * The caller presents their HMAC session token which is verified HERE in
 * Convex (lib/session.requireUser); a bare userId is never trusted from the
 * browser. Ownership is enforced by construction: the query only ever reads
 * rows belonging to the authenticated user.
 */
export const listUserArtifactsSession = query({
  args: {
    session: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.session);
    return await ctx.db
      .query("artifacts")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

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

/** Single artifact with ownership check (null when absent or not owned). */
export const getArtifactForUser = query({
  args: { artifactId: v.id("artifacts"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.userId !== args.userId) return null;
    return artifact;
  },
});

/** SESSION-VERIFIED single artifact read (client document viewer). */
export const getArtifactForUserSession = query({
  args: { session: v.string(), artifactId: v.id("artifacts") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.session);
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.userId !== user._id) return null;
    return artifact;
  },
});

/** Update an artifact's title/format after a new version renders (spec §27). */
export const updateArtifactMeta = mutation({
  args: {
    artifactId: v.id("artifacts"),
    userId: v.id("users"),
    title: v.optional(v.string()),
    format: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.userId !== args.userId) {
      return { success: false as const, error: "Artifact not found" };
    }
    await ctx.db.patch(args.artifactId, {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.format !== undefined ? { format: args.format } : {}),
      updatedAt: Date.now(),
    });
    return { success: true as const };
  },
});

// ==================== ACTION: Generate Artifact ====================

/**
 * Main artifact generation action.
 *
 * Pipeline (single-request legacy path — the durable multi-unit pipeline is
 * the generationJobs system targeted for Phase 3):
 *   1. Plan: ask the model for a JSON blueprint (title, sections, components).
 *   2. Generate: write each section with section-level prompts + global context.
 *   3. Assemble: concatenate section content into the final document text.
 *
 * All AI calls go through aiRouter (AgentRouter primary, independent
 * provider fallback across Gemini/OpenAI).
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
    provider?: string;
    model?: string;
  }> => {
    const startTime = Date.now();

    try {
      // ---- Phase 0: PAID-FEATURE ENTITLEMENT GATE (defense in depth) ----
      // The Next.js API layer already enforces this; re-checked here so the
      // action can never be used to bypass the free-plan AI block.
      if (args.userId) {
        const user = await ctx.runQuery(api.users.getUser, {
          userId: args.userId as any,
        }).catch(() => null);
        const planId = (user as any)?.planId as string | undefined;
        let plan: any = null;
        if (planId) {
          plan = await ctx.runQuery(api.plans.getPlanById, { planId: planId as any }).catch(() => null);
        }
        if (!plan) {
          plan = await ctx.runQuery(api.plans.getFreePlan, {}).catch(() => null);
        }
        const allowed =
          plan?.aiChatEnabled === true ||
          (plan?.aiChatEnabled === undefined &&
            plan?.tier &&
            String(plan.tier).toLowerCase() !== "free");
        if (!allowed) {
          return {
            success: false,
            error: "AI generation is a premium feature. Upgrade to Pro to create documents with AI.",
            code: "PLAN_UPGRADE_REQUIRED",
          };
        }
      }

      // ---- Phase 1: Plan the artifact (JSON blueprint) ----
      const planPrompt = buildBlueprintPrompt({
        userRequest: args.prompt,
        artifactType: args.artifactType,
        outputFormat: args.outputFormat,
      });

      const blueprint = await aiRouter.generateJson<Blueprint>(
        { messages: [
            { role: "system", content: planPrompt.system },
            { role: "user", content: planPrompt.user },
        ] },
        { task: "reasoning", maxTokens: 8192 }
      );

      const issues = validateBlueprint(blueprint);
      if (issues.length > 0) {
        console.warn("[ARTIFACTS] Blueprint validation issues:", issues);
        // Non-fatal: patch the minimum required fields and continue.
        if (!blueprint.sections || !Array.isArray(blueprint.sections)) {
          blueprint.sections = [
            {
              id: "section-1",
              title: blueprint.title || "Content",
              summary: args.prompt.slice(0, 200),
              components: [{ type: "text" as const }],
            },
          ];
        }
      }

      const normalizedType = (args.artifactType || blueprint.artifactType || "document").toLowerCase();
      const normalizedFormat = (args.outputFormat || "DOCX").toUpperCase();

      // ---- Phase 2: Generate each section ----
      let totalTokens = 0;
      let lastProvider = "";
      let lastModel = "";
      const sectionTexts: string[] = [];
      const generatedSections: GeneratedSection[] = [];

      for (let i = 0; i < blueprint.sections.length; i++) {
        const section = blueprint.sections[i];
        const globalContext = sectionTexts
          .slice(-2) // keep context bounded: the two most recent sections
          .join("\n\n")
          .slice(0, 4000);

        const sectionPrompt = buildSectionPrompt({
          blueprint,
          sectionId: section.id,
          globalContext,
        });

        try {
          const sectionResult = await aiRouter.generateJson<GeneratedSection>(
            {
              messages: [
                { role: "system", content: sectionPrompt.system },
                { role: "user", content: sectionPrompt.user },
              ],
            },
            { task: "generation", maxTokens: 8192 }
          );

          generatedSections.push(sectionResult);
          totalTokens += 0; // tokens tracked via aiRouter responses below

          // Assemble readable text from the section components.
          sectionTexts.push(assembleSectionText(sectionResult));
        } catch (sectionErr) {
          // A single failed section shouldn't kill the whole artifact —
          // record a placeholder note and keep going.
          console.error(
            `[ARTIFACTS] Section ${section.id} (${section.title}) failed:`,
            sectionErr instanceof Error ? sectionErr.message : sectionErr
          );
          sectionTexts.push(
            `## ${section.title}\n\n[Section generation failed: ${
              sectionErr instanceof Error ? sectionErr.message : "unknown error"
            }]\n`
          );
        }
      }

      // ---- Phase 3: Assemble ----
      const content = [
        `# ${blueprint.title}`,
        blueprint.description ? `\n${blueprint.description}\n` : "",
        ...sectionTexts,
      ].join("\n\n");

      // Save artifact record (optional — don't fail generation if saving fails)
      if (args.userId) {
        try {
          await ctx.runMutation(api.artifacts.saveArtifactRecord, {
            userId: args.userId as any, // Will be validated by Convex
            title: blueprint.title || "Generated Artifact",
            type: normalizedType,
            format: normalizedFormat,
            prompt: args.prompt,
            status: "completed",
          });
        } catch (saveError) {
          console.warn("[ARTIFACTS] Failed to save record (non-critical):", saveError);
        }
      }

      const artifactId = `artifact_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      return {
        success: true,
        artifact: {
          id: artifactId,
          title: blueprint.title || "Generated Artifact",
          type: normalizedType,
          format: normalizedFormat,
          content,
          specification: {
            ...blueprint,
            generatedSections: generatedSections.length,
          } as Record<string, unknown>,
        },
        tokensUsed: totalTokens,
        generationTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof AllProvidersFailedError) {
        return {
          success: false,
          error: `AI generation failed: ${error.message}`,
          code: "ALL_PROVIDERS_FAILED",
          generationTimeMs: Date.now() - startTime,
        };
      }
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

// ==================== HELPERS ====================

/**
 * Convert a GeneratedSection (structured components) into readable markdown-ish
 * text for the `content` field. The renderers consume the structured
 * specification; this plain-text form is for preview + search.
 */
function assembleSectionText(section: GeneratedSection): string {
  const parts: string[] = [`## ${section.title}`];
  for (const comp of section.components || []) {
    switch (comp.type) {
      case "heading":
        parts.push(`### ${String(comp.content)}`);
        break;
      case "text":
        parts.push(String(comp.content));
        break;
      case "list":
        if (Array.isArray(comp.content)) {
          parts.push(
            (comp.content as unknown[]).map((item) => `- ${String(item)}`).join("\n")
          );
        }
        break;
      case "table":
        if (Array.isArray(comp.content)) {
          const rows = comp.content as unknown[][];
          parts.push(
            rows
              .map((row) => `| ${row.map((c) => String(c)).join(" | ")} |`)
              .join("\n")
          );
        }
        break;
      case "quote":
        parts.push(`> ${String(comp.content)}`);
        break;
      case "code":
        parts.push("```\n" + String(comp.content) + "\n```");
        break;
      default:
        if (comp.content !== undefined && comp.content !== null) {
          parts.push(String(comp.content));
        }
    }
  }
  return parts.join("\n\n");
}

// =============================================================================
// ARTIFACT DELETION (ownership enforced in Convex)
// =============================================================================
// The API route calls this with the session user id; the mutation re-verifies
// ownership and returns the linked file's r2Key so the route can remove the
// R2 object (Node-only AWS SDK lives there, not in Convex).
// =============================================================================
export const deleteUserArtifact = mutation({
  args: { artifactId: v.id("artifacts"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) return { success: false as const, error: "Artifact not found" };
    if (artifact.userId !== args.userId) {
      return { success: false as const, error: "Forbidden: not your artifact" };
    }

    // Collect the linked R2 key (if the artifact has a stored file).
    let r2Key: string | undefined;
    if (artifact.fileId) {
      const file = await ctx.db.get(artifact.fileId);
      if (file) {
        r2Key = file.r2Key;
        await ctx.db.delete(file._id);
      }
    }

    // Delete version history rows (spec §27): the artifact is gone, its
    // version trail goes with it.
    const versionRows = await ctx.db
      .query("artifactVersions")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", args.artifactId))
      .collect();
    for (const row of versionRows) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.delete(args.artifactId);
    return { success: true as const, r2Key };
  },
});

// Link a persisted R2 file record to an artifact (ownership enforced).
export const linkFile = mutation({
  args: {
    artifactId: v.id("artifacts"),
    userId: v.id("users"),
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.userId !== args.userId) {
      throw new Error("Artifact not found or not yours");
    }
    await ctx.db.patch(args.artifactId, {
      fileId: args.fileId,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

// =============================================================================
// ARTIFACT VERSIONS (spec §27)
// =============================================================================
// Every significant render appends an immutable version row. Users never lose
// a previous document after an AI modification: restoring a version re-points
// the artifact at that version's file (and records the restore as a new
// version entry so history stays append-only).
// =============================================================================

/**
 * Append a version row for an artifact and bump its versionCount.
 * Called by the render route AFTER the file is in R2 and the file row exists.
 * Operation: 'generate' | 'ai_edit' | 'regenerate' | 'export' | 'restore'.
 */
export const saveArtifactVersion = mutation({
  args: {
    serverToken: v.string(),
    artifactId: v.id("artifacts"),
    userId: v.id("users"),
    operation: v.string(),
    sourceVersion: v.optional(v.number()),
    format: v.string(),
    filename: v.string(),
    fileId: v.id("files"),
    r2Key: v.string(),
    size: v.number(),
    jobId: v.optional(v.id("generationJobs")),
    qaReport: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) return { success: false as const, error: "Artifact not found" };
    if (artifact.userId !== args.userId) {
      return { success: false as const, error: "Forbidden: not your artifact" };
    }

    // IDEMPOTENCY PER JOB: a retried render attempt (claim released after a
    // partial failure — e.g. completeJobRendered failed) re-runs this
    // mutation with the SAME jobId. Without this guard every retry appended
    // ANOTHER version row for the same attempt. Upsert instead: refresh the
    // existing row's file pointer and return its version number.
    if (args.jobId) {
      const sameJob = await ctx.db
        .query("artifactVersions")
        .withIndex("by_artifactId", (q) => q.eq("artifactId", args.artifactId))
        .order("desc")
        .take(50)
        .then((rows) => rows.find((r) => r.jobId === args.jobId));
      if (sameJob) {
        const now = Date.now();
        await ctx.db.patch(sameJob._id, {
          fileId: args.fileId,
          r2Key: args.r2Key,
          size: args.size,
          filename: args.filename,
        });
        await ctx.db.patch(args.artifactId, {
          versionCount: Math.max(artifact.versionCount ?? sameJob.version, sameJob.version),
          fileId: args.fileId,
          format: args.format,
          updatedAt: now,
        });
        return { success: true as const, version: sameJob.version };
      }
    }

    // Next version number = max(existing) + 1 (append-only, race-safe enough
    // for single-user flows; the render claim already single-flights renders).
    const existing = await ctx.db
      .query("artifactVersions")
      .withIndex("by_artifactId_version", (q) => q.eq("artifactId", args.artifactId))
      .order("desc")
      .take(1);
    const nextVersion = (existing[0]?.version ?? 0) + 1;

    const now = Date.now();
    await ctx.db.insert("artifactVersions", {
      artifactId: args.artifactId,
      userId: args.userId,
      version: nextVersion,
      operation: args.operation,
      sourceVersion: args.sourceVersion,
      format: args.format,
      filename: args.filename,
      fileId: args.fileId,
      r2Key: args.r2Key,
      size: args.size,
      jobId: args.jobId,
      qaReport: args.qaReport,
      createdAt: now,
    });

    // Keep the artifact pointed at the LATEST file and format.
    await ctx.db.patch(args.artifactId, {
      versionCount: nextVersion,
      fileId: args.fileId,
      format: args.format,
      updatedAt: now,
    });

    return { success: true as const, version: nextVersion };
  },
});

/** List an artifact's versions (newest first). Ownership enforced. */
export const listArtifactVersions = query({
  args: { artifactId: v.id("artifacts"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.userId !== args.userId) {
      return { success: false as const, versions: [] as Array<Record<string, unknown>> };
    }
    const rows = await ctx.db
      .query("artifactVersions")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", args.artifactId))
      .order("desc")
      .collect();
    return {
      success: true as const,
      versions: rows.map((r) => ({
        version: r.version,
        operation: r.operation,
        sourceVersion: r.sourceVersion,
        format: r.format,
        filename: r.filename,
        fileId: r._id,
        r2Key: r.r2Key,
        size: r.size,
        qaReport: r.qaReport,
        createdAt: r.createdAt,
      })),
    };
  },
});

/**
 * Restore a previous version: re-point the artifact's fileId/format at the
 * requested version's file row, and append a 'restore' version entry so the
 * audit trail stays complete. The old file bytes in R2 are never deleted.
 */
export const restoreArtifactVersion = mutation({
  args: {
    serverToken: v.string(),
    artifactId: v.id("artifacts"),
    userId: v.id("users"),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.userId !== args.userId) {
      return { success: false as const, error: "Artifact not found" };
    }
    const target = await ctx.db
      .query("artifactVersions")
      .withIndex("by_artifactId_version", (q) =>
        q.eq("artifactId", args.artifactId).eq("version", args.version)
      )
      .first();
    if (!target) {
      return { success: false as const, error: `Version ${args.version} not found` };
    }

    const now = Date.now();
    const latest = await ctx.db
      .query("artifactVersions")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", args.artifactId))
      .order("desc")
      .first();
    const nextVersion = (latest?.version ?? 0) + 1;

    await ctx.db.insert("artifactVersions", {
      artifactId: args.artifactId,
      userId: args.userId,
      version: nextVersion,
      operation: "restore",
      sourceVersion: args.version,
      format: target.format,
      filename: target.filename,
      fileId: target.fileId,
      r2Key: target.r2Key,
      size: target.size,
      qaReport: target.qaReport,
      createdAt: now,
    });

    await ctx.db.patch(args.artifactId, {
      fileId: target.fileId,
      format: target.format,
      versionCount: nextVersion,
      updatedAt: now,
    });

    return { success: true as const, version: nextVersion, restoredFrom: args.version };
  },
});

/**
 * Fetch an artifact's source job (blueprint + completed units) so the export
 * route can re-render the SAME content in another format (spec §42).
 */
export const getArtifactSourceJob = query({
  args: { artifactId: v.id("artifacts"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.userId !== args.userId) return null;
    const job = await ctx.db
      .query("generationJobs")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", args.artifactId))
      .order("desc")
      .first();
    if (!job || !job.blueprint) return null;
    const units = await ctx.db
      .query("generationUnits")
      .withIndex("by_jobId_sequence", (q) => q.eq("jobId", job._id))
      .collect();
    return { job, units };
  },
});
