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
import {
  buildDesignerSystemPrompt,
  buildDesignerUserPrompt,
  parseDesignPlan,
  applyDesignPlan,
  describeDesignPlan,
  buildGenerationBrief,
  type DesignPlan,
  type GenerationBrief,
} from "../src/services/design-planning";

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
      // ---------- PHASE 1: TWO-STAGE PLANNING (spec §8) ----------
      // Stage A — AI DESIGNER: decides audience, tone, theme, density and
      //   visual priority. Strictly validated against the closed theme
      //   registry (themes.ts); a bad/unusable designer response falls back
      //   to a safe format-appropriate default instead of failing the job.
      // Stage B — AI ARCHITECT: builds the section blueprint UNDER the
      //   designer's constraints (never invents its own visual direction).
      if (!job.blueprint) {
        await ctx.runMutation(internal.generation.setJobStatus, {
          jobId,
          status: "planning",
          currentStage: "Planning document design",
          progress: 2,
        });

        const artifactType = (job.artifactType || "document").toUpperCase();
        const outputFormat = normalizeFormat(job.outputFormat, artifactType);

        // ----- Stage A: designer -----
        const designPlan = await designStage(job, outputFormat);
        const { design } = applyDesignPlan(designPlan, outputFormat);
        const designDirection = describeDesignPlan(designPlan);
        // Full brief = design direction + resolved DOCUMENT SCALE (page/
        // word budgets, section bounds, visual cadence). The scale honors
        // explicit user evidence ("100 pages notes") over the designer's
        // opinion — see doc-scale.ts.
        const brief: GenerationBrief = buildGenerationBrief(designPlan, job.prompt);
        const scale = brief.scale;
        console.log(
          `[WORKER] job ${jobId}: scale=${scale.depth} pages≈${scale.pageTarget} sections=${scale.minSections}-${scale.maxSections} words/unit=${scale.wordsPerUnitMin}-${scale.wordsPerUnitMax} (${scale.rationale})`
        );

        // ----- Stage B: architect -----
        const planPrompt = buildPlanningSystemPrompt(artifactType, outputFormat, {
          theme: designPlan.theme,
          audience: designPlan.audience,
          tone: designPlan.tone,
          density: designPlan.density,
          visualPriority: designPlan.visualPriority,
          useCharts: designPlan.useCharts,
          useTables: designPlan.useTables,
          useMetrics: designPlan.useMetrics,
        }, scale);

        // 8192 (was 4096): Gemini 3.x thinking consumes the SAME
        // maxOutputTokens budget, so a 4096 cap truncated large PPTX/XLSX
        // blueprints mid-JSON → "Failed to parse AI planning response" →
        // an otherwise-successful job died before rendering.
        const PLAN_MAX_TOKENS = 8192;
        // ONE planning retry on a malformed blueprint: a fresh sample (or a
        // different model after provider rotation) resolves a transient
        // malformed-JSON response. Failing a paid job while every downstream
        // stage is still recoverable is the worst possible outcome.
        let blueprint: ReturnType<typeof parsePlanResponse> | null = null;
        let lastPlanError: unknown = null;
        for (let planAttempt = 1; planAttempt <= 2 && !blueprint; planAttempt++) {
          const planResponse = await aiRouter.generate(
            {
              messages: [
                { role: "system", content: planPrompt },
                {
                  role: "user",
                  content:
                    planUserPrompt(job) +
                    (planAttempt > 1
                      ? "\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with EXACTLY ONE raw JSON object and nothing else — no prose, no markdown fences, no trailing text."
                      : ""),
                },
              ],
              options: {
                temperature: planAttempt > 1 ? 0.3 : 0.7,
                // Long-document blueprints (20-30 sections with visuals +
                // notes) need real headroom — 4096 truncated exhaustive
                // plans mid-JSON.
                maxTokens: PLAN_MAX_TOKENS,
                responseFormat: { type: "json" as const },
              },
            },
            { task: "reasoning" }
          );
          try {
            blueprint = parsePlanResponse(
              planResponse.content || "{}",
              artifactType,
              outputFormat,
              {
                design,
                scale,
                // Mechanically enforce the designer's chart decision —
                // previously only prompt prose, so the cadence pass kept
                // injecting decorative charts anyway.
                useCharts: designPlan.useCharts,
              }
            );
          } catch (parseErr) {
            lastPlanError = parseErr;
            console.warn(
              `[WORKER] job ${jobId}: planning parse failed (attempt ${planAttempt}/2): ${
                parseErr instanceof Error ? parseErr.message.slice(0, 220) : String(parseErr)
              }`
            );
          }
        }
        if (!blueprint) {
          throw lastPlanError instanceof Error
            ? lastPlanError
            : new Error("Failed to parse AI planning response after 2 attempts");
        }

        await ctx.runMutation(internal.generation.initializeUnits, {
          jobId,
          blueprint: blueprint as unknown as Record<string, unknown>,
          designPlan: { ...designPlan, scale } as unknown as Record<string, unknown>,
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
 * POST the app's render endpoint. On success the endpoint completes the job.
 *
 * Response handling matters here: the endpoint is idempotent and can answer
 * 200 without actually rendering (claim bounced as IN_FLIGHT, job already
 * completed by another caller, etc.). Treating every 200 as "done" used to
 * silently end the server-side chain and leave the job hanging at 97%
 * "Creating your file" forever — the browser fallback was the only remaining
 * trigger, and it never runs when the tab is closed. Now:
 *   • completed/alreadyCompleted → done;
 *   • 200 but still "rendering" (claim not ours) → schedule a renderRetry so
 *     the SERVER-side chain keeps driving toward completion;
 *   • HTTP/network failure → schedule a renderRetry (as before).
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
  //
  // Exception: self-hosted / local Convex backends (and CI) CAN reach a
  // localhost app origin. Setting FILO_ALLOW_LOCAL_RENDER_ORIGIN=1 in the
  // Convex environment opts in to server-to-server rendering for private
  // origins, so the server-side chain works without a browser.
  const allowLocalOrigin = process.env.FILO_ALLOW_LOCAL_RENDER_ORIGIN === "1";
  if (
    base &&
    !allowLocalOrigin &&
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
    const bodyText = await res.text().catch(() => "");
    if (res.ok) {
      // The endpoint completes/fails the job authoritatively — but a 200 does
      // NOT guarantee a render happened (idempotent/claim semantics). Re-read
      // the job: if it is STILL "rendering", drive the retry chain ourselves
      // instead of waiting on a browser that may never come.
      const after = await ctx.runQuery(internal.generation.internalGetJob, { jobId });
      if (after && after.status === "rendering") {
        console.warn(
          `[WORKER] job ${jobId}: render endpoint answered 200 but job is still rendering (body: ${bodyText.slice(0, 120)}) — scheduling render retry`
        );
        await scheduleRenderRetry(ctx, jobId, retryAttempt + 1);
      }
      return;
    }
    console.error(
      `[WORKER] render endpoint ${res.status} for job ${jobId}: ${bodyText.slice(0, 300)}`
    );

    // The endpoint returns a structured body for known failures:
    //   { success:false, error, code, kind, retryable, s3ErrorName, detail }
    // HONOR the `retryable` contract: a deterministic failure (broken
    // credentials, request the storage API will always refuse) retried on
    // backoff fails identically forever — that exact loop previously stalled
    // every such job at 97% ("Creating your file") with no resolution. Fail
    // the job NOW with the actionable reason instead.
    let errBody: {
      error?: string;
      code?: string;
      detail?: string;
      retryable?: boolean;
    } | null = null;
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && typeof parsed === "object") errBody = parsed;
    } catch {
      // non-JSON body (proxy error page, empty body) → default retry path
    }

    if (errBody && errBody.retryable === false && res.status !== 429) {
      const reason =
        errBody.error ||
        errBody.detail ||
        errBody.code ||
        `render endpoint HTTP ${res.status} (non-retryable)`;
      await ctx.runMutation(internal.generation.failJobFromRender, {
        serverToken,
        jobId,
        error: `File creation failed permanently: ${String(reason).slice(0, 350)}`,
      });
      return;
    }

    throw new Error(`render endpoint HTTP ${res.status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WORKER] render call failed for job ${jobId}:`, msg);
    await scheduleRenderRetry(ctx, jobId, retryAttempt + 1);
  }
}

/**
 * Schedule a delayed renderRetry. After the retry budget is exhausted the
 * job FAILS with a clear, actionable error instead of hanging at 97% forever
 * — an honest, retryable failure (resumeUserJob can re-enter rendering)
 * always beats an eternal silent stall.
 */
async function scheduleRenderRetry(ctx: any, jobId: string, nextAttempt: number) {
  if (nextAttempt > 5) {
    const job = await ctx.runQuery(internal.generation.internalGetJob, { jobId });
    if (job && job.status === "rendering") {
      const lastErr =
        typeof job.error === "string" && job.error.trim()
          ? job.error
          : "the file could not be rendered or uploaded";
      await ctx.runMutation(internal.generation.failJobFromRender, {
        jobId,
        error: `File creation did not complete after 5 automatic attempts: ${lastErr}`.slice(0, 400),
      });
    }
    return;
  }
  const delaySec = Math.min(30 * nextAttempt, 120);
  await ctx.scheduler.runAfter(delaySec * 1000, internal.worker.renderRetry, {
    jobId,
    attempt: nextAttempt,
  });
}

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
    applyAiKeys(args.aiKeys as AiKeys | undefined);
    await callRenderEndpoint(ctx, args.jobId, args.attempt);
  },
});

// ==================== HELPERS ====================

/**
 * STAGE A — the AI designer call (spec §8). Never fails the job: any error
 * (provider outage, malformed JSON) degrades to the format-appropriate
 * default design plan so generation can proceed.
 */
async function designStage(
  job: { prompt: string; sourceContext?: string | null; artifactType?: string | null },
  outputFormat: DocumentFormat
): Promise<DesignPlan> {
  try {
    const sourceSummary = job.sourceContext
      ? job.sourceContext.slice(0, 2000)
      : null;
    const { system, user } = {
      system: buildDesignerSystemPrompt(outputFormat),
      user: buildDesignerUserPrompt(job.prompt, outputFormat, sourceSummary),
    };
    const response = await aiRouter.generate(
      {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        options: {
          temperature: 0.4,
          maxTokens: 1200,
          responseFormat: { type: "json" as const },
        },
      },
      { task: "reasoning" }
    );
    return parseDesignPlan(response.content || "{}", job.prompt, outputFormat);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[WORKER] designer stage failed — using safe default design: ${msg.slice(0, 200)}`
    );
    // Deterministic, validated fallback (spec §36: repair/retry → here,
    // degrade gracefully rather than failing a paid job on an optional stage).
    return parseDesignPlan("{}", job.prompt, outputFormat);
  }
}

/**
 * The architect prompt body: the user request plus extracted file context so
 * plans can be grounded in attached source material (spec §21/§26).
 */
function planUserPrompt(job: { prompt: string; sourceContext?: string | null; sourceArtifactId?: string | null }): string {
  const context = job.sourceContext?.trim();
  const editPreamble = job.sourceArtifactId
    ? "EDIT REQUEST — the source material below is the user's EXISTING document. Plan must REUSE its structure and headings (updated titles are allowed), carry its real content forward, and apply this edit instruction. Do not plan a different document.\n\n"
    : "";
  if (context) {
    return (
      editPreamble +
      `${job.prompt}\n\nSOURCE MATERIAL EXTRACTED FROM THE USER'S ATTACHED FILES ` +
      `(the plan MUST be grounded in this content; reuse its structure, facts ` +
      `and figures where relevant):\n${context.slice(0, 20000)}`
    );
  }
  return editPreamble + job.prompt;
}

/** Human-readable design direction from the job's persisted designPlan. */
function designDirectionFor(job: { designPlan?: unknown }): string | null {
  const plan = job.designPlan as
    | { theme?: string; audience?: string; tone?: string; density?: string }
    | null
    | undefined;
  if (!plan || typeof plan !== "object") return null;
  return describeDesignPlan(parseDesignPlan(JSON.stringify(plan), "", "DOCX"));
}

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
      level?: string;
      number?: string;
      visuals?: Array<{ kind: 'chart' | 'table' | 'diagram' | 'metrics' | 'timeline' | 'two_column'; hint?: string }>;
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

  // Resolved document scale (persisted on the job's designPlan at planning
  // time). Drives the per-unit word budget for EVERY unit of the document.
  const scale = (job.designPlan as { scale?: { wordsPerUnitMin?: number; wordsPerUnitMax?: number; depth?: string } } | null | undefined)?.scale;
  const wordTarget =
    scale && scale.wordsPerUnitMin && scale.wordsPerUnitMax
      ? { min: scale.wordsPerUnitMin, max: scale.wordsPerUnitMax }
      : null;

  // Document-wide continuity: titles of ALL completed units + the opening
  // text of the two nearest predecessors. The previous "last two sections,
  // 4000 chars" window let chapter 18 of a long document drift into
  // repeating chapter 3; a full title map costs ~30 tokens per 20 units and
  // keeps the whole outline in view.
  const completedBefore = allUnits
    .filter((u) => u.status === "completed" && u.sequence < unit.sequence)
    .sort((a, b) => a.sequence - b.sequence);
  const titleMap = completedBefore
    .map((u) => `- ${u.title}`)
    .join("\n")
    .slice(0, 2400);
  const nearestText = completedBefore
    .slice(-2)
    .map((u) => {
      const content = u.content as
        | { components?: Array<{ type?: string; content?: unknown }> }
        | undefined;
      const bits = (content?.components || [])
        .filter((c) => c.type === "PARAGRAPH" || c.type === "HEADING")
        .map((c) => String(c.content ?? "").slice(0, 300))
        .join("\n");
      return `${u.title}\n${bits}`;
    })
    .join("\n\n")
    .slice(0, 2600);
  const globalContext = [
    titleMap ? `Sections already written (DO NOT repeat their content):\n${titleMap}` : "",
    nearestText ? `The two sections immediately before this one (continue smoothly from them):\n${nearestText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 5200);

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
    // Ground content in attached-file context + the designer's direction
    // (spec §8/§21/§26).
    sourceContext: typeof job.sourceContext === "string" ? job.sourceContext : null,
    designDirection:
      typeof designDirectionFor(job) === "string" ? designDirectionFor(job) : undefined,
    // Scale-driven depth: numbering, level, word budget, mandatory visuals.
    sectionNumber: section.number || null,
    sectionLevel: section.level || "chapter",
    wordTarget,
    visuals: section.visuals ?? [],
    // EDIT MODE: jobs that reference an existing artifact preserve and revise
    // it instead of writing a from-scratch replacement.
    isEdit: Boolean(job.sourceArtifactId),
    editInstruction: job.sourceArtifactId ? job.prompt : null,
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
          // Word-budgeted units (up to ~1100 words + tables/charts JSON)
          // need more headroom than the old 4096 — truncation here produced
          // thin sections and cut-off chart JSON.
          maxTokens: 8192,
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
