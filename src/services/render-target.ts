// =============================================================================
// RENDER TARGET RESOLUTION (render-retry idempotency)
// =============================================================================
// PURE decision logic for "which artifact does THIS render attempt write to".
//
// Production incident: the render route called saveArtifactRecord on every
// attempt. When an attempt failed AFTER the artifact row was created (version
// write hiccup, completeJobRendered failure, ...) the retry created ANOTHER
// artifact row for the same document — the user's log showed artifact IDs
// multiplying every ~11s while storage 503s looped.
//
// The fix has three tiers, in priority order:
//   1. job.renderArtifactId  — set by the first attempt that created an
//      artifact (via recordRenderArtifact). Reuse it, append a new version.
//   2. job.sourceArtifactId  — AI-edit/regeneration flows write a new VERSION
//      of the user's existing artifact.
//   3. create fresh          — first attempt of a fresh generation.
//
// Extraction into a pure module keeps the retry contract unit-testable
// without a Convex/Vercel runtime.
// =============================================================================

export interface RenderJobView {
  renderArtifactId?: string | null
  sourceArtifactId?: string | null
}

export interface ArtifactView {
  _id: string
  versionCount?: number
  format?: string
  userId?: string
}

export type RenderTargetAction =
  | { action: 'reuse_render_artifact'; artifactId: string; baseVersionCount: number; reason: string }
  | { action: 'version_existing'; artifactId: string; baseVersionCount: number; reason: string }
  | { action: 'create_fresh'; reason: string }

/**
 * Decide the render target for this attempt. `existing` is the artifact
 * looked up by the route (or null when the id dangles — e.g. the user deleted
 * the artifact mid-flight).
 */
export function resolveRenderTarget(
  job: RenderJobView,
  existing: ArtifactView | null
): RenderTargetAction {
  // Tier 1: a previous attempt of THIS job already created the artifact.
  if (job.renderArtifactId) {
    if (existing && existing._id === job.renderArtifactId) {
      return {
        action: 'reuse_render_artifact',
        artifactId: existing._id,
        baseVersionCount: existing.versionCount ?? 1,
        reason: 'retry reuses the artifact created by the first render attempt',
      }
    }
    // Dangling pointer (artifact deleted mid-flight) → fall through to
    // creating a fresh record; the next recordRenderArtifact call updates
    // nothing (recordRenderArtifact keeps the FIRST id — a fresh create here
    // still lands on a single artifact for THIS attempt chain).
    if (!existing) {
      return { action: 'create_fresh', reason: 'job.renderArtifactId points at a deleted artifact — creating a replacement' }
    }
    // Pointer disagrees with lookup (should not happen) — trust the lookup.
    return {
      action: 'reuse_render_artifact',
      artifactId: existing._id,
      baseVersionCount: existing.versionCount ?? 1,
      reason: 'job.renderArtifactId lookup returned a different row — trusting the loaded artifact',
    }
  }

  // Tier 2: version an existing artifact (AI edit / regenerate flows).
  if (job.sourceArtifactId) {
    if (existing && existing._id === job.sourceArtifactId) {
      return {
        action: 'version_existing',
        artifactId: existing._id,
        baseVersionCount: existing.versionCount ?? 1,
        reason: 'regeneration appends a version to the source artifact',
      }
    }
    return { action: 'create_fresh', reason: 'source artifact was deleted mid-flight — creating a fresh artifact' }
  }

  // Tier 3: first attempt of a fresh generation.
  return { action: 'create_fresh', reason: 'fresh generation — no prior artifact for this job' }
}
