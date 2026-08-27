import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// =============================================================================
// FILE METADATA (Convex) — actual bytes live in Cloudflare R2.
// The Next.js upload route registers every successful R2 upload here, so the
// file manager, storage quotas, and admin storage metrics are all real.
// =============================================================================

/**
 * Register a file AFTER a successful R2 upload. The r2Key is supplied by the
 * server route (never trusted from the client). Also records one
 * `file_upload` usage record for quota metering.
 */
export const registerFile = mutation({
  args: {
    userId: v.id("users"),
    originalName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    r2Key: v.string(),
    r2Bucket: v.optional(v.string()),
    artifactId: v.optional(v.id("artifacts")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const fileId = await ctx.db.insert("files", {
      userId: args.userId,
      artifactId: args.artifactId,
      originalName: args.originalName,
      mimeType: args.mimeType,
      size: args.size,
      r2Key: args.r2Key,
      r2Bucket: args.r2Bucket || "filo-uploads",
      uploaded: true,
      createdAt: now,
    });

    // Usage record (storage metering happens by summing files.size).
    const d = new Date(now);
    await ctx.db.insert("usageRecords", {
      userId: args.userId,
      type: "file_upload",
      amount: 1,
      periodStart: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
      periodEnd: new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime(),
      createdAt: now,
    });

    return fileId;
  },
});

// Get user's files (newest first)
export const getUserFiles = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("files")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(500);
  },
});

/**
 * Delete a file's metadata row. Ownership is verified here AND in the API
 * route (defense in depth). R2 object deletion happens in the API route,
 * which owns the AWS SDK credentials.
 */
export const deleteFile = mutation({
  args: { fileId: v.id("files"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) throw new Error("File not found");
    if (file.userId !== args.userId) throw new Error("Forbidden: not your file");

    await ctx.db.delete(args.fileId);
    return { success: true, r2Key: file.r2Key };
  },
});

/** Storage used by a user (bytes) — computed in Convex for quota checks. */
export const getStorageUsage = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("files")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    return {
      bytes: files.reduce((sum, f) => sum + (f.size || 0), 0),
      count: files.length,
    };
  },
});

/** Fetch a single file row with ownership check (used by the delete route). */
export const getFileForUser = query({
  args: { fileId: v.id("files"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file || file.userId !== args.userId) return null;
    return file;
  },
});
