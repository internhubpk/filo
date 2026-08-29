// =============================================================================
// FILO MATH ENGINE (spec §20 — "mathematics must be real")
// =============================================================================
// LaTeX → standalone SVG via MathJax SSR (lite DOM adaptor, no browser), then
// → PNG via sharp for embedding into DOCX / PDF / PPTX. The AI supplies LaTeX;
// this engine computes the exact visual — a broken or unparseable expression
// is reported as a FAILURE, never silently rendered as corrupted plain text.
//
// Pipeline facts established by the phase-10 verification suite:
//   • liteAdaptor().outerHTML(node) wraps the <svg> in <mjx-container> — the
//     engine extracts the inner <svg>…</svg> so sharp sees an SVG root.
//   • MathJax emits width/height in `ex` units; we rewrite them in px from the
//     viewBox ratio for deterministic document sizing (the viewBox is present).
//   • TeX compile errors appear as data-mml-node="merror" nodes instead of
//     exceptions — the engine treats their presence as a hard failure so the
//     caller can fall back to an honest, visible representation.
// =============================================================================

interface MjDoc {
  convert(latex: string): unknown
  adaptor: {
    outerHTML(node: unknown): string
  }
}

let cachedDoc: MjDoc | null = null
let initPromise: Promise<MjDoc> | null = null

async function getMathJax() {
  if (cachedDoc) return cachedDoc
  if (!initPromise) {
    initPromise = (async () => {
      const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] =
        await Promise.all([
          import('mathjax-full/js/mathjax.js'),
          import('mathjax-full/js/input/tex.js'),
          import('mathjax-full/js/output/svg.js'),
          import('mathjax-full/js/adaptors/liteAdaptor.js'),
          import('mathjax-full/js/handlers/html.js'),
          import('mathjax-full/js/input/tex/AllPackages.js'),
        ])
      const adaptor = liteAdaptor()
      RegisterHTMLHandler(adaptor)
      const tex = new TeX({ packages: AllPackages as unknown as string[] })
      const svg = new SVG({ fontCache: 'none' })
      const doc = mathjax.document('', { InputJax: tex, OutputJax: svg }) as unknown as {
        convert(latex: string): unknown
      }
      const entry: MjDoc = { convert: (latex: string) => doc.convert(latex), adaptor }
      cachedDoc = entry
      return entry
    })()
  }
  return initPromise
}

export interface MathSvg {
  svg: string
  widthPx: number
  heightPx: number
}

/** Baseline pixels per `ex` — controls rendered equation size in documents. */
const EX_PX = 16
const MIN_WIDTH_PX = 24

/** Strip BOM/zero-width chars and surrounding $ delimiters the AI often adds. */
export function cleanLatex(raw: unknown): string {
  let s = String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
  // Accept "$$…$$", "\( … \)", "\[ … \]" and "$…$" wrappers.
  s = s.replace(/^\$\$([\s\S]+)\$\$$/, '$1')
  s = s.replace(/^\\\[([\s\S]+)\\\]$/, '$1')
  s = s.replace(/^\\\(([\s\S]+)\\\)$/, '$1')
  if (s.startsWith('$') && s.endsWith('$') && s.length > 2) s = s.slice(1, -1)
  return s.trim()
}

/**
 * Convert LaTeX to a standalone SVG string. Returns null when the TeX engine
 * reports a parse error (merror node) — the caller must NOT render the output
 * of a failed compile, because MathJax embeds the error text into the image.
 */
export async function latexToSvg(
  latex: string,
  opts?: { color?: string; display?: boolean; exPx?: number }
): Promise<MathSvg | null> {
  const mj = await getMathJax()
  let node: unknown
  try {
    node = mj.convert(latex)
  } catch {
    return null
  }
  let svg = mj.adaptor.outerHTML(node)
  const start = svg.indexOf('<svg')
  const end = svg.lastIndexOf('</svg>') + 6
  if (start < 0 || end <= start) return null
  svg = svg.slice(start, end)

  // A failed compile shows up as an merror node — or, for unknown macros, a
  // red-tinted mtext node ("Undefined control sequence" path). Both are TeX
  // errors and must be treated as failures (honesty requirement: never
  // silently render a corrupted expression with its error text baked in).
  if (/data-mml-node="merror"/.test(svg) || /class="merror"/.test(svg) || /fill="red"/.test(svg)) return null

  // Rewrite ex-unit dimensions into px from the viewBox so document layout is
  // deterministic across librsvg builds.
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]
  const wEx = Number(svg.match(/width="([\d.]+)ex"/)?.[1] ?? 0)
  const hEx = Number(svg.match(/height="([\d.]+)ex"/)?.[1] ?? 0)
  const exPx = Math.min(Math.max(opts?.exPx ?? EX_PX, 8), 48)
  if (viewBox && wEx > 0 && hEx > 0) {
    const vb = viewBox.trim().split(/\s+/).map(Number)
    if (vb.length === 4 && vb.every((n) => Number.isFinite(n))) {
      const wPx = Math.max(Math.round(wEx * exPx), MIN_WIDTH_PX)
      const hPx = Math.max(Math.round(hPx2(hEx, wEx, wPx)), 1)
      svg = svg
        .replace(/width="[\d.]+ex"/, `width="${wPx}"`)
        .replace(/height="[\d.]+ex"/, `height="${hPx}"`)
    }
  }
  svg = svg.replace(/style="[^"]*"/, '').replace(/currentColor/g, opts?.color ?? '#1F2937')
  const widthPx = Math.max(MIN_WIDTH_PX, Math.round(wEx * exPx) || MIN_WIDTH_PX)
  const heightPx = Math.max(12, Math.round(hEx * exPx) || Math.round(widthPx * 0.4))
  return { svg, widthPx, heightPx }
}

function hPx2(hEx: number, wEx: number, wPx: number): number {
  // preserve the ex aspect ratio
  return (hEx / wEx) * wPx
}

export interface MathPng {
  png: Buffer
  width: number
  height: number
}

/**
 * Convert LaTeX to a crisp PNG (2x rasterization). Returns null on compile
 * failure — callers must fall back to a VISIBLE honest representation (the
 * raw LaTeX source in a styled block), never to a silent drop.
 */
export async function latexToPng(
  latex: string,
  opts?: { color?: string; display?: boolean; exPx?: number }
): Promise<MathPng | null> {
  const rendered = await latexToSvg(latex, opts)
  if (!rendered) return null
  try {
    const sharp = (await import('sharp')).default
    // 2x for crisp embedding (equations are small — quality matters most).
    const png = await sharp(Buffer.from(rendered.svg), { density: 192 }).png().toBuffer()
    const meta = await sharp(png).metadata()
    return {
      png,
      width: meta.width ?? rendered.widthPx,
      height: meta.height ?? rendered.heightPx,
    }
  } catch {
    return null
  }
}

/** A component-level representation returned to renderers. */
export interface RenderedEquation {
  kind: 'png'
  png: Buffer
  width: number
  height: number
  latex: string
}

export async function renderEquation(
  content: unknown,
  opts?: { color?: string; display?: boolean; exPx?: number }
): Promise<RenderedEquation | null> {
  const o = (content && typeof content === 'object' ? content : {}) as Record<string, unknown>
  const latex = cleanLatex(
    typeof o.latex === 'string'
      ? o.latex
      : typeof o.content === 'string'
        ? o.content
        : typeof content === 'string'
          ? content
          : ''
  )
  if (!latex) return null
  const display = typeof o.display === 'boolean' ? o.display : (opts?.display ?? true)
  const png = await latexToPng(latex, { color: opts?.color, display, exPx: opts?.exPx })
  if (!png) return null
  return { kind: 'png', ...png, latex }
}

/** The raw LaTeX of an equation component (for honest fallbacks). */
export function equationLatexOf(content: unknown): string {
  const o = (content && typeof content === 'object' ? content : {}) as Record<string, unknown>
  return cleanLatex(
    typeof o.latex === 'string'
      ? o.latex
      : typeof o.content === 'string'
        ? o.content
        : typeof content === 'string'
          ? content
          : ''
  )
}
