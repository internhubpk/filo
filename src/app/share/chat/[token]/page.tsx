"use client";

// =============================================================================
// /share/chat/[token] — PUBLIC shared chat view (view | edit permission).
// =============================================================================
// Resolves the conversation through the PUBLIC token query (sanitized — no
// owner identity ever reaches this page). With "edit" permission the visitor
// can send messages; AI replies spend the OWNER's quota and are enforced
// server-side. The transcript is a live Convex subscription, so new messages
// from the owner or other visitors appear without a refresh.
// =============================================================================

import { use, useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Eye, FileText, Loader2, MessageSquare, Pencil, TriangleAlert } from "lucide-react";
import { api } from "@convex/_generated/api";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LogoMark } from "@/components/shared/logo";

interface SharedMessage {
  _id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: { kind?: string; error?: string } | null;
  createdAt: number;
}

export default function SharedChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  // Live public subscription — new messages appear without refresh.
  const shared = useQuery(api.chats.getSharedByToken, {
    token,
    includeMessages: true,
  }) as
    | {
        chatId: string;
        title: string;
        permission: "view" | "edit";
        sharedAt: number;
        updatedAt: number;
        messages?: SharedMessage[];
      }
    | null
    | undefined;

  const canEdit = shared?.permission === "edit";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Public header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <Link href="/" className="flex items-center gap-2" aria-label="Filo">
          <LogoMark size={24} />
          <span className="text-sm font-semibold tracking-tight">Filo</span>
        </Link>
        <span className="flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {canEdit ? <Pencil className="size-3" /> : <Eye className="size-3" />}
          {canEdit ? "Shared with editing" : "Shared · read-only"}
        </span>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {shared === undefined ? (
          <SharedSkeleton />
        ) : shared === null ? (
          <InvalidLink />
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-lg font-semibold tracking-tight">{shared.title}</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Shared conversation · {shared.messages?.length ?? 0} messages
              </p>
            </div>

            {(shared.messages ?? []).length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-14 text-center">
                <MessageSquare className="size-6 text-muted-foreground/50" />
                <p className="text-sm font-medium">No messages yet</p>
              </div>
            ) : (
              (shared.messages ?? []).map((m) =>
                m.role === "user" ? (
                  <div key={m._id} className="mb-5 flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[14.5px] leading-relaxed text-primary-foreground">
                      {m.content}
                    </div>
                  </div>
                ) : m.metadata?.error && !m.content ? (
                  <div key={m._id} className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {m.metadata.error}
                  </div>
                ) : (
                  <div key={m._id} className="mb-5 flex items-start gap-2.5">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-[10px] font-semibold text-primary">
                      F
                    </span>
                    <div className="min-w-0 flex-1">
                      <ChatMarkdown content={m.content} />
                    </div>
                  </div>
                )
              )
            )}

            {canEdit ? <SharedComposer token={token} /> : (
              <p className="mt-10 rounded-xl border bg-muted/30 px-4 py-3 text-center text-xs text-muted-foreground">
                This chat is shared in read-only mode. Sign in to Filo to start your own conversations.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ==================== Composer (edit permission) ====================

function SharedComposer({ token }: { token: string }) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = value.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/shared/chat/${encodeURIComponent(token)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.error || "Could not send your message");
      } else {
        setValue("");
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="sticky bottom-4 mt-8">
      {error ? (
        <p className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}
      <div className="flex items-end gap-2 rounded-2xl border bg-card p-2.5 shadow-lg">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Add a message to this conversation…"
          className="max-h-[140px] min-h-[24px] flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground/70"
          aria-label="Message"
        />
        <Button size="sm" className="h-8 gap-1.5" onClick={() => void send()} disabled={!value.trim() || sending}>
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Send
        </Button>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
        Messages are added to the owner&apos;s conversation — Filo replies using their plan.
      </p>
    </div>
  );
}

// ==================== States ====================

function SharedSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-6 w-2/3" />
      <div className="flex justify-end">
        <Skeleton className="h-10 w-1/2 rounded-2xl" />
      </div>
      <div className="flex items-start gap-2.5">
        <Skeleton className="size-7 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      </div>
    </div>
  );
}

function InvalidLink() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10">
        <TriangleAlert className="size-6 text-destructive" />
      </span>
      <h1 className="text-lg font-semibold">This link is no longer valid</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The share link was revoked or never existed. Ask the owner for a fresh link.
      </p>
      <Button variant="outline" asChild className="mt-2">
        <Link href="/">
          <FileText className="mr-2 size-4" /> About Filo
        </Link>
      </Button>
    </div>
  );
}
