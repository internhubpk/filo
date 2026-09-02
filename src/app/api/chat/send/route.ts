// =============================================================================
// POST /api/chat/send — the unified chat + Document Mode endpoint
// =============================================================================
// THE primary flow of the rebuilt Filo experience:
//
//   mode = "chat"      → SSE stream. Persists the user message, streams the
//                        assistant reply token-by-token (strategy provider),
//                        persists the finished reply. The client renders the
//                        live stream, then the reactive transcript takes over.
//
//   mode = "document"  → JSON. Runs the SAME entitlement/quota checks as
//                        one-off generation, then enqueues a durable job and
//                        passes the RECENT CONVERSATION as sourceContext —
//                        the document is genuinely grounded in what the user
//                        researched in this chat. Returns { jobId } in
//                        milliseconds; progress arrives via Convex reactivity.
//
// CONTEXT PRESERVATION: both modes load the chat transcript from Convex and
// build the AI request from it — switching Chat → Document Mode never loses
// the conversation.
//
// AUTH: HMAC session token (Authorization header), re-verified against the
// live Convex user record. Every Convex call passes the same session token —
// ownership is enforced INSIDE Convex (see convex/chats.ts).
// =============================================================================

import { NextRequest } from "next/server";
import { validateSessionToken } from "@/lib/session";
import { api } from "@convex/_generated/api";
import { getConvexClient } from "@/lib/convex-server";
import { isAiChatAllowedForPlan, type PlanEntitlementDoc } from "@/lib/ai-entitlement";
import { aiRouter, userSafeAiMessage, AllProvidersFailedError } from "@/services/ai";
import { extractWebSources } from "@/lib/web-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- Request shape ----

interface ChatSendBody {
  chatId?: string;
  message: string;
  mode?: "chat" | "document";
  artifactType?: string; // document | spreadsheet | presentation
  outputFormat?: string; // docx | pdf | xlsx | pptx
  /** REGENERATE: the transcript already ends with the user's prompt (the
   *  client deleted the previous reply via chats.truncateFrom). No new user
   *  row is persisted — a fresh assistant reply is streamed for the same
   *  prompt. Chat mode only; requires an existing chatId. */
  regenerate?: boolean;
  /** Optional per-request chat model pin (future UI picker). Validated
   *  against a strict charset; unknown ids fail naturally at the provider. */
  model?: string;
}

// ---- Context windows (bounded — oversized prompts slow every provider) ----

const MAX_CONTEXT_MESSAGES = 24;
const MAX_CONTEXT_CHARS = 12_000;
const MAX_SOURCE_CONTEXT_CHARS = 22_000; // planning prompt slices at 24k
const TITLE_MAX_LEN = 60;

// -----------------------------------------------------------------------------
// Chat system prompt
// -----------------------------------------------------------------------------
// The old one-liner gave the model no identity, no capability map and no
// formatting contract — it introduced itself as "It looks like workspace
// assistant" and rambled. This version defines WHO Filo is, WHAT it can do
// (chat, research + citations, drafting/editing, Document Mode hand-off) and
// HOW to format for the chat renderer (markdown, code fences with language
// tags, $ math, tables), plus honesty rules. Deliberately scoped to CHAT —
// document generation keeps its own pipeline prompts (services/ai/prompts.ts).
function buildChatSystemPrompt(webSearch: boolean): string {
  const lines = [
    "You are Filo — the AI assistant inside Filo, a workspace for researching, writing, and producing documents. You are knowledgeable, direct, and warm, and you take pride in answers that are immediately useful.",
    "",
    "WHAT YOU DO",
    "- Answer questions and explain concepts clearly — facts over filler.",
    "- Draft, edit, and improve writing: emails, reports, articles, summaries, plans, and code explanations.",
    "- Research and organize: compare options, weigh trade-offs, structure findings.",
    "- For full deliverables (a polished DOCX/PDF/XLSX/PPTX built from this conversation), tell the user to tap the Document (file) icon and switch to Document Mode — it turns everything discussed here into a formatted file.",
    "",
    "HOW YOU WRITE (the chat renders full markdown)",
    "- Lead with the answer, then support it. Short paragraphs; add headings, bullet lists, and tables when they genuinely aid scanning — not decoration.",
    "- Use **bold** sparingly for key terms. Write code in fenced blocks with a language tag. Write math in $...$ or $$...$$.",
    "- Match the user's language and tone. No filler openers (\"Certainly!\", \"Great question!\") and no sign-offs.",
    "- Never invent facts, numbers, quotes, or sources. If unsure, say what you know and what would need verification.",
    "- Use the conversation history naturally. Ask a clarifying question only when the request is genuinely ambiguous — otherwise make a reasonable assumption and say it.",
  ];
  if (webSearch) {
    lines.push(
      "",
      "WEB SEARCH is enabled: ground factual and current claims in live results, cite them inline as [title](url) where they support a point, and never present a link you have not seen in results. The app lists your top sources below the reply."
    );
  }
  return lines.join("\n");
}

function errorResponse(error: string, code: string, status: number, extra?: Record<string, unknown>) {
  return Response.json({ success: false, error, code, ...(extra ? { data: extra } : {}) }, { status });
}

/** Derive a readable chat title from the first user message (no extra AI call, zero latency). */
function deriveTitle(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  if (clean.length <= TITLE_MAX_LEN) return clean || "New chat";
  const cut = clean.slice(0, TITLE_MAX_LEN);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > TITLE_MAX_LEN * 0.5 ? cut.slice(0, lastSpace) : cut) + "…";
}

/** Build the bounded conversation context for the AI request. */
function boundedHistory(
  history: Array<{ role: string; content: string }>
): Array<{ role: "user" | "assistant"; content: string }> {
  const recent = history.slice(-MAX_CONTEXT_MESSAGES);
  const picked: Array<{ role: "user" | "assistant"; content: string }> = [];
  let budget = MAX_CONTEXT_CHARS;
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = String(m.content ?? "");
    if (!content.trim()) continue;
    const clipped = content.length > budget ? content.slice(0, budget) + "…" : content;
    budget -= clipped.length;
    picked.unshift({ role, content: clipped });
    if (budget <= 0) break;
  }
  return picked;
}

function buildContextMessages(
  history: Array<{ role: string; content: string }>,
  currentMessage: string
): Array<{ role: "user" | "assistant"; content: string }> {
  return [...boundedHistory(history), { role: "user", content: currentMessage }];
}

/** Bounded transcript excerpt used as the document generation sourceContext. */
function buildConversationSourceContext(
  history: Array<{ role: string; content: string }>
): string {
  const recent = history.slice(-MAX_CONTEXT_MESSAGES);
  const lines: string[] = [];
  let budget = MAX_SOURCE_CONTEXT_CHARS;
  for (let i = recent.length - 1; i >= 0 && budget > 0; i--) {
    const role = recent[i].role === "assistant" ? "ASSISTANT" : "USER";
    const content = String(recent[i].content ?? "").trim();
    if (!content) continue;
    const line = `${role}: ${content}`;
    budget -= line.length + 1;
    lines.unshift(line);
  }
  return [
    "CONVERSATION CONTEXT — the user researched this topic with Filo before requesting the document.",
    "Ground the document in these facts, decisions and preferences; do not contradict them.",
    "",
    ...lines,
  ].join("\n");
}

export async function POST(request: NextRequest) {
  // ==================== AUTHENTICATION ====================
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return errorResponse("Authentication required", "UNAUTHORIZED", 401);
  }
  const session = validateSessionToken(token);
  if (!session.valid || !session.user) {
    return errorResponse("Invalid or expired session", "INVALID_SESSION", 401);
  }
  const userId = session.user.id;

  // ==================== REQUEST VALIDATION ====================
  let body: ChatSendBody;
  try {
    body = (await request.json()) as ChatSendBody;
  } catch {
    return errorResponse("Invalid request body", "BAD_REQUEST", 400);
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  // REGENERATE re-answers the prompt that already sits at the end of the
  // transcript — chat mode only, never document mode.
  const regenerate = body.regenerate === true;
  const mode: "chat" | "document" = !regenerate && body.mode === "document" ? "document" : "chat";
  if (!message && !regenerate) {
    return errorResponse("Message cannot be empty", "EMPTY_MESSAGE", 400);
  }
  if (message.length > 32_000) {
    return errorResponse("Message is too long (32,000 character limit)", "MESSAGE_TOO_LONG", 400);
  }

  const convex = getConvexClient();

  // ==================== LIVE ACCOUNT STATUS ====================
  // The HMAC token can be up to 7 days old — re-read the CURRENT record.
  try {
    const dbUser = (await convex.query(api.users.getUser, { userId: userId as any })) as
      | { status?: string; planId?: string | null }
      | null;
    if (!dbUser) {
      return errorResponse("Account not found. Please log out and log in again.", "ACCOUNT_NOT_FOUND", 401);
    }
    if ((dbUser.status ?? "active") === "suspended") {
      return errorResponse("Your account has been suspended. Please contact support.", "ACCOUNT_SUSPENDED", 403);
    }
  } catch (statusErr) {
    console.warn("[CHAT/SEND] Live status lookup failed:", statusErr);
  }

  // ==================== CHAT RESOLUTION ====================
  let chatId = body.chatId ?? null;
  if (regenerate && !chatId) {
    // There must be a prior prompt to re-answer.
    return errorResponse("Chat not found", "NOT_FOUND", 404);
  }
  try {
    if (!chatId) {
      chatId = (await convex.mutation(api.chats.create, {
        session: token,
        title: deriveTitle(message),
        mode,
      })) as string;
    } else {
      // Ownership probe — fails closed when the chat isn't the caller's.
      const chat = (await convex.query(api.chats.getForUser, {
        session: token,
        chatId: chatId as any,
      })) as { _id: string } | null;
      if (!chat) {
        return errorResponse("Chat not found", "NOT_FOUND", 404);
      }
    }
  } catch (err) {
    console.error("[CHAT/SEND] Chat resolution failed:", err);
    return errorResponse("Could not open the chat", "CHAT_ERROR", 500);
  }

  // ==================== TRANSCRIPT (context source) ====================
  let history: Array<{ role: string; content: string }> = [];
  try {
    const prior = (await convex.query(api.chats.messagesForUser, {
      session: token,
      chatId: chatId as any,
    })) as Array<{ role: string; content: string }> | null;
    history = Array.isArray(prior) ? prior : [];
  } catch (histErr) {
    console.warn("[CHAT/SEND] Transcript lookup failed, continuing without context:", histErr);
  }

  // A regenerate with no user turn to re-answer is a client bug — fail fast.
  if (regenerate && !history.some((m) => m.role === "user" && String(m.content ?? "").trim())) {
    return errorResponse("Nothing to regenerate", "EMPTY_MESSAGE", 400);
  }

  // ==================== PERSIST USER MESSAGE (immediately) ====================
  // The user's own message lands in the database BEFORE any AI work — the
  // reactive transcript shows it instantly on every device. A regenerate
  // SKIPS this: its prompt is already the last row of the transcript.
  if (!regenerate) {
    try {
      await convex.mutation(api.chats.appendMessage, {
        session: token,
        chatId: chatId as any,
        role: "user",
        content: message,
      });
    } catch (appendErr) {
      console.error("[CHAT/SEND] Failed to persist user message:", appendErr);
      return errorResponse("Could not save your message", "PERSIST_FAILED", 500);
    }
  }

  // ==================== DOCUMENT MODE → enqueue durable job ====================
  if (mode === "document") {
    try {
      return await startDocumentGeneration({
        convex,
        token,
        userId,
        chatId: chatId as string,
        message,
        history,
        artifactType: body.artifactType,
        outputFormat: body.outputFormat,
        appBaseUrl:
          process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
          request.nextUrl.origin,
      });
    } catch (docErr) {
      console.error("[CHAT/SEND] Document mode failed:", docErr);
      return errorResponse("Could not start the document generation", "DOCUMENT_START_FAILED", 500);
    }
  }

  // ==================== CHAT MODE → SSE stream ====================
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      send({ type: "meta", chatId, mode: "chat" });

      // Regenerate: the prompt is the transcript's last row — no extra turn.
      const contextMessages = regenerate
        ? boundedHistory(history)
        : buildContextMessages(history, message);
      let assistantText = "";

      // ---- Chat model pin (chat mode ONLY — document mode keeps its own
      // cost-optimized task matrix) ----
      // Precedence: client-supplied model (validated charset; future picker)
      // > CHAT_MODEL env pin > provider default/task matrix.
      // Routing is DIRECT: the strategy provider (production = OpenAI via
      // OPENAI_API_KEY) serves the pinned id itself when its registry lists
      // it, and an explicit AI_PROVIDER env is absolute — a shared gateway
      // that happens to carry the same model id (e.g. AgentRouter's
      // gpt-5.6-sol) never hijacks the request. So CHAT_MODEL=gpt-5.6-sol
      // needs ONLY OPENAI_API_KEY, no AgentRouter key.
      const bodyModel =
        typeof body.model === "string" && /^[A-Za-z0-9._/-]{1,120}$/.test(body.model)
          ? body.model
          : undefined;
      const envModel = process.env.CHAT_MODEL?.trim() || undefined;
      const chatModel = bodyModel || envModel;

      // Reasoning depth for thinking models (gpt-5.x / o-series) — 'low'
      // cuts seconds of silent "Thinking…" off the first token so replies
      // start in ~ms. Env-overridable; document generation is unaffected
      // (it keeps the provider default for quality).
      const rawEffort = process.env.CHAT_REASONING_EFFORT?.trim().toLowerCase();
      const reasoningEffort = (
        ["minimal", "low", "medium", "high"] as readonly (string | undefined)[]
      ).includes(rawEffort)
        ? (rawEffort as "minimal" | "low" | "medium" | "high")
        : "low";

      try {
        const result = await aiRouter.stream(
          {
            messages: [
              { role: "system", content: buildChatSystemPrompt(process.env.CHAT_WEB_SEARCH === "true") },
              ...contextMessages,
            ],
            options: {
              temperature: 0.7,
              // Reasoning models spend completion budget on thinking before
              // the visible answer — 2048 truncated real replies mid-sentence.
              maxTokens: 4096,
              reasoningEffort,
              // CHAT-ONLY native web grounding (env-gated, default off):
              //   GEMINI → google_search tool → groundingMetadata citations
              //   OPENAI → web_search_options (search-capable models) →
              //            url_citation annotations
              // Providers that can't ground ignore it fail-soft. Document
              // mode NEVER grounds — generation quality must not depend on
              // live web state.
              webSearch: process.env.CHAT_WEB_SEARCH === "true",
            },
          },
          { task: "generation", ...(chatModel ? { model: chatModel } : {}) }
        );

        for await (const delta of result.textStream) {
          if (!delta) continue;
          assistantText += delta;
          send({ type: "delta", text: delta });
        }
        const final = await result.finished;
        assistantText = final.content || assistantText;

        if (!assistantText.trim()) {
          throw new Error("The model returned an empty response");
        }

        // Persist the assistant reply — the reactive transcript takes over
        // from the client's local stream buffer. Sources: native provider
        // grounding citations win; link extraction is the fallback when the
        // provider can't ground (or grounding was disabled).
        const nativeSources = final.sources ?? [];
        const webSources =
          nativeSources.length > 0 ? nativeSources : extractWebSources(assistantText);
        await convex.mutation(api.chats.appendMessage, {
          session: token,
          chatId: chatId as any,
          role: "assistant",
          content: assistantText,
          metadata: {
            model: final.model,
            provider: final.provider,
            usage: final.usage,
            durationMs: final.durationMs,
            ...(webSources.length > 0 ? { sources: webSources } : {}),
          },
        });

        send({ type: "done", chatId });
        controller.close();
      } catch (streamErr) {
        console.error("[CHAT/SEND] Chat stream failed:", streamErr);
        const safe =
          streamErr instanceof AllProvidersFailedError
            ? userSafeAiMessage(streamErr)
            : streamErr instanceof Error
              ? streamErr.message
              : "The AI service is temporarily unavailable";
        try {
          // Persist the failure as an assistant turn so the transcript is
          // honest about what happened (and retry is possible).
          await convex.mutation(api.chats.appendMessage, {
            session: token,
            chatId: chatId as any,
            role: "assistant",
            content: "",
            metadata: { error: safe },
          });
        } catch {
          /* transcript write is best-effort here */
        }
        send({ type: "error", error: safe });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ==================== DOCUMENT MODE HELPER ====================

async function startDocumentGeneration(opts: {
  convex: ReturnType<typeof getConvexClient>;
  token: string;
  userId: string;
  chatId: string;
  message: string;
  history: Array<{ role: string; content: string }>;
  artifactType?: string;
  outputFormat?: string;
  appBaseUrl: string;
}) {
  const { convex, token, userId, chatId, message, history } = opts;

  // ---- Plan + entitlement (fail-closed, mirrors /api/artifacts/agent-generate) ----
  let plan: PlanEntitlementDoc | null = null;
  try {
    const dbUser = (await convex.query(api.users.getUser, { userId: userId as any })) as
      | { planId?: string | null }
      | null;
    if (dbUser?.planId) {
      plan = (await convex.query(api.plans.getPlanById, { planId: dbUser.planId as any })) as PlanEntitlementDoc | null;
    }
    if (!plan) {
      plan = (await convex.query(api.plans.getFreePlan, {})) as PlanEntitlementDoc | null;
    }
  } catch (planErr) {
    console.warn("[CHAT/SEND] Plan lookup failed:", planErr);
  }
  if (!isAiChatAllowedForPlan(plan)) {
    return errorResponse(
      "AI generation is a premium feature. Upgrade to Pro to create documents with AI.",
      "PLAN_UPGRADE_REQUIRED",
      403,
      { upgradeUrl: "/billing" }
    );
  }

  // ---- Monthly quota pre-check (never spend tokens on an exhausted plan) ----
  const planLimit = plan?.maxAiGenerations ?? null;
  if (planLimit !== null && planLimit >= 0) {
    try {
      const usage = (await convex.query(api.subscriptions.getMonthlyAiUsage, {
        userId: userId as any,
      })) as { used?: number } | null;
      const used = usage?.used ?? 0;
      if (used >= planLimit) {
        return errorResponse(
          `Monthly generation limit reached (${used}/${planLimit}). Your limit resets next month.`,
          "LIMIT_REACHED",
          429,
          { remaining: 0, limit: planLimit }
        );
      }
    } catch (usageErr) {
      console.warn("[CHAT/SEND] Usage lookup unavailable, skipping pre-check:", usageErr);
    }
  }

  // ---- Duplicate guard: one active job per user ----
  try {
    const activeJob = (await convex.query(api.generation.getActiveUserJob, {
      userId: userId as any,
    })) as { _id: string; status: string } | null;
    if (activeJob) {
      return errorResponse("A generation is already in progress.", "GENERATION_IN_PROGRESS", 429, {
        jobId: activeJob._id,
        status: activeJob.status,
      });
    }
  } catch (guardErr) {
    console.warn("[CHAT/SEND] Duplicate guard lookup failed:", guardErr);
  }

  // ---- Enqueue the durable job with the CONVERSATION as context ----
  const serverToken = process.env.FILO_SERVER_SECRET;
  if (!serverToken) {
    return errorResponse(
      "Generation is not configured on this deployment (missing FILO_SERVER_SECRET).",
      "NOT_CONFIGURED",
      503
    );
  }

  const artifactType = opts.artifactType || "document";
  const outputFormat =
    opts.outputFormat ||
    (artifactType === "spreadsheet" ? "xlsx" : artifactType === "presentation" ? "pptx" : "docx");

  const result = (await convex.mutation(api.generation.enqueueJob, {
    serverToken,
    userId: userId as any,
    prompt: message,
    artifactType,
    outputFormat,
    appBaseUrl: opts.appBaseUrl,
    sourceContext: buildConversationSourceContext(history),
    aiKeys: {
      gemini: process.env.GEMINI_API_KEY || undefined,
      openai: process.env.OPENAI_API_KEY || undefined,
      agentRouter: process.env.AGENT_ROUTER_API_KEY || undefined,
    },
  })) as { success: boolean; jobId?: string; error?: string; code?: string };

  if (!result.success || !result.jobId) {
    return errorResponse(result.error || "Could not start generation", result.code || "ENQUEUE_FAILED", 400);
  }

  // ---- Persist the generation turn (chat flips to document mode) ----
  await convex.mutation(api.chats.appendMessage, {
    session: token,
    chatId: chatId as any,
    role: "assistant",
    content: `Generating ${artifactType} — I'll base it on our conversation.`,
    metadata: {
      kind: "generation",
      jobId: result.jobId,
      artifactType,
      outputFormat,
    },
    mode: "document",
  });

  return Response.json({
    success: true,
    data: {
      chatId,
      jobId: result.jobId,
      status: "queued",
      artifactType,
      outputFormat,
    },
  });
}
