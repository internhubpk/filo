// =============================================================================
// POST /api/chat/share — create / rotate / revoke a public chat share link
// DELETE /api/chat/share — revoke
// =============================================================================
// The share token is 32 cryptographically random bytes (base64url, ~43
// chars) generated HERE, server-side — the client never supplies tokens.
// Rotation replaces the stored token, so previously-issued links die
// instantly. Revocation clears the token (same effect).
// The permission ("view" | "edit") is stored on the chat row and enforced in
// Convex at read/write time — a leaked old "edit" link cannot be replayed
// after a downgrade to "view" (rotation on every permission change).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { validateSessionToken } from "@/lib/session";
import { api } from "@convex/_generated/api";
import { getConvexClient } from "@/lib/convex-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appUrl(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ success: false, error: "Authentication required", code: "UNAUTHORIZED" }, { status: 401 });
  }
  const session = validateSessionToken(token);
  if (!session.valid || !session.user) {
    return NextResponse.json({ success: false, error: "Invalid or expired session", code: "INVALID_SESSION" }, { status: 401 });
  }

  let body: { chatId?: string; permission?: "view" | "edit" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body", code: "BAD_REQUEST" }, { status: 400 });
  }
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  const permission = body.permission === "edit" ? "edit" : "view";
  if (!chatId) {
    return NextResponse.json({ success: false, error: "chatId is required", code: "MISSING_FIELDS" }, { status: 400 });
  }

  try {
    const convex = getConvexClient();
    const shareToken = randomBytes(32).toString("base64url");
    const result = (await convex.mutation(api.chats.setShare, {
      session: token,
      chatId: chatId as any,
      permission,
      token: shareToken,
    })) as { shared: boolean };

    if (!result.shared) {
      return NextResponse.json({ success: false, error: "Chat not found", code: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        shareToken,
        permission,
        url: `${appUrl(request)}/share/chat/${shareToken}`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Share failed";
    const notFound = message.includes("not found") || message.includes("Unauthorized");
    console.error("[CHAT/SHARE] Share failed:", err);
    return NextResponse.json(
      { success: false, error: notFound ? "Chat not found" : "Could not create the share link", code: notFound ? "NOT_FOUND" : "SHARE_FAILED" },
      { status: notFound ? 404 : 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ success: false, error: "Authentication required", code: "UNAUTHORIZED" }, { status: 401 });
  }
  const session = validateSessionToken(token);
  if (!session.valid || !session.user) {
    return NextResponse.json({ success: false, error: "Invalid or expired session", code: "INVALID_SESSION" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");
  if (!chatId) {
    return NextResponse.json({ success: false, error: "chatId is required", code: "MISSING_FIELDS" }, { status: 400 });
  }

  try {
    const convex = getConvexClient();
    await convex.mutation(api.chats.setShare, {
      session: token,
      chatId: chatId as any,
      permission: null,
    });
    return NextResponse.json({ success: true, data: { shared: false } });
  } catch (err) {
    console.error("[CHAT/SHARE] Revoke failed:", err);
    return NextResponse.json({ success: false, error: "Could not revoke the share link", code: "REVOKE_FAILED" }, { status: 500 });
  }
}
