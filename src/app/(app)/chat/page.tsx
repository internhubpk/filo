"use client";

// =============================================================================
// /chat — the unified workspace home (new chat, empty state).
// =============================================================================
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChatWorkspace } from "@/components/chat/workspace";

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatFallback />}>
      <ChatWorkspaceWithParams />
    </Suspense>
  );
}

function ChatWorkspaceWithParams() {
  const params = useSearchParams();
  const mode = params.get("mode") === "document" ? ("document" as const) : undefined;
  return <ChatWorkspace initialMode={mode} />;
}

function ChatFallback() {
  return <div className="flex-1 bg-background" />;
}
