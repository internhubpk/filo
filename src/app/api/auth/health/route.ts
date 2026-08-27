// =============================================================================
// GET /api/auth/health
// =============================================================================
// Public, read-only diagnostic endpoint for the authentication backend.
//
// WHY: previous signup/login incidents failed INSIDE the Convex deployment
// and looked identical regardless of which internal step broke (hashing,
// user insert, session insert). This endpoint calls the `authHealthCheck`
// Convex query, which probes every table/index the auth flow depends on and
// returns per-check statuses — so a stale or half-deployed backend becomes
// instantly visible with:
//
//     curl https://<site>/api/auth/health
//
// The function reference is intentionally a string ("auth:authHealthCheck")
// rather than the generated API object: if the deployment is stale this
// route must still exist and run so it can TELL you the backend is stale.
// =============================================================================

import { NextResponse } from 'next/server'
import { getConvexClient } from '@/lib/convex-server'

export async function GET() {
  let client
  try {
    client = getConvexClient()
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'CONVEX_URL is not configured on this server',
        checks: {},
      },
      { status: 503 }
    )
  }

  try {
    const health = await client.query('auth:authHealthCheck' as never, {})
    const ok = (health as { ok?: boolean })?.ok === true
    return NextResponse.json(
      { success: true, data: health },
      { status: ok ? 200 : 503 }
    )
  } catch (probeError) {
    // A thrown error here almost always means the deployed Convex functions
    // do not include auth:authHealthCheck yet → the backend predates this
    // repository's current code and needs `npx convex deploy`.
    const detail =
      probeError instanceof Error ? probeError.message : String(probeError)
    console.error('[API /auth/health] Probe failed:', probeError)
    return NextResponse.json(
      {
        success: false,
        error:
          'auth:authHealthCheck not available — the Convex functions in this deployment are out of date (run `npx convex deploy`).',
        detail,
        checks: {},
      },
      { status: 503 }
    )
  }
}
