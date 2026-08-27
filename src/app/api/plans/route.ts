// =============================================================================
// GET /api/plans
// =============================================================================
// Available subscription plans — ALWAYS sourced from the Convex `plans`
// table (NO hardcoded fallback data; if Convex fails we return an error,
// never fake plans).
//
// SELF-HEALING: a brand-new deployment that never ran `npm run
// convex:seed` has an empty plans table. Instead of showing an empty
// "Change plan" section, this route bootstraps the default plans into the
// empty table (convex/seed.ts:ensurePlansSeeded — strict no-op when any
// plan already exists) and re-queries.
// =============================================================================

import { NextResponse } from 'next/server'
import { getConvexClient } from '@/lib/convex-server'
import { api } from '@convex/_generated/api'

export async function GET() {
  try {
    const convex = getConvexClient()

    let plans = await convex.query(api.plans.getActivePlans)

    // Fresh deployment: plans table was never seeded. Bootstrap the
    // defaults (no-op if any plan exists) and re-read.
    if (!plans || plans.length === 0) {
      try {
        await convex.mutation(api.seed.ensurePlansSeeded, {})
        plans = await convex.query(api.plans.getActivePlans)
      } catch (seedErr) {
        console.error('[API /plans] Auto-seed failed:', seedErr)
      }
    }

    return NextResponse.json({
      success: true,
      data: plans || []
    })
  } catch (error) {
    console.error('[API /plans] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Could not load plans. Please try again shortly.',
        data: []
      },
      { status: 502 }
    )
  }
}
