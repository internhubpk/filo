// =============================================================================
// FILO TYPOGRAPHY — BUNDLED FONT REGISTRY (rendering-correctness core)
// =============================================================================
// Root cause of the "□□□□□" tofu incident: SVG rasterization (sharp → librsvg
// → fontconfig) previously relied on fonts that HAPPENED to exist on the host.
// Diagrams declared font-family="Arial" (never installed on Linux servers) and
// ECharts declared no family at all. On bare containers fontconfig resolves to
// nothing and librsvg paints .notdef boxes for EVERY glyph. The PDF renderer
// had the same class of bug: absolute /usr/share/fonts paths with a Helvetica
// (Latin-1 only) fallback — any arrow, Greek letter or math symbol became a
// missing glyph.
//
// This module makes typography DETERMINISTIC:
//   1. Filo ships its own fonts (assets/fonts) — DejaVu (full Latin/Greek/
//      Cyrillic/arrows/math/punctuation coverage) plus the metric-compatible
//      document twins Liberation Serif (Times New Roman) and Carlito
//      (Calibri). Every file is integrity-checked with real font magic bytes —
//      a corrupt "font" (this repo's own hosts have shipped HTML error pages
//      named *.ttf) is never registered.
//   2. ensureRasterizerFonts() installs a generated fontconfig that ALWAYS
//      includes the bundled directory (plus any real system font dirs), and
//      points FONTCONFIG_FILE at it BEFORE sharp/librsvg initializes. Tofu
//      becomes impossible on any deployment, including bare containers.
//   3. PDF font selection is GLYPH-COVERAGE-AWARE: a theme's metric twin is
//      embedded only when it actually covers every character of the document;
//      otherwise the renderer falls back to DejaVu per document (never
//      per-character tofu).
//
// Node-only module (fs/os/path + optional fontkit). Never import it from
// code bundled into Convex actions.
// =============================================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ==================== BUNDLED FONT CATALOG ====================

export type FontStyle = 'regular' | 'bold' | 'italic' | 'boldItalic'

export interface BundledFont {
  /** fontconfig family name (as written inside the TTF). */
  family: string
  style: FontStyle
  file: string
}

/** Every font Filo ships in assets/fonts. Files are validated before use. */
export const BUNDLED_FONTS: BundledFont[] = [
  // DejaVu — the correctness floor. Covers Latin, accented Latin, Greek,
  // Cyrillic, arrows (→←↑↓), math operators (≤ ≥ ≠ ± × ÷ ∑ ∫ √), currency
  // (€ £ ¥ ₹ ₨), punctuation (— – ‘ ’ “ ” …) and technical symbols (✓).
  { family: 'DejaVu Sans', style: 'regular', file: 'DejaVuSans.ttf' },
  { family: 'DejaVu Sans', style: 'bold', file: 'DejaVuSans-Bold.ttf' },
  { family: 'DejaVu Serif', style: 'regular', file: 'DejaVuSerif.ttf' },
  { family: 'DejaVu Serif', style: 'bold', file: 'DejaVuSerif-Bold.ttf' },
  { family: 'DejaVu Sans Mono', style: 'regular', file: 'DejaVuSansMono.ttf' },
  { family: 'DejaVu Sans Mono', style: 'bold', file: 'DejaVuSansMono-Bold.ttf' },
  // Metric-compatible document twins — keep PDF page layout aligned with the
  // theme's intended Word typography (Times New Roman / Calibri metrics).
  { family: 'Liberation Serif', style: 'regular', file: 'LiberationSerif-Regular.ttf' },
  { family: 'Liberation Serif', style: 'bold', file: 'LiberationSerif-Bold.ttf' },
  { family: 'Liberation Serif', style: 'italic', file: 'LiberationSerif-Italic.ttf' },
  { family: 'Liberation Serif', style: 'boldItalic', file: 'LiberationSerif-BoldItalic.ttf' },
  { family: 'Carlito', style: 'regular', file: 'Carlito-Regular.ttf' },
  { family: 'Carlito', style: 'bold', file: 'Carlito-Bold.ttf' },
  { family: 'Carlito', style: 'italic', file: 'Carlito-Italic.ttf' },
  { family: 'Carlito', style: 'boldItalic', file: 'Carlito-BoldItalic.ttf' },
]

/** Family used by every SVG rasterized server-side (diagrams, charts). */
export const RASTER_FONT_FAMILY = 'DejaVu Sans'
/** Family used by rasterized code blocks / monospace SVG text. */
export const RASTER_MONO_FAMILY = 'DejaVu Sans Mono'

/**
 * Full CSS/SVG font-family stack for server-rasterized SVG text. The bundled
 * family is listed FIRST so librsvg resolves it from the Filo fontconfig even
 * on bare containers; trailing generics are the last-resort fallback.
 */
export const RASTER_FONT_STACK = `${RASTER_FONT_FAMILY}, ${RASTER_MONO_FAMILY}, sans-serif`

/** Browser/HTML font stack mirroring the raster stack (client-side rendering). */
export const HTML_FONT_STACK = `'DejaVu Sans', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`
export const HTML_MONO_STACK = `'DejaVu Sans Mono', ui-monospace, 'Cascadia Code', Consolas, monospace`

// ==================== FONT DIRECTORY RESOLUTION ====================

let cachedFontDir: string | null | undefined

function isRealFontFile(p: string): boolean {
  try {
    const fd = fs.openSync(p, 'r')
    const buf = Buffer.alloc(4)
    const read = fs.readSync(fd, buf, 0, 4, 0)
    fs.closeSync(fd)
    if (read < 4) return false
    // TrueType 0x00010000 / 'true' / 'OTTO' (CFF) / 'ttcf' (collection).
    const magic = buf.readUInt32BE(0)
    return magic === 0x00010000 || magic === 0x74727565 || magic === 0x4f54544f || magic === 0x74746366
  } catch {
    return false
  }
}

/**
 * Locate the bundled assets/fonts directory. Order:
 *   1. FILO_FONTS_DIR env override
 *   2. walk up from process.cwd() looking for assets/fonts with real fonts
 *   3. walk up from this module's directory (covers compiled test builds)
 */
export function resolveFontDir(): string | null {
  if (cachedFontDir !== undefined) return cachedFontDir
  const probe = (dir: string | null): string | null => {
    if (!dir) return null
    const sentinel = path.join(dir, 'DejaVuSans.ttf')
    return isRealFontFile(sentinel) ? dir : null
  }

  const envDir = process.env.FILO_FONTS_DIR
  let found: string | null = envDir ? probe(path.resolve(envDir)) : null

  if (!found) {
    let dir = path.resolve(process.cwd())
    for (let i = 0; i < 6 && !found; i++) {
      found = probe(path.join(dir, 'assets', 'fonts'))
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  if (!found) {
    // __dirname works for both CJS test builds and bundled server output.
    let dir = path.dirname(__filename)
    for (let i = 0; i < 6 && !found; i++) {
      found = probe(path.join(dir, 'assets', 'fonts'))
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  cachedFontDir = found
  return found
}

/** Absolute path of a bundled font file, or null when unavailable. */
export function bundledFontPath(file: string): string | null {
  const dir = resolveFontDir()
  if (!dir) return null
  const p = path.join(dir, file)
  return isRealFontFile(p) ? p : null
}

/** Resolve a BundledFont entry to a real path (null when missing/corrupt). */
function facePath(font: BundledFont): string | null {
  return bundledFontPath(font.file)
}

function findFace(family: string, style: FontStyle): string | null {
  const face = BUNDLED_FONTS.find((f) => f.family === family && f.style === style)
  return face ? facePath(face) : null
}

// ==================== RASTERIZER FONTCONFIG BOOTSTRAP ====================

const SYSTEM_FONT_DIRS = [
  '/usr/share/fonts',
  '/usr/local/share/fonts',
  path.join(os.homedir(), '.fonts'),
  path.join(os.homedir(), '.local', 'share', 'fonts'),
]

let rasterizerReady = false

/**
 * Guarantee that sharp/librsvg can resolve the bundled fonts, regardless of
 * what the host provides. MUST be called before the FIRST `import('sharp')` —
 * librsvg snapshots fontconfig at init. Every server-side image pipeline
 * (diagrams, charts, equations) calls this before rasterizing.
 *
 * The generated config ALWAYS includes the bundled font dir and ADDS any real
 * system font dirs, so hosts with rich font setups (e.g. Noto CJK) keep them.
 */
export function ensureRasterizerFonts(): void {
  if (rasterizerReady) return

  const bundledDir = resolveFontDir()

  // Build a fontconfig that unions bundled + existing system directories.
  const dirs: string[] = []
  if (bundledDir) dirs.push(bundledDir)
  for (const d of SYSTEM_FONT_DIRS) {
    try {
      if (fs.existsSync(d) && !dirs.includes(d)) dirs.push(d)
    } catch {
      /* unreadable home dir — skip */
    }
  }

  const cacheDir = path.join(os.tmpdir(), 'filo-fontconfig-cache')
  try {
    fs.mkdirSync(cacheDir, { recursive: true })
  } catch {
    /* non-fatal: fontconfig will fall back to no cache */
  }

  const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  ${dirs.map((d) => `<dir>${escapeXml(d)}</dir>`).join('\n  ')}
  <cachedir>${escapeXml(cacheDir)}</cachedir>
</fontconfig>`

  const confPath = path.join(os.tmpdir(), 'filo-fonts.conf')
  try {
    fs.writeFileSync(confPath, conf)
    // Always point the process at OUR config: the bundled fonts are then
    // guaranteed to be visible to librsvg even on bare containers.
    process.env.FONTCONFIG_FILE = confPath
  } catch {
    // Read-only tmp — leave the environment untouched; bundled fonts still
    // resolve whenever the host fontconfig includes the asset directory.
  }

  rasterizerReady = true
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ==================== GLYPH COVERAGE ====================

export interface FontPair {
  regular: string
  bold: string
  /** Human-readable family label (for QA metadata). */
  family: string
}

/**
 * True when `fontFile` covers every non-control character of `text`.
 * Uses fontkit (already a pdfkit dependency) to read the font's cmap.
 * Returns false when the font file itself is unreadable.
 */
export function fontCovers(fontFile: string, text: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fontkit = require('fontkit') as { openSync(p: string): { hasGlyphForCodePoint(cp: number): boolean } | null }
    const font = fontkit.openSync(fontFile)
    if (!font) return false
    for (const ch of text) {
      const cp = ch.codePointAt(0)
      if (cp === undefined) continue
      // Skip control characters and line separators — they never render.
      if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue
      if (cp === 0x2028 || cp === 0x2029 || cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff) continue
      if (!font.hasGlyphForCodePoint(cp)) return false
    }
    return true
  } catch {
    return false
  }
}

// ==================== PDF FONT RESOLUTION ====================

const SERIF_HINT = /georgia|times|serif|palatino|book|garamond|roman/i

function isSerifThemeFont(family: string): boolean {
  return SERIF_HINT.test(family) && !/sans/i.test(family)
}

export interface PdfFontResolution {
  body: FontPair | null
  mono: FontPair | null
  /** QA/debug info: why the family was chosen. */
  reason: string
  /** True when the body font could NOT cover the document and DejaVu was used. */
  coverageFallback: boolean
  /** True when the document needs a CJK-capable font but none was found. */
  cjkMissing: boolean
}

const CJK_RE = /[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F\u3040-\u30FF]/

function cjkCandidates(): FontPair[] {
  const pairs: FontPair[] = []
  const env = process.env.FILO_CJK_FONT
  if (env && isRealFontFile(env)) {
    const boldCandidate = env.replace(/\.ttf$/i, '-Bold.ttf')
    pairs.push({ regular: env, bold: isRealFontFile(boldCandidate) ? boldCandidate : env, family: 'env-cjk' })
  }
  const host = [
    '/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf',
    '/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  ]
  for (const regular of host) {
    if (isRealFontFile(regular)) {
      const bold = regular.replace(/-Regular\.ttf$/, '-Bold.ttf').replace(/\.ttc$/, '-Bold.ttc')
      pairs.push({ regular, bold: isRealFontFile(bold) ? bold : regular, family: 'host-cjk' })
    }
  }
  return pairs
}

/**
 * Resolve the fonts to embed for a PDF document.
 *
 * Selection order for the body face:
 *   1. CJK detection — any CJK codepoint forces the best available CJK font
 *      (base-14 and Latin twins would be pure tofu).
 *   2. The theme's metric twin (Liberation Serif for serif themes, Carlito
 *      for sans themes) when it covers the FULL document charset.
 *   3. DejaVu Sans/Serif — the coverage floor (arrows, Greek, math, ✓ …).
 *   4. null when even the bundle is unavailable — the caller then falls back
 *      to pdfkit base-14 Helvetica and MUST surface a QA warning.
 */
export function resolvePdfFonts(themeBodyFont: string, sampleText: string): PdfFontResolution {
  const text = String(sampleText ?? '')
  const cjk = CJK_RE.test(text)
  const serif = isSerifThemeFont(themeBodyFont || '')

  // ---- 1. CJK ----
  if (cjk) {
    const pair = cjkCandidates()[0] ?? null
    return {
      body: pair,
      mono: resolveMono(),
      reason: pair ? `CJK document → ${pair.family} (${pair.regular})` : 'CJK document but no CJK font available on this host',
      coverageFallback: false,
      cjkMissing: !pair,
    }
  }

  // ---- 2/3. metric twin with full coverage, else DejaVu floor ----
  const twinRegular = serif ? findFace('Liberation Serif', 'regular') : findFace('Carlito', 'regular')
  const twinBold = serif ? findFace('Liberation Serif', 'bold') : findFace('Carlito', 'bold')
  if (twinRegular && twinBold && fontCovers(twinRegular, text)) {
    return {
      body: { regular: twinRegular, bold: twinBold, family: serif ? 'Liberation Serif' : 'Carlito' },
      mono: resolveMono(),
      reason: `theme twin (${serif ? 'Liberation Serif' : 'Carlito'}) covers the full charset`,
      coverageFallback: false,
      cjkMissing: false,
    }
  }

  const floorFamily = serif ? 'DejaVu Serif' : 'DejaVu Sans'
  const floorRegular = findFace(floorFamily, 'regular')
  const floorBold = findFace(floorFamily, 'bold')
  if (floorRegular && floorBold) {
    return {
      body: { regular: floorRegular, bold: floorBold, family: floorFamily },
      mono: resolveMono(),
      reason: twinRegular
        ? `theme twin missed glyphs in the document — coverage fallback to ${floorFamily}`
        : `bundled ${floorFamily}`,
      coverageFallback: Boolean(twinRegular),
      cjkMissing: false,
    }
  }

  // ---- 4. nothing available ----
  return {
    body: null,
    mono: null,
    reason: 'no bundled fonts found — PDF falls back to base-14 Helvetica (Latin-1 only)',
    coverageFallback: false,
    cjkMissing: cjk,
  }
}

function resolveMono(): FontPair | null {
  const regular = findFace('DejaVu Sans Mono', 'regular')
  const bold = findFace('DejaVu Sans Mono', 'bold')
  if (regular && bold) return { regular, bold, family: 'DejaVu Sans Mono' }
  return null
}

// ==================== SVG TEXT MEASUREMENT ====================

interface MeasuredFont {
  widthOf(text: string, fontSize: number): number
}

let measuredFontCache: Map<string, MeasuredFont | null> = new Map()

/**
 * Exact text width in a bundled font via fontkit glyph advances — used by the
 * diagram engine to size nodes so long labels wrap instead of overflowing.
 * Falls back to a conservative heuristic when fontkit/font is unavailable.
 */
export function measureText(fontFile: string, text: string, fontSize: number): number {
  const key = fontFile
  let measurer = measuredFontCache.get(key)
  if (measurer === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fontkit = require('fontkit') as { openSync(p: string): { layout(s: string): { advanceWidth: number } } | null } & Record<string, unknown>
      const anyFontkit = fontkit as unknown as { openSync(p: string): { layout(s: string): { advanceWidth: number }; unitsPerEm: number } | null }
      const font = anyFontkit.openSync(fontFile)
      measurer = font
        ? {
            widthOf: (t: string, fs: number) => {
              if (!t) return 0
              try {
                return (font.layout(t).advanceWidth / font.unitsPerEm) * fs
              } catch {
                return t.length * fs * 0.58
              }
            },
          }
        : null
    } catch {
      measurer = null
    }
    measuredFontCache.set(key, measurer)
  }
  if (measurer) return measurer.widthOf(text, fontSize)
  // Heuristic fallback (~DejaVu Sans average advance).
  return text.length * fontSize * 0.6
}

/** Reset internal caches (tests / long-lived processes). */
export function resetTypographyCaches(): void {
  measuredFontCache = new Map()
  rasterizerReady = false
}
