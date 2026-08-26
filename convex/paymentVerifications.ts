// =============================================================================
// FILO Payment Verifications - Manual Admin-Verified Payment Flow
// =============================================================================
// Replaces the SafePay automatic checkout flow.
//
// Lifecycle:
//   1. User picks a plan on /pricing or /billing.
//   2. User pays externally (bank transfer, EasyPaisa, JazzCash, etc.) and
//      submits the transaction details via /api/payments/submit.
//   3. The submission lands here as a "pending" paymentVerification record.
//   4. An admin reviews the submission in /admin and either approves
//      (which flips the user's status to "active" so they can generate)
//      or rejects (with a reason surfaced back to the user).
// =============================================================================

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ==================== USER-FACING ====================

/**
 * Create a new payment verification submission (called by user from /billing).
 * Returns the id of the created record so the client can show a success state.
 */
export const createVerification = mutation({
  args: {
    userId: v.id("users"),
    planId: v.optional(v.id("plans")),
    amount: v.number(),
    currency: v.string(),
    paymentMethod: v.string(),
    transactionId: v.string(),
    proofUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const verificationId = await ctx.db.insert("paymentVerifications", {
      userId: args.userId,
      planId: args.planId,
      amount: args.amount,
      currency: args.currency,
      paymentMethod: args.paymentMethod,
      transactionId: args.transactionId,
      proofUrl: args.proofUrl,
      notes: args.notes,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return verificationId;
  },
});

/**
 * Get all payment verifications submitted by a given user (newest first).
 * Used on /billing to show the user their submission history + status.
 */
export const getMyVerifications = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("paymentVerifications")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
  },
});

/**
 * Get the most recent verification for a user (used by dashboard to show
 * "your payment is being reviewed" banner without fetching the full list).
 */
export const getLatestVerification = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("paymentVerifications")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .first();
  },
});

// ==================== ADMIN-FACING ====================

/**
 * List all pending payment verifications (admin only).
 * Newest first so admin sees the freshest submissions at the top.
 */
export const getPendingVerifications = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("paymentVerifications")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .take(200);
  },
});

/**
 * List ALL payment verifications regardless of status (admin only).
 * Used for the audit/history view in the admin panel.
 */
export const getAllVerifications = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("paymentVerifications")
      .order("desc")
      .take(200);
  },
});

// ==================== ADMIN ACTIONS ====================

/**
 * Approve a payment verification.
 * Side effects:
 *   - Marks the verification as "approved" with reviewer info + admin note.
 *   - Flips the user's status to "active" so they can generate artifacts.
 *   - Optionally stamps the chosen planId onto the user record.
 *
 * This is the "unlock" action: until this runs, the user cannot perform
 * chat/AI generation. After this runs, they immediately have access.
 */
export const approveVerification = mutation({
  args: {
    verificationId: v.id("paymentVerifications"),
    reviewedBy: v.optional(v.string()),
    adminNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification) {
      throw new Error("Verification record not found");
    }

    if (verification.status !== "pending") {
      throw new Error(
        `Verification already ${verification.status} (cannot approve again)`
      );
    }

    const now = Date.now();

    // 1. Update the verification record
    await ctx.db.patch(args.verificationId, {
      status: "approved",
      reviewedBy: args.reviewedBy ?? "admin",
      reviewedAt: now,
      adminNote: args.adminNote,
      updatedAt: now,
    });

    // 2. Activate the user (this unlocks AI generation)
    const userUpdates: Record<string, unknown> = {
      status: "active",
      activatedAt: now,
      activationNote: args.adminNote ?? "Payment verified by admin",
      updatedAt: now,
    };

    if (verification.planId) {
      userUpdates.planId = verification.planId;
    }

    await ctx.db.patch(verification.userId, userUpdates);

    return {
      success: true,
      verificationId: args.verificationId,
      userId: verification.userId,
      activated: true,
    };
  },
});

/**
 * Reject a payment verification with a reason.
 * Side effects:
 *   - Marks the verification as "rejected" with reviewer info + admin note.
 *   - The user's status is NOT changed (they remain in whatever state they
 *     were in - typically still "pending_activation"). The admin note is
 *     surfaced back to the user so they can re-submit with correct info.
 */
export const rejectVerification = mutation({
  args: {
    verificationId: v.id("paymentVerifications"),
    reviewedBy: v.optional(v.string()),
    adminNote: v.string(), // reason is required for rejection
  },
  handler: async (ctx, args) => {
    const verification = await ctx.db.get(args.verificationId);
    if (!verification) {
      throw new Error("Verification record not found");
    }

    if (verification.status !== "pending") {
      throw new Error(
        `Verification already ${verification.status} (cannot reject again)`
      );
    }

    const now = Date.now();

    await ctx.db.patch(args.verificationId, {
      status: "rejected",
      reviewedBy: args.reviewedBy ?? "admin",
      reviewedAt: now,
      adminNote: args.adminNote,
      updatedAt: now,
    });

    return {
      success: true,
      verificationId: args.verificationId,
      userId: verification.userId,
      activated: false,
    };
  },
});
