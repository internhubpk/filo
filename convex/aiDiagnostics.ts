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
//   - LIVE probes (opt-in): Gemini ListModels + one 1-token generateContent
//     call; OpenRouter GET /key (validity + credits, zero token spend);
//     OpenAI reported as disabled when unconfigured
//
// Recorded per probe: HTTP status, latency, model, provider error code.
// NEVER recorded/returned: API keys, secrets, authorization headers.
// =============================================================================

import { v } from "convex/values";
import { action } from "./_generated/server";
import { aiRouter, providerHealthSnapshot } from "../src/services/ai";
import { GeminiProvider } from "../src/services/ai/gemini";
import { OpenRouterProvider } from "../src/services/ai/openrouter";
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
    /** Run network probes (Gemini 1-token call, OpenRouter /key). */
    probe: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    assertServerToken(args.serverToken);
    const doProbe = args.probe === true;

    const gemini = new GeminiProvider();
    const openrouter = new OpenRouterProvider();
    const openai = new OpenAiProvider();

    const result: Record<string, unknown> = {
      environment: "Convex",
      generatedAt: Date.now(),
      // In-isolate router health (quota cooldown / degraded) — no secrets.
      routerHealth: providerHealthSnapshot(),
      providers: [] as unknown[],
    };

    const providers: Array<Record<string, unknown>> = [];

    // ---------- GEMINI (primary) ----------
    const geminiEntry: Record<string, unknown> = {
      id: "GEMINI",
      displayName: "Google Gemini",
      configured: gemini.isConfigured(),
      defaultModel: gemini.defaultModel,
      models: gemini.availableModels,
    };
    if (gemini.isConfigured() && doProbe) {
      // (a) ListModels — proves reachability + key validity + model registry.
      const diag = await gemini.diagnose();
      geminiEntry.listModels = {
        httpStatus: diag.httpStatus,
        latencyMs: diag.latencyMs,
        availableConfiguredModels: diag.availableConfiguredModels,
        missingConfiguredModels: diag.missingConfiguredModels,
        error: diag.error,
      };
      // (b) One minimal generateContent call — proves the exact request path
      // generation uses (auth + model + format + not rate-limited/503).
      const ping = await gemini.ping();
      geminiEntry.ping = {
        ok: ping.ok,
        httpStatus: ping.httpStatus,
        latencyMs: ping.latencyMs,
        model: ping.model,
        errorCode: ping.errorCode,
        error: ping.error,
      };
    }
    providers.push(geminiEntry);

    // ---------- OPENROUTER (secondary) ----------
    const orEntry: Record<string, unknown> = {
      id: "OPENROUTER",
      displayName: "OpenRouter",
      configured: openrouter.isConfigured(),
      defaultModel: openrouter.defaultModel,
      models: openrouter.availableModels,
    };
    if (openrouter.isConfigured() && doProbe) {
      // GET /key — validity + credits without spending tokens.
      const keyInfo = await openrouter.fetchKeyInfo();
      orEntry.keyInfo = {
        valid: keyInfo.valid,
        httpStatus: keyInfo.httpStatus,
        latencyMs: keyInfo.latencyMs,
        label: keyInfo.label,
        usage: keyInfo.usage,
        limit: keyInfo.limit ?? null,
        isFreeTier: keyInfo.isFreeTier,
        error: keyInfo.error,
      };
    }
    providers.push(orEntry);

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
