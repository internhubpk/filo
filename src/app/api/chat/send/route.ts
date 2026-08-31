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
}

// ---- Context windows (bounded — oversized prompts slow every provider) ----

const MAX_CONTEXT_MESSAGES = 24;
const MAX_CONTEXT_CHARS = 12_000;
const MAX_SOURCE_CONTEXT_CHARS = 22_000; // planning prompt slices at 24k
const TITLE_MAX_LEN = 60;

const CHAT_SYSTEM_PROMPT = `You are Filo, an expert AI workspace assistant. You help users research topics, draft content, and prepare documents. Answer in clear, well-structured markdown: short paragraphs, headings when useful, bullet lists for enumerations, tables for comparisons. Be precise and concrete; prefer facts over filler. When the user's question builds on earlier messages in the conversation, use that context naturally. If you don't know something, say so briefly.`;

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
function buildContextMessages(
  history: Array<{ role: string; content: string }>,
  currentMessage: string
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
  picked.push({ role: "user", content: currentMessage });
  return picked;
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
  const mode: "chat" | "document" = body.mode === "document" ? "document" : "chat";
  if (!message) {
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

  // ==================== PERSIST USER MESSAGE (immediately) ====================
  // The user's own message lands in the database BEFORE any AI work — the
  // reactive transcript shows it instantly on every device.
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

      const contextMessages = buildContextMessages(history, message);
      let assistantText = "";

      try {
        const result = await aiRouter.stream(
          {
            messages: [
              { role: "system", content: CHAT_SYSTEM_PROMPT },
              ...contextMessages,
            ],
            options: { temperature: 0.7, maxTokens: 2048 },
          },
          { task: "generation" }
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
        // from the client's local stream buffer. Web resources cited by the
        // reply (if any) ride along in metadata.sources and render as the
        // "Web resources" strip in the chat UI.
        const webSources = extractWebSources(assistantText);
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
