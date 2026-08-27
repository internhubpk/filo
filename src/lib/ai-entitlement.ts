// =============================================================================
// AI Entitlement — is a plan allowed to use AI chat/generation?
// =============================================================================
// Single source of truth used by every AI-starting API route:
//   • /api/artifacts/agent-generate (background jobs)
//   • /api/artifacts/generate (legacy synchronous path)
//
// POLICY: AI generation is a PAID feature. Free plans can upload/organize
// files but cannot create documents with AI.
//
// Enforcement lives SERVER-SIDE only — the client may mirror the decision
// for UX, but never decides it.
// =============================================================================

export interface PlanEntitlementDoc {
  _id?: string
  name?: string
  tier?: string
  maxAiGenerations?: number | null
  /** Explicit per-plan override stored on the plans document (admin-editable). */
  aiChatEnabled?: boolean
}

/**
 * May this plan use AI chat/generation?
 * - Explicit `aiChatEnabled` on the plan doc always wins (admin-controlled).
 * - Missing flag (plans created before the field existed): fall back to the
 *   tier — "free" (or unknown) is denied, paid tiers are allowed. This makes
 *   the paid-only rule effective immediately without re-seeding.
 * - No plan at all → treated as Free → denied.
 */
export function isAiChatAllowedForPlan(
  plan: PlanEntitlementDoc | null | undefined
): boolean {
  if (!plan) return false
  if (plan.aiChatEnabled === true) return true
  if (plan.aiChatEnabled === false) return false
  const tier = (plan.tier || '').toLowerCase()
  return tier !== '' && tier !== 'free'
}
