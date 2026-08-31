"use client";

// =============================================================================
// /chat/[chatId] — deep link to a specific conversation. Same unified
// workspace, opened on an existing chat (history sidebar → shareable URL).
// =============================================================================
import { use } from "react";
import { ChatWorkspace } from "@/components/chat/workspace";

export default function ChatDetailPage({ params }: { params: Promise<{ chatId: string }> }) {
  // Next.js 16 passes params as a promise; unwrap with React.use() so the
  // workspace mounts with the id on the first render.
  const { chatId } = use(params);
  return <ChatWorkspace initialChatId={chatId} />;
}
