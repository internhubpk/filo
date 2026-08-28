// =============================================================================
// FILO DURABLE GENERATION PIPELINE (Convex)
// =============================================================================
// Long-document generation as a Convex-backed job composed of units, so it
// keeps running after the user closes the tab or logs out.
//
// LIFECYCLE
//   queued → planning → generating → validating → rendering
//          → completed | failed | cancelled
//
// WHO DOES WHAT
//   • enqueueJob (serverToken mutation): the ONLY entry point. Called by the
//     Next.js API after auth + quota + entitlement checks. Creates the job
//     row and SCHEDULES the worker via ctx.scheduler — scheduled functions
//     run independently of the caller, so nothing breaks when the HTTP
//     request returns (this is what makes tab-close/logout safe).
//   • worker.processJob (convex/worker.ts, "use node"): the AI phase — one
//     AI call per scheduled invocation, self-chaining via the scheduler.
//     Every state change below is a COMMITTED MUTATION, so a crash at unit N
//     leaves units 1..N-1 durable and resume can continue from N.
//   • POST /api/generation/render (Next.js): the Node-heavy render phase
//     (DOCX/PDF/XLSX/PPTX + R2 upload). Called by the worker, or by the
//     client as a fallback; idempotent.
//   • completeJobRendered (serverToken mutation): called by the render
//     endpoint — the ONLY place a job becomes "completed".
//
// CLIENT
//   The client subscribes to getJob / listUserJobs (Convex reactivity) —
//   progress updates stream live without polling, on any page.
// =============================================================================

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";

// -----------------------------------------------------------------------------
// Server token enforcement (mirrors convex/billing.ts — fail-closed)
// -----------------------------------------------------------------------------

function assertServerToken(token: unknown) {
  const secret = process.env.FILO_SERVER_SECRET;
  if (!secret) {
    throw new Error(
      "FILO_SERVER_SECRET is not configured in the Convex environment. " +
        "Generation functions are disabled (fail-closed)."
    );
  }
  if (typeof token !== "string" || token.length !== secret.length) {
    throw new Error("Unauthorized: invalid server token");
  }
  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= secret.charCodeAt(i) ^ (token as string).charCodeAt(i);
  }
  if (diff !== 0) throw new Error("Unauthorized: invalid server token");
}

export const ACTIVE_STATUSES = [
  "queued",
  "planning",
  "generating",
  "validating",
  "rendering",
] as const;

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

/** The user's active (non-terminal) job, if any — duplicate guard + resume UI. */
export const getActiveUserJob = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("generationJobs")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);
    const active = jobs.find((j) =>
      (ACTIVE_STATUSES as readonly string[]).includes(j.status)
    );
    return active ?? null;
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

/**
 * SERVER-ONLY: job + units for the render endpoint (Next.js). The caller
 * must present the shared server token (enforced here, fail-closed).
 */
export const getJobForRender = query({
  args: { serverToken: v.string(), jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const units = await ctx.db
      .query("generationUnits")
      .withIndex("by_jobId_sequence", (q) => q.eq("jobId", args.jobId))
      .collect();
    return { job, units };
  },
});

// ==================== INTERNAL MUTATIONS ====================
// (job-state changes — only callable from our own actions via internal.generation.*)

/** Create the job row (status=queued). */
export const createJob = internalMutation({
  args: {
    userId: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    prompt: v.string(),
    artifactType: v.optional(v.string()),
    outputFormat: v.optional(v.string()),
    appBaseUrl: v.optional(v.string()),
    brandConfig: v.optional(v.any()),
    attachedFileNames: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("generationJobs", {
      userId: args.userId,
      workspaceId: args.workspaceId,
      prompt: args.prompt,
      artifactType: args.artifactType,
      outputFormat: args.outputFormat,
      appBaseUrl: args.appBaseUrl,
      brandConfig: args.brandConfig,
      attachedFileNames: args.attachedFileNames,
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

/** Persist the blueprint + create unit rows. */
export const initializeUnits = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    blueprint: v.any(),
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
    const job = await ctx.db.get(args.jobId);
    if (!job || job.blueprint) return; // idempotent — never double-plan
    await ctx.db.patch(args.jobId, {
      blueprint: args.blueprint,
      totalUnits: args.sections.length,
      model: args.model,
      provider: args.provider,
      updatedAt: now,
    });
    for (let i = 0; i < args.sections.length; i++) {
      const s = args.sections[i];
      await ctx.db.insert("generationUnits", {
        jobId: args.jobId,
        sequence: i,
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

/** Put a unit back in the pending queue (transient failure / stale claim). */
export const requeueUnit = internalMutation({
  args: { unitId: v.id("generationUnits") },
  handler: async (ctx, args) => {
    const unit = await ctx.db.get(args.unitId);
    if (!unit) return;
    if (unit.status === "completed" || unit.status === "failed") return;
    await ctx.db.patch(args.unitId, {
      status: "pending",
      updatedAt: Date.now(),
    });
  },
});

/** Persist generated unit content + roll progress up into the job. */
export const completeUnit = internalMutation({
  args: {
    unitId: v.id("generationUnits"),
    content: v.any(),
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
      ? Math.min(93, Math.max(6, Math.round((completed / job.totalUnits) * 90))) // reserve for validate/render
      : 93;
    await ctx.db.patch(unit.jobId, {
      completedUnits: completed,
      progress,
      inputTokens: job.inputTokens + (args.inputTokens ?? 0),
      outputTokens: job.outputTokens + (args.outputTokens ?? 0),
      currentStage: `Writing "${unit.title}" (${completed}/${job.totalUnits})`,
      updatedAt: Date.now(),
    });
  },
});

/** Mark a unit permanently failed + roll up into the job. */
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

/**
 * Roll a job back to "queued" after a TRANSIENT AI outage during planning
 * (spec §5/§14/§23) and count the automatic retry. Deliberately patches the
 * document instead of going through setJobStatus — "queued" is a BACKWARD
 * transition by design here (the worker will re-plan from committed state;
 * nothing is duplicated because the blueprint was never written).
 * Terminal states remain sticky.
 */
export const bumpAutoRetry = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    currentStage: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return false;
    const terminal = ["completed", "failed", "cancelled"];
    if (terminal.includes(job.status)) return false;
    await ctx.db.patch(args.jobId, {
      status: "queued",
      currentStage: args.currentStage,
      error: undefined,
      autoRetries: (job.autoRetries ?? 0) + 1,
      updatedAt: Date.now(),
    });
    return true;
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
    // Only forward transitions (protects against out-of-order stale workers).
    const order = ["queued", "planning", "generating", "validating", "rendering", ...terminal];
    if (order.indexOf(args.status) < order.indexOf(job.status)) return;

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.currentStage !== undefined) patch.currentStage = args.currentStage;
    if (args.progress !== undefined) patch.progress = args.progress;
    if (args.error !== undefined) patch.error = args.error;
    else patch.error = undefined;
    if (args.status === "completed" || args.status === "failed") {
      patch.completedAt = Date.now();
    }
    await ctx.db.patch(args.jobId, patch);
  },
});

/** Enter the rendering state (records renderStartedAt for the render guard). */
export const markRendering = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    currentStage: v.optional(v.string()),
    progress: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;
    const terminal = ["completed", "failed", "cancelled"];
    if (terminal.includes(job.status)) return;
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "rendering",
      currentStage: args.currentStage ?? "Creating your file",
      progress: args.progress ?? 97,
      renderStartedAt: now,
      startedAt: job.startedAt ?? now,
      updatedAt: now,
    });
  },
});

/** Requeue failed units for retry (bounded by 3 per unit). */
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
    let requeued = 0;
    for (const unit of failed) {
      if ((unit.attempts ?? 0) >= 3) continue;
      await ctx.db.patch(unit._id, { status: "pending", updatedAt: now });
      requeued++;
    }
    const job = await ctx.db.get(args.jobId);
    if (job && requeued > 0) {
      await ctx.db.patch(args.jobId, {
        failedUnits: 0,
        error: undefined,
        retryCount: job.retryCount + 1,
        updatedAt: now,
      });
    }
    return requeued;
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

// =============================================================================
// PUBLIC SERVER API (serverToken-authenticated; called by Next.js API routes)
// =============================================================================

/**
 * Create a generation job and SCHEDULE the worker. Returns immediately —
 * the pipeline runs in Convex regardless of what the user's browser does.
 * Auth: FILO_SERVER_SECRET (the Next.js server; never the browser).
 */
export const enqueueJob = mutation({
  args: {
    serverToken: v.string(),
    userId: v.id("users"),
    prompt: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
    artifactType: v.optional(v.string()),
    outputFormat: v.optional(v.string()),
    appBaseUrl: v.optional(v.string()),
    brandConfig: v.optional(v.any()),
    attachedFileNames: v.optional(v.array(v.string())),
    // Fallback AI keys (from the Next.js env) for deployments where the
    // keys are not yet set on Convex. Never persisted to the database —
    // forwarded only to the scheduled worker invocation.
    aiKeys: v.optional(
      v.object({
        agentRouter: v.optional(v.string()),
        gemini: v.optional(v.string()),
        openai: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);

    if (!args.prompt || args.prompt.trim().length < 10) {
      return { success: false as const, error: "Prompt must be at least 10 characters", code: "INVALID_PROMPT" };
    }

    // ---- Defense in depth: paid-feature entitlement re-checked in Convex
    // (the Next.js layer already enforced this; never trust one layer). ----
    {
      const user = await ctx.db.get(args.userId);
      if (!user) {
        return { success: false as const, error: "Account not found", code: "ACCOUNT_NOT_FOUND" };
      }
      if (user.status === "suspended") {
        return { success: false as const, error: "Account suspended", code: "ACCOUNT_SUSPENDED" };
      }
      let plan: { aiChatEnabled?: boolean; tier?: string } | null = null;
      if (user.planId) {
        plan = await ctx.db.get(user.planId);
      }
      if (!plan) {
        plan = await ctx.db
          .query("plans")
          .withIndex("by_tier", (q) => q.eq("tier", "free"))
          .first();
      }
      const allowed =
        plan?.aiChatEnabled === true ||
        (plan?.aiChatEnabled === undefined &&
          !!plan?.tier &&
          String(plan.tier).toLowerCase() !== "free");
      if (!allowed) {
        return {
          success: false as const,
          error: "AI generation is a premium feature. Upgrade to Pro to create documents with AI.",
          code: "PLAN_UPGRADE_REQUIRED",
        };
      }
    }

    const jobId = await ctx.runMutation(internal.generation.createJob, {
      userId: args.userId,
      workspaceId: args.workspaceId,
      prompt: args.prompt.trim(),
      artifactType: args.artifactType,
      outputFormat: args.outputFormat,
      appBaseUrl: args.appBaseUrl,
      brandConfig: args.brandConfig,
      attachedFileNames: args.attachedFileNames,
    });

    await ctx.scheduler.runAfter(0, internal.worker.processJob, {
      jobId,
      aiKeys: args.aiKeys,
    });

    return { success: true as const, jobId };
  },
});

/**
 * Cancel a job. Auth: serverToken + userId (the API route derives userId
 * from the validated session; ownership is enforced here).
 */
export const cancelUserJob = mutation({
  args: {
    serverToken: v.string(),
    jobId: v.id("generationJobs"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== args.userId) {
      return { success: false as const, error: "Job not found", code: "NOT_FOUND" };
    }
    if (["completed", "cancelled"].includes(job.status)) {
      return { success: false as const, error: `Job is already ${job.status}`, code: "INVALID_STATE" };
    }
    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      currentStage: "Cancelled",
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { success: true as const };
  },
});

/**
 * Retry a failed job: requeues failed units (if any) and reschedules the
 * worker. Also recovers jobs stuck in planning/generating/rendering.
 */
export const resumeUserJob = mutation({
  args: {
    serverToken: v.string(),
    jobId: v.id("generationJobs"),
    userId: v.id("users"),
    aiKeys: v.optional(
      v.object({
        agentRouter: v.optional(v.string()),
        gemini: v.optional(v.string()),
        openai: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== args.userId) {
      return { success: false as const, error: "Job not found", code: "NOT_FOUND" };
    }
    if (job.status === "completed") {
      return { success: false as const, error: "Job is already completed", code: "INVALID_STATE" };
    }
    if (job.status === "cancelled") {
      return { success: false as const, error: "Cancelled jobs cannot be resumed — start a new one", code: "INVALID_STATE" };
    }
    if (job.retryCount >= 5) {
      return { success: false as const, error: "Maximum retry attempts reached for this job", code: "RETRY_LIMIT" };
    }

    if (job.status === "rendering") {
      // Render phase — re-enter rendering so the worker/client triggers the
      // idempotent render endpoint again.
      await ctx.db.patch(args.jobId, {
        renderStartedAt: undefined,
        error: undefined,
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.worker.processJob, {
        jobId: args.jobId,
        aiKeys: args.aiKeys,
      });
      return { success: true as const, jobId: args.jobId };
    }

    if (job.blueprint) {
      const requeued = await ctx.runMutation(internal.generation.requeueFailedUnits, {
        jobId: args.jobId,
      });
      await ctx.db.patch(args.jobId, {
        status: "generating",
        currentStage: requeued > 0 ? `Retrying ${requeued} section(s)` : "Resuming generation",
        completedAt: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(args.jobId, {
        status: "queued",
        currentStage: "Requeued",
        completedAt: undefined,
        updatedAt: Date.now(),
      });
    }

    await ctx.scheduler.runAfter(0, internal.worker.processJob, {
      jobId: args.jobId,
      aiKeys: args.aiKeys,
    });
    return { success: true as const, jobId: args.jobId };
  },
});

/**
 * Idempotent render claim. The render endpoint (worker AND client may call
 * it) claims the right to render; only one render runs at a time per job.
 * A claim older than 100s is considered abandoned and may be re-claimed.
 */
export const claimRender = mutation({
  args: { serverToken: v.string(), jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const job = await ctx.db.get(args.jobId);
    if (!job) return { claimed: false as const, reason: "NOT_FOUND" as const };
    if (job.status === "completed") return { claimed: false as const, reason: "COMPLETED" as const };
    if (job.status === "cancelled") return { claimed: false as const, reason: "CANCELLED" as const };
    if (job.status !== "rendering") return { claimed: false as const, reason: "NOT_RENDERING" as const };
    const now = Date.now();
    if (job.renderStartedAt && now - job.renderStartedAt < 100_000) {
      return { claimed: false as const, reason: "IN_FLIGHT" as const };
    }
    await ctx.db.patch(args.jobId, { renderStartedAt: now, updatedAt: now });
    return { claimed: true as const };
  },
});

/** Release an abandoned render claim (keeps the job in "rendering"). */
export const releaseRenderClaim = mutation({
  args: {
    serverToken: v.string(),
    jobId: v.id("generationJobs"),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "rendering") return { success: false as const };
    await ctx.db.patch(args.jobId, {
      renderStartedAt: undefined,
      error: args.error ?? undefined,
      updatedAt: Date.now(),
    });
    return { success: true as const };
  },
});

/**
 * Called by POST /api/generation/render after the file has been rendered,
 * uploaded to R2 and the artifact record created. The ONLY path that marks
 * a job completed, and the only place usage is recorded for job jobs.
 */
export const completeJobRendered = mutation({
  args: {
    serverToken: v.string(),
    jobId: v.id("generationJobs"),
    artifactId: v.id("artifacts"),
    fileName: v.optional(v.string()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const job = await ctx.db.get(args.jobId);
    if (!job) return { success: false as const, error: "Job not found" };
    if (job.status === "completed") return { success: true as const, alreadyCompleted: true };

    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "completed",
      currentStage: "Completed",
      progress: 100,
      artifactId: args.artifactId,
      error: undefined,
      completedAt: now,
      updatedAt: now,
    });

    // Record usage exactly once per successful job (idempotency: this
    // mutation returns early above when already completed).
    await ctx.runMutation(api.subscriptions.recordAIGeneration, {
      serverToken: args.serverToken,
      userId: job.userId,
    }).catch(() => {});

    return { success: true as const };
  },
});

/**
 * Called by the render endpoint when rendering fails irreparably (bad
 * blueprint etc.). The job can be retried by the user via resumeUserJob.
 */
export const failJobFromRender = mutation({
  args: {
    serverToken: v.string(),
    jobId: v.id("generationJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const job = await ctx.db.get(args.jobId);
    if (!job) return { success: false as const, error: "Job not found" };
    if (["completed", "cancelled"].includes(job.status)) {
      return { success: false as const, error: `Job is already ${job.status}` };
    }
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "failed",
      currentStage: "File creation failed",
      error: args.error,
      completedAt: now,
      updatedAt: now,
    });
    return { success: true as const };
  },
});
