import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// SECURITY: user documents contain `passwordHash`, which must never leave
// the database. Public queries below strip it before returning. Hash access
// happens ONLY inside Convex via the internalQuery `getUserAuthDataByEmail`
// (used by the login action) — an internal function cannot be invoked from
// outside the Convex deployment.
type PublicUser = Record<string, unknown> | null;

function stripSecrets<T extends { passwordHash?: string }>(
  user: T | null
): PublicUser {
  if (!user) return null;
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

// ==================== QUERIES ====================

// Get user by ID (public — secrets stripped)
export const getUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return stripSecrets(await ctx.db.get(args.userId));
  },
});

// Get user by email (public — secrets stripped)
export const getUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return stripSecrets(
      await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .first()
    );
  },
});

// INTERNAL: full user record including passwordHash for credential checks.
// Only callable from within Convex (actions/mutations in this deployment).
export const getUserAuthDataByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
  },
});

// Get just the user's activation status (lightweight check for client gating)
export const getUserStatus = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return { exists: false, status: null as null | string };
    }
    return {
      exists: true,
      status: user.status ?? "pending_activation",
      name: user.name,
      email: user.email,
      planId: user.planId ?? null,
    };
  },
});

// Admin: list all users (newest first) — secrets stripped
export const getAllUsers = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db
      .query("users")
      .order("desc")
      .take(200);
    return users.map(stripSecrets);
  },
});

// Admin: list users pending activation — secrets stripped
export const getPendingUsers = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_status", (q) => q.eq("status", "pending_activation"))
      .order("desc")
      .take(200);
    return users.map(stripSecrets);
  },
});

// Admin: list active users — secrets stripped
export const getActiveUsers = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc")
      .take(200);
    return users.map(stripSecrets);
  },
});

// Create new user
export const createUser = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    image: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if user already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existing) {
      return existing;
    }

    // Create new user. Payments have been removed — every signup is
    // activated instantly so the user can generate right away. Admins can
    // still suspend abusive accounts via the admin panel.
    const userId = await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      image: args.image,
      status: "active",
      activatedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return await ctx.db.get(userId);
  },
});

// Update user profile.
//
// SECURITY: `planId` changes are BILLING-sensitive (they gate AI
// generation and plan entitlements). This mutation is reachable directly
// through the Convex HTTP API by anyone holding the deployment URL, so a
// planId change now requires the shared server token (same guard as
// billing/generation). Name/image changes stay open — they are only routed
// through the ownership-checked /api/user/profile endpoint.
// Deployments without FILO_SERVER_SECRET configured (throwaway local dev)
// still allow the change so local test harnesses keep working.
export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    planId: v.optional(v.id("plans")),
    serverToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.planId !== undefined) {
      const secret = process.env.FILO_SERVER_SECRET;
      if (secret) {
        if (
          typeof args.serverToken !== "string" ||
          args.serverToken.length !== secret.length ||
          args.serverToken !== secret
        ) {
          throw new Error(
            "Unauthorized: plan changes require a valid server token"
          );
        }
      }
    }

    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) updates.name = args.name;
    if (args.image !== undefined) updates.image = args.image;
    if (args.planId !== undefined) updates.planId = args.planId;

    await ctx.db.patch(args.userId, updates);

    return await ctx.db.get(args.userId);
  },
});

// Delete user account
export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Delete all user's files
    const files = await ctx.db
      .query("files")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    
    for (const file of files) {
      // TODO: Delete from R2
      await ctx.db.delete(file._id);
    }

    // Delete all artifacts
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    for (const artifact of artifacts) {
      await ctx.db.delete(artifact._id);
    }

    // Delete sessions (uses the declared by_userId index instead of a scan)
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    // Finally delete user
    await ctx.db.delete(args.userId);

    return { success: true };
  },
});

// Create user with password hash.
// INTERNAL: password hash insertion must never be callable from outside the
// Convex deployment. Called exclusively by the signup action in auth.ts,
// which hashes the password inside Convex so plaintext hashes do not travel
// over the network or appear in client-callable argument surfaces.
export const createUserWithPassword = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    image: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if user already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existing) {
      return existing._id;
    }

    // Resolve the Free plan so every new account starts with real,
    // enforceable limits (quota reads user.planId → plans.maxAiGenerations).
    // If the plans table is empty (unseeded deployment) the assignment is
    // simply skipped and the billing overview falls back to the Free plan
    // at read time.
    const freePlan = await ctx.db
      .query("plans")
      .withIndex("by_tier", (q) => q.eq("tier", "free"))
      .first();

    // Create new user with password hash, activated instantly (payments
    // removed). Admins retain suspend/activate controls for moderation.
    const userId = await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      image: args.image,
      passwordHash: args.passwordHash,
      planId: freePlan?._id,
      status: "active",
      activatedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return userId;
  },
});

// Internal: create a user with a specific role (used by the env-admin
// bootstrap inside Convex; NOT publicly invokable).
export const createUserInternal = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    isAdmin: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      passwordHash: args.passwordHash,
      isAdmin: args.isAdmin,
      status: "active",
      activatedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

// ==================== ADMIN MUTATIONS ====================

// Admin: re-activate a previously SUSPENDED account (suspension lift only —
// plan entitlements come exclusively from verified payments)
export const activateUser = mutation({
  args: {
    userId: v.id("users"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // POLICY (rebuild v2): admins may only lift a SUSPENSION. Paid plans and
    // their entitlements are granted EXCLUSIVELY by the billing webhook /
    // verified Safepay signals — a manual plan change here would create an
    // unpaid entitlement (the exact flow the rebuild removed).
    if (user.status !== "suspended") {
      throw new Error(
        "Only suspended accounts can be re-activated by an admin. Subscriptions and plan entitlements are activated automatically by verified payments."
      );
    }

    const updates: Record<string, unknown> = {
      status: "active",
      activatedAt: Date.now(),
      activationNote: args.note,
      updatedAt: Date.now(),
    };

    await ctx.db.patch(args.userId, updates);
    return await ctx.db.get(args.userId);
  },
});

// Admin: suspend a user account (revoke AI generation access)
export const suspendUser = mutation({
  args: {
    userId: v.id("users"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(args.userId, {
      status: "suspended",
      activationNote: args.note,
      updatedAt: Date.now(),
    });

    return await ctx.db.get(args.userId);
  },
});

// Admin: reset a user back to pending state (e.g. moderation hold)
export const resetUserToPending = mutation({
  args: {
    userId: v.id("users"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(args.userId, {
      status: "pending_activation",
      activationNote: args.note,
      updatedAt: Date.now(),
    });

    return await ctx.db.get(args.userId);
  },
});

// =============================================================================
// ADMIN ROLE MANAGEMENT (server-side enforced)
// =============================================================================

export const setUserRole = mutation({
  args: {
    serverToken: v.string(),
    adminUserId: v.id("users"),
    targetUserId: v.id("users"),
    isAdmin: v.boolean(),
  },
  handler: async (ctx, args) => {
    const secret = process.env.FILO_SERVER_SECRET;
    if (!secret || args.serverToken !== secret) {
      throw new Error("Unauthorized: invalid server token");
    }
    const admin = await ctx.db.get(args.adminUserId);
    if (!admin || admin.isAdmin !== true || admin.status !== "active") {
      throw new Error("Forbidden: admin privileges required (verified in Convex)");
    }
    const target = await ctx.db.get(args.targetUserId);
    if (!target) throw new Error("Target user not found");

    await ctx.db.patch(args.targetUserId, { isAdmin: args.isAdmin, updatedAt: Date.now() });

    await ctx.db.insert("auditLogs", {
      actorId: args.adminUserId,
      actorEmail: admin.email,
      actorType: "admin",
      action: args.isAdmin ? "user.role.granted" : "user.role.revoked",
      targetType: "user",
      targetId: args.targetUserId,
      metadata: { targetEmail: target.email },
      createdAt: Date.now(),
    });
    return { success: true };
  },
});

// Internal variant used by the seed/bootstrap path (no HTTP surface).
export const setUserRoleInternal = internalMutation({
  args: { targetUserId: v.id("users"), isAdmin: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.targetUserId, { isAdmin: args.isAdmin, updatedAt: Date.now() });
    return { success: true };
  },
});
