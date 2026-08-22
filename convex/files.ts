import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Generate presigned URL for upload (client sends file directly to R2)
export const generateUploadUrl = mutation({
  args: {
    userId: v.id("users"),
    originalName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    artifactId: v.optional(v.id("artifacts")),
  },
  handler: async (ctx, args) => {
    // Create file record in Convex
    const fileId = await ctx.db.insert("files", {
      userId: args.userId,
      artifactId: args.artifactId,
      originalName: args.originalName,
      mimeType: args.mimeType,
      size: args.size,
      r2Key: `uploads/${args.userId}/${Date.now()}-${args.originalName}`,
      r2Bucket: process.env.R2_BUCKET_NAME || "filo-uploads",
      uploaded: false,
      createdAt: Date.now(),
    });

    // In production, you'd generate a presigned URL here using AWS SDK
    // For now, return the file ID and expected key
    return {
      fileId,
      r2Key: `uploads/${args.userId}/${Date.now()}-${args.originalName}`,
      // Presigned URL would be generated server-side
      // uploadUrl: await generatePresignedUrl(r2Key, mimeType),
    };
  },
});

// Mark file as uploaded after successful R2 upload
export const markFileUploaded = mutation({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.fileId, {
      uploaded: true,
    });
    
    // Record usage
    const file = await ctx.db.get(args.fileId);
    if (file) {
      // Get current month's start and end
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();

      await ctx.db.insert("usageRecords", {
        userId: file.userId,
        type: "file_upload",
        amount: 1,
        periodStart,
        periodEnd,
        createdAt: Date.now(),
      });
    }
  },
});

// Get user's files
export const getUserFiles = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("files")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
  },
});

// Delete file (from R2 and Convex)
export const deleteFile = mutation({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) throw new Error("File not found");

    // Delete from R2 (in production, use AWS SDK)
    // await deleteFromR2(file.r2Key);

    // Delete from Convex
    await ctx.db.delete(args.fileId);
    
    return { success: true };
  },
});
