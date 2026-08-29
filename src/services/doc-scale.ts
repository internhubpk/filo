// =============================================================================
// FILO DOCUMENT SCALE ENGINE
// =============================================================================
// Turns "how big should this document be" into a first-class, prompt-driven
// decision that the WHOLE pipeline honors:
//
//   user request ──▶ ContentDepth ──▶ DocumentScale
//                                     • pageTarget   (DOCX/PDF)
//                                     • slidesTarget (PPTX)
//                                     • section-count bounds
//                                     • per-section word budgets
//                                     • visual cadence (charts/tables/diagrams)
//                                     • TOC + numbered headings flags
//
// The scale is inferred from EXPLICIT evidence in the user's request (page
// counts, "notes", "textbook", "handbook", "one-pager"…) and refined by the
// AI designer's contentDepth. Every downstream prompt (architect + section
// generators) receives the scale so a "100-page notes" request produces a
// 20-30 chapter blueprint with 700-1100-word units — not a 6-section pamphlet.
//
// PURE module (no rendering imports) — safe for the Convex worker bundle.
// =============================================================================

export type ContentDepth = 'brief' | 'standard' | 'comprehensive' | 'exhaustive'

export interface DocumentScale {
  depth: ContentDepth
  /** Approximate printed-page target for DOCX/PDF (0 = unspecified). */
  pageTarget: number
  /** Approximate slide target for PPTX (0 = unspecified). */
  slidesTarget: number
  /** Blueprint section (chapter) count bounds for the architect. */
  minSections: number
  maxSections: number
  /** Per-section unit word budget [min, max] — enforced in content prompts. */
  wordsPerUnitMin: number
  wordsPerUnitMax: number
  /** Require a visual (chart/table/diagram/metrics) at least every N units. */
  visualEveryN: number
  /** Render a table of contents. */
  toc: boolean
  /** Number headings (1., 1.1 — deterministic, computed in code). */
  numberedHeadings: boolean
  /** Human-readable reason (stored on the job for diagnostics). */
  rationale: string
}

// ==================== EVIDENCE DETECTION ====================

const LONG_DOC_EVIDENCE: Array<{ re: RegExp; weight: number; why: string }> = [
  { re: /(\d{2,4})\s*(?:\+)?\s*(?:pages|page|pgs|页)/i, weight: 3, why: 'explicit page count' },
  { re: /\b(?:100|150|200|300|400|500)\s*(?:\+)?\s*pages?\b/i, weight: 3, why: 'explicit 100+ pages' },
  { re: /\b(?:lecture|class|study|revision|course)\s+notes\b/i, weight: 3, why: 'study/lecture notes' },
  { re: /\btextbook\b|\bhandbook\b|\bcourse\s+material\b|\bmasterclass\b/i, weight: 3, why: 'textbook/handbook' },
  { re: /\bcomprehensive\b|\bin[- ]?depth\b|\bexhaustive\b|\bcomplete\s+guide\b|\bdefinitive\b/i, weight: 2, why: 'comprehensive wording' },
  { re: /\bdeep\s+dive\b|\bfull\s+course\b|\bcurriculum\b|\bsyllabus\b/i, weight: 2, why: 'course framing' },
  { re: /\bwhite\s*paper\b|\bresearch\s+report\b|\bthesis\b|\bdissertation\b/i, weight: 2, why: 'long-form research' },
  { re: /\bstep[- ]by[- ]step\b.*\b(?:guide|tutorial)\b/i, weight: 1, why: 'tutorial guide' },
  { re: /\buser\s+manual\b|\boperations\s+manual\b|\bplaybook\b/i, weight: 2, why: 'manual/playbook' },
  { re: /\bannual\s+report\b|\b10[- ]k\b|\binvestor\s+prospectus\b/i, weight: 2, why: 'annual-scale report' },
]

const SHORT_DOC_EVIDENCE: Array<{ re: RegExp; weight: number; why: string }> = [
  { re: /\bone[- ]pager?\b|\bone[- ]page\b/i, weight: 3, why: 'one-pager requested' },
  { re: /\bquick\s+(?:summary|overview|brief)\b|\bshort\s+(?:doc|document|report|note)\b/i, weight: 2, why: 'short summary requested' },
  { re: /\belevator\s+pitch\b|\bexecutive\s+summary\s+only\b/i, weight: 2, why: 'pitch/summary only' },
  { re: /\bbrief(?:ly)?\b(?!\s*the)\b/i, weight: 1, why: '"brief" wording' },
]

/** Explicit page hint: "at least 80 pages", "100 pages notes", "about 40 pages". */
export function explicitPageHint(request: string): number | null {
  const m = /(\d{1,4})\s*(?:\+|-)?\s*(?:printed\s+)?pages?\b/i.exec(String(request || ''))
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 1) return null
  return Math.min(n, 300)
}

function evidenceScore(request: string, table: Array<{ re: RegExp; weight: number; why: string }>): { score: number; whys: string[] } {
  let score = 0
  const whys: string[] = []
  for (const { re, weight, why } of table) {
    if (re.test(request)) {
      score += weight
      whys.push(why)
    }
  }
  return { score, whys }
}

// ==================== SCALE PROFILES ====================

const PROFILES: Record<ContentDepth, Omit<DocumentScale, 'depth' | 'pageTarget' | 'slidesTarget' | 'rationale'>> = {
  brief: {
    minSections: 3,
    maxSections: 5,
    wordsPerUnitMin: 220,
    wordsPerUnitMax: 420,
    visualEveryN: 2,
    toc: false,
    numberedHeadings: false,
  },
  standard: {
    minSections: 6,
    maxSections: 10,
    wordsPerUnitMin: 380,
    wordsPerUnitMax: 650,
    visualEveryN: 3,
    toc: true,
    numberedHeadings: false,
  },
  comprehensive: {
    minSections: 10,
    maxSections: 18,
    wordsPerUnitMin: 550,
    wordsPerUnitMax: 900,
    visualEveryN: 3,
    toc: true,
    numberedHeadings: true,
  },
  exhaustive: {
    minSections: 18,
    maxSections: 30,
    wordsPerUnitMin: 700,
    wordsPerUnitMax: 1100,
    visualEveryN: 3,
    toc: true,
    numberedHeadings: true,
  },
}

/** Pages generated per 1000 words for Filo's body typography (A4, 11pt). */
const WORDS_PER_PAGE = 420
const SLIDES_PER_DEPTH: Record<ContentDepth, [number, number]> = {
  brief: [6, 9],
  standard: [10, 16],
  comprehensive: [16, 24],
  exhaustive: [24, 32],
}

// ==================== SCALE RESOLUTION ====================

/**
 * Resolve the final DocumentScale. `request` is the raw user prompt;
 * `designerDepth` is the AI designer's contentDepth ("brief|standard|comprehensive").
 * Explicit user evidence always WINS over the designer — a "100 pages notes"
 * request must never silently degrade to a 6-section pamphlet because the
 * designer said "standard".
 */
export function resolveDocumentScale(request: string, designerDepth?: string | null): DocumentScale {
  const req = String(request || '')
  const longEv = evidenceScore(req, LONG_DOC_EVIDENCE)
  const shortEv = evidenceScore(req, SHORT_DOC_EVIDENCE)
  const pageHint = explicitPageHint(req)

  // Start from the designer's opinion, then let evidence override.
  let depth: ContentDepth = 'standard'
  if (designerDepth === 'brief' || designerDepth === 'comprehensive' || designerDepth === 'exhaustive') {
    depth = designerDepth
  }

  if (pageHint && pageHint >= 40) depth = 'exhaustive'
  else if (pageHint && pageHint >= 15) depth = 'comprehensive'
  else if (pageHint && pageHint <= 4) depth = 'brief'

  if (longEv.score >= 3 && depth === 'standard') depth = 'comprehensive'
  if (longEv.score >= 5 && (depth === 'standard' || depth === 'comprehensive')) depth = 'exhaustive'
  if (shortEv.score >= 2 && depth === 'standard') depth = 'brief'

  const profile = PROFILES[depth]
  const rationaleBits: string[] = []
  if (pageHint) rationaleBits.push(`user asked for ~${pageHint} pages`)
  if (longEv.whys.length) rationaleBits.push(longEv.whys.join(', '))
  if (shortEv.whys.length) rationaleBits.push(shortEv.whys.join(', '))
  rationaleBits.push(`designer depth: ${designerDepth || 'unspecified'}`)

  // Page target: honor the explicit hint, else derive from the profile.
  let pageTarget = pageHint ?? 0
  if (pageTarget === 0) {
    const words = (profile.wordsPerUnitMin + profile.wordsPerUnitMax) / 2 *
      ((profile.minSections + profile.maxSections) / 2)
    pageTarget = Math.max(2, Math.round((words / WORDS_PER_PAGE) * 10) / 10)
  }

  // If the user named a page count, size the section budget to reach it.
  let { minSections, maxSections } = profile
  if (pageHint && pageHint >= 8) {
    const unitsNeeded = Math.ceil((pageHint * WORDS_PER_PAGE) / ((profile.wordsPerUnitMin + profile.wordsPerUnitMax) / 2))
    maxSections = Math.min(60, Math.max(maxSections, unitsNeeded))
    minSections = Math.min(maxSections - 1, Math.max(minSections, Math.ceil(unitsNeeded * 0.8)))
  }

  const [slidesMin, slidesMax] = SLIDES_PER_DEPTH[depth]
  const slidesTarget = pageHint ? 0 : Math.round((slidesMin + slidesMax) / 2)

  return {
    depth,
    pageTarget,
    slidesTarget,
    minSections,
    maxSections,
    wordsPerUnitMin: profile.wordsPerUnitMin,
    wordsPerUnitMax: profile.wordsPerUnitMax,
    visualEveryN: profile.visualEveryN,
    toc: profile.toc,
    numberedHeadings: profile.numberedHeadings,
    rationale: rationaleBits.join(' · ').slice(0, 240),
  }
}

/** Compact block for the architect system prompt. */
export function scaleForPrompt(scale: DocumentScale, format: string): string {
  if (format === 'PPTX') {
    const slides = scale.slidesTarget || 12
    return `DOCUMENT SCALE (MANDATORY): the deck must land at ~${slides} slides (±2). Plan ${scale.minSections}-${scale.maxSections} content sections; a section = 1-2 slides. Depth profile: ${scale.depth}.`
  }
  if (format === 'XLSX' || format === 'CSV') {
    return `DOCUMENT SCALE: plan ${scale.minSections}-${scale.maxSections} data worksheets. Depth profile: ${scale.depth}. Each data sheet should carry a full, realistic table (8+ data rows unless the domain forbids it).`
  }
  const pages = scale.pageTarget ? `~${scale.pageTarget} pages` : 'a multi-page document'
  return [
    `DOCUMENT SCALE (MANDATORY): the final document must be ${pages} (${scale.depth} profile).`,
    `Plan ${scale.minSections}-${scale.maxSections} MAIN SECTIONS. For ${scale.depth === 'brief' ? 'short' : 'longer'} documents group them under PARTS (level:"part") when natural.`,
    `Each section targets ${scale.wordsPerUnitMin}-${scale.wordsPerUnitMax} words of body content — the content generator ENFORCES this budget, so plan section topics that can genuinely carry it.`,
    `Include at least one visual (chart, table, diagram or metric grid) every ${scale.visualEveryN} sections.`,
    scale.numberedHeadings ? 'Headings will be auto-numbered (1., 2., 2.1 …) — write titles without manual numbers.' : 'Write natural section titles.',
  ].join(' ')
}

// ==================== VISUAL PLANNING (deterministic) ====================

export interface VisualAssignment {
  kind: 'chart' | 'table' | 'diagram' | 'metrics' | 'timeline' | 'two_column'
  /** Optional hint for the content generator, e.g. "line: trend over 4 periods". */
  hint?: string
}

/**
 * Deterministic visual distribution for a section list. The architect's own
 * visual notes are honored; this pass GUARANTEES the cadence and the chart
 * variety so "charts where required" stops depending on model mood:
 *   • every Nth section carries at least one visual;
 *   • pie/donut charts cap at ~1/3 of charts (no pie-chart soup);
 *   • business/financial documents get a metric grid in the opening section.
 */
export function enforceVisualCadence(
  sections: Array<{ id: string; visuals?: VisualAssignment[]; level?: string; title?: string }>,
  scale: DocumentScale,
  opts?: { businessLike?: boolean }
): void {
  const usable = sections.filter((s) => (s.level || 'chapter') !== 'part')
  const everyN = Math.max(2, scale.visualEveryN)
  let chartCount = 0
  let pieCount = 0

  for (let i = 0; i < usable.length; i++) {
    const s = usable[i]
    s.visuals = (s.visuals || []).filter((v) => !!v.kind)
    const hasVisual = s.visuals.length > 0
    const needsVisual = (i + 1) % everyN === 0 || i === 1 // early visual to set expectations
    if (!hasVisual && needsVisual) {
      // Rotate kinds so documents don't become all-bar-charts.
      const cycle: VisualAssignment['kind'][] = ['chart', 'table', 'chart', 'diagram', 'chart']
      const kind = cycle[i % cycle.length]
      const hint =
        kind === 'chart'
          ? chartKindHint(chartCount, pieCount)
          : kind === 'table'
            ? '3-6 columns × 5-8 data rows, realistic values'
            : kind === 'diagram'
              ? 'flowchart or hierarchy of the process/structure described'
              : '2-4 headline numbers'
      s.visuals.push({ kind, hint })
    }
    for (const v of s.visuals) {
      if (v.kind === 'chart') {
        chartCount++
        if (/pie|donut/i.test(v.hint || '')) pieCount++
      }
    }
  }

  // Pie-cap pass: swap excess pies to bar (keeps variety, kills pie soup).
  const maxPies = Math.max(1, Math.floor(chartCount / 3))
  let excess = pieCount - maxPies
  if (excess > 0) {
    for (const s of usable) {
      if (excess <= 0) break
      for (const v of s.visuals || []) {
        if (excess > 0 && v.kind === 'chart' && /pie|donut/i.test(v.hint || '')) {
          v.hint = 'bar: compare categories'
          excess--
        }
      }
    }
  }

  // Business documents open with numbers.
  if (opts?.businessLike && usable.length > 0) {
    const first = usable[0]
    if (!(first.visuals || []).some((v) => v.kind === 'metrics')) {
      first.visuals = [{ kind: 'metrics', hint: '3-4 headline KPIs for the opening' }, ...(first.visuals || [])]
    }
  }
}

function chartKindHint(chartIdx: number, pieCount: number): string {
  const kinds = ['bar', 'line', 'bar', 'area', 'line']
  const kind = kinds[chartIdx % kinds.length]
  if (kind === 'bar' && pieCount === 0 && chartIdx >= 1) return 'pie: share/composition of a whole'
  return `${kind}: ${kind === 'line' || kind === 'area' ? 'trend over time/periods' : 'compare categories'}`
}

// ==================== HEADING NUMBERING ====================

export interface NumberedSection {
  level?: string
  number?: string
}

/**
 * Deterministic hierarchical numbering for a flat section list.
 *   part     → I, II, III …
 *   chapter  → 1, 2, 3 … (restarts never; parts don't reset chapter numbers —
 *              continuous numbering is the norm for reports)
 *   section  → 1.1, 1.2 … under the nearest preceding chapter
 */
export function assignSectionNumbers<T extends NumberedSection>(sections: T[]): T[] {
  let partNo = 0
  let chapterNo = 0
  let sectionNo = 0
  for (const s of sections) {
    const level = (s.level || 'chapter').toLowerCase()
    if (level === 'part') {
      partNo++
      sectionNo = 0
      s.number = romanize(partNo)
    } else if (level === 'section' || level === 'subsection') {
      sectionNo++
      s.number = chapterNo > 0 ? `${chapterNo}.${sectionNo}` : `${sectionNo}`
    } else {
      chapterNo++
      sectionNo = 0
      s.number = `${chapterNo}`
    }
  }
  return sections
}

function romanize(n: number): string {
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'],
    [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'],
    [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let out = ''
  let v = n
  for (const [val, sym] of table) {
    while (v >= val) {
      out += sym
      v -= val
    }
  }
  return out || 'I'
}
