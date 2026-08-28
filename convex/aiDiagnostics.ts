"use node";
// =============================================================================
// FILO AI — PROVIDER DIAGNOSTICS (Convex runtime)
// =============================================================================
// AI-repair spec §2/§3/§9/§17/§18:
//   Generation runs INSIDE Convex actions (convex/worker.ts, convex/
//   artifacts.ts) — so "is AI configured / reachable / valid" can only be
//   answered truthfully from THIS runtime, never from the browser or a
//   Vercel-only probe.
//
// What this module reports (admin-gated via FILO_SERVER_SECRET):
//   - config snapshot: which providers have keys in the Convex environment
//     (booleans only — the key VALUES never leave the server)
//   - in-isolate router health (quota cooldown / degraded state)
//   - LIVE probes (opt-in): one minimal Agent Router chat call per
//     configured model (verifies every model id against the real key) +
//     OpenAI ping when configured; OpenAI reported as disabled when
//     unconfigured
//
// Recorded per probe: HTTP status, latency, model, provider error code.
// NEVER recorded/returned: API keys, secrets, authorization headers.
// =============================================================================

import { v } from "convex/values";
import { action } from "./_generated/server";
import { aiRouter, providerHealthSnapshot } from "../src/services/ai";
import { AgentRouterModule } from "../src/services/ai/agentrouter";
import { OpenAiProvider } from "../src/services/ai/openai";

// -----------------------------------------------------------------------------
// Server token enforcement (mirrors convex/generation.ts — fail-closed)
// -----------------------------------------------------------------------------

function assertServerToken(token: unknown) {
  const secret = process.env.FILO_SERVER_SECRET;
  if (!secret) {
    throw new Error(
      "FILO_SERVER_SECRET is not configured in the Convex environment. " +
        "AI diagnostics are disabled (fail-closed)."
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

/**
 * AI provider status + (optionally) live reachability probes, executed from
 * the exact Convex runtime where generation runs.
 */
export const probeAiProviders = action({
  args: {
    serverToken: v.string(),
    /** Run network probes (Agent Router chat calls — default + per-model). */
    probe: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    assertServerToken(args.serverToken);
    const doProbe = args.probe === true;

    const agentRouter = new AgentRouterModule();
    const openai = new OpenAiProvider();

    const result: Record<string, unknown> = {
      environment: "Convex",
      generatedAt: Date.now(),
      // In-isolate router health (quota cooldown / degraded) — no secrets.
      routerHealth: providerHealthSnapshot(),
      providers: [] as unknown[],
    };

    const providers: Array<Record<string, unknown>> = [];

    // ---------- AGENT ROUTER (primary) ----------
    const agentEntry: Record<string, unknown> = {
      id: "AGENT_ROUTER",
      displayName: "Agent Router",
      configured: agentRouter.isConfigured(),
      defaultModel: agentRouter.defaultModel,
      models: agentRouter.availableModels,
    };
    if (agentRouter.isConfigured() && doProbe) {
      // Ping the DEFAULT model through the exact request path generation
      // uses (auth + model + format + not rate-limited).
      const ping = await agentRouter.ping();
      agentEntry.ping = {
        ok: ping.ok,
        httpStatus: ping.httpStatus,
        latencyMs: ping.latencyMs,
        model: ping.model,
        errorCode: ping.errorCode,
        error: ping.error,
      };
      // Verify EVERY configured model id against the real key (tiny calls,
      // ~10 tokens each) — catches retired/renamed model ids immediately.
      const perModel: unknown[] = [];
      for (const model of agentRouter.availableModels) {
        const m = await agentRouter.ping(model);
        perModel.push({
          model,
          ok: m.ok,
          httpStatus: m.httpStatus,
          latencyMs: m.latencyMs,
          errorCode: m.errorCode,
          error: m.error,
        });
      }
      agentEntry.modelProbes = perModel;
    }
    providers.push(agentEntry);

    // ---------- OPENAI (optional) ----------
    const oaiEntry: Record<string, unknown> = {
      id: "OPENAI",
      displayName: "OpenAI",
      configured: openai.isConfigured(),
      // Spec §10: unconfigured OpenAI is DISABLED, never "attempted+failed".
      enabled: openai.isConfigured(),
      status: openai.isConfigured() ? "configured" : "disabled: missing OPENAI_API_KEY",
      defaultModel: openai.defaultModel,
      models: openai.availableModels,
    };
    providers.push(oaiEntry);

    result.providers = providers;
    return result;
  },
});
