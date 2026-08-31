"use client";

// =============================================================================
// HistoryPanel — the user's chat history (right-hand workspace sidebar).
// =============================================================================
// Subscribes reactively to convex.chats.listForUser. The four states are
// explicit and honest:
//   undefined  → subscription loading  → skeleton rows
//   []         → no chats yet          → real empty state
//   rows       → the list (newest activity first)
//   error      → thrown/rejected       → error row with retry
// Row actions: open, rename (inline), delete (confirm). Active chat is
// highlighted; the row shows the chat's last-used mode when it's "document".
// =============================================================================

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import { useFiloSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface ChatRow {
  _id: string;
  title: string;
  lastMode: "chat" | "document";
  lastMessagePreview?: string;
  lastMessageAt: number;
}

export function HistoryPanel({
  activeChatId,
  onOpenChat,
  onNewChat,
  className,
}: {
  activeChatId: string | null;
  onOpenChat: (chatId: string) => void;
  onNewChat: () => void;
  className?: string;
}) {
  const { token } = useFiloSession();

  // Reactive subscription — NEVER polled; undefined === still loading.
  const chats = useQuery(
    api.chats.listForUser,
    token ? ({ session: token, limit: 100 } as any) : ("skip" as any)
  ) as ChatRow[] | undefined | null;

  const removeChat = useMutation(api.chats.remove);
  const renameChat = useMutation(api.chats.rename);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ChatRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    if (!chats?.length) return [];
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const groups: Array<{ label: string; items: ChatRow[] }> = [
      { label: "Today", items: [] },
      { label: "Yesterday", items: [] },
      { label: "Previous 7 days", items: [] },
      { label: "Older", items: [] },
    ];
    for (const c of chats) {
      const age = now - c.lastMessageAt;
      if (age < dayMs) groups[0].items.push(c);
      else if (age < 2 * dayMs) groups[1].items.push(c);
      else if (age < 8 * dayMs) groups[2].items.push(c);
      else groups[3].items.push(c);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [chats]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      await removeChat({ session: token!, chatId: deleteTarget._id as any });
      if (deleteTarget._id === activeChatId) onNewChat();
      setDeleteTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not delete the chat");
    } finally {
      setDeleting(false);
    }
  }

  async function commitRename() {
    if (!renamingId) return;
    const title = renameValue.trim();
    if (title) {
      try {
        await renameChat({ session: token!, chatId: renamingId as any, title });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Could not rename the chat");
      }
    }
    setRenamingId(null);
  }

  return (
    <div className={cn("flex h-full flex-col", className)} aria-label="Chat history">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pb-2 pt-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">History</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onNewChat}
          aria-label="Start a new chat"
        >
          <Plus className="size-3.5" /> New
        </Button>
      </div>

      {/* Body — four states */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {chats === undefined ? (
          <div className="space-y-1.5 px-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="space-y-1.5 rounded-lg px-2 py-2">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            ))}
          </div>
        ) : chats === null ? (
          <div className="mx-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            Couldn&apos;t load your chat history.
            <Button variant="outline" size="sm" className="mt-2 h-6 w-full text-xs" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        ) : chats.length === 0 ? (
          <div className="mx-1 mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center">
            <MessageSquare className="size-6 text-muted-foreground/50" />
            <p className="text-xs font-medium">No conversations yet</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Start chatting and every conversation will be saved here.
            </p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.label} className="mb-2">
              <p className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((chat) => {
                  const active = chat._id === activeChatId;
                  if (renamingId === chat._id) {
                    return (
                      <li key={chat._id} className="px-1">
                        <div className="flex items-center gap-1 rounded-lg border border-primary/40 bg-background px-2 py-1.5">
                          <Input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void commitRename();
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="h-6 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
                            aria-label="Chat title"
                          />
                          <button onClick={() => void commitRename()} aria-label="Save title" className="text-muted-foreground hover:text-foreground">
                            <Check className="size-3.5" />
                          </button>
                          <button onClick={() => setRenamingId(null)} aria-label="Cancel rename" className="text-muted-foreground hover:text-foreground">
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li key={chat._id} className="group/row relative">
                      <button
                        onClick={() => onOpenChat(chat._id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "w-full rounded-lg px-2.5 py-2 text-left transition-colors",
                          active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          {chat.lastMode === "document" ? (
                            <FileText className="size-3 shrink-0 text-primary" aria-label="Document conversation" />
                          ) : null}
                          <span className={cn("truncate text-[13px]", active ? "font-medium" : "text-foreground/90")}>
                            {chat.title}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {chat.lastMessagePreview ?? timeAgo(chat.lastMessageAt)}
                        </span>
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus:opacity-100 group-hover/row:opacity-100"
                            aria-label={`Actions for ${chat.title}`}
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            onClick={() => {
                              setRenamingId(chat._id);
                              setRenameValue(chat.title);
                            }}
                          >
                            <Pencil className="mr-2 size-3.5" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(chat)}>
                            <Trash2 className="mr-2 size-3.5" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}

        {actionError ? (
          <p className="mx-1 mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">{actionError}</p>
        ) : null}
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.title}&rdquo; and its entire transcript will be permanently removed. Any shared
              links to it will stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete chat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
