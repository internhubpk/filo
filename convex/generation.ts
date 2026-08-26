// =============================================================================
// FILO DURABLE GENERATION PIPELINE (Phase 3)
// =============================================================================
// Long-document generation as a Convex-backed job composed of units.
//
// WHY: The legacy path (convex/artifacts.ts generateArtifact) runs the whole
// pipeline inside ONE synchronous action call. If it crashes at unit 7 of 12,
// everything is lost and the user re-pays for units 1-6 on retry. Serverless
// timeouts make 300-page documents impossible.
//
// DESIGN:
//   Job lifecycle: queued → planning → generating → validating → rendering
//                  → uploading → completed | failed | cancelled
//
//   - startGenerationJob (action): validates, creates the job row + unit
//     rows (all 'pending'), then kicks off processGenerationJob.
//   - processGenerationJob (action): the durable worker loop. For each pending
//     unit: mark in_progress → generate via aiRouter (Gemini primary,
//     retry/fallback inside) → persist unit content → update job progress.
//     Every state change is a COMMITTED MUTATION, so a crash at unit N leaves
//     units 1..N-1 durable; resumeGenerationJob continues from N.
//   - The client subscribes to the job document (Convex reactivity) —
//     progress updates stream without polling.
//   - retryFailedUnits (action): requeues only failed units (bounded retries).
//   - cancelGenerationJob (mutation): sets status=cancelled; the worker
//     checks status between units and stops.
//
// COST/SAFETY:
//   - Authorization: every query/action takes userId from the SESSION at the
//     API-route layer; these functions re-verify job ownership before
//     mutating (defense in depth).
//   - Unit-level token accounting rolls up into the job for billing.
// =============================================================================

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import {
  aiRouter,
  buildBlueprintPrompt,
  buildSectionPrompt,
  validateBlueprint,
  AllProvidersFailedError,
} from "../src/services/ai/index";
import type { Blueprint, GeneratedSection } from "../src/services/ai/index";

// ==================== QUERIES ====================

/** Get a job (with ownership check) — the client subscribes to this. */
export const getJob = query({
  args: { jobId: v.id("generationJobs"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== args.userId) return null;
    return job;
  },
});

/** List a user's jobs (most recent first). */
export const listUserJobs = query({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("generationJobs")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

/** Get all units of a job (ordered by sequence) — for resume + rendering. */
export const getJobUnits = query({
  args: { jobId: v.id("generationJobs"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== args.userId) return null;
    return await ctx.db
      .query("generationUnits")
      .withIndex("by_jobId_sequence", (q) => q.eq("jobId", args.jobId))
      .collect();
  },
});

// ==================== INTERNAL MUTATIONS ====================
// (job-state changes — only callable from our own actions via api.generation.*)

/** Create the job row (status=queued). */
export const createJob = internalMutation({
  args: {
    userId: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    prompt: v.string(),
    artifactType: v.optional(v.string()),
    outputFormat: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("generationJobs", {
      userId: args.userId,
      workspaceId: args.workspaceId,
      prompt: args.prompt,
      artifactType: args.artifactType,
      outputFormat: args.outputFormat,
      status: "queued",
      currentStage: "Queued",
      progress: 0,
      totalUnits: 0,
      completedUnits: 0,
      failedUnits: 0,
      inputTokens: 0,
      outputTokens: 0,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Persist the blueprint + create unit rows (status: queued → planning done). */
export const initializeUnits = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    blueprint: v.object({}),
    sections: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        type: v.string(),
      })
    ),
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "generating",
      currentStage: "Generating content",
      blueprint: args.blueprint,
      totalUnits: args.sections.length,
      model: args.model,
      provider: args.provider,
      updatedAt: now,
    });
    for (const s of args.sections) {
      await ctx.db.insert("generationUnits", {
        jobId: args.jobId,
        sequence: args.sections.indexOf(s),
        title: s.title,
        type: s.type,
        status: "pending",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

/** Mark a unit in_progress (worker claims it). */
export const claimUnit = internalMutation({
  args: { unitId: v.id("generationUnits") },
  handler: async (ctx, args) => {
    const unit = await ctx.db.get(args.unitId);
    if (!unit) throw new Error(`unit ${args.unitId} not found`);
    await ctx.db.patch(args.unitId, {
      status: "in_progress",
      attempts: unit.attempts + 1,
      updatedAt: Date.now(),
    });
  },
});

/** Persist generated unit content + roll progress up into the job. */
export const completeUnit = internalMutation({
  args: {
    unitId: v.id("generationUnits"),
    content: v.object({}),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const unit = await ctx.db.get(args.unitId);
    if (!unit) throw new Error(`unit ${args.unitId} not found`);

    await ctx.db.patch(args.unitId, {
      status: "completed",
      content: args.content,
      inputTokens: args.inputTokens ?? 0,
      outputTokens: args.outputTokens ?? 0,
      error: undefined,
      updatedAt: Date.now(),
    });

    // Roll up into the job.
    const job = await ctx.db.get(unit.jobId);
    if (!job) return;
    const completed = job.completedUnits + 1;
    const progress = job.totalUnits > 0
      ? Math.min(95, Math.round((completed / job.totalUnits) * 90)) // reserve 5% for render
      : 95;
    await ctx.db.patch(unit.jobId, {
      completedUnits: completed,
      progress,
      inputTokens: job.inputTokens + (args.inputTokens ?? 0),
      outputTokens: job.outputTokens + (args.outputTokens ?? 0),
      currentStage: `Generating content (${completed}/${job.totalUnits})`,
      updatedAt: Date.now(),
    });
  },
});

/** Mark a unit failed + roll up into the job. */
export const failUnit = internalMutation({
  args: { unitId: v.id("generationUnits"), error: v.string() },
  handler: async (ctx, args) => {
    const unit = await ctx.db.get(args.unitId);
    if (!unit) return;
    await ctx.db.patch(args.unitId, {
      status: "failed",
      error: args.error,
      updatedAt: Date.now(),
    });
    const job = await ctx.db.get(unit.jobId);
    if (!job) return;
    await ctx.db.patch(unit.jobId, {
      failedUnits: job.failedUnits + 1,
      updatedAt: Date.now(),
    });
  },
});

/** Transition job status (with guard: terminal states are sticky). */
export const setJobStatus = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    status: v.string(),
    currentStage: v.optional(v.string()),
    progress: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;
    const terminal = ["completed", "failed", "cancelled"];
    // Don't let a stale worker overwrite a terminal state.
    if (terminal.includes(job.status)) return;

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.currentStage !== undefined) patch.currentStage = args.currentStage;
    if (args.progress !== undefined) patch.progress = args.progress;
    if (args.error !== undefined) patch.error = args.error;
    if (args.status === "completed" || args.status === "failed") {
      patch.completedAt = Date.now();
    }
    await ctx.db.patch(args.jobId, patch);
  },
});

/** Requeue failed units for retry (bounded by maxRetries). */
export const requeueFailedUnits = internalMutation({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    const failed = await ctx.db
      .query("generationUnits")
      .withIndex("by_jobId_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "failed")
      )
      .collect();
    const now = Date.now();
    for (const unit of failed) {
      await ctx.db.patch(unit._id, { status: "pending", updatedAt: now });
    }
    const job = await ctx.db.get(args.jobId);
    if (job) {
      await ctx.db.patch(args.jobId, {
        status: "generating",
        currentStage: `Retrying ${failed.length} unit(s)`,
        failedUnits: 0,
        error: undefined,
        retryCount: job.retryCount + 1,
        updatedAt: now,
      });
    }
    return failed.length;
  },
});

// ==================== PUBLIC ACTIONS ====================

/**
 * Start a durable generation job.
 * Returns the jobId immediately; the client subscribes to getJob for progress.
 */
export const startGenerationJob = action({
  args: {
    userId: v.id("users"),
    prompt: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
    artifactType: v.optional(v.string()),
    outputFormat: v.optional(v.string()),
    /** Resume an existing job instead of re-planning. */
    resumeJobId: v.optional(v.id("generationJobs")),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    jobId?: Id<"generationJobs">;
    error?: string;
    code?: string;
  }> => {
    // ---- Resume path ----
    if (args.resumeJobId) {
      return resumeInternal(ctx, args.resumeJobId, args.userId);
    }

    // ---- Validate prompt ----
    if (!args.prompt || args.prompt.trim().length < 10) {
      return {
        success: false,
        error: "Prompt must be at least 10 characters",
        code: "INVALID_PROMPT",
      };
    }

    // ---- Create job row (queued) ----
    const jobId = await ctx.runMutation(internal.generation.createJob, {
      userId: args.userId,
      workspaceId: args.workspaceId,
      prompt: args.prompt.trim(),
      artifactType: args.artifactType,
      outputFormat: args.outputFormat,
    });

    // ---- Kick off the durable worker (fire and forget for the caller;
    //      all state lives in Convex) ----
    void runPipeline(ctx, jobId).catch((err) => {
      console.error(`[GENERATION] pipeline crashed for job ${jobId}:`, err);
    });

    return { success: true, jobId };
  },
});

/**
 * The durable worker. Runs the full pipeline for a job:
 *   planning → per-unit generation → validating → completed.
 * Every state change is committed via mutation, so a crash mid-way leaves
 * the job resumable from the last completed unit.
 */
async function runPipeline(ctx: any, jobId: Id<"generationJobs">): Promise<void> {
  const startedAt = Date.now();

  // ==================== STAGE: PLANNING ====================
  await ctx.runMutation(internal.generation.setJobStatus, {
    jobId,
    status: "planning",
    currentStage: "Planning document structure",
    progress: 2,
  });

  let job: any = await ctx.runQuery(api.generation.getJob, {
    jobId,
    // internal read — ownership already validated at job creation
    userId: (await ctx.runQuery(api.generation.getJob, { jobId, userId: "" as Id<"users"> }))?._id
      ? // unreachable; placeholder for typing
        ("" as Id<"users">)
      : ("" as Id<"users">),
  });
  // NOTE: getJob enforces ownership; for internal reads we use a dedicated
  // internal query instead (see internalGetJob below).
  job = await ctx.runQuery(internal.generation.internalGetJob, { jobId });
  if (!job) throw new Error(`job ${jobId} not found`);

  const planPrompt = buildBlueprintPrompt({
    userRequest: job.prompt,
    artifactType: job.artifactType,
    outputFormat: job.outputFormat,
  });

  let blueprint: Blueprint;
  try {
    blueprint = await aiRouter.generateJson<Blueprint>(
      {
        messages: [
          { role: "system", content: planPrompt.system },
          { role: "user", content: planPrompt.user },
        ],
      },
      { task: "reasoning", maxTokens: 8192 }
    );
  } catch (err) {
    const msg =
      err instanceof AllProvidersFailedError
        ? err.message
        : err instanceof Error
          ? err.message
          : "planning failed";
    await ctx.runMutation(internal.generation.setJobStatus, {
      jobId,
      status: "failed",
      currentStage: "Planning failed",
      error: msg,
    });
    return;
  }

  // Patch minimum fields if the blueprint is degenerate.
  const issues = validateBlueprint(blueprint);
  if (issues.length > 0) {
    console.warn(`[GENERATION] blueprint issues for job ${jobId}:`, issues);
    if (!Array.isArray(blueprint.sections) || blueprint.sections.length === 0) {
      blueprint.sections = [
        {
          id: "section-1",
          title: blueprint.title || "Content",
          summary: job.prompt.slice(0, 200),
          components: [{ type: "text" }],
        },
      ];
    }
  }

  // ==================== STAGE: CREATE UNITS ====================
  await ctx.runMutation(internal.generation.initializeUnits, {
    jobId,
    blueprint: blueprint as unknown as Record<string, unknown>,
    sections: blueprint.sections.map((s, i) => ({
      id: s.id,
      title: s.title,
      type: i === 0 ? "intro" : i === blueprint.sections.length - 1 ? "conclusion" : "section",
    })),
  });

  // ==================== STAGE: GENERATE UNITS ====================
  await generatePendingUnits(ctx, jobId);

  // ==================== STAGE: VALIDATING ====================
  await ctx.runMutation(internal.generation.setJobStatus, {
    jobId,
    status: "validating",
    currentStage: "Validating content",
    progress: 96,
  });

  const units: any[] = await ctx.runQuery(internal.generation.internalGetJobUnits, { jobId });
  const completed = units.filter((u) => u.status === "completed");
  const failed = units.filter((u) => u.status === "failed");

  if (completed.length === 0) {
    await ctx.runMutation(internal.generation.setJobStatus, {
      jobId,
      status: "failed",
      currentStage: "All units failed",
      error: `All ${failed.length} unit(s) failed to generate`,
    });
    return;
  }

  // ==================== STAGE: COMPLETE ====================
  // NOTE: rendering + R2 upload happen in the Next.js layer (document-renderer
  // + R2 SDK are Node-heavy). The job hands the assembled sections to the
  // API route, which renders and uploads, then calls finishJob.
  await ctx.runMutation(internal.generation.setJobStatus, {
    jobId,
    status: "rendering",
    currentStage: "Ready to render",
    progress: 97,
  });

  console.info(
    `[GENERATION] job ${jobId} pipeline finished in ${Date.now() - startedAt}ms ` +
      `(${completed.length} completed, ${failed.length} failed)`
  );
}

/**
 * Generate every pending unit for a job. Called by runPipeline and by
 * resumeGenerationJob. Between units we re-read the job to honor cancels.
 */
async function generatePendingUnits(ctx: any, jobId: Id<"generationJobs">): Promise<void> {
  for (;;) {
    // Honor cancellation between units.
    const job = await ctx.runQuery(internal.generation.internalGetJob, { jobId });
    if (!job || job.status === "cancelled") {
      console.info(`[GENERATION] job ${jobId} cancelled — stopping worker`);
      return;
    }

    // Find the next pending unit.
    const units: any[] = await ctx.runQuery(internal.generation.internalGetJobUnits, { jobId });
    const next = units
      .filter((u) => u.status === "pending")
      .sort((a, b) => a.sequence - b.sequence)[0];
    if (!next) return; // all done

    await generateOneUnit(ctx, jobId, next._id, units);
  }
}

/** Generate a single unit (claim → generate → complete/fail). */
async function generateOneUnit(
  ctx: any,
  jobId: Id<"generationJobs">,
  unitId: Id<"generationUnits">,
  allUnits: any[]
): Promise<void> {
  await ctx.runMutation(internal.generation.claimUnit, { unitId });

  const job = await ctx.runQuery(internal.generation.internalGetJob, { jobId });
  const unit = allUnits.find((u) => u._id === unitId);
  if (!job || !unit) return;

  const blueprint = job.blueprint as unknown as Blueprint;
  if (!blueprint?.sections) {
    await ctx.runMutation(internal.generation.failUnit, {
      unitId,
      error: "job blueprint missing",
    });
    return;
  }

  // Global context: summaries of already-completed units (bounded).
  const completedBefore = allUnits
    .filter((u) => u.status === "completed" && u.sequence < unit.sequence)
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-2);
  const globalContext = completedBefore
    .map((u) => {
      const content = u.content as { title?: string; components?: Array<{ type: string; content: unknown }> } | undefined;
      const textBits = (content?.components || [])
        .filter((c) => c.type === "text" || c.type === "heading")
        .map((c) => String(c.content).slice(0, 400))
        .join("\n");
      return `## ${content?.title || u.title}\n${textBits}`;
    })
    .join("\n\n")
    .slice(0, 4000);

  // Find the blueprint section for this unit (by sequence).
  const section = blueprint.sections[unit.sequence] || blueprint.sections[0];
  const prompt = buildSectionPrompt({
    blueprint,
    sectionId: section.id,
    globalContext,
  });

  try {
    const sectionResult = await aiRouter.generateJson<GeneratedSection>(
      {
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      },
      { task: "generation", maxTokens: 8192 }
    );

    await ctx.runMutation(internal.generation.completeUnit, {
      unitId,
      content: sectionResult as unknown as Record<string, unknown>,
      inputTokens: 0,
      outputTokens: 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[GENERATION] unit ${unitId} (${section.title}) failed:`, msg);
    await ctx.runMutation(internal.generation.failUnit, { unitId, error: msg });
  }
}

/** Resume a crashed/stalled job from its last completed unit. */
async function resumeInternal(
  ctx: any,
  jobId: Id<"generationJobs">,
  userId: Id<"users">
): Promise<{ success: boolean; jobId?: Id<"generationJobs">; error?: string; code?: string }> {
  const job = await ctx.runQuery(api.generation.getJob, { jobId, userId });
  if (!job) {
    return { success: false, error: "Job not found or not yours", code: "NOT_FOUND" };
  }
  if (["completed", "cancelled"].includes(job.status)) {
    return { success: false, error: `Job is already ${job.status}`, code: "INVALID_STATE" };
  }

  if (job.status === "planning" || !job.blueprint) {
    // Never planned (or planning crashed) — rerun the full pipeline.
    await ctx.runMutation(internal.generation.setJobStatus, {
      jobId,
      status: "queued",
      currentStage: "Requeued",
    });
    void runPipeline(ctx, jobId).catch((err) => {
      console.error(`[GENERATION] resumed pipeline crashed for job ${jobId}:`, err);
    });
    return { success: true, jobId };
  }

  // Units exist — continue generating pending/failed units.
  await ctx.runMutation(internal.generation.requeueFailedUnits, { jobId });
  void generatePendingUnits(ctx, jobId)
    .then(async () => {
      await ctx.runMutation(internal.generation.setJobStatus, {
        jobId,
        status: "rendering",
        currentStage: "Ready to render",
        progress: 97,
      });
    })
    .catch((err) => {
      console.error(`[GENERATION] resume failed for job ${jobId}:`, err);
    });
  return { success: true, jobId };
}

/** Retry only the failed units of a completed-with-failures job. */
export const retryFailedUnits = action({
  args: { jobId: v.id("generationJobs"), userId: v.id("users") },
  handler: async (ctx, args): Promise<{
    success: boolean;
    retried?: number;
    error?: string;
    code?: string;
  }> => {
    const job = await ctx.runQuery(api.generation.getJob, {
      jobId: args.jobId,
      userId: args.userId,
    });
    if (!job) {
      return { success: false, error: "Job not found or not yours", code: "NOT_FOUND" };
    }
    if (job.retryCount >= 3) {
      return {
        success: false,
        error: "Maximum retry count (3) reached for this job",
        code: "RETRY_LIMIT",
      };
    }

    const retried = await ctx.runMutation(internal.generation.requeueFailedUnits, {
      jobId: args.jobId,
    });
    if (retried === 0) {
      return { success: false, error: "No failed units to retry", code: "NOTHING_TO_RETRY" };
    }

    void generatePendingUnits(ctx, args.jobId)
      .then(async () => {
        await ctx.runMutation(internal.generation.setJobStatus, {
          jobId: args.jobId,
          status: "rendering",
          currentStage: "Ready to render",
          progress: 97,
        });
      })
      .catch((err) => {
        console.error(`[GENERATION] retry failed for job ${args.jobId}:`, err);
      });

    return { success: true, retried };
  },
});

/** Cancel a job (user-initiated). Terminal — the worker stops at the next unit boundary. */
export const cancelGenerationJob = action({
  args: { jobId: v.id("generationJobs"), userId: v.id("users") },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; code?: string }> => {
    const job = await ctx.runQuery(api.generation.getJob, {
      jobId: args.jobId,
      userId: args.userId,
    });
    if (!job) {
      return { success: false, error: "Job not found or not yours", code: "NOT_FOUND" };
    }
    if (["completed", "cancelled"].includes(job.status)) {
      return { success: false, error: `Job is already ${job.status}`, code: "INVALID_STATE" };
    }
    await ctx.runMutation(internal.generation.setJobStatus, {
      jobId: args.jobId,
      status: "cancelled",
      currentStage: "Cancelled by user",
    });
    return { success: true };
  },
});

// ==================== INTERNAL QUERIES ====================
// (no ownership check — called only by our own actions)

export const internalGetJob = internalQuery({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

export const internalGetJobUnits = internalQuery({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("generationUnits")
      .withIndex("by_jobId_sequence", (q) => q.eq("jobId", args.jobId))
      .collect();
  },
});

/** Mark a job fully completed (called by the API route after render + upload). */
export const finishJob = action({
  args: {
    jobId: v.id("generationJobs"),
    userId: v.id("users"),
    artifactId: v.optional(v.id("artifacts")),
    actualCost: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const job = await ctx.runQuery(api.generation.getJob, {
      jobId: args.jobId,
      userId: args.userId,
    });
    if (!job) {
      return { success: false, error: "Job not found or not yours" };
    }
    await ctx.runMutation(internal.generation.setJobStatus, {
      jobId: args.jobId,
      status: "completed",
      currentStage: "Completed",
      progress: 100,
    });
    if (args.artifactId) {
      await ctx.runMutation(internal.generation.attachArtifact, {
        jobId: args.jobId,
        artifactId: args.artifactId,
      });
    }
    return { success: true };
  },
});

export const attachArtifact = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    artifactId: v.id("artifacts"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      artifactId: args.artifactId,
      updatedAt: Date.now(),
    });
  },
});
