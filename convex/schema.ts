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
    // Provider-agnostic customer ID (legacy Safepay field, kept for backward compat)
    providerCustomerId: v.optional(v.string()),
    // Manual activation flow: every new signup starts as "pending_activation".
    // Admin must verify payment and flip status to "active" before user can
    // generate artifacts. "suspended" revokes access.
    status: v.union(
      v.literal("pending_activation"),
      v.literal("active"),
      v.literal("suspended")
    ),
    activatedAt: v.optional(v.number()),
    activationNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_status", ["status"])
    .index("by_providerCustomerId", ["providerCustomerId"]),

  // Payment verifications (manual admin-verified payment flow)
  // Replaces the SafePay automatic checkout flow. A user submits their
  // payment details (transaction id, method, amount, notes). An admin
  // reviews and either approves (which activates the user account) or
  // rejects (with a reason that is surfaced back to the user).
  paymentVerifications: defineTable({
    userId: v.id("users"),
    planId: v.optional(v.id("plans")),
    amount: v.number(),
    currency: v.string(), // "PKR"
    paymentMethod: v.string(), // bank_transfer | easypaisa | jazzcash | other
    transactionId: v.string(), // user-submitted reference / TRX ID
    proofUrl: v.optional(v.string()), // optional screenshot / receipt URL
    notes: v.optional(v.string()), // user-submitted notes
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected")
    ),
    reviewedBy: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    adminNote: v.optional(v.string()), // admin feedback shown to user
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_status", ["status"])
    .index("by_userId_status", ["userId", "status"]),

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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["active"])
    .index("by_order", ["order"]),

  // Subscriptions (provider-agnostic)
  subscriptions: defineTable({
    userId: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    planId: v.id("plans"),
    provider: v.literal("safepay"), // Safepay only for beta
    status: v.union(
      v.literal("active"),
      v.literal("canceled"),
      v.literal("past_due"),
      v.literal("trialing"),
      v.literal("expired")
    ),
    providerSubscriptionId: v.optional(v.string()),
    providerCustomerId: v.optional(v.string()),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_status", ["status"])
    .index("by_providerSubscriptionId", ["providerSubscriptionId"]),

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
    metadata: v.optional(v.object({})),
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
    metadata: v.optional(v.object({})),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_period", ["userId", "periodStart", "periodEnd"])
    .index("by_type_period", ["type", "periodStart"]),

  // Payments (Safepay for beta)
  payments: defineTable({
    userId: v.id("users"),
    subscriptionId: v.optional(v.id("subscriptions")),
    amount: v.number(),
    currency: v.string(), // "PKR"
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("refunded"),
      v.literal("cancelled")
    ),
    provider: v.literal("safepay"),
    providerPaymentId: v.optional(v.string()),
    invoiceId: v.optional(v.string()),
    description: v.string(),
    metadata: v.optional(v.object({})),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_status", ["status"])
    .index("by_providerPaymentId", ["providerPaymentId"]),

  // Webhook events (for idempotency - critical for payment security)
  webhookEvents: defineTable({
    provider: v.union(v.literal("safepay"), v.literal("custom")),
    eventId: v.string(),
    type: v.string(),
    data: v.object({}),
    processed: v.boolean(),
    processingError: v.optional(v.string()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("by_provider_eventId", ["provider", "eventId"])
    .index("by_processed", ["processed"]),

  // Workspaces (for team collaboration)
  workspaces: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.id("users"),
    settings: v.optional(v.object({})),
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
    colors: v.optional(v.object({})),
    fonts: v.optional(v.object({})),
    contactInfo: v.optional(v.object({})),
    footerText: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_workspaceId", ["workspaceId"]),
});
