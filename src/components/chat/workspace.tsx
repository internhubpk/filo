"use client";

// =============================================================================
// ChatWorkspace — the unified chat + document workspace (THE product).
// =============================================================================
// Layout: [conversation] inside the AppShell, whose ONE sidebar (icon rail ⟷
// expanded panel, closed by default) owns navigation + chat history + account.
// The workspace opens/closes that sidebar via SidebarContext (useSidebar):
// the header's menu button opens it on mobile, the panel toggle on desktop.
//
// The four database states are rendered honestly at every layer:
//   • transcript: undefined → skeleton bubbles — BUT NEVER while a send is in
//     flight: the optimistic user bubble + the single thinking→typing bubble
//     are the entire loading UI, so no skeleton ever competes with them
//   • the streaming assistant reply is marked locally until the persisted
//     message arrives via the reactive subscription (no duplicates)
//   • generation turns render <GenerationCard> with live job progress
//   • Convex errors hit <QueryBoundary> → honest error state with retry
//
// Context preservation: the server builds every AI request (chat AND
// document) from the persisted transcript — switching modes mid-conversation
// never loses the thread.
// =============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  Copy,
  FileText,
  Menu,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Share2,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import { useFiloSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { QueryBoundary } from "@/components/chat/query-boundary";
import { useSidebar } from "@/components/layout/sidebar-context";
import { Composer, type ComposerMode, type DocFormat } from "@/components/chat/composer";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { SourcesBlock, toChatSources } from "@/components/chat/sources-block";
import { GenerationCard } from "@/components/chat/generation-card";
import { ShareChatDialog } from "@/components/chat/share-dialog";
import { WelcomeOrb } from "@/components/chat/welcome-animation";

// ==================== Transcript message shape ====================

interface TranscriptMessage {
  _id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: {
    kind?: string;
    jobId?: string;
    artifactType?: string;
    outputFormat?: string;
    error?: string;
    model?: string;
    provider?: string;
    // Web-grounding citations attached by the chat backend when the reply
    // used web results: [{ title, url, snippet? }, …]
    sources?: { title: string; url: string; snippet?: string }[];
  } | null;
  createdAt: number;
}

// ==================== Main workspace ====================

export function ChatWorkspace({
  initialChatId,
  initialMode,
}: {
  initialChatId?: string;
  initialMode?: ComposerMode;
}) {
  const router = useRouter();
  const { user, token } = useFiloSession();

  const [chatId, setChatId] = useState<string | null>(initialChatId ?? null);
  const [mode, setMode] = useState<ComposerMode>(initialMode ?? "chat");
  const [format, setFormat] = useState<DocFormat>("docx");
  // The single workspace sidebar (AppShell) starts CLOSED — this workspace
  // only opens it on demand through SidebarContext.
  const sidebar = useSidebar();
  const [shareOpen, setShareOpen] = useState(false);

  // URL sync for deep links (/chat/<id>).
  useEffect(() => {
    const desired = chatId ? `/chat/${chatId}` : "/chat";
    if (window.location.pathname !== desired) {
      window.history.replaceState(null, "", desired);
    }
  }, [chatId]);

  // ---- Reactive subscriptions (no polling anywhere) ----
  const chat = useQuery(
    api.chats.getForUser,
    token && chatId ? ({ session: token, chatId } as any) : ("skip" as any)
  ) as { _id: string; title: string } | null | undefined;

  const messages = useQuery(
    api.chats.messagesForUser,
    token && chatId ? ({ session: token, chatId } as any) : ("skip" as any)
  ) as TranscriptMessage[] | null | undefined;

  // ---- Streaming + optimistic state ----
  // streamText is the LETTER-BY-LETTER displayed text; streamTarget is the
  // full text received from the server. A rAF typewriter loop reveals the
  // backlog at a steady adaptive rate so irregular server chunks read as
  // continuous typing instead of blocks popping in.
  const [streamText, setStreamText] = useState<string | null>(null);
  const [streamTarget, setStreamTarget] = useState("");
  const [pendingUser, setPendingUser] = useState<{ content: string; at: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Synchronous send-guard: React state (`streaming`) only updates on the
  // next render, so two rapid Enter presses could both slip past the async
  // guard and start two interleaved SSE streams. A ref closes that race.
  const sendingRef = useRef(false);

  // ---- Typewriter engine ----
  const targetRef = useRef(""); // authoritative full text (read by the rAF loop)
  const shownLenRef = useRef(0); // how many characters are currently displayed
  const sseDoneRef = useRef(false); // server finished sending
  const rafRef = useRef<number | null>(null);
  const typingDoneRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);

  const streaming = streamText !== null;

  /** Start a fresh chat stream: THINKING phase, rAF loop running. */
  const beginStream = useCallback(() => {
    targetRef.current = "";
    shownLenRef.current = 0;
    sseDoneRef.current = false;
    setStreamTarget("");
    setStreamText("");
    let resolve: () => void = () => {};
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    typingDoneRef.current = { promise, resolve };
    if (rafRef.current === null) {
      const tick = () => {
        rafRef.current = null;
        const target = targetRef.current;
        if (shownLenRef.current < target.length) {
          const remaining = target.length - shownLenRef.current;
          // Adaptive reveal — FAST: a deep backlog burns at up to 60 chars
          // per frame (~3600 chars/s) so the reply lands in about a second
          // once the server is done, decelerating to a fine 2-char letter
          // rate at the tail. The flowing text itself is the typing
          // indicator — no extra blinking cursor is rendered.
          const step = Math.min(60, Math.max(2, Math.ceil(remaining / 6)));
          shownLenRef.current = Math.min(target.length, shownLenRef.current + step);
          setStreamText(target.slice(0, shownLenRef.current));
        }
        if (sseDoneRef.current && shownLenRef.current >= target.length) {
          typingDoneRef.current?.resolve(); // drained — transcript takes over
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
  }, []);

  /** Append a server delta to the typewriter backlog. The first delta also
   *  ends the THINKING phase — the dots swap for the flowing reply text. */
  const pushStreamText = useCallback((delta: string) => {
    targetRef.current += delta;
    setStreamTarget(targetRef.current);
  }, []);

  /** Mark the server side as finished — the typewriter drains, then resolves. */
  const endStreamTarget = useCallback(() => {
    sseDoneRef.current = true;
  }, []);

  /** Kill the stream immediately (error / abort) and clear all its state. */
  const cancelStream = useCallback(() => {
    sseDoneRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    typingDoneRef.current = null;
    targetRef.current = "";
    shownLenRef.current = 0;
    setStreamTarget("");
    setStreamText(null);
  }, []);

  /** SUCCESS handoff: the reply finished typing — drop the streaming bubble
   *  entirely so the persisted transcript row (copy button, sources) takes
   *  over. This is what makes the cursor disappear and the copy action
   *  appear the moment the message completes. */
  const finalizeStream = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    sseDoneRef.current = false;
    typingDoneRef.current = null;
    targetRef.current = "";
    shownLenRef.current = 0;
    setStreamTarget("");
    setStreamText(null);
  }, []);

  // Stop the rAF loop on unmount (state updates on an unmounted component
  // are no-ops, but the loop itself must not keep running).
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sendError) return;
    const t = setTimeout(() => setSendError(null), 6000);
    return () => clearTimeout(t);
  }, [sendError]);

  // Optimistic rows are dropped once the persisted rows arrive.
  const pendingReflected = useMemo(() => {
    if (!pendingUser || !messages) return false;
    return messages.some(
      (m) => m.role === "user" && m.content === pendingUser.content && m.createdAt >= pendingUser.at
    );
  }, [pendingUser, messages]);

  // While the letter-by-letter stream is in flight, the freshly persisted
  // assistant row is hidden — the typing bubble is the sole renderer until
  // the typewriter drains, then the transcript row (copy button, sources,
  // generation card) takes over seamlessly with identical content.
  const visibleMessages = useMemo(() => {
    if (!messages || !streaming || streamTarget === "") return messages;
    const last = messages[messages.length - 1];
    if (
      last &&
      last.role === "assistant" &&
      last.content.length > 0 &&
      (last.content === streamTarget ||
        last.content.startsWith(streamTarget) ||
        streamTarget.startsWith(last.content))
    ) {
      return messages.slice(0, -1);
    }
    return messages;
  }, [messages, streaming, streamTarget]);

  // ---- Scroll management: follow new content unless the user scrolled up ----
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages?.length, streamText, pendingUser]);

  // ---- Send ----
  const send = useCallback(
    async (text: string) => {
      if (!token || streaming || sendingRef.current) return;
      sendingRef.current = true;
      setPendingUser({ content: text, at: Date.now() });
      setBusy(true);
      setSendError(null);

      const currentChatId = chatId;
      const currentMode = mode;
      const currentFormat = format;

      // Chat mode: the THINKING indicator is visible from the first
      // millisecond (network + model latency included); the same bubble then
      // turns into the letter-by-letter stream.
      if (currentMode === "chat") beginStream();

      try {
        const ac = new AbortController();
        abortRef.current = ac;

        const res = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            chatId: currentChatId ?? undefined,
            message: text,
            mode: currentMode,
            ...(currentMode === "document"
              ? {
                  artifactType:
                    currentFormat === "xlsx"
                      ? "spreadsheet"
                      : currentFormat === "pptx"
                        ? "presentation"
                        : "document",
                  outputFormat: currentFormat,
                }
              : {}),
          }),
          signal: ac.signal,
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(err?.error || `Request failed (${res.status})`);
        }

        if (currentMode === "document") {
          const json = (await res.json()) as { success: boolean; data?: { chatId: string }; error?: string };
          if (!json.success) throw new Error(json.error || "Could not start the generation");
          if (!currentChatId && json.data?.chatId) setChatId(json.data.chatId);
          // Keep the optimistic user bubble until the persisted row reflects
          // it — nulling here would blank the message out while the fresh
          // transcript subscription loads.
          return;
        }

        // ---- SSE stream (deltas feed the typewriter backlog) ----
        const reader = res.body?.getReader();
        if (!reader) throw new Error("Streaming is not supported in this browser");
        const decoder = new TextDecoder();
        let buffer = "";
        let errored: string | null = null;

        let finished = false;
        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const raw of events) {
            const line = raw.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let evt: { type?: string; text?: string; chatId?: string; error?: string };
            try {
              evt = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (evt.type === "meta" && evt.chatId && !currentChatId) {
              setChatId(evt.chatId);
            } else if (evt.type === "delta" && evt.text) {
              pushStreamText(evt.text);
            } else if (evt.type === "error") {
              errored = evt.error ?? "The AI service failed";
            } else if (evt.type === "done") {
              finished = true; // stop reading — the server is done
              break;
            }
          }
        }

        if (errored) throw new Error(errored);
        // Server finished — let the typewriter drain the remaining backlog,
        // THEN hand the message over to the persisted transcript (avoids a
        // half-typed handoff; the copy/sources row appears only once the
        // reply is complete). The race covers a backgrounded tab — rAF
        // doesn't tick there, and the caret must never hang on frames that
        // never come.
        endStreamTarget();
        await Promise.race([
          typingDoneRef.current?.promise ?? Promise.resolve(),
          new Promise((r) => setTimeout(r, 6000)),
        ]);
        finalizeStream(); // bubble out → transcript row (copy, sources) in
        setPendingUser(null);
      } catch (sendErr) {
        cancelStream();
        const aborted = sendErr instanceof DOMException && sendErr.name === "AbortError";
        if (!aborted) {
          setSendError(sendErr instanceof Error ? sendErr.message : "Something went wrong");
        }
        setPendingUser(null);
      } finally {
        sendingRef.current = false;
        setBusy(false);
        abortRef.current = null;
      }
    },
    [
      token,
      chatId,
      mode,
      format,
      streaming,
      beginStream,
      pushStreamText,
      endStreamTarget,
      finalizeStream,
      cancelStream,
    ]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const openChat = useCallback((id: string) => {
    // Leaving mid-stream aborts the fetch (catch → cancelStream cleans up).
    abortRef.current?.abort();
    setChatId(id);
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setChatId(null);
    router.push("/chat");
  }, [router]);

  // ---- Example prompts (empty state) ----
  const [preset, setPreset] = useState<{ text: string; key: number } | undefined>();

  const showExamples =
    !chatId && !streaming && (messages === undefined || messages === null || messages.length === 0);

  // A send is in flight from the first optimistic paint until the persisted
  // transcript takes over. While true, loading skeletons are BANNED — the
  // optimistic user bubble and the one thinking→typing bubble are the sole
  // progress UI (a skeleton here is what made sends look broken/doubled).
  const inFlight = busy || streaming || pendingUser !== null;

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* Conversation column — the sidebar itself lives in the AppShell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact header */}
        <header className="flex h-12 shrink-0 items-center gap-1.5 border-b px-3 sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 md:hidden"
            onClick={() => sidebar.setOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="size-4.5" />
          </Button>

          <div className="min-w-0 flex-1">
            {chatId ? (
              chat === undefined ? (
                inFlight ? (
                  // Mid-send: no skeleton flash in the header either — a calm
                  // fallback title until the real one arrives.
                  <h1 className="truncate text-sm font-medium">Conversation</h1>
                ) : (
                  <Skeleton className="h-4 w-40" />
                )
              ) : (
                <h1 className="truncate text-sm font-medium">{chat?.title ?? "Conversation"}</h1>
              )
            ) : (
              <h1 className="text-sm font-medium">New chat</h1>
            )}
          </div>

          {chatId ? (
            <>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" onClick={() => setShareOpen(true)}>
                <Share2 className="size-3.5" /> <span className="hidden sm:inline">Share</span>
              </Button>
              <DeleteChatButton chatId={chatId} onDeleted={newChat} />
            </>
          ) : null}

          <Button variant="ghost" size="sm" className="hidden h-8 gap-1.5 px-2.5 text-xs lg:inline-flex" onClick={newChat}>
            <Plus className="size-3.5" /> New
          </Button>

          {/* Sidebar toggle — one sidebar, closed by default, opened here */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden size-8 md:inline-flex"
            onClick={sidebar.toggle}
            aria-label={sidebar.open ? "Close sidebar" : "Open sidebar"}
            aria-expanded={sidebar.open}
          >
            {sidebar.open ? <PanelRightClose className="size-4.5" /> : <PanelRightOpen className="size-4.5" />}
          </Button>
        </header>

        {sendError ? (
          <div
            role="alert"
            data-testid="send-error"
            className="mx-4 mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {sendError}
          </div>
        ) : null}

        {/* Transcript */}
        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
          <QueryBoundary>
            <div className="mx-auto w-full max-w-3xl px-4 py-6">
              {showExamples ? (
                <EmptyState userName={user?.name} onExample={(text) => setPreset({ text, key: Date.now() })} />
              ) : null}

              {/* Skeleton ONLY when loading a transcript nobody is sending
                  into (e.g. opening a chat from history). Mid-send the
                  optimistic bubble + thinking dots are the loading state. */}
              {messages === undefined && chatId && !inFlight ? <TranscriptSkeleton /> : null}

              {visibleMessages?.map((m) => (
                <MessageRow key={m._id} message={m} />
              ))}

              {pendingUser && !pendingReflected ? <UserBubble content={pendingUser.content} pending /> : null}

              {streaming ? (
                <AssistantMessage>
                  {streamText!.length === 0 ? (
                    <ThinkingIndicator />
                  ) : (
                    <ChatMarkdown content={streamText!} />
                  )}
                </AssistantMessage>
              ) : null}
            </div>
          </QueryBoundary>
        </div>

        {/* Composer */}
        <div className="shrink-0 px-3 pb-4 pt-1 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              mode={mode}
              onModeChange={setMode}
              format={format}
              onFormatChange={setFormat}
              onSend={(text) => void send(text)}
              onStop={stop}
              streaming={streaming}
              busy={busy}
              preset={preset}
            />
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {mode === "document"
                ? "Document Mode generates from this conversation — switch back to Chat anytime."
                : "Filo can make mistakes — verify important information."}
            </p>
          </div>
        </div>
      </div>

      {/* Share dialog */}
      <ShareChatDialog chatId={chatId} open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  );
}

// =============================================================================
// Message rows
// =============================================================================

function MessageRow({ message }: { message: TranscriptMessage }) {
  if (message.role === "user") {
    return <UserBubble content={message.content} />;
  }

  // Error turn (assistant message with metadata.error and no content)
  if (message.metadata?.error && !message.content) {
    return (
      <div className="mb-5 flex items-start gap-2.5">
        <Avatar className="mt-0.5 size-7 shrink-0 border border-primary/20 bg-primary/10">
          <AvatarFallback className="text-[10px] text-primary">F</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {message.metadata.error}
        </div>
      </div>
    );
  }

  const sources = toChatSources(message.metadata?.sources);
  return (
    <AssistantMessage rawContent={message.content || undefined}>
      {message.content ? <ChatMarkdown content={message.content} /> : null}
      {sources.length > 0 ? <SourcesBlock sources={sources} /> : null}
      {message.metadata?.kind === "generation" && message.metadata.jobId ? (
        <GenerationCard
          jobId={message.metadata.jobId}
          artifactType={message.metadata.artifactType}
          outputFormat={message.metadata.outputFormat}
        />
      ) : null}
    </AssistantMessage>
  );
}

function UserBubble({ content, pending }: { content: string; pending?: boolean }) {
  return (
    <div className={cn("mb-5 flex justify-end", pending && "opacity-80")}>
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[14.5px] leading-relaxed text-primary-foreground">
        {content}
      </div>
    </div>
  );
}

function AssistantMessage({
  children,
  rawContent,
}: {
  children: ReactNode;
  /** Raw markdown of the message — when present a copy action appears
   *  BELOW the response (always visible, quiet styling). */
  rawContent?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative mb-5 flex items-start gap-2.5">
      <Avatar className="mt-0.5 size-7 shrink-0 border border-primary/20 bg-primary/10">
        <AvatarFallback className="text-[10px] font-semibold text-primary">F</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        {children}
        {rawContent ? (
          <div className="mt-1 flex items-center">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(rawContent).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                });
              }}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                copied && "text-success hover:text-success"
              )}
              aria-label="Copy message"
              title="Copy message"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// =============================================================================
// ThinkingIndicator — shown from the moment a chat message is sent until the
// first typed characters arrive (three bouncing dots + label).
// =============================================================================
function ThinkingIndicator() {
  return (
    <span className="flex items-center gap-2.5 py-1 text-sm text-muted-foreground" role="status">
      <span className="thinking-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      Thinking…
    </span>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading conversation">
      <div className="flex justify-end">
        <Skeleton className="h-10 w-2/3 rounded-2xl" />
      </div>
      <div className="flex items-start gap-2.5">
        <Skeleton className="size-7 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Empty state — honest (no fake history), useful (real entry points)
// =============================================================================
const EXAMPLES = [
  {
    icon: MessageSquare,
    title: "Research a topic",
    prompt: "Research the state of solid-state batteries and summarize where the technology stands today.",
  },
  {
    icon: Sparkles,
    title: "Draft an idea",
    prompt: "Draft a project proposal for a customer loyalty program for a mid-size coffee chain.",
  },
  {
    icon: FileText,
    title: "Then make a document",
    prompt: "I need a professional briefing document about remote-work policy — ask me for the details you need first.",
  },
];

function EmptyState({
  userName,
  onExample,
}: {
  userName?: string;
  onExample: (prompt: string) => void;
}) {
  const firstName = (userName ?? "there").split(" ")[0];
  return (
    <div className="flex flex-col items-center py-10 text-center sm:py-16">
      <WelcomeOrb className="mb-1" />
      <h2 className="mt-4 text-xl font-semibold tracking-tight">Hi {firstName} — what are we working on?</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        Research a topic, think through an idea, then switch to Document Mode to turn the
        conversation into a finished file.
      </p>
      <div className="mt-8 grid w-full gap-2 sm:grid-cols-3">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.title}
            onClick={() => onExample(ex.prompt)}
            className="group rounded-xl border bg-card p-3.5 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
          >
            <ex.icon className="size-4 text-primary" />
            <p className="mt-2 text-[13px] font-medium">{ex.title}</p>
            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">{ex.prompt}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// DeleteChatButton — header trash with confirm
// =============================================================================
function DeleteChatButton({ chatId, onDeleted }: { chatId: string; onDeleted: () => void }) {
  const { token } = useFiloSession();
  const removeChat = useMutation(api.chats.remove);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    setError(null);
    try {
      await removeChat({ session: token!, chatId: chatId as any });
      setOpen(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the chat");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="hidden size-8 text-muted-foreground hover:text-destructive sm:inline-flex"
        onClick={() => setOpen(true)}
        aria-label="Delete this chat"
      >
        <Trash2 className="size-4" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              The entire transcript will be permanently removed. Shared links to it will stop
              working. Documents you generated stay in your library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirm();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete chat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
