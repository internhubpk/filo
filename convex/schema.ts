import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Define your Convex schema
// ARCHITECTURE: Convex is the ONLY database
// - No SQLite, no PostgreSQL, no other databases
// - All persistent data lives here

export default defineSchema({
  // Users table
  users: defineTable({
    name: v.string(),
    email: v.string(),
    emailVerified: v.optional(v.boolean()),
    image: v.optional(v.string()),
    passwordHash: v.optional(v.string()), // For email/password auth
    planId: v.optional(v.id("plans")),
    // Safepay customer reference (set after first successful subscription
    // checkout webhook). Optional until billing is used.
    providerCustomerId: v.optional(v.string()),
    // Account lifecycle: new signups start as "active" on the Free tier.
    // "suspended" revokes access (admin action, audited).
    status: v.union(
      v.literal("pending_activation"),
      v.literal("active"),
      v.literal("suspended")
    ),
    // Role flag. Checked SERVER-SIDE in every admin surface (Next.js API
    // routes re-read the live user record from Convex). Never trust the
    // client to claim admin.
    isAdmin: v.optional(v.boolean()),
    activatedAt: v.optional(v.number()),
    activationNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_status", ["status"])
    .index("by_providerCustomerId", ["providerCustomerId"])
    .index("by_isAdmin", ["isAdmin"])
    .index("by_createdAt", ["createdAt"]),

  // Sessions (for authentication)
  sessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_userId", ["userId"]),

  // Plans configuration (stored in Convex, NOT env vars)
  plans: defineTable({
    name: v.string(),
    description: v.string(),
    priceMonthly: v.number(), // PKR
    priceYearly: v.number(),  // PKR
    currency: v.string(),     // "PKR"
    features: v.array(v.string()),
    limitations: v.array(v.string()),
    popular: v.boolean(),
    active: v.boolean(),
    maxAiGenerations: v.number(),
    maxStorageMb: v.number(),
    maxTeamMembers: v.optional(v.number()),
    icon: v.string(),
    order: v.number(),
    contactSales: v.optional(v.boolean()),
    // Stable tier identifier ("free" | "pro" | "team" | "department").
    // Used by the billing engine to compare plans without relying on Convex IDs.
    tier: v.optional(v.string()),
    // Safepay subscription plan identifiers configured in the Safepay
    // merchant sandbox dashboard. Checkout refuses plans without these
    // (except contactSales plans, which never touch Safepay).
    safepayPlanIdMonthly: v.optional(v.string()),
    safepayPlanIdYearly: v.optional(v.string()),
    // Entitlement flag: whether this plan may use AI chat/generation.
    // Enforced SERVER-SIDE on every generation start. When undefined, the
    // enforcement layer falls back to the plan tier ("free" → denied).
    aiChatEnabled: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["active"])
    .index("by_order", ["order"])
    .index("by_tier", ["tier"]),

  // Artifacts (generated documents)
  artifacts: defineTable({
    userId: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    title: v.string(),
    type: v.string(), // document, spreadsheet, presentation, etc.
    format: v.string(), // DOCX, PDF, XLSX, PPTX, CSV
    prompt: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("generating"),
      v.literal("completed"),
      v.literal("error"),
      v.literal("archived")
    ),
    fileId: v.optional(v.id("files")),
    versionCount: v.number(),
    metadata: v.optional(v.any()),
    brandId: v.optional(v.id("brands")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_status", ["status"])
    .index("by_userId_status", ["userId", "status"])
    .index("by_workspaceId", ["workspaceId"]),

  // Files (R2 storage references - metadata only)
  files: defineTable({
    userId: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    artifactId: v.optional(v.id("artifacts")),
    originalName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    r2Key: v.string(), // R2 object key
    r2Bucket: v.string(), // R2 bucket name
    url: v.optional(v.string()), // Presigned URL (temporary)
    uploaded: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_artifactId", ["artifactId"])
    .index("by_r2Key", ["r2Key"]),

  // Usage records (for billing enforcement)
  usageRecords: defineTable({
    userId: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    type: v.union(
      v.literal("ai_generation"),
      v.literal("file_upload"),
      v.literal("storage_used"),
      v.literal("download"),
      v.literal("api_call")
    ),
    amount: v.number(),
    periodStart: v.number(),
    periodEnd: v.number(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_period", ["userId", "periodStart", "periodEnd"])
    .index("by_type_period", ["type", "periodStart"]),

  // Workspaces (for team collaboration)
  workspaces: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.id("users"),
    settings: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerId", ["ownerId"]),

  // Workspace members
  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("member"),
      v.literal("viewer")
    ),
    joinedAt: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_userId", ["userId"])
    .index("by_workspace_userId", ["workspaceId", "userId"]),

  // Knowledge sources (for AI context)
  knowledgeSources: defineTable({
    userId: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    name: v.string(),
    type: v.union(
      v.literal("document"),
      v.literal("website"),
      v.literal("text"),
      v.literal("database")
    ),
    content: v.optional(v.string()),
    fileId: v.optional(v.id("files")),
    url: v.optional(v.string()),
    embeddingGenerated: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_workspaceId", ["workspaceId"]),

  // Brand profiles (for document branding)
  brands: defineTable({
    userId: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    name: v.string(),
    logoUrl: v.optional(v.string()),
    colors: v.optional(v.any()),
    fonts: v.optional(v.any()),
    contactInfo: v.optional(v.any()),
    footerText: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_workspaceId", ["workspaceId"]),

  // =============================================================================
  // DURABLE GENERATION PIPELINE (Phase 3)
  // Long-document generation runs as a Convex-backed job composed of units.
  // The job document is the single source of truth for progress; the client
  // subscribes to it reactively (no polling loops needed).
  // =============================================================================

  // Generation jobs — one per user "generate" request.
  generationJobs: defineTable({
    userId: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    artifactId: v.optional(v.id("artifacts")),
    prompt: v.string(),
    artifactType: v.optional(v.string()),
    outputFormat: v.optional(v.string()),

    // Lifecycle: queued → planning → generating → validating → rendering
    //            → uploading → completed | failed | cancelled
    status: v.union(
      v.literal("queued"),
      v.literal("planning"),
      v.literal("generating"),
      v.literal("validating"),
      v.literal("rendering"),
      v.literal("uploading"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    currentStage: v.optional(v.string()), // human-readable stage label
    progress: v.number(), // 0-100

    // Unit accounting
    totalUnits: v.number(),
    completedUnits: v.number(),
    failedUnits: v.number(),

    // Observability / billing
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    estimatedCost: v.optional(v.number()),
    actualCost: v.optional(v.number()),
    retryCount: v.number(),
    // Automatic transient-outage retries performed by the worker (spec §5/
    // §14/§23): when the PLANNING AI call fails because every provider was
    // transiently unavailable (503/429/timeout), the worker re-queues the
    // job with backoff instead of failing it. Bounded — see worker.ts.
    // Distinct from retryCount, which counts USER-initiated retries.
    autoRetries: v.optional(v.number()),

    // Blueprint (the plan) persisted so units can be generated/resumed
    // independently, and so a resumed job doesn't re-plan.
    blueprint: v.optional(v.any()),

    // Original app origin (e.g. "https://filo-ailab99.vercel.app") captured
    // at enqueue time. The worker calls this origin's /api/generation/render
    // to render + persist the file, so rendering survives tab close/logout.
    appBaseUrl: v.optional(v.string()),
    // Small branding config captured at enqueue time (never secrets).
    brandConfig: v.optional(v.any()),
    // Names only — attached file CONTENT is intentionally not persisted
    // (Convex documents are capped at 1MB; base64 uploads would not fit).
    attachedFileNames: v.optional(v.array(v.string())),
    // Timestamp of the last render attempt (concurrency guard for the
    // idempotent render endpoint — worker AND client may both trigger it).
    renderStartedAt: v.optional(v.number()),

    // Failure info
    error: v.optional(v.string()),

    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_status", ["userId", "status"])
    .index("by_status", ["status"])
    .index("by_artifactId", ["artifactId"]),

  // Generation units — one per section/chunk of the document.
  generationUnits: defineTable({
    jobId: v.id("generationJobs"),
    sequence: v.number(), // order within the job
    title: v.string(),
    type: v.string(), // e.g. 'section' | 'intro' | 'conclusion' | 'table'
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    content: v.optional(v.any()), // structured GeneratedSection JSON
    metadata: v.optional(v.any()),
    attempts: v.number(),
    error: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_jobId", ["jobId"])
    .index("by_jobId_status", ["jobId", "status"])
    .index("by_jobId_sequence", ["jobId", "sequence"]),

  // =============================================================================
  // BILLING (Safepay sandbox subscriptions)
  // =============================================================================
  // Source of truth for subscription entitlements is THIS DATABASE, updated
  // exclusively by the server-side webhook handler (never by the browser).
  // =============================================================================

  // Subscriptions — one per user (latest wins; history preserved via
  // `subscriptions` audit fields + auditLogs).
  subscriptions: defineTable({
    userId: v.id("users"),
    planId: v.id("plans"),
    // Lifecycle states (see src/lib/billing-shared.ts):
    //   pending   — checkout started, waiting for Safepay confirmation
    //   active    — paid and confirmed via webhook
    //   past_due  — latest renewal payment failed
    //   paused    — temporarily paused (Safepay subscription.paused)
    //   unpaid    — Safepay stopped billing (subscription.unpaid)
    //   canceled  — user/merchant canceled; entitlement until period end
    //   ended     — fully terminated (no entitlement)
    //   failed    — initial payment failed, never activated
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("paused"),
      v.literal("unpaid"),
      v.literal("canceled"),
      v.literal("ended"),
      v.literal("failed")
    ),
    interval: v.union(v.literal("monthly"), v.literal("yearly")),
    safepaySubscriptionId: v.optional(v.string()),
    safepayCustomerId: v.optional(v.string()),
    amount: v.number(),          // charged per interval, PKR
    currency: v.string(),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    canceledAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    pausedAt: v.optional(v.number()),
    resumedAt: v.optional(v.number()),
    // Timestamp the subscription FIRST became active (paid confirmation via
    // webhook/tracker reconciliation, or admin manual activation).
    activatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_status", ["status"])
    .index("by_planId", ["planId"])
    .index("by_safepaySubscriptionId", ["safepaySubscriptionId"])
    .index("by_userId_status", ["userId", "status"]),

  // Payments — every Safepay transaction we learn about (webhook-driven).
  payments: defineTable({
    userId: v.id("users"),
    subscriptionId: v.optional(v.id("subscriptions")),
    planId: v.optional(v.id("plans")),
    amount: v.number(),
    currency: v.string(),
    // pending → succeeded | failed | refunded | disputed | dispute_won | dispute_lost
    status: v.union(
      v.literal("pending"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("refunded"),
      v.literal("disputed"),
      v.literal("dispute_won"),
      v.literal("dispute_lost")
    ),
    paymentMethod: v.optional(v.string()),
    // Safepay references
    safepayTrackingId: v.optional(v.string()),
    safepayPaymentToken: v.optional(v.string()),
    safepaySubscriptionId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    refundedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_status", ["status"])
    .index("by_subscriptionId", ["subscriptionId"])
    .index("by_safepayTrackingId", ["safepayTrackingId"])
    .index("by_safepayPaymentToken", ["safepayPaymentToken"])
    .index("by_createdAt", ["createdAt"]),

  // Webhook events — idempotency ledger + debug monitor for the admin UI.
  webhookEvents: defineTable({
    // Unique Safepay event identifier. Duplicate deliveries are recorded
    // with status "duplicate" and never re-processed.
    eventId: v.string(),
    eventType: v.string(),
    // success | failed | retrying | ignored | duplicate
    processingStatus: v.union(
      v.literal("success"),
      v.literal("failed"),
      v.literal("retrying"),
      v.literal("ignored"),
      v.literal("duplicate")
    ),
    payload: v.optional(v.any()), // sanitized (no secrets)
    relatedUserId: v.optional(v.id("users")),
    relatedSubscriptionId: v.optional(v.id("subscriptions")),
    relatedPaymentId: v.optional(v.id("payments")),
    error: v.optional(v.string()),
    retryCount: v.number(),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("by_eventId", ["eventId"])
    .index("by_processingStatus", ["processingStatus"])
    .index("by_receivedAt", ["receivedAt"]),

  // Audit logs — who did what, when (auth, billing, admin, file ops).
  auditLogs: defineTable({
    actorId: v.optional(v.id("users")),     // null = system/webhook
    actorEmail: v.optional(v.string()),
    actorType: v.union(
      v.literal("user"),
      v.literal("admin"),
      v.literal("system"),
      v.literal("webhook")
    ),
    action: v.string(),                     // e.g. "subscription.activated"
    targetType: v.optional(v.string()),     // e.g. "user" | "subscription" | "payment" | "file" | "plan"
    targetId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_actorId", ["actorId"])
    .index("by_action", ["action"])
    .index("by_createdAt", ["createdAt"])
    .index("by_targetType_targetId", ["targetType", "targetId"]),
});
