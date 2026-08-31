// =============================================================================
// POST /api/shared/chat/[token]/messages — visitor send on an EDIT-shared chat
// =============================================================================
// The share token IS the credential (32 random bytes, verified against the
// live chat row inside Convex). Visitors with "edit" permission can add
// messages to the conversation; the AI replies on the OWNER's account, so
// the owner's plan entitlement + monthly quota are enforced BEFORE any AI
// spend. View-only links get a 403. Revoked links get the same answer as
// unknown links (fail-closed, nothing to probe).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getConvexClient } from "@/lib/convex-server";
import { isAiChatAllowedForPlan, type PlanEntitlementDoc } from "@/lib/ai-entitlement";
import { aiRouter, userSafeAiMessage } from "@/services/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONTEXT_CHARS = 12_000;
const CHAT_SYSTEM_PROMPT = `You are Filo, an expert AI workspace assistant. You help users research topics, draft content, and prepare documents. Answer in clear, well-structured markdown: short paragraphs, headings when useful, bullet lists for enumerations, tables for comparisons. Be precise and concrete; prefer facts over filler. This conversation is shared with you by its owner; collaborators may also contribute messages.`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const shareToken = typeof token === "string" ? token.trim() : "";
  if (shareToken.length < 20) {
    return NextResponse.json({ success: false, error: "Share link is not valid", code: "INVALID_TOKEN" }, { status: 404 });
  }

  let body: { content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body", code: "BAD_REQUEST" }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ success: false, error: "Message cannot be empty", code: "EMPTY_MESSAGE" }, { status: 400 });
  }
  if (content.length > 8_000) {
    return NextResponse.json({ success: false, error: "Message is too long (8,000 character limit)", code: "MESSAGE_TOO_LONG" }, { status: 400 });
  }

  const convex = getConvexClient();

  // ---- Resolve the shared chat (sanitized; includes transcript) ----
  const shared = (await convex.query(api.chats.getSharedByToken, {
    token: shareToken,
    includeMessages: true,
  })) as {
    chatId: string;
    title: string;
    permission: "view" | "edit";
    messages?: Array<{ role: string; content: string }>;
  } | null;

  if (!shared) {
    return NextResponse.json({ success: false, error: "Share link is not valid", code: "INVALID_TOKEN" }, { status: 404 });
  }
  if (shared.permission !== "edit") {
    return NextResponse.json(
      { success: false, error: "This chat is shared with view-only permission", code: "VIEW_ONLY" },
      { status: 403 }
    );
  }

  // ---- Owner entitlement + quota (AI replies spend the OWNER's plan) ----
  const chatRow = (await convex.query(api.chats.getSharedByToken, { token: shareToken })) as
    | { chatId: string }
    | null;
  if (!chatRow) {
    return NextResponse.json({ success: false, error: "Share link is not valid", code: "INVALID_TOKEN" }, { status: 404 });
  }

  // The owner's user id is resolved through a SERVER-TOKEN-GATED query — the
  // public share projection never exposes it. Needed for quota checks only.
  const serverToken = process.env.FILO_SERVER_SECRET;
  if (!serverToken) {
    return NextResponse.json(
      { success: false, error: "Shared chat replies are not configured on this deployment.", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }
  const owner = (await convex.query(api.chats.getOwnerForShareToken, {
    serverToken,
    token: shareToken,
  })) as { userId: string; status: string } | null;
  if (!owner) {
    return NextResponse.json({ success: false, error: "Share link is not valid", code: "INVALID_TOKEN" }, { status: 404 });
  }
  if (owner.status === "suspended") {
    return NextResponse.json(
      { success: false, error: "The owner's account is suspended — messages cannot be processed right now.", code: "OWNER_SUSPENDED" },
      { status: 403 }
    );
  }

  let plan: PlanEntitlementDoc | null = null;
  try {
    const dbUser = (await convex.query(api.users.getUser, { userId: owner.userId as any })) as
      | { planId?: string | null }
      | null;
    if (dbUser?.planId) {
      plan = (await convex.query(api.plans.getPlanById, { planId: dbUser.planId as any })) as PlanEntitlementDoc | null;
    }
    if (!plan) {
      plan = (await convex.query(api.plans.getFreePlan, {})) as PlanEntitlementDoc | null;
    }
    if (!isAiChatAllowedForPlan(plan)) {
      return NextResponse.json(
        { success: false, error: "The owner's plan does not include AI replies.", code: "PLAN_UPGRADE_REQUIRED" },
        { status: 403 }
      );
    }
    const planLimit = plan?.maxAiGenerations ?? null;
    if (planLimit !== null && planLimit >= 0) {
      const usage = (await convex.query(api.subscriptions.getMonthlyAiUsage, {
        userId: owner.userId as any,
      })) as { used?: number } | null;
      if ((usage?.used ?? 0) >= planLimit) {
        return NextResponse.json(
          { success: false, error: "The owner's monthly AI limit is reached — your message was not sent.", code: "LIMIT_REACHED" },
          { status: 429 }
        );
      }
    }
  } catch (quotaErr) {
    console.warn("[SHARED/CHAT] Quota lookup failed:", quotaErr);
  }

  // ---- Persist the visitor message (token-verified inside Convex) ----
  await convex.mutation(api.chats.appendSharedMessage, {
    token: shareToken,
    role: "user",
    content,
  });

  // ---- AI reply from the shared transcript ----
  const history = (shared.messages ?? []).map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: String(m.content ?? ""),
  }));
  // Bounded context: walk backwards accumulating until the budget is spent.
  const picked: Array<{ role: "user" | "assistant"; content: string }> = [];
  let budget = MAX_CONTEXT_CHARS;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m.content.trim()) continue;
    const clipped = m.content.length > budget ? m.content.slice(0, budget) + "…" : m.content;
    budget -= clipped.length;
    picked.unshift({ role: m.role, content: clipped });
    if (budget <= 0) break;
  }
  picked.push({ role: "user", content });

  try {
    const response = await aiRouter.generate(
      {
        messages: [{ role: "system", content: CHAT_SYSTEM_PROMPT }, ...picked],
        options: { temperature: 0.7, maxTokens: 2048 },
      },
      { task: "generation" }
    );

    await convex.mutation(api.chats.appendSharedMessage, {
      token: shareToken,
      role: "assistant",
      content: response.content,
      metadata: { model: response.model, provider: response.provider, viaSharedLink: true },
    });

    return NextResponse.json({ success: true, data: { ok: true } });
  } catch (aiErr) {
    const safe = userSafeAiMessage(aiErr as Error);
    console.error("[SHARED/CHAT] AI reply failed:", aiErr);
    return NextResponse.json({ success: false, error: safe, code: "AI_FAILED" }, { status: 502 });
  }
}
