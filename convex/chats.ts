// =============================================================================
// FILO CHAT — Convex backend for the unified chat workspace
// =============================================================================
// AUTH MODEL (rebuild v2): every owner-scoped function takes the user's
// HMAC session TOKEN (issued by src/lib/session.ts at login) and verifies it
// cryptographically INSIDE Convex via lib/session.requireUser. A bare userId
// argument is never trusted — anyone holding the public deployment URL can
// pass arbitrary ids, so verification must happen where the data lives.
// After authentication, every read/write still re-checks ownership
// (chat.userId === user._id) so a valid session can only ever touch its own
// rows. Fail-closed on: bad signature, expired token, deleted/suspended
// account, foreign chat id.
//
// Public share access goes exclusively through `getSharedByToken`, which
// resolves the 32-byte random share token and NEVER exposes the owner's id,
// email, or any other user's data.
//
// The client subscribes reactively (useQuery) — there are NO polling loops
// and NO duplicate subscription paths in this module.
// =============================================================================

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser } from "./lib/session";

// ==================== QUERIES (reactive) ====================

/**
 * Sidebar list — newest activity first. Reactive; `undefined` = subscription
 * still loading (the client MUST render a skeleton, never an empty state).
 */
export const listForUser = query({
  args: {
    session: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.session);
    return await ctx.db
      .query("chats")
      .withIndex("by_userId_lastMessageAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 100);
  },
});

/** Single chat with ownership check (null when absent or not owned). */
export const getForUser = query({
  args: { session: v.string(), chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.session);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== user._id) return null;
    return chat;
  },
});

/**
 * Full transcript for one chat, oldest first. Ownership is verified against
 * the chat BEFORE any message leaves the database.
 */
export const messagesForUser = query({
  args: { session: v.string(), chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.session);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== user._id) return null;
    return await ctx.db
      .query("messages")
      .withIndex("by_chatId_createdAt", (q) => q.eq("chatId", args.chatId))
      .order("asc")
      .collect();
  },
});

// ==================== PUBLIC SHARE QUERY ====================

/**
 * Resolve a public share link. Returns a SANITIZED projection only — the
 * owner's userId, email and plan never leave the database. Null when the
 * token does not exist (tokens are 32 random bytes; there is no enumeration
 * path and no rate-limit-visible error to probe).
 */
export const getSharedByToken = query({
  args: {
    token: v.string(),
    includeMessages: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (token.length < 20) return null; // malformed → same answer as unknown
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", token))
      .first();
    if (!chat) return null;
    const messages = args.includeMessages
      ? await ctx.db
          .query("messages")
          .withIndex("by_chatId_createdAt", (q) => q.eq("chatId", chat._id))
          .order("asc")
          .collect()
      : undefined;
    return {
      chatId: chat._id,
      title: chat.title,
      permission: chat.sharePermission ?? "view",
      sharedAt: chat.sharedAt ?? chat.updatedAt,
      updatedAt: chat.updatedAt,
      messages:
        messages?.map((m) => ({
          _id: m._id,
          role: m.role,
          content: m.content,
          metadata: m.metadata,
          createdAt: m.createdAt,
        })) ?? undefined,
    };
  },
});

// ==================== SERVER-ONLY SHARE RESOLUTION ====================

/**
 * SERVER-ONLY (FILO_SERVER_SECRET enforced): resolve the owner behind a
 * share token so the shared-send route can enforce the OWNER's entitlement
 * and quota before any AI spend. Never callable with just a deployment URL;
 * the public share projection never exposes this data.
 */
export const getOwnerForShareToken = query({
  args: { serverToken: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const secret = process.env.FILO_SERVER_SECRET;
    if (!secret || args.serverToken.length !== secret.length) {
      throw new Error("Unauthorized: invalid server token");
    }
    let diff = 0;
    for (let i = 0; i < secret.length; i++) {
      diff |= secret.charCodeAt(i) ^ args.serverToken.charCodeAt(i);
    }
    if (diff !== 0) throw new Error("Unauthorized: invalid server token");

    const token = args.token.trim();
    if (token.length < 20) return null;
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", token))
      .first();
    if (!chat) return null;
    const user = await ctx.db.get(chat.userId);
    if (!user) return null;
    return {
      userId: chat.userId,
      status: user.status ?? "active",
    };
  },
});

// ==================== MUTATIONS ====================

/** Create a chat. Title is provisional — the first send renames it. */
export const create = mutation({
  args: {
    session: v.string(),
    title: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("chat"), v.literal("document"))),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.session);
    const now = Date.now();
    const chatId = await ctx.db.insert("chats", {
      userId: user._id,
      title: (args.title ?? "New chat").slice(0, 120),
      lastMode: args.mode ?? "chat",
      lastMessageAt: now,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return chatId;
  },
});

/**
 * Append one message and touch the chat (preview + counters). Ownership
 * enforced. `mode` optionally updates the chat's last used mode (document
 * sends flip the chat to "document" so the sidebar can badge it).
 */
export const appendMessage = mutation({
  args: {
    session: v.string(),
    chatId: v.id("chats"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    metadata: v.optional(v.any()),
    mode: v.optional(v.union(v.literal("chat"), v.literal("document"))),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.session);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== user._id) {
      throw new Error("Chat not found");
    }
    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      chatId: args.chatId,
      userId: user._id,
      role: args.role,
      content: args.content,
      metadata: args.metadata,
      createdAt: now,
    });
    await ctx.db.patch(args.chatId, {
      lastMessageAt: now,
      updatedAt: now,
      lastMessagePreview: args.content.slice(0, 160),
      messageCount: chat.messageCount + 1,
      ...(args.mode ? { lastMode: args.mode } : {}),
    });
    return messageId;
  },
});

/** Rename a chat (owner only). */
export const rename = mutation({
  args: { session: v.string(), chatId: v.id("chats"), title: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.session);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== user._id) throw new Error("Chat not found");
    const title = args.title.trim().slice(0, 120);
    if (!title) throw new Error("Title cannot be empty");
    await ctx.db.patch(args.chatId, { title, updatedAt: Date.now() });
    return { success: true };
  },
});

/**
 * Delete a chat and its ENTIRE transcript. Ownership enforced. Message rows
 * are purged explicitly — chat deletion must never leave orphan messages.
 */
export const remove = mutation({
  args: { session: v.string(), chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.session);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== user._id) throw new Error("Chat not found");
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .collect();
    for (const m of messages) {
      await ctx.db.delete(m._id);
    }
    await ctx.db.delete(args.chatId);
    return { success: true, deletedMessages: messages.length };
  },
});

/**
 * Truncate a transcript FROM a message. `inclusive: true` deletes that
 * message and everything after it (message EDIT: the old turn is dropped,
 * the edited prompt is re-sent as a fresh row). `inclusive: false` keeps
 * the message and deletes only what follows (REGENERATE: keep the prompt,
 * drop the reply). Ownership enforced on chat AND anchor message. Chat
 * counters/preview fall back to the surviving tail.
 */
export const truncateFrom = mutation({
  args: {
    session: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    inclusive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.session);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== user._id) throw new Error("Chat not found");
    const anchor = await ctx.db.get(args.messageId);
    if (!anchor || anchor.chatId !== args.chatId) throw new Error("Message not found");
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chatId_createdAt", (q) => q.eq("chatId", args.chatId))
      .order("asc")
      .collect();
    const idx = messages.findIndex((m) => m._id === args.messageId);
    if (idx === -1) throw new Error("Message not found");
    const doomed = messages.slice(args.inclusive ? idx : idx + 1);
    for (const m of doomed) {
      await ctx.db.delete(m._id);
    }
    const remaining = messages.slice(0, args.inclusive ? idx : idx + 1);
    const last = remaining[remaining.length - 1];
    await ctx.db.patch(args.chatId, {
      messageCount: Math.max(0, chat.messageCount - doomed.length),
      lastMessageAt: last?.createdAt ?? chat.createdAt,
      lastMessagePreview: last ? last.content.slice(0, 160) : "",
      updatedAt: Date.now(),
    });
    return { success: true, deletedMessages: doomed.length };
  },
});

// ==================== SHARING ====================

/**
 * Create or rotate a share link. The token is 32 cryptographically random
 * bytes (base64url, ~43 chars) — non-guessable by construction. Rotation
 * replaces the old token so previously-shared links die immediately.
 * `permission: null` revokes sharing entirely.
 */
export const setShare = mutation({
  args: {
    session: v.string(),
    chatId: v.id("chats"),
    permission: v.union(v.literal("view"), v.literal("edit"), v.null()),
    token: v.optional(v.string()), // fresh token generated by the API route
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.session);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== user._id) throw new Error("Chat not found");
    if (args.permission === null) {
      await ctx.db.patch(args.chatId, {
        shareToken: undefined,
        sharePermission: undefined,
        sharedAt: undefined,
        updatedAt: Date.now(),
      });
      return { shared: false };
    }
    if (!args.token || args.token.length < 32) {
      throw new Error("A cryptographically random share token is required");
    }
    await ctx.db.patch(args.chatId, {
      shareToken: args.token,
      sharePermission: args.permission,
      sharedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { shared: true, token: args.token, permission: args.permission };
  },
});

/**
 * Append a message from a shared-chat visitor with EDIT permission. The
 * share token IS the credential — verified against the live chat row, and
 * the stored permission must still be "edit" at write time. Messages land
 * under the OWNER's userId (the chat is theirs); the visitor never gains
 * an account, a session, or access to any other chat.
 */
export const appendSharedMessage = mutation({
  args: {
    token: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (token.length < 20) throw new Error("Invalid share token");
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", token))
      .first();
    if (!chat) throw new Error("Share link is no longer valid");
    if ((chat.sharePermission ?? "view") !== "edit") {
      throw new Error("This chat is shared with view-only permission");
    }
    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      chatId: chat._id,
      userId: chat.userId,
      role: args.role,
      content: args.content,
      metadata: args.metadata,
      createdAt: now,
    });
    await ctx.db.patch(chat._id, {
      lastMessageAt: now,
      updatedAt: now,
      lastMessagePreview: args.content.slice(0, 160),
      messageCount: chat.messageCount + 1,
    });
    return messageId;
  },
});
