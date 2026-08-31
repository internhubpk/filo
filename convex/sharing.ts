// =============================================================================
// FILO SHARING — secure public links for documents (artifacts)
// =============================================================================
// Same token discipline as chats: a 32-byte cryptographically random
// base64url token IS the credential. The public query returns a SANITIZED
// projection (no owner id, no prompt internals beyond the title) and the
// download route re-verifies the token server-side before streaming a single
// byte from storage.
// =============================================================================

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// ==================== QUERIES ====================

/** Owner-scoped share state for the share dialog (null when not owned). */
export const getShareForUser = query({
  args: { artifactId: v.id("artifacts"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.artifactId);
    if (!a || a.userId !== args.userId) return null;
    return {
      artifactId: a._id,
      title: a.title,
      format: a.format,
      type: a.type,
      shareToken: a.shareToken ?? null,
      sharedAt: a.sharedAt ?? null,
    };
  },
});

/**
 * PUBLIC: resolve an artifact share token. Sanitized projection only —
 * userId, prompt and internal metadata never leave the database. Null for
 * unknown/revoked tokens (no error to probe against).
 */
export const getSharedArtifactByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (token.length < 20) return null;
    const a = await ctx.db
      .query("artifacts")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", token))
      .first();
    if (!a) return null;
    return {
      artifactId: a._id,
      title: a.title,
      type: a.type,
      format: a.format,
      status: a.status,
      versionCount: a.versionCount,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      // File handle for the download route (the route re-verifies the token
      // server-side before touching R2).
      fileId: a.fileId ?? null,
    };
  },
});

// ==================== MUTATIONS ====================

/** Create or rotate the share token (owner only). permission is view-only for documents. */
export const shareArtifact = mutation({
  args: {
    artifactId: v.id("artifacts"),
    userId: v.id("users"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.artifactId);
    if (!a || a.userId !== args.userId) throw new Error("Document not found");
    if (!args.token || args.token.length < 32) {
      throw new Error("A cryptographically random share token is required");
    }
    await ctx.db.patch(args.artifactId, {
      shareToken: args.token,
      sharedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { shared: true, token: args.token };
  },
});

/** Revoke the public link (owner only). Old URLs die immediately. */
export const revokeArtifactShare = mutation({
  args: { artifactId: v.id("artifacts"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.artifactId);
    if (!a || a.userId !== args.userId) throw new Error("Document not found");
    await ctx.db.patch(args.artifactId, {
      shareToken: undefined,
      sharedAt: undefined,
      updatedAt: Date.now(),
    });
    return { shared: false };
  },
});

/**
 * SERVER/ROUTE USE — resolve the R2 file row behind a DOCUMENT share token.
 * The token is re-verified HERE against the live artifact row (a stale or
 * revoked token yields null), so the download route can never be talked into
 * streaming an unshared file. Returns only the storage key + filename —
 * no owner identity.
 */
export const getSharedFileByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (token.length < 20) return null;
    const a = await ctx.db
      .query("artifacts")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", token))
      .first();
    if (!a || !a.fileId) return null;
    const file = await ctx.db.get(a.fileId);
    if (!file) return null;
    return {
      r2Key: file.r2Key,
      filename: file.originalName,
      format: a.format,
      title: a.title,
    };
  },
});
