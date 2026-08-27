// =============================================================================
// FILO BILLING ENGINE — Safepay sandbox subscriptions
// =============================================================================
// SOURCE OF TRUTH: Convex. Entitlements are granted ONLY here, ONLY after a
// verified Safepay webhook event. The browser can never flip subscription
// state.
//
// SECURITY MODEL
//   Convex public functions are reachable by anyone with the deploy URL, so
//   every function in this module requires `serverToken` — a shared secret
//   (FILO_SERVER_SECRET) known only to the Next.js server runtime and the
//   Convex environment. Fail-closed: if the env var is unset, everything
//   throws. Admin-flavored queries additionally require `adminUserId`, and
//   re-verify the user's live `isAdmin` flag inside Convex.
//
// IDEMPOTENCY
//   Webhook events are keyed by a unique event id. First delivery processes
//   and records the event; duplicate deliveries are recorded with status
//   "duplicate" and never re-applied.
//
// STATE MACHINE (subscriptions.status)
//   pending → active            (payment.succeeded / subscription.payment.succeeded)
//   active  → past_due          (subscription.payment.failed)
//   active  → paused            (subscription.paused)
//   paused  → active            (subscription.resumed)
//   active  → canceled          (subscription.canceled, cancelAtPeriodEnd=true)
//   canceled → ended            (subscription.ended)
//   active  → unpaid            (subscription.unpaid)
//   any     → ended             (subscription.ended)
//   pending → failed            (payment.failed before first success)
// =============================================================================

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// -----------------------------------------------------------------------------
// Server token enforcement (fail-closed)
// -----------------------------------------------------------------------------

function assertServerToken(token: unknown) {
  const secret = process.env.FILO_SERVER_SECRET;
  if (!secret) {
    throw new Error(
      "FILO_SERVER_SECRET is not configured in the Convex environment. " +
        "Billing functions are disabled (fail-closed)."
    );
  }
  if (typeof token !== "string" || token.length !== secret.length) {
    throw new Error("Unauthorized: invalid server token");
  }
  // Length-equal above; constant-time-ish compare.
  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= secret.charCodeAt(i) ^ (token as string).charCodeAt(i);
  }
  if (diff !== 0) throw new Error("Unauthorized: invalid server token");
}

async function assertAdmin(ctx: any, adminUserId: unknown) {
  const user = await ctx.db.get(adminUserId as Id<"users">);
  if (!user || user.isAdmin !== true || user.status !== "active") {
    throw new Error("Forbidden: admin privileges required (verified in Convex)");
  }
  return user;
}

// -----------------------------------------------------------------------------
// QUERIES — user billing
// -----------------------------------------------------------------------------

/** The user's current subscription (latest by createdAt) joined with its plan. */
export const getSubscriptionForUser = query({
  args: { serverToken: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .order("desc")
      .first();
    if (!sub) return null;
    const plan = await ctx.db.get(sub.planId);
    return { ...sub, plan };
  },
});

/** All subscriptions for a user (subscription history), newest first. */
export const getSubscriptionHistory = query({
  args: { serverToken: v.string(), userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit ?? 25);
  },
});

/** Payment history for a user, newest first. */
export const getPaymentsForUser = query({
  args: { serverToken: v.string(), userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    return await ctx.db
      .query("payments")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

/**
 * Full billing overview for the billing page: subscription + plan + payment
 * history + live usage counts. One round-trip from the API route.
 */
export const getBillingOverview = query({
  args: { serverToken: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);

    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .order("desc")
      .first();

    const plan = sub ? await ctx.db.get(sub.planId) : user.planId ? await ctx.db.get(user.planId) : null;

    const payments = await ctx.db
      .query("payments")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .order("desc")
      .take(25);

    // Usage this calendar month.
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const usage = await ctx.db
      .query("usageRecords")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .filter((q: any) => q.gte(q.field("periodStart"), startOfMonth))
      .collect();

    const fileRows = await ctx.db
      .query("files")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .collect();

    const artifactRows = await ctx.db
      .query("artifacts")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .collect();

    return {
      user: { name: user.name, email: user.email, status: user.status },
      subscription: sub,
      plan,
      payments,
      usage: {
        generations: usage
          .filter((u: any) => u.type === "ai_generation")
          .reduce((s: number, u: any) => s + u.amount, 0),
        uploads: usage.filter((u: any) => u.type === "file_upload").length,
        storageBytes: fileRows.reduce((s: number, f: any) => s + (f.size || 0), 0),
        fileCount: fileRows.length,
        artifactCount: artifactRows.length,
        periodStart: startOfMonth,
      },
    };
  },
});

// -----------------------------------------------------------------------------
// QUERIES — admin
// -----------------------------------------------------------------------------

export const adminListSubscriptions = query({
  args: {
    serverToken: v.string(),
    adminUserId: v.id("users"),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    await assertAdmin(ctx, args.adminUserId);
    const limit = args.limit ?? 100;
    const rows = args.status
      ? await ctx.db
          .query("subscriptions")
          .withIndex("by_status", (q: any) => q.eq("status", args.status))
          .order("desc")
          .take(limit)
      : await ctx.db.query("subscriptions").order("desc").take(limit);

    return await Promise.all(
      rows.map(async (s: any) => {
        const user: any = await ctx.db.get(s.userId);
        const plan: any = await ctx.db.get(s.planId);
        return {
          ...s,
          userName: (user && user.name) || "Unknown",
          userEmail: (user && user.email) || "unknown",
          planName: (plan && plan.name) || "Unknown plan",
        };
      })
    );
  },
});

export const adminListPayments = query({
  args: {
    serverToken: v.string(),
    adminUserId: v.id("users"),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    await assertAdmin(ctx, args.adminUserId);
    const limit = args.limit ?? 100;
    const rows = args.status
      ? await ctx.db
          .query("payments")
          .withIndex("by_status", (q: any) => q.eq("status", args.status))
          .order("desc")
          .take(limit)
      : await ctx.db.query("payments").order("desc").take(limit);

    return await Promise.all(
      rows.map(async (p: any) => {
        const user: any = await ctx.db.get(p.userId);
        return {
          ...p,
          userName: (user && user.name) || "Unknown",
          userEmail: (user && user.email) || "unknown",
        };
      })
    );
  },
});

export const adminListWebhookEvents = query({
  args: {
    serverToken: v.string(),
    adminUserId: v.id("users"),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    await assertAdmin(ctx, args.adminUserId);
    const limit = args.limit ?? 100;
    if (args.status) {
      return await ctx.db
        .query("webhookEvents")
        .withIndex("by_processingStatus", (q: any) => q.eq("processingStatus", args.status))
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("webhookEvents").withIndex("by_receivedAt").order("desc").take(limit);
  },
});

export const adminListAuditLogs = query({
  args: {
    serverToken: v.string(),
    adminUserId: v.id("users"),
    action: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    await assertAdmin(ctx, args.adminUserId);
    const limit = args.limit ?? 150;
    if (args.action) {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_action", (q: any) => q.eq("action", args.action))
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("auditLogs").withIndex("by_createdAt").order("desc").take(limit);
  },
});

/** Aggregated billing KPIs for the admin overview. Computed in Convex. */
export const adminBillingStats = query({
  args: { serverToken: v.string(), adminUserId: v.id("users") },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    await assertAdmin(ctx, args.adminUserId);

    const [activeSubs, canceledSubs, pendingSubs, pastDueSubs, allPayments] = await Promise.all([
      ctx.db.query("subscriptions").withIndex("by_status", (q: any) => q.eq("status", "active")).collect(),
      ctx.db.query("subscriptions").withIndex("by_status", (q: any) => q.eq("status", "canceled")).collect(),
      ctx.db.query("subscriptions").withIndex("by_status", (q: any) => q.eq("status", "pending")).collect(),
      ctx.db.query("subscriptions").withIndex("by_status", (q: any) => q.eq("status", "past_due")).collect(),
      ctx.db.query("payments").collect(),
    ]);

    let mrrPkr = 0;
    for (const s of activeSubs as any[]) {
      mrrPkr += s.interval === "yearly" ? s.amount / 12 : s.amount;
    }
    const succeeded = (allPayments as any[]).filter((p) => p.status === "succeeded");
    const revenuePkr = succeeded.reduce((sum, p) => sum + p.amount, 0);
    const failedPayments = (allPayments as any[]).filter((p) => p.status === "failed").length;
    const refundedPayments = (allPayments as any[]).filter((p) => p.status === "refunded").length;

    return {
      activeSubscriptions: activeSubs.length,
      canceledSubscriptions: canceledSubs.length,
      pendingSubscriptions: pendingSubs.length,
      pastDueSubscriptions: pastDueSubs.length,
      mrrPkr: Math.round(mrrPkr),
      revenuePkr,
      totalPayments: (allPayments as any[]).length,
      failedPayments,
      refundedPayments,
      paidUserIds: new Set((activeSubs as any[]).map((s) => s.userId)).size,
    };
  },
});

/**
 * Time-series analytics for admin charts. Buckets by day (UTC) over the
 * requested range. All computed from real database rows.
 */
export const adminAnalytics = query({
  args: {
    serverToken: v.string(),
    adminUserId: v.id("users"),
    days: v.optional(v.number()), // default 30
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    await assertAdmin(ctx, args.adminUserId);
    const days = Math.min(Math.max(args.days ?? 30, 7), 365);

    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const rangeStart = now - days * DAY;

    const [users, payments, artifacts, usage] = await Promise.all([
      ctx.db.query("users").withIndex("by_createdAt").collect(),
      ctx.db.query("payments").withIndex("by_createdAt").collect(),
      ctx.db.query("artifacts").withIndex("by_userId").collect(),
      ctx.db.query("usageRecords").withIndex("by_userId").collect(),
    ]);

    // Day buckets
    const buckets: Record<
      string,
      {
        date: string;
        signups: number;
        revenue: number;
        payments: number;
        generations: number;
        artifacts: number;
      }
    > = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * DAY);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { date: key, signups: 0, revenue: 0, payments: 0, generations: 0, artifacts: 0 };
    }

    for (const u of users as any[]) {
      const key = new Date(u.createdAt).toISOString().slice(0, 10);
      if (buckets[key]) buckets[key].signups++;
    }
    for (const p of payments as any[]) {
      const key = new Date(p.createdAt).toISOString().slice(0, 10);
      if (!buckets[key]) continue;
      if (p.status === "succeeded") {
        buckets[key].revenue += p.amount;
      }
      buckets[key].payments++;
    }
    for (const a of artifacts as any[]) {
      const key = new Date(a.createdAt).toISOString().slice(0, 10);
      if (buckets[key]) buckets[key].artifacts++;
    }
    for (const u of usage as any[]) {
      if (u.type !== "ai_generation") continue;
      const key = new Date(u.createdAt).toISOString().slice(0, 10);
      if (buckets[key]) buckets[key].generations += u.amount;
    }

    const series = Object.values(buckets).filter((b) => b.date >= new Date(rangeStart).toISOString().slice(0, 10));

    // Plan distribution (current user plan assignments)
    const planRows = await ctx.db.query("plans").collect();
    const planCounts: Record<string, number> = {};
    for (const u of users as any[]) {
      const planId = String(u.planId ?? "free");
      planCounts[planId] = (planCounts[planId] ?? 0) + 1;
    }
    const planDistribution = planRows
      .map((p: any) => ({ name: p.name, tier: p.tier ?? p.name.toLowerCase(), count: planCounts[String(p._id)] ?? 0 }))
      .filter((p) => p.count > 0);
    const unassigned = planCounts["free"] ?? 0;
    if (unassigned > 0) planDistribution.push({ name: "Free", tier: "free", count: unassigned });

    // Artifact type distribution
    const typeCounts: Record<string, number> = {};
    for (const a of artifacts as any[]) {
      const t = a.type || "other";
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    }
    const artifactTypes = Object.entries(typeCounts).map(([type, count]) => ({ type, count }));

    return {
      series,
      planDistribution,
      artifactTypes,
      totals: {
        users: (users as any[]).length,
        activeUsers: (users as any[]).filter((u) => u.status === "active").length,
        suspendedUsers: (users as any[]).filter((u) => u.status === "suspended").length,
        artifacts: (artifacts as any[]).length,
      },
    };
  },
});

// -----------------------------------------------------------------------------
// MUTATIONS — checkout flow (called by Next.js API routes)
// -----------------------------------------------------------------------------

/** Create (or reuse) a pending subscription for a plan + interval. */
export const createPendingSubscription = mutation({
  args: {
    serverToken: v.string(),
    userId: v.id("users"),
    planId: v.id("plans"),
    interval: v.union(v.literal("monthly"), v.literal("yearly")),
    amount: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const now = Date.now();

    // Cancel any stale pending subscriptions for this user.
    const stale = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId_status", (q: any) => q.eq("userId", args.userId).eq("status", "pending"))
      .collect();
    for (const s of stale as any[]) {
      await ctx.db.patch(s._id, { status: "ended", endedAt: now, updatedAt: now });
    }

    const id = await ctx.db.insert("subscriptions", {
      userId: args.userId,
      planId: args.planId,
      status: "pending",
      interval: args.interval,
      amount: args.amount,
      currency: args.currency,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

/** Attach Safepay checkout references + create the pending payment row. */
export const recordCheckoutStarted = mutation({
  args: {
    serverToken: v.string(),
    subscriptionId: v.id("subscriptions"),
    userId: v.id("users"),
    planId: v.id("plans"),
    amount: v.number(),
    currency: v.string(),
    trackingId: v.optional(v.string()),
    paymentToken: v.optional(v.string()),
    safepaySubscriptionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const now = Date.now();
    await ctx.db.patch(args.subscriptionId, {
      safepaySubscriptionId: args.safepaySubscriptionId,
      updatedAt: now,
    });
    const paymentId = await ctx.db.insert("payments", {
      userId: args.userId,
      subscriptionId: args.subscriptionId,
      planId: args.planId,
      amount: args.amount,
      currency: args.currency,
      status: "pending",
      safepayTrackingId: args.trackingId,
      safepayPaymentToken: args.paymentToken,
      safepaySubscriptionId: args.safepaySubscriptionId,
      createdAt: now,
      updatedAt: now,
    });
    return paymentId;
  },
});

/** User-initiated cancel at period end (entitlement preserved until period end). */
export const setSubscriptionCancelAtPeriodEnd = mutation({
  args: {
    serverToken: v.string(),
    userId: v.id("users"),
    subscriptionId: v.id("subscriptions"),
    cancel: v.boolean(),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub || sub.userId !== args.userId) throw new Error("Subscription not found");
    if (sub.status !== "active") throw new Error("Only active subscriptions can be canceled");

    await ctx.db.patch(args.subscriptionId, {
      cancelAtPeriodEnd: args.cancel,
      canceledAt: args.cancel ? Date.now() : undefined,
      updatedAt: Date.now(),
    });

    await ctx.db.insert("auditLogs", {
      actorId: args.userId,
      actorType: "user",
      action: args.cancel ? "subscription.cancel_requested" : "subscription.cancel_reverted",
      targetType: "subscription",
      targetId: args.subscriptionId,
      metadata: { cancelAtPeriodEnd: args.cancel },
      createdAt: Date.now(),
    });
    return { success: true };
  },
});

/** Store the Safepay customer id on the user (after first checkout). */
export const setUserCustomer = mutation({
  args: { serverToken: v.string(), userId: v.id("users"), customerId: v.string() },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    await ctx.db.patch(args.userId, { providerCustomerId: args.customerId, updatedAt: Date.now() });
    return { success: true };
  },
});

/** Generic audit-log writer for the API layer (admin actions, auth events). */
export const writeAuditLog = mutation({
  args: {
    serverToken: v.string(),
    actorId: v.optional(v.id("users")),
    actorEmail: v.optional(v.string()),
    actorType: v.union(v.literal("user"), v.literal("admin"), v.literal("system"), v.literal("webhook")),
    action: v.string(),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    await ctx.db.insert("auditLogs", {
      actorId: args.actorId,
      actorEmail: args.actorEmail,
      actorType: args.actorType,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
    return { success: true };
  },
});

// -----------------------------------------------------------------------------
// MUTATIONS — webhook state machine (called ONLY by the verified webhook route)
// -----------------------------------------------------------------------------

/**
 * Begin processing a webhook event. Returns "new" if this is the first
 * delivery (and creates the ledger row), or "duplicate" if the event id was
 * already recorded. Duplicate deliveries NEVER re-run the state machine.
 */
export const beginWebhookEvent = mutation({
  args: {
    serverToken: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_eventId", (q: any) => q.eq("eventId", args.eventId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        processingStatus: "duplicate",
        receivedAt: Date.now(),
      });
      return { duplicate: true as const, eventDbId: existing._id, existing };
    }
    const eventDbId = await ctx.db.insert("webhookEvents", {
      eventId: args.eventId,
      eventType: args.eventType,
      processingStatus: "retrying",
      payload: args.payload,
      retryCount: 0,
      receivedAt: Date.now(),
    });
    return { duplicate: false as const, eventDbId };
  },
});

/** Mark a webhook event processed (success/ignored) or failed. */
export const finishWebhookEvent = mutation({
  args: {
    serverToken: v.string(),
    eventDbId: v.id("webhookEvents"),
    status: v.union(v.literal("success"), v.literal("failed"), v.literal("ignored")),
    error: v.optional(v.string()),
    relatedUserId: v.optional(v.id("users")),
    relatedSubscriptionId: v.optional(v.id("subscriptions")),
    relatedPaymentId: v.optional(v.id("payments")),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const ev = await ctx.db.get(args.eventDbId);
    await ctx.db.patch(args.eventDbId, {
      processingStatus: args.status,
      error: args.error,
      retryCount: args.status === "failed" ? (ev?.retryCount ?? 0) + 1 : ev?.retryCount ?? 0,
      processedAt: Date.now(),
      relatedUserId: args.relatedUserId,
      relatedSubscriptionId: args.relatedSubscriptionId,
      relatedPaymentId: args.relatedPaymentId,
    });
    return { success: true };
  },
});

/** Resolve a user from a Safepay customer id or email (webhook helper). */
export const resolveUserForWebhook = query({
  args: {
    serverToken: v.string(),
    customerId: v.optional(v.string()),
    email: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    if (args.userId) {
      const u = await ctx.db.get(args.userId as Id<"users">);
      if (u) return u;
    }
    if (args.customerId) {
      const byCustomer = await ctx.db
        .query("users")
        .withIndex("by_providerCustomerId", (q: any) => q.eq("providerCustomerId", args.customerId))
        .first();
      if (byCustomer) return byCustomer;
    }
    if (args.email) {
      const byEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q: any) => q.eq("email", (args.email || "").toLowerCase()))
        .first();
      if (byEmail) return byEmail;
    }
    return null;
  },
});

/** Find a subscription by Safepay subscription id, else the user's latest. */
export const resolveSubscriptionForWebhook = query({
  args: {
    serverToken: v.string(),
    userId: v.id("users"),
    safepaySubscriptionId: v.optional(v.string()),
    subscriptionDbId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    if (args.subscriptionDbId) {
      const s = await ctx.db.get(args.subscriptionDbId as Id<"subscriptions">);
      if (s && s.userId === args.userId) return s;
    }
    if (args.safepaySubscriptionId) {
      const s = await ctx.db
        .query("subscriptions")
        .withIndex("by_safepaySubscriptionId", (q: any) =>
          q.eq("safepaySubscriptionId", args.safepaySubscriptionId)
        )
        .first();
      if (s && s.userId === args.userId) return s;
    }
    // Fall back to the user's most recent subscription (pending or active).
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .order("desc")
      .first();
  },
});

/**
 * Apply a subscription state transition (the webhook state machine).
 * Also keeps users.planId in sync so entitlements follow confirmed state.
 */
export const applySubscriptionTransition = mutation({
  args: {
    serverToken: v.string(),
    subscriptionId: v.id("subscriptions"),
    nextStatus: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("paused"),
      v.literal("unpaid"),
      v.literal("canceled"),
      v.literal("ended"),
      v.literal("failed")
    ),
    eventType: v.string(),
    safepaySubscriptionId: v.optional(v.string()),
    safepayCustomerId: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error("Subscription not found: " + args.subscriptionId);
    const now = Date.now();

    const patch: Record<string, unknown> = {
      status: args.nextStatus,
      updatedAt: now,
    };
    if (args.safepaySubscriptionId) patch.safepaySubscriptionId = args.safepaySubscriptionId;
    if (args.safepayCustomerId) patch.safepayCustomerId = args.safepayCustomerId;
    if (args.currentPeriodStart) patch.currentPeriodStart = args.currentPeriodStart;
    if (args.currentPeriodEnd) patch.currentPeriodEnd = args.currentPeriodEnd;
    if (args.cancelAtPeriodEnd !== undefined) patch.cancelAtPeriodEnd = args.cancelAtPeriodEnd;

    switch (args.nextStatus) {
      case "active":
        patch.resumedAt = sub.status === "paused" ? now : undefined;
        patch.endedAt = undefined;
        patch.failedAt = undefined;
        break;
      case "paused":
        patch.pausedAt = now;
        break;
      case "canceled":
        patch.canceledAt = sub.canceledAt ?? now;
        break;
      case "ended":
        patch.endedAt = now;
        break;
    }

    await ctx.db.patch(args.subscriptionId, patch);

    // Entitlement sync: the user's plan follows CONFIRMED subscription state.
    if (args.nextStatus === "active") {
      await ctx.db.patch(sub.userId, { planId: sub.planId, updatedAt: now });
    } else if (args.nextStatus === "ended" || args.nextStatus === "failed") {
      // Downgrade to the Free plan if one exists.
      const freePlan = await ctx.db
        .query("plans")
        .withIndex("by_tier", (q: any) => q.eq("tier", "free"))
        .first();
      if (freePlan) await ctx.db.patch(sub.userId, { planId: freePlan._id, updatedAt: now });
    }

    await ctx.db.insert("auditLogs", {
      actorType: "webhook",
      action: `subscription.${args.eventType}`,
      targetType: "subscription",
      targetId: args.subscriptionId,
      metadata: {
        from: sub.status,
        to: args.nextStatus,
        safepaySubscriptionId: args.safepaySubscriptionId ?? sub.safepaySubscriptionId,
      },
      createdAt: now,
    });

    return { success: true, previousStatus: sub.status };
  },
});

/**
 * Upsert a payment record from a webhook event (idempotent by tracking id:
 * a second event for the same tracking id updates rather than duplicates).
 */
export const upsertPaymentFromWebhook = mutation({
  args: {
    serverToken: v.string(),
    userId: v.id("users"),
    subscriptionId: v.optional(v.id("subscriptions")),
    planId: v.optional(v.id("plans")),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("refunded"),
      v.literal("disputed"),
      v.literal("dispute_won"),
      v.literal("dispute_lost")
    ),
    safepayTrackingId: v.optional(v.string()),
    safepayPaymentToken: v.optional(v.string()),
    safepaySubscriptionId: v.optional(v.string()),
    paymentMethod: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertServerToken(args.serverToken);
    const now = Date.now();

    let existing: any = null;
    if (args.safepayTrackingId) {
      existing = await ctx.db
        .query("payments")
        .withIndex("by_safepayTrackingId", (q: any) => q.eq("safepayTrackingId", args.safepayTrackingId))
        .first();
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        failureReason: args.failureReason ?? existing.failureReason,
        paymentMethod: args.paymentMethod ?? existing.paymentMethod,
        refundedAt: args.status === "refunded" ? now : existing.refundedAt,
        updatedAt: now,
      });
      await ctx.db.insert("auditLogs", {
        actorType: "webhook",
        action: `payment.${args.status}`,
        targetType: "payment",
        targetId: existing._id,
        metadata: { trackingId: args.safepayTrackingId, amount: existing.amount, via: "webhook-update" },
        createdAt: now,
      });
      return existing._id;
    }

    const id = await ctx.db.insert("payments", {
      userId: args.userId,
      subscriptionId: args.subscriptionId,
      planId: args.planId,
      amount: args.amount ?? 0,
      currency: args.currency ?? "PKR",
      status: args.status,
      safepayTrackingId: args.safepayTrackingId,
      safepayPaymentToken: args.safepayPaymentToken,
      safepaySubscriptionId: args.safepaySubscriptionId,
      paymentMethod: args.paymentMethod,
      failureReason: args.failureReason,
      refundedAt: args.status === "refunded" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorType: "webhook",
      action: `payment.${args.status}`,
      targetType: "payment",
      targetId: id,
      metadata: { trackingId: args.safepayTrackingId, amount: args.amount },
      createdAt: now,
    });
    return id;
  },
});
