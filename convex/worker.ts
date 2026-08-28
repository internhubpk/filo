"use node";
// =============================================================================
// FILO DURABLE GENERATION WORKER (Convex Node action)
// =============================================================================
// Runs the AI-heavy part of background document generation INSIDE Convex, so
// generation keeps running after the user closes the tab, logs out, or their
// laptop sleeps. Nothing runs on Vercel for the long AI phase anymore — which
// permanently fixes the 504 on /api/artifacts/agent-generate.
//
// WHY "use node":
//   The AI layer (src/services/ai) uses fetch + setTimeout + AbortController.
//   Convex's default V8 isolate has no timers; Node actions do.
//
// WHY SELF-CHAINING (one AI call per invocation):
//   Convex action invocations have a bounded timeout (default 1 minute,
//   dashboard-configurable). Instead of one long-running action, this worker
//   processes EXACTLY ONE unit of work per invocation (plan one document, or
//   generate one section) and then schedules the next invocation via
//   ctx.scheduler.runAfter(0, ...). Benefits:
//     • never trips the action timeout
//     • every step is a committed mutation → crash-resumable
//     • cancellation is honored at every step boundary
//
// FLOW (see also convex/generation.ts):
//   enqueueJob (mutation) ─schedules─▶ processJob ─┐
//     processJob: no blueprint?  → plan (1 AI call) → schedule processJob
//                 pending unit?   → generate (1 AI call) → schedule processJob
//                 units done?     → validating → rendering → POST
//                                   {appBaseUrl}/api/generation/render
//                                   (Node render + R2 upload + artifact save)
//                 render POST failed? → renderRetry (backoff, 5 attempts)
//   The CLIENT also re-triggers /api/generation/render when it sees a job
//   stuck in "rendering" — the endpoint is idempotent, so double triggers
//   are harmless.
//
// SECRETS:
//   • FILO_SERVER_SECRET is read from the Convex environment (already
//     required by billing).
//   • AI keys are read from the Convex environment when set (`npx convex
//     env set AGENT_ROUTER_API_KEY …`, GEMINI_API_KEY, OPENAI_API_KEY —
//     recommended). As a fallback the Next.js enqueue route passes the
//     server's own keys as scheduler args (aiKeys); they are applied to
//     process.env for this invocation only and never written to the
//     database.
// ===============================================================================

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  aiRouter,
  AllProvidersFailedError,
  userSafeAiMessage,
} from "../src/services/ai";
import {
  buildPlanningSystemPrompt,
  buildSectionContentPrompt,
  parsePlanResponse,
  normalizeComponentType,
  type DocumentFormat,
} from "../src/services/artifact-planning";

// ==================== TYPES ====================

interface AiKeys {
  agentRouter?: string;
  gemini?: string;
  openai?: string;
}

// ==================== ENTRY POINT ====================

/**
 * The self-chaining worker. Processes ONE unit of work per invocation.
 * Scheduled by enqueueJob (initially) and by itself (to continue).
 */
export const processJob = internalAction({
  args: {
    jobId: v.id("generationJobs"),
    aiKeys: v.optional(
      v.object({
        agentRouter: v.optional(v.string()),
        gemini: v.optional(v.string()),
        openai: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const jobId = args.jobId;
    applyAiKeys(args.aiKeys);

    const job = await ctx.runQuery(internal.generation.internalGetJob, {
      jobId: args.jobId,
    });
    if (!job) return;
    if (["completed", "failed", "cancelled"].includes(job.status)) return;

    try {
      // ---------- PHASE 1: PLANNING ----------
      if (!job.blueprint) {
        await ctx.runMutation(internal.generation.setJobStatus, {
          jobId,
          status: "planning",
          currentStage: "Planning document structure",
          progress: 2,
        });

        const artifactType = (job.artifactType || "document").toUpperCase();
        const outputFormat = normalizeFormat(job.outputFormat, artifactType);

        const planPrompt = buildPlanningSystemPrompt(artifactType, outputFormat);
        const planResponse = await aiRouter.generate(
          {
            messages: [
              { role: "system", content: planPrompt },
              { role: "user", content: job.prompt },
            ],
            options: {
              temperature: 0.7,
              maxTokens: 4096,
              responseFormat: { type: "json" as const },
            },
          },
          { task: "reasoning" }
        );

        const blueprint = parsePlanResponse(
          planResponse.content || "{}",
          artifactType,
          outputFormat
        );

        await ctx.runMutation(internal.generation.initializeUnits, {
          jobId,
          blueprint: blueprint as unknown as Record<string, unknown>,
          sections: blueprint.sections.map((s, i) => ({
            id: s.id,
            title: s.title,
            type:
              i === 0
                ? "intro"
                : i === blueprint.sections.length - 1
                  ? "conclusion"
                  : "section",
          })),
        });

        // Plan done — chain to the first unit.
        await ctx.runMutation(internal.generation.setJobStatus, {
          jobId,
          status: "generating",
          currentStage: "Generating content (0/" + blueprint.sections.length + ")",
          progress: 5,
        });
        await scheduleNext(ctx, jobId, args.aiKeys);
        return;
      }

      // ---------- PHASE 2: SECTION GENERATION ----------
      const units: Array<Record<string, any>> = await ctx.runQuery(
        internal.generation.internalGetJobUnits,
        { jobId }
      );
      const now = Date.now();
      const STALE_MS = 3.5 * 60 * 1000;

      // Recover units stuck in_progress (e.g. their invocation hit the
      // action timeout). Only units with attempts left are requeued.
      const stale = units.filter(
        (u) =>
          u.status === "in_progress" &&
          now - (u.updatedAt ?? 0) > STALE_MS &&
          (u.attempts ?? 0) < 3
      );
      for (const u of stale) {
        await ctx.runMutation(internal.generation.requeueUnit, {
          unitId: u._id,
        });
      }

      const pending = units
        .filter((u) => u.status === "pending" || stale.includes(u))
        .sort((a, b) => a.sequence - b.sequence);

      if (pending.length > 0) {
        const transientRequeue = await generateOneUnit(
          ctx,
          jobId,
          pending[0],
          units,
          args.aiKeys
        );
        // A unit requeued after a TRANSIENT AI failure retries on a delay
        // (45s) instead of instantly — 503 "high demand" spikes usually
        // clear in minutes, and instant re-loops just burn the 3 unit
        // attempts within seconds (spec §5/§23).
        await scheduleNext(ctx, jobId, args.aiKeys, transientRequeue ? 45_000 : 0);
        return;
      }

      // Any fresh in_progress units? Another invocation owns them — stop
      // here (it will chain onward when its unit completes).
      const freshInProgress = units.some(
        (u) =>
          u.status === "in_progress" && now - (u.updatedAt ?? 0) <= STALE_MS
      );
      if (freshInProgress) return;

      // ---------- PHASE 3: FINALIZE ----------
      const completedUnits = units.filter((u) => u.status === "completed");
      if (completedUnits.length === 0) {
        await ctx.runMutation(internal.generation.setJobStatus, {
          jobId,
          status: "failed",
          currentStage: "All sections failed",
          error: `All ${units.length} section(s) failed to generate. You can retry.`,
        });
        return;
      }

      await ctx.runMutation(internal.generation.setJobStatus, {
        jobId,
        status: "validating",
        currentStage: "Validating content",
        progress: 95,
      });
      await ctx.runMutation(internal.generation.markRendering, {
        jobId,
        currentStage: "Creating your file",
        progress: 97,
      });

      // Hand off to the app's render endpoint (Node runtime: document
      // renderer + R2 upload + artifact persistence live there).
      await callRenderEndpoint(ctx, jobId);
      // The render endpoint completes the job. If it failed, renderRetry
      // (scheduled inside callRenderEndpoint) keeps trying with backoff, and
      // the client triggers the same idempotent endpoint as a final safety
      // net when it sees the job stuck in "rendering".
    } catch (err) {
      // Spec §16: the USER-visible job error is a clean, actionable message;
      // the full provider diagnostics stay in the Convex function logs
      // (console.error below) and are also retained for admins via the
      // /api/admin/ai/status diagnostics surface.
      const msg = err instanceof Error ? err.message : String(err);
      const userMsg = userSafeAiMessage(err);
      if (err instanceof AllProvidersFailedError) {
        console.error(
          `[WORKER] job ${jobId} provider diagnostics:`,
          JSON.stringify(err.attempts)
        );
      }
      console.error(`[WORKER] job ${jobId} failed:`, msg);

      // TRANSIENT-OUTAGE AUTO-RETRY (spec §5/§14/§23): Google's 503 "high
      // demand" spikes are explicitly temporary. If the PLANNING call failed
      // because every configured provider was transiently unavailable, roll
      // the job back to "queued" and re-invoke the worker after a backoff
      // instead of failing it outright. Guards:
      //   • planning phase only (no blueprint yet — nothing to duplicate,
      //     so paid documents can never be generated twice by this path);
      //   • bounded to 2 automatic retries (60s, then 120s);
      //   • only for retryable failure codes — auth/model/config failures
      //     are deterministic and fail fast;
      //   • terminal states stay sticky (bumpAutoRetry re-checks).
      const transientCodes = [
        "PROVIDER_UNAVAILABLE",
        "RATE_LIMITED",
        "TIMEOUT",
        "NETWORK_ERROR",
        "UNKNOWN",
      ];
      const transientOutage =
        err instanceof AllProvidersFailedError &&
        !job.blueprint &&
        (job.autoRetries ?? 0) < 2 &&
        err.attempts.some((a) => transientCodes.includes(a.code));
      if (transientOutage) {
        const attemptNo = (job.autoRetries ?? 0) + 1;
        const delayMs = attemptNo === 1 ? 60_000 : 120_000;
        const bumped = await ctx.runMutation(internal.generation.bumpAutoRetry, {
          jobId,
          currentStage: `AI providers busy — retrying automatically (${attemptNo}/2)`,
        });
        if (bumped) {
          console.warn(
            `[WORKER] job ${jobId} transient AI outage — auto-retry ${attemptNo}/2 scheduled in ${delayMs / 1000}s`
          );
          await ctx.scheduler.runAfter(delayMs, internal.worker.processJob, {
            jobId,
            aiKeys: args.aiKeys,
          });
          return;
        }
      }

      await ctx.runMutation(internal.generation.setJobStatus, {
        jobId,
        status: "failed",
        currentStage: "Generation failed",
        error: userMsg,
      });
    }
  },
});

/**
 * Delayed render retry. Only acts while the job is still "rendering"
 * (i.e. the render endpoint hasn't completed the job yet).
 */
export const renderRetry = internalAction({
  args: {
    jobId: v.id("generationJobs"),
    attempt: v.number(),
    aiKeys: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.generation.internalGetJob, {
      jobId: args.jobId,
    });
    if (!job || job.status !== "rendering") return; // done or moved on
    if (args.attempt > 5) {
      console.error(
        `[WORKER] render retry limit reached for job ${args.jobId}; leaving job for client fallback`
      );
      return;
    }
    applyAiKeys(args.aiKeys as AiKeys | undefined);
    await callRenderEndpoint(ctx, args.jobId, args.attempt);
  },
});

// ==================== HELPERS ====================

/**
 * Generate ONE section unit. Returns true when the unit was requeued due to
 * a TRANSIENT AI failure (caller then schedules the next invocation on a
 * delay instead of immediately).
 */
async function generateOneUnit(
  ctx: any,
  jobId: string,
  unit: Record<string, any>,
  allUnits: Array<Record<string, any>>,
  aiKeys?: AiKeys
): Promise<boolean> {
  await ctx.runMutation(internal.generation.claimUnit, { unitId: unit._id });

  const job = await ctx.runQuery(internal.generation.internalGetJob, { jobId });
  if (!job?.blueprint) {
    await ctx.runMutation(internal.generation.requeueUnit, { unitId: unit._id });
    return false;
  }
  // Honor cancellation claimed between scheduling and running.
  if (job.status === "cancelled") return false;

  const blueprint = job.blueprint as {
    title?: string;
    type?: string;
    outputFormat?: string;
    sections?: Array<{
      id: string;
      title: string;
      type?: string;
      components?: Array<{ data?: { note?: string } | null; type?: string }>;
    }>;
  };
  const section = blueprint.sections?.[unit.sequence] ?? blueprint.sections?.[0];
  if (!section) {
    await ctx.runMutation(internal.generation.failUnit, {
      unitId: unit._id,
      error: "blueprint section missing",
    });
    return false;
  }

  // Bounded continuity: summaries of the previous two completed units.
  const completedBefore = allUnits
    .filter((u) => u.status === "completed" && u.sequence < unit.sequence)
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-2);
  const globalContext = completedBefore
    .map((u) => {
      const content = u.content as
        | { components?: Array<{ type?: string; content?: unknown }> }
        | undefined;
      const bits = (content?.components || [])
        .filter((c) => c.type === "PARAGRAPH" || c.type === "HEADING")
        .map((c) => String(c.content ?? "").slice(0, 400))
        .join("\n");
      return `${u.title}\n${bits}`;
    })
    .join("\n\n")
    .slice(0, 4000);

  const { system, user } = buildSectionContentPrompt({
    sectionTitle: section.title,
    sectionType: section.type || "content",
    componentNotes: (section.components || []).map(
      (c) => c.data?.note || ""
    ),
    documentTitle: blueprint.title || "Document",
    documentType: blueprint.type || "DOCUMENT",
    outputFormat: blueprint.outputFormat || "DOCX",
    originalPrompt: job.prompt,
    globalContext,
  });

  try {
    const response = await aiRouter.generate(
      {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        options: {
          temperature: 0.7,
          maxTokens: 4096,
          responseFormat: { type: "json" as const },
        },
      },
      { task: "generation" }
    );

    const parsed = safeParseComponents(response.content || "{}");
    await ctx.runMutation(internal.generation.completeUnit, {
      unitId: unit._id,
      content: { components: parsed },
      inputTokens: response.usage?.promptTokens ?? 0,
      outputTokens: response.usage?.completionTokens ?? 0,
    });
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WORKER] unit ${unit._id} (${section.title}) failed:`, msg);
    if ((unit.attempts ?? 0) + 1 >= 3) {
      // Permanent failure for this unit — rendering will use placeholder
      // content for it (same behavior as the legacy synchronous pipeline).
      // The unit error is user-visible on the artifact page, so store the
      // clean message and keep the raw detail in the logs.
      await ctx.runMutation(internal.generation.failUnit, {
        unitId: unit._id,
        error: userSafeAiMessage(err),
      });
      return false;
    } else {
      // Transient — put it back in the queue (claim already bumped
      // attempts). The caller delays the next invocation so the spike can
      // clear (spec §23).
      await ctx.runMutation(internal.generation.requeueUnit, {
        unitId: unit._id,
      });
      return true;
    }
  }
}

/** Parse the section AI response into normalized render-ready components. */
function safeParseComponents(raw: string): Array<{ type: string; content: unknown }> {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) parsed = JSON.parse(m[1]);
    else parsed = { components: [{ type: "paragraph", content: raw }] };
  }
  const list = Array.isArray(parsed?.components) ? parsed.components : [];
  const normalized = list
    .filter((c: any) => c && c.content !== undefined && c.content !== null)
    .map((c: any) => ({
      type: normalizeComponentType(String(c.type || "paragraph")),
      content: c.content,
    }));
  if (normalized.length === 0) {
    return [{ type: "PARAGRAPH", content: "(empty section)" }];
  }
  return normalized;
}

async function scheduleNext(
  ctx: any,
  jobId: string,
  aiKeys?: AiKeys,
  delayMs = 0
) {
  await ctx.scheduler.runAfter(delayMs, internal.worker.processJob, {
    jobId,
    aiKeys: aiKeys ?? undefined,
  });
}

/**
 * POST the app's render endpoint. On success the endpoint completes the job.
 * On failure schedules a delayed renderRetry (up to 5 attempts).
 */
async function callRenderEndpoint(ctx: any, jobId: string, retryAttempt = 0) {
  const job = await ctx.runQuery(internal.generation.internalGetJob, { jobId });
  const base = (job?.appBaseUrl || process.env.FILO_APP_URL || "").replace(/\/+$/, "");
  const serverToken = process.env.FILO_SERVER_SECRET;

  // A Convex CLOUD worker can never reach a dev machine. If the job was
  // enqueued from localhost (or any private address), skip the pointless
  // POST + retry storm entirely — the browser fallback trigger in the UI
  // (ActiveGenerations) calls the SAME idempotent endpoint from the user's
  // machine, which is exactly what can reach it.
  if (
    base &&
    /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[a-z0-9-]+\.local)\b/i.test(
      base
    )
  ) {
    console.warn(
      `[WORKER] job ${jobId}: render origin ${base} is not reachable from Convex cloud — deferring to the browser render trigger`
    );
    return;
  }

  if (!base || !serverToken) {
    // Cannot render server-to-server right now. Leave the job in
    // "rendering": the client triggers the SAME idempotent endpoint as soon
    // as it notices (works even without FILO_APP_URL configured).
    await ctx.runMutation(internal.generation.setJobStatus, {
      jobId,
      status: "rendering",
      currentStage: "Finishing up",
      error: base ? undefined : "Render endpoint origin unknown; waiting for app trigger",
    });
    return;
  }

  try {
    const res = await fetch(`${base}/api/generation/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverToken, jobId }),
    });
    if (res.ok) {
      // The endpoint completes/fails the job authoritatively.
      return;
    }
    const bodyText = await res.text().catch(() => "");
    console.error(
      `[WORKER] render endpoint ${res.status} for job ${jobId}: ${bodyText.slice(0, 300)}`
    );
    throw new Error(`render endpoint HTTP ${res.status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WORKER] render call failed for job ${jobId}:`, msg);
    const nextAttempt = retryAttempt + 1;
    const delaySec = Math.min(60 * nextAttempt, 300);
    await ctx.scheduler.runAfter(delaySec * 1000, internal.worker.renderRetry, {
      jobId,
      attempt: nextAttempt,
    });
  }
}

function normalizeFormat(outputFormat: unknown, artifactType: string): DocumentFormat {
  const f = String(outputFormat || "").toUpperCase();
  if (["DOCX", "PDF", "XLSX", "PPTX", "CSV"].includes(f)) return f as DocumentFormat;
  if (artifactType === "PRESENTATION") return "PPTX";
  if (artifactType === "SPREADSHEET") return "XLSX";
  return "DOCX";
}

/** Apply enqueue-time AI keys to this invocation's environment (fallback
 *  when the keys are not configured on the Convex deployment itself). */
function applyAiKeys(keys?: AiKeys) {
  if (!keys) return;
  if (keys.agentRouter && !process.env.AGENT_ROUTER_API_KEY) {
    process.env.AGENT_ROUTER_API_KEY = keys.agentRouter;
  }
  if (keys.gemini && !process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = keys.gemini;
  }
  if (keys.openai && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = keys.openai;
}
