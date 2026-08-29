// =============================================================================
// FILO DESIGNER STAGE (spec §8 — two-stage AI: Designer + Content)
// =============================================================================
// STAGE A of the generation pipeline: a dedicated AI "designer" call that runs
// BEFORE the structural plan. It decides intent + visual direction:
//
//   artifactType / audience / purpose / tone / content depth / theme /
//   density / visual priority
//
// The design plan is STRICTLY VALIDATED against the closed theme registry
// (themes.ts) — the AI cannot invent colors, fonts or layouts, only select
// from validated families and fine-tune the accent within hex constraints.
//
// PURE module (no rendering imports) so the Convex worker bundle stays small.
// =============================================================================

import { resolveTheme, themeCatalogForPrompt, themeExists } from './themes'
import type { DesignSpecification } from '@/types'
import type { DocumentFormat } from '@/services/artifact-planning'
import { extractJsonObject } from '@/services/artifact-planning'

// ==================== DESIGN PLAN MODEL ====================

export type ContentDensity = 'light' | 'medium' | 'dense'

export interface DesignPlan {
  artifactType: string
  documentSubtype: string
  audience: string
  purpose: string
  tone: string
  contentDepth: string
  theme: string
  themeRationale: string
  density: ContentDensity
  visualPriority: string[]
  accentOverride: string | null
  useCharts: boolean
  useTables: boolean
  useMetrics: boolean
}

// ==================== PROMPT ====================

export function buildDesignerSystemPrompt(format: DocumentFormat): string {
  return `You are Filo's document designer. Before any content is written, you decide the VISUAL AND EDITORIAL DIRECTION of the artifact.

You will receive the user's request. Respond ONLY with valid JSON in exactly this shape:

{
  "artifactType": "document|spreadsheet|presentation|report|proposal|invoice|resume|lesson_plan|contract|email|custom",
  "documentSubtype": "short snake_case label, e.g. business_report, pitch_deck, budget_forecast",
  "audience": "who will read this (e.g. executives, investors, students, clients)",
  "purpose": "inform|persuade|teach|sell|review|decide",
  "tone": "professional|friendly|academic|persuasive|technical|casual",
  "contentDepth": "brief|standard|comprehensive",
  "theme": "one theme id from the catalog below",
  "themeRationale": "one sentence explaining why this theme fits",
  "density": "light|medium|dense",
  "visualPriority": ["2-4 things that matter most visually, e.g. key metrics, charts, section hierarchy"],
  "accentOverride": "a hex color like #0ea5e9, or null to use the theme default",
  "useCharts": true,
  "useTables": true,
  "useMetrics": true
}

THEME CATALOG (choose the single best fit; never invent an id):
${themeCatalogForPrompt()}

SELECTION RULES:
1. Match the theme to the audience and subject domain, not to personal taste.
2. Financial/budget content → "financial". Legal/contracts → "legal". Academic/research → "academic" or "research".
3. Pitch decks/startups → "startup" or "modern-tech". Board/executive reports → "executive". Government/policy → "government".
4. Presentations may use "professional-dark" for screen-first premium decks.
5. accentOverride must be null or a valid #rrggbb hex that harmonizes with the chosen theme.
6. The output format is ${format} — density and visual priority must make sense for it (e.g. presentations favor light density).`
}

export function buildDesignerUserPrompt(
  userRequest: string,
  format: DocumentFormat,
  sourceContextSummary?: string | null
): string {
  const context = sourceContextSummary?.trim()
    ? `\n\nSOURCE MATERIAL SUMMARY (from files the user attached — the design must respect this content):\n${sourceContextSummary.slice(0, 3000)}`
    : ''
  return `User request: ${userRequest}

Target output format: ${format}${context}

Decide the design direction now. Respond with the JSON object only.`
}

// ==================== PARSING + VALIDATION ====================

const KNOWN_ARTIFACT_TYPES = new Set([
  'document', 'spreadsheet', 'presentation', 'proposal', 'invoice', 'resume',
  'lesson_plan', 'report', 'contract', 'email', 'custom',
])

const DENSITIES: ContentDensity[] = ['light', 'medium', 'dense']

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : fallback
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/**
 * Parse + validate the designer's JSON. Invalid values are replaced with safe
 * defaults; an invalid theme falls back to a sensible default per format —
 * the pipeline NEVER trusts arbitrary free-form model output (spec §36).
 */
export function parseDesignPlan(
  aiContent: string,
  userRequest: string,
  format: DocumentFormat
): DesignPlan {
  let raw: Record<string, unknown> = {}
  try {
    // Bulletproof extractor (shared with the architect stage): survives prose
    // wrapping, fences, trailing commas and truncated output. An unusable
    // design degrades to safe defaults below — it can never fail the job.
    raw = extractJsonObject(aiContent)
  } catch {
    raw = {}
  }

  const defaultTheme = defaultThemeFor(format)
  let theme = asString(raw.theme, defaultTheme).toLowerCase().replace(/\s+/g, '-')
  if (!themeExists(theme)) theme = defaultTheme

  let density = String(raw.density || 'medium').toLowerCase() as ContentDensity
  if (!DENSITIES.includes(density)) density = 'medium'

  let artifactType = asString(raw.artifactType, 'document').toLowerCase()
  if (!KNOWN_ARTIFACT_TYPES.has(artifactType)) {
    artifactType = format === 'PPTX' ? 'presentation' : format === 'XLSX' || format === 'CSV' ? 'spreadsheet' : 'document'
  }

  let accentOverride: string | null = null
  if (typeof raw.accentOverride === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accentOverride)) {
    accentOverride = raw.accentOverride
  }

  const visualPriority = Array.isArray(raw.visualPriority)
    ? raw.visualPriority.filter((v): v is string => typeof v === 'string').slice(0, 4)
    : ['section hierarchy', 'readable typography']

  return {
    artifactType,
    documentSubtype: asString(raw.documentSubtype, format.toLowerCase() + '_document')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, ''),
    audience: asString(raw.audience, 'professionals'),
    purpose: asString(raw.purpose, 'inform'),
    tone: asString(raw.tone, 'professional'),
    contentDepth: asString(raw.contentDepth, 'standard'),
    theme,
    themeRationale: asString(raw.themeRationale, 'Safe professional default'),
    density,
    visualPriority: visualPriority.length > 0 ? visualPriority : ['section hierarchy'],
    accentOverride,
    useCharts: asBool(raw.useCharts, format !== 'CSV'),
    useTables: asBool(raw.useTables, true),
    useMetrics: asBool(raw.useMetrics, true),
  }
}

/** Safe default theme when the designer output is unusable or absent. */
export function defaultThemeFor(format: DocumentFormat): string {
  switch (format) {
    case 'PPTX':
      return 'corporate'
    case 'XLSX':
    case 'CSV':
      return 'financial'
    default:
      return 'executive'
  }
}

/** Resolve the validated DesignPlan into the renderer-facing DesignSpecification. */
export function applyDesignPlan(
  plan: DesignPlan,
  format: DocumentFormat
): { design: DesignSpecification; tokens: ReturnType<typeof resolveTheme>['tokens'] } {
  const { design, tokens } = resolveTheme(plan.theme, {
    accentOverride: plan.accentOverride,
    format,
  })
  return { design, tokens }
}

/** Short human-readable summary of the design direction (stored on the job). */
export function describeDesignPlan(plan: DesignPlan): string {
  return `${plan.theme} theme · ${plan.tone} tone · ${plan.density} density · for ${plan.audience}`
}
