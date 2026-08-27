// =============================================================================
// Billing state metadata — shared by the billing UI and the admin console.
// Single source of truth for how each lifecycle state is displayed.
// (Colors alone never carry meaning: every badge also carries a text label.)
// =============================================================================

export type SubscriptionStatus =
  | "pending"
  | "active"
  | "past_due"
  | "paused"
  | "unpaid"
  | "canceled"
  | "ended"
  | "failed";

export type PaymentStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "refunded"
  | "disputed"
  | "dispute_won"
  | "dispute_lost";

export type WebhookStatus = "success" | "failed" | "retrying" | "ignored" | "duplicate";

export interface StatusMeta {
  label: string;
  /** Tailwind classes for the badge. */
  className: string;
  /** Dot color class for inline indicators. */
  dot: string;
  /** Short human explanation shown in tooltips / detail views. */
  description: string;
}

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, StatusMeta> = {
  pending: {
    label: "Pending",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
    dot: "bg-amber-500",
    description: "Checkout started — waiting for Safepay to confirm the payment.",
  },
  active: {
    label: "Active",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-500",
    description: "Paid and confirmed. Full plan entitlements are active.",
  },
  past_due: {
    label: "Past due",
    className: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
    dot: "bg-orange-500",
    description: "The latest renewal payment failed. Update your payment method to restore uninterrupted access.",
  },
  paused: {
    label: "Paused",
    className: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30",
    dot: "bg-sky-500",
    description: "Billing is temporarily paused by the merchant or payment provider.",
  },
  unpaid: {
    label: "Unpaid",
    className: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
    dot: "bg-orange-500",
    description: "Safepay stopped collecting payments for this subscription.",
  },
  canceled: {
    label: "Canceled",
    className: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30",
    dot: "bg-rose-500",
    description: "Canceled — access continues until the end of the current period.",
  },
  ended: {
    label: "Ended",
    className: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
    dot: "bg-zinc-500",
    description: "Fully terminated. The account is on the Free plan.",
  },
  failed: {
    label: "Failed",
    className: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30",
    dot: "bg-rose-500",
    description: "The initial payment failed, so the subscription never activated.",
  },
};

export const PAYMENT_STATUS: Record<PaymentStatus, StatusMeta> = {
  pending: {
    label: "Pending",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
    dot: "bg-amber-500",
    description: "Waiting for the provider to settle this transaction.",
  },
  succeeded: {
    label: "Succeeded",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-500",
    description: "Payment captured successfully.",
  },
  failed: {
    label: "Failed",
    className: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30",
    dot: "bg-rose-500",
    description: "The payment did not go through.",
  },
  refunded: {
    label: "Refunded",
    className: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30",
    dot: "bg-violet-500",
    description: "This payment was refunded.",
  },
  disputed: {
    label: "Disputed",
    className: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
    dot: "bg-orange-500",
    description: "The customer disputed this payment.",
  },
  dispute_won: {
    label: "Dispute won",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-500",
    description: "The dispute was resolved in the merchant's favor.",
  },
  dispute_lost: {
    label: "Dispute lost",
    className: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30",
    dot: "bg-rose-500",
    description: "The dispute was resolved in the customer's favor.",
  },
};

export const WEBHOOK_STATUS: Record<WebhookStatus, StatusMeta> = {
  success: {
    label: "Success",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-500",
    description: "Event processed and applied.",
  },
  failed: {
    label: "Failed",
    className: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30",
    dot: "bg-rose-500",
    description: "Processing threw — Safepay will retry this delivery.",
  },
  retrying: {
    label: "Retrying",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
    dot: "bg-amber-500",
    description: "Received but not yet fully processed.",
  },
  ignored: {
    label: "Ignored",
    className: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
    dot: "bg-zinc-500",
    description: "Informational or unmatched event — recorded, no state change.",
  },
  duplicate: {
    label: "Duplicate",
    className: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30",
    dot: "bg-sky-500",
    description: "A delivery with this event id was already processed — safely skipped.",
  },
};

/** Generation job stages, in lifecycle order (matches convex schema). */
export const JOB_STAGES = [
  "queued",
  "planning",
  "generating",
  "validating",
  "rendering",
  "uploading",
  "completed",
] as const;

export function statusMetaFor(kind: "subscription" | "payment" | "webhook", status: string): StatusMeta {
  const table =
    kind === "subscription" ? SUBSCRIPTION_STATUS : kind === "payment" ? PAYMENT_STATUS : WEBHOOK_STATUS;
  return (
    (table as Record<string, StatusMeta>)[status] ?? {
      label: status,
      className: "bg-muted text-muted-foreground border-border",
      dot: "bg-muted-foreground",
      description: "Unknown state.",
    }
  );
}
