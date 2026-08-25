// =============================================================================
// SAFEPAY WEBHOOK PROCESSING - Convex Actions
// =============================================================================
// Called by the Next.js webhook endpoint (/api/webhooks/safepay)
// via ConvexHttpClient to process payment events in the Convex backend.
//
// This is the SINGLE SOURCE OF TRUTH for all payment state changes.
// Webhooks from Safepay hit Next.js, which then calls these actions.
// =============================================================================

import { action } from './_generated/server'
import { v } from 'convex/values'

// ==================== TYPES ====================

interface WebhookProcessResult {
  success: boolean
  action: string
  paymentUpdated: boolean
  subscriptionActivated: boolean
  subscriptionId?: string
  error?: string
  [key: string]: unknown
}

// ==================== MAIN WEBHOOK PROCESSOR ====================

/**
 * Process a Safepay webhook event - the main entry point from Next.js
 * Handles: payment.succeeded, payment.failed, payment.refunded,
 *          subscription.canceled, subscription.ended, subscription.payment.succeeded
 */
export const processSafepayWebhook = action({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    data: v.object({
      id: v.string(),
      status: v.optional(v.string()),
      amount: v.optional(v.number()),
      currency: v.optional(v.string()),
      reason: v.optional(v.string()),
      error_code: v.optional(v.string()),
      error_message: v.optional(v.string()),
      dispute_reason: v.optional(v.string()),
      customer: v.optional(v.object({
        id: v.string(),
        email: v.optional(v.string()),
        name: v.optional(v.string()),
      })),
      metadata: v.optional(v.record(v.string(), v.any())),
      plan_id: v.optional(v.string()),
      subscription_id: v.optional(v.string()),
      billing_period: v.optional(v.object({
        start: v.number(),
        end: v.number(),
      })),
    }),
  },
  handler: async (ctx, args): Promise<WebhookProcessResult> => {
    console.log(`[SAFEPAY-WEBHOOK] Processing event: ${args.eventType} (id: ${args.eventId})`)

    // Step 1: Record webhook event for idempotency
    const existingEvent = await ctx.db
      .query('webhookEvents')
      .withIndex('by_provider_eventId', (q) =>
        q.eq('provider', 'safepay').eq('eventId', args.eventId)
      )
      .first()

    if (existingEvent) {
      console.log(`[SAFEPAY-WEBHOOK] Duplicate event ${args.eventId} - skipping`)
      return {
        success: true,
        action: 'duplicate_ignored',
        paymentUpdated: false,
        subscriptionActivated: false,
      }
    }

    // Record new webhook event
    const webhookEventId = await ctx.db.insert('webhookEvents', {
      provider: 'safepay',
      eventId: args.eventId,
      type: args.eventType,
      data: args.data as any,
      processed: false,
      receivedAt: Date.now(),
    })

    try {
      let result: WebhookProcessResult

      // Route to appropriate handler based on event type
      switch (args.eventType) {
        case 'payment.succeeded':
        case 'payment.captured':
          result = await handlePaymentSucceeded(ctx, args)
          break

        case 'payment.failed':
          result = await handlePaymentFailed(ctx, args)
          break

        case 'payment.refunded':
          result = await handlePaymentRefunded(ctx, args)
          break

        case 'payment.cancelled':
        case 'void.succeeded':
          result = await handlePaymentCancelled(ctx, args)
          break

        case 'subscription.canceled':
          result = await handleSubscriptionCanceled(ctx, args)
          break

        case 'subscription.ended':
          result = await handleSubscriptionEnded(ctx, args)
          break

        case 'subscription.unpaid':
          result = await handleSubscriptionUnpaid(ctx, args)
          break

        case 'subscription.payment.succeeded':
          result = await handleSubscriptionRenewalSucceeded(ctx, args)
          break

        case 'subscription.payment.failed':
          result = await handleSubscriptionRenewalFailed(ctx, args)
          break

        default:
          console.log(`[SAFEPAY-WEBHOOK] Unhandled event type: ${args.eventType}`)
          result = {
            success: true,
            action: 'event_acknowledged_no_action',
            paymentUpdated: false,
            subscriptionActivated: false,
          }
      }

      // Mark webhook as processed
      await ctx.db.patch(webhookEventId, {
        processed: true,
        processedAt: Date.now(),
      })

      return result

    } catch (error) {
 const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[SAFEPAY-WEBHOOK] Error processing ${args.eventType}:`, errorMsg)

      // Mark webhook as processed with error
      await ctx.db.patch(webhookEventId, {
        processed: true,
        processedAt: Date.now(),
        processingError: errorMsg,
      })

      return {
        success: false,
        action: 'processing_error',
        paymentUpdated: false,
        subscriptionActivated: false,
        error: errorMsg,
      }
    }
  },
})

// ==================== PAYMENT HANDLERS ====================

async function handlePaymentSucceeded(
  ctx: any,
  args: any
): Promise<WebhookProcessResult> {
  const { data, eventType } = args
  const metadata = data.metadata || {}
  const userId = metadata.userId
  const planId = metadata.planId || data.plan_id
  const isYearly = metadata.isYearly === true || metadata.isYearly === 'true'
  const safepayPaymentId = data.id

  console.log(`[SAFEPAY-WEBHOOK] Payment succeeded: ${safepayPaymentId}, userId: ${userId}, planId: ${planId}`)

  // Step 1: Find and update payment record
  let paymentRecord: any = null
  if (safepayPaymentId) {
    const payments = await ctx.db
      .query('payments')
      .withIndex('by_providerPaymentId', (q: any) =>
        q.eq('providerPaymentId', safepayPaymentId)
      )
      .collect()

    paymentRecord = payments.find((p: any) => p.status === 'pending') || payments[0]

    if (paymentRecord && paymentRecord.status !== 'completed') {
      await ctx.db.patch(paymentRecord._id, {
        status: 'completed',
        updatedAt: Date.now(),
        metadata: {
          ...paymentRecord.metadata,
          verifiedAt: Date.now(),
          verifiedVia: 'webhook',
          webhookEvent: eventType,
          safepayStatus: data.status,
        },
      })
      console.log(`[SAFEPAY-WEBHOOK] Payment ${paymentRecord._id} updated to completed`)
    }
  }

  // Step 2: Activate or extend subscription
  let subscriptionActivated = false
  let subscriptionId: string | undefined

  if (userId && planId) {
    // Calculate billing period
    const now = Date.now()
    const periodEnd = isYearly
      ? now + 365 * 24 * 60 * 60 * 1000
      : now + 30 * 24 * 60 * 60 * 1000

    // Check for existing active/trialing subscription
    const existingSubs = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q: any) => q.eq('userId', userId))
      .collect()

    const activeSub = existingSubs.find(
      (s: any) => s.status === 'active' || s.status === 'trialing'
    )

    if (activeSub) {
      // Extend existing subscription
      const newPeriodEnd = Math.max(activeSub.currentPeriodEnd, now) +
        (isYearly ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000)

      await ctx.db.patch(activeSub._id, {
        status: 'active',
        currentPeriodEnd: newPeriodEnd,
        cancelAtPeriodEnd: false,
        updatedAt: now,
      })

      subscriptionId = activeSub._id
      subscriptionActivated = true
      console.log(`[SAFEPAY-WEBHOOK] Extended subscription ${activeSub._id} until ${new Date(newPeriodEnd).toISOString()}`)
    } else {
      // Create new subscription
      subscriptionId = await ctx.db.insert('subscriptions', {
        userId,
        planId,
        provider: 'safepay',
        providerSubscriptionId: data.subscription_id || safepayPaymentId,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        createdAt: now,
        updatedAt: now,
      })

      subscriptionActivated = true
      console.log(`[SAFEPAY-WEBHOOK] Created new subscription ${subscriptionId}`)
    }

    // Step 3: Update user's plan reference
    try {
      await ctx.db.patch(userId, {
        planId,
        updatedAt: Date.now(),
      })
      console.log(`[SAFEPAY-WEBHOOK] Updated user ${userId} plan to ${planId}`)
    } catch (userErr) {
      console.error(`[SAFEPAY-WEBHOOK] Failed to update user plan:`, userErr)
      // Non-critical - subscription is still active
    }
  } else {
    console.warn(`[SAFEPAY-WEBHOOK] No userId or planId in metadata - cannot activate subscription`)
    console.warn(`[SAFEPAY-WEBHOOK] Metadata:`, JSON.stringify(metadata))
  }

  return {
    success: true,
    action: 'payment_completed_subscription_activated',
    paymentUpdated: !!paymentRecord,
    subscriptionActivated,
    subscriptionId,
    safepayPaymentId,
    userId,
    planId,
  }
}

async function handlePaymentFailed(
  ctx: any,
  args: any
): Promise<WebhookProcessResult> {
  const { data } = args
  const safepayPaymentId = data.id

  let paymentUpdated = false

  // Find and mark payment as failed
  if (safepayPaymentId) {
    const payments = await ctx.db
      .query('payments')
      .withIndex('by_providerPaymentId', (q: any) =>
        q.eq('providerPaymentId', safepayPaymentId)
      )
      .collect()

    const pendingPayment = payments.find((p: any) => p.status === 'pending')

    if (pendingPayment) {
      await ctx.db.patch(pendingPayment._id, {
        status: 'failed',
        updatedAt: Date.now(),
        metadata: {
          ...pendingPayment.metadata,
          failureReason: data.reason || data.error_message || 'Payment failed',
          failureCode: data.error_code,
          failedAt: Date.now(),
          failedVia: 'webhook',
        },
      })
      paymentUpdated = true
    }
  }

  return {
    success: true,
    action: 'payment_failed_recorded',
    paymentUpdated,
    subscriptionActivated: false,
    safepayPaymentId,
    reason: data.reason,
  }
}

async function handlePaymentRefunded(
  ctx: any,
  args: any
): Promise<WebhookProcessResult> {
  const { data } = args
  const safepayPaymentId = data.id

  let paymentUpdated = false

  if (safepayPaymentId) {
    const payments = await ctx.db
      .query('payments')
      .withIndex('by_providerPaymentId', (q: any) =>
        q.eq('providerPaymentId', safepayPaymentId)
      )
      .collect()

    const completedPayment = payments.find((p: any) => p.status === 'completed')

    if (completedPayment) {
      await ctx.db.patch(completedPayment._id, {
        status: 'refunded',
        updatedAt: Date.now(),
        metadata: {
          ...completedPayment.metadata,
          refundReason: data.reason || 'Refund processed',
          refundedAt: Date.now(),
          refundedVia: 'webhook',
        },
      })
      paymentUpdated = true

      // Cancel associated subscription if full refund
      if (completedPayment.subscriptionId) {
        try {
          await ctx.db.patch(completedPayment.subscriptionId, {
            status: 'canceled',
            updatedAt: Date.now(),
          })
          console.log(`[SAFEPAY-WEBHOOK] Cancelled subscription ${completedPayment.subscriptionId} due to refund`)
        } catch (subErr) {
          console.error(`[SAFEPAY-WEBHOOK] Failed to cancel subscription on refund:`, subErr)
        }
      }
    }
  }

  return {
    success: true,
    action: 'payment_refunded_processed',
    paymentUpdated,
    subscriptionActivated: false,
    safepayPaymentId,
    reason: data.reason,
  }
}

async function handlePaymentCancelled(
  ctx: any,
  args: any
): Promise<WebhookProcessResult> {
  const { data } = args
  const safepayPaymentId = data.id

  let paymentUpdated = false

  if (safepayPaymentId) {
    const payments = await ctx.db
      .query('payments')
      .withIndex('by_providerPaymentId', (q: any) =>
        q.eq('providerPaymentId', safepayPaymentId)
      )
      .collect()

    const pendingPayment = payments.find((p: any) => p.status === 'pending')

    if (pendingPayment) {
      await ctx.db.patch(pendingPayment._id, {
        status: 'cancelled',
        updatedAt: Date.now(),
      })
      paymentUpdated = true
    }
  }

  return {
    success: true,
    action: 'payment_cancelled_recorded',
    paymentUpdated,
    subscriptionActivated: false,
    safepayPaymentId,
  }
}

// ==================== SUBSCRIPTION HANDLERS ====================

async function handleSubscriptionCanceled(
  ctx: any,
  args: any
): Promise<WebhookProcessResult> {
  const { data } = args
  const providerSubId = data.id || data.subscription_id

  if (!providerSubId) {
    return { success: true, action: 'no_subscription_id', paymentUpdated: false, subscriptionActivated: false }
  }

  // Find subscription by provider ID
  const subscriptions = await ctx.db
    .query('subscriptions')
    .withIndex('by_providerSubscriptionId', (q: any) =>
      q.eq('providerSubscriptionId', providerSubId)
    )
    .collect()

  const subscription = subscriptions[0]
  if (!subscription) {
    console.warn(`[SAFEPAY-WEBHOOK] Subscription not found for provider ID: ${providerSubId}`)
    return { success: true, action: 'subscription_not_found', paymentUpdated: false, subscriptionActivated: false }
  }

  // Mark as canceled but keep access until period end
  await ctx.db.patch(subscription._id, {
    cancelAtPeriodEnd: true,
    updatedAt: Date.now(),
  })

  return {
    success: true,
    action: 'subscription_cancelled_access_until_period_end',
    paymentUpdated: false,
    subscriptionActivated: false,
    subscriptionId: subscription._id,
    accessUntil: subscription.currentPeriodEnd,
  }
}

async function handleSubscriptionEnded(
  ctx: any,
  args: any
): Promise<WebhookProcessResult> {
  const { data } = args
  const providerSubId = data.id || data.subscription_id

  if (!providerSubId) {
    return { success: true, action: 'no_subscription_id', paymentUpdated: false, subscriptionActivated: false }
  }

  const subscriptions = await ctx.db
    .query('subscriptions')
    .withIndex('by_providerSubscriptionId', (q: any) =>
      q.eq('providerSubscriptionId', providerSubId)
    )
    .collect()

  const subscription = subscriptions[0]
  if (!subscription) {
    return { success: true, action: 'subscription_not_found', paymentUpdated: false, subscriptionActivated: false }
  }

  // Fully expire the subscription and revoke access
  await ctx.db.patch(subscription._id, {
    status: 'expired',
    updatedAt: Date.now(),
  })

  // Clear user's plan reference
  try {
    await ctx.db.patch(subscription.userId, {
      planId: undefined,
      updatedAt: Date.now(),
    })
  } catch (e) {
    console.error(`[SAFEPAY-WEBHOOK] Failed to clear user plan on subscription end:`, e)
  }

  return {
    success: true,
    action: 'subscription_ended_access_revoked',
    paymentUpdated: false,
    subscriptionActivated: false,
    subscriptionId: subscription._id,
    accessRevoked: true,
  }
}

async function handleSubscriptionUnpaid(
  ctx: any,
  args: any
): Promise<WebhookProcessResult> {
  const { data } = args
  const providerSubId = data.id || data.subscription_id

  if (!providerSubId) {
    return { success: true, action: 'no_subscription_id', paymentUpdated: false, subscriptionActivated: false }
  }

  const subscriptions = await ctx.db
    .query('subscriptions')
    .withIndex('by_providerSubscriptionId', (q: any) =>
      q.eq('providerSubscriptionId', providerSubId)
    )
    .collect()

  const subscription = subscriptions[0]
  if (!subscription) {
    return { success: true, action: 'subscription_not_found', paymentUpdated: false, subscriptionActivated: false }
  }

  // Mark as past_due - dunning period
  await ctx.db.patch(subscription._id, {
    status: 'past_due',
    updatedAt: Date.now(),
  })

  return {
    success: true,
    action: 'subscription_marked_past_due',
    paymentUpdated: false,
    subscriptionActivated: false,
    subscriptionId: subscription._id,
    gracePeriodDays: 14,
  }
}

async function handleSubscriptionRenewalSucceeded(
  ctx: any,
  args: any
): Promise<WebhookProcessResult> {
  const { data } = args
  const providerSubId = data.subscription_id
  const metadata = data.metadata || {}
  const isYearly = metadata.isYearly === true || metadata.isYearly === 'true'

  if (!providerSubId) {
    return { success: true, action: 'no_subscription_id', paymentUpdated: false, subscriptionActivated: false }
  }

  const subscriptions = await ctx.db
    .query('subscriptions')
    .withIndex('by_providerSubscriptionId', (q: any) =>
      q.eq('providerSubscriptionId', providerSubId)
    )
    .collect()

  const subscription = subscriptions[0]
  if (!subscription) {
    return { success: true, action: 'subscription_not_found', paymentUpdated: false, subscriptionActivated: false }
  }

  // Extend subscription period
  const now = Date.now()
  const extensionMs = isYearly
    ? 365 * 24 * 60 * 60 * 1000
    : 30 * 24 * 60 * 60 * 1000

  const newPeriodEnd = Math.max(subscription.currentPeriodEnd, now) + extensionMs

  await ctx.db.patch(subscription._id, {
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd: newPeriodEnd,
    cancelAtPeriodEnd: false,
    updatedAt: now,
  })

  // Record the renewal payment
  try {
    await ctx.db.insert('payments', {
      userId: subscription.userId,
      subscriptionId: subscription._id,
      amount: data.amount || 0,
      currency: data.currency || 'PKR',
      status: 'completed',
      provider: 'safepay',
      providerPaymentId: data.id,
      description: `Filo subscription renewal - ${new Date(now).toLocaleDateString('en-PK')}`,
      metadata: {
        type: 'renewal',
        isYearly,
        renewedAt: now,
        renewedVia: 'webhook',
      },
      createdAt: now,
      updatedAt: now,
    })
  } catch (payErr) {
    console.error(`[SAFEPAY-WEBHOOK] Failed to record renewal payment:`, payErr)
  }

  return {
    success: true,
    action: 'subscription_renewed_extended',
    paymentUpdated: true,
    subscriptionActivated: true,
    subscriptionId: subscription._id,
    newPeriodEnd,
    amount: data.amount,
  }
}

async function handleSubscriptionRenewalFailed(
  ctx: any,
  args: any
): Promise<WebhookProcessResult> {
  const { data } = args
  const providerSubId = data.subscription_id

  if (!providerSubId) {
    return { success: true, action: 'no_subscription_id', paymentUpdated: false, subscriptionActivated: false }
  }

  const subscriptions = await ctx.db
    .query('subscriptions')
    .withIndex('by_providerSubscriptionId', (q: any) =>
      q.eq('providerSubscriptionId', providerSubId)
    )
    .collect()

  const subscription = subscriptions[0]
  if (!subscription) {
    return { success: true, action: 'subscription_not_found', paymentUpdated: false, subscriptionActivated: false }
  }

  // Record the failed renewal payment
  try {
    await ctx.db.insert('payments', {
      userId: subscription.userId,
      subscriptionId: subscription._id,
      amount: data.amount || 0,
      currency: data.currency || 'PKR',
      status: 'failed',
      provider: 'safepay',
      providerPaymentId: data.id,
      description: `Filo subscription renewal FAILED - ${new Date().toLocaleDateString('en-PK')}`,
      metadata: {
        type: 'renewal_failed',
        failureReason: data.reason || data.error_message,
        failureCode: data.error_code,
        failedAt: Date.now(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  } catch (payErr) {
    console.error(`[SAFEPAY-WEBHOOK] Failed to record failed renewal:`, payErr)
  }

  // Mark subscription as past_due (don't cancel immediately - grace period)
  await ctx.db.patch(subscription._id, {
    status: 'past_due',
    updatedAt: Date.now(),
  })

  return {
    success: true,
    action: 'renewal_failed_subscription_past_due',
    paymentUpdated: true,
    subscriptionActivated: false,
    subscriptionId: subscription._id,
    reason: data.reason,
    gracePeriodActive: true,
  }
}
