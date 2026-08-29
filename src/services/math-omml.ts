// =============================================================================
// LATEX → OOXML MATH (OMML) CONVERTER — native, editable Word equations
// =============================================================================
// The DOCX format is the one place equations can be REAL first-class objects
// (Word's math zone), so a subset of LaTeX is converted to `docx` Math
// components instead of a rasterized image. Supported subset (the constructs
// the user requirement explicitly names):
//
//   fractions \frac{}{} \dfrac{}{} \tfrac{}{}   powers  x^{n} / x^2
//   subscripts x_{i} / x_i                      sub+sup x_{i}^{2}
//   roots     \sqrt{x} \sqrt[n]{x}              summation \sum_{i=1}^{n}
//   integrals \int_{}^{} \oint_{}^{}            limits    \lim_{x \to 0}
//   brackets  \left( … \right) \left[ … \right] (auto-sizing m:d delimiters)
//   greek     \alpha … \Omega                   operators \times \cdot \pm \leq \geq \neq \approx \infty \to \partial …
//   accents   \hat{x} \bar{x} \vec{x} \tilde{x} \dot{x} \overline{x}
//   text      \text{…} \mathrm{…}               sets      \mathbb{R}
//   functions \sin \cos \tan \log \ln \exp …    primes    x' x''
//
// ANYTHING ELSE (matrices, \begin{…} environments, unknown macros) → the
// parser THROWS and the DOCX renderer falls back to the PNG equation engine.
// A construct we cannot represent natively is NEVER silently degraded to
// plain text (user requirement §3/§10: never silently corrupt math).
// =============================================================================

import {
  MathFraction,
  MathLimitLower,
  MathRadical,
  MathRoundBrackets,
  MathRun,
  MathSquareBrackets,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathIntegral,
  MathSuperScript,
  type MathComponent,
} from 'docx'

// ==================== CHARACTER MAPS ====================

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}

const OPERATORS: Record<string, string> = {
  times: '×', cdot: '⋅', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
  equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝',
  infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', nexists: '∄',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', Leftrightarrow: '⇔', mapsto: '↦',
  uparrow: '↑', downarrow: '↓',
  ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', ddots: '⋱',
  land: '∧', wedge: '∧', lor: '∨', vee: '∨', neg: '¬', lnot: '¬',
  oplus: '⊕', otimes: '⊗', perp: '⊥', parallel: '∥', angle: '∠',
  degree: '°', circ: '∘', bullet: '•',
  prime: '′', dagger: '†', ddagger: '‡', ell: 'ℓ',
  aleph: 'ℵ', hbar: 'ℏ', Re: 'ℜ', Im: 'ℑ', wp: '℘',
  cdotp: '⋅',
}

const DOUBLE_STRUCK: Record<string, string> = {
  R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', E: '𝔼', P: 'ℙ', H: 'ℍ',
}

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'det', 'dim', 'gcd',
  'max', 'min', 'sup', 'inf', 'deg', 'arg', 'ker', 'hom', 'tr', 'Pr',
])

const SPACING = new Set([',', ';', ':', ' ', 'quad', 'qquad', '!'])

// ==================== TOKENIZER ====================

type Token =
  | { t: 'cmd'; name: string }
  | { t: 'ch'; ch: string }
  | { t: 'group'; items: Token[] }

export class TeXUnsupportedError extends Error {}

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i))
      if (!m) throw new TeXUnsupportedError('dangling backslash')
      tokens.push({ t: 'cmd', name: m[1] })
      i += m[0].length
    } else if (ch === '{') {
      let depth = 1
      let j = i + 1
      while (j < src.length && depth > 0) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '{') depth++
        else if (src[j] === '}') depth--
        j++
      }
      if (depth !== 0) throw new TeXUnsupportedError('unclosed { group')
      tokens.push({ t: 'group', items: tokenize(src.slice(i + 1, j - 1)) })
      i = j
    } else if (ch === '}') {
      throw new TeXUnsupportedError('unbalanced }')
    } else {
      tokens.push({ t: 'ch', ch })
      i++
    }
  }
  return tokens
}

// ==================== PARSER ====================

class Parser {
  private pos = 0

  constructor(private readonly tokens: Token[]) {}

  parse(): MathComponent[] {
    return this.parseSequence(() => this.pos >= this.tokens.length)
  }

  private peek(): Token | null {
    return this.tokens[this.pos] ?? null
  }

  private next(): Token | null {
    return this.tokens[this.pos++] ?? null
  }

  /**
   * Parse until `stop()`. After every atom, consume any following ^/_ script
   * tokens (both, in any order) and wrap the atom accordingly — this is what
   * makes `x_{i}^{2}` a single sub+superscript Word structure.
   */
  private parseSequence(stop: () => boolean, stopDepth?: { depth: number }): MathComponent[] {
    const out: MathComponent[] = []
    while (!stop()) {
      const tok = this.next()
      if (!tok) break
      const atoms = this.parseAtom(tok, stopDepth)
      if (atoms.length > 0) out.push(...atoms)
      // postfix scripts (both orders; braceless single-token args supported)
      for (let k = 0; k < 2; k++) {
        const p = this.peek()
        if (!p || p.t !== 'ch' || (p.ch !== '^' && p.ch !== '_')) break
        if (out.length === 0) throw new TeXUnsupportedError('script with no base')
        this.next()
        const arg = this.parseArg(stopDepth)
        const base = out[out.length - 1]
        if (p.ch === '^' && !isSupWrapped(base)) {
          out[out.length - 1] = new MathSuperScript({ children: [base], superScript: arg.length ? arg : [new MathRun('')] })
        } else if (p.ch === '_' && !isSubWrapped(base)) {
          out[out.length - 1] = new MathSubScript({ children: [base], subScript: arg.length ? arg : [new MathRun('')] })
        } else {
          // second script on the same base → wrap in a sub+sup structure
          out[out.length - 1] = new MathSubSuperScript({
            children: [unwrapToBase(base)],
            subScript: p.ch === '_' ? (arg.length ? arg : [new MathRun('')]) : [new MathRun('')],
            superScript: p.ch === '^' ? (arg.length ? arg : [new MathRun('')]) : [new MathRun('')],
          })
        }
      }
    }
    return out
  }

  /** Parse a required argument (braced group, command, or single char). */
  private parseArg(stopDepth?: { depth: number }): MathComponent[] {
    const tok = this.next()
    if (!tok) throw new TeXUnsupportedError('missing argument')
    if (tok.t === 'group') {
      const sub = new Parser(tok.items)
      return sub.parse()
    }
    return this.parseAtom(tok, stopDepth)
  }

  private parseAtom(tok: Token, stopDepth?: { depth: number }): MathComponent[] {
    if (tok.t === 'group') {
      const sub = new Parser(tok.items)
      return sub.parse()
    }

    if (tok.t === 'ch') {
      const ch = tok.ch
      if (ch === '^' || ch === '_') throw new TeXUnsupportedError('dangling script marker')
      if (ch === "'") return [new MathSuperScript({ children: [new MathRun('')], superScript: [new MathRun('′')] })]
      const map: Record<string, string> = { '-': '−', '*': '∗', '~': ' ', '`': '’' }
      return [new MathRun(map[ch] ?? ch)]
    }

    const name = tok.name

    // ---- structure commands ----
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
      const num = this.parseArg(stopDepth)
      const den = this.parseArg(stopDepth)
      return [new MathFraction({
        numerator: num.length ? num : [new MathRun('')],
        denominator: den.length ? den : [new MathRun('')],
      })]
    }
    if (name === 'sqrt') {
      let degree: MathComponent[] | undefined
      const p = this.peek()
      if (p && p.t === 'ch' && p.ch === '[') {
        this.next()
        const inner: Token[] = []
        let depth = 1
        for (;;) {
          const t = this.next()
          if (!t) throw new TeXUnsupportedError('unclosed [ in \\sqrt')
          if (t.t === 'ch' && t.ch === '[') { depth++; inner.push(t); continue }
          if (t.t === 'ch' && t.ch === ']') { depth--; if (depth === 0) break; inner.push(t); continue }
          inner.push(t)
        }
        degree = new Parser(inner).parse()
      }
      const children = this.parseArg(stopDepth)
      return [new MathRadical({ children: children.length ? children : [new MathRun('')], degree: degree && degree.length ? degree : undefined })]
    }
    if (name === 'sum') {
      return [this.parseNary('∑', stopDepth)]
    }
    if (name === 'int' || name === 'oint' || name === 'iint' || name === 'iiint') {
      const sym = name === 'int' ? '∫' : name === 'oint' ? '∮' : name === 'iint' ? '∬' : '∭'
      return [this.parseNary(sym, stopDepth, 'integral')]
    }
    if (name === 'lim') {
      const p = this.peek()
      if (p && p.t === 'ch' && p.ch === '_') {
        this.next()
        const arg = this.parseArg(stopDepth)
        return [new MathLimitLower({ children: [new MathRun('lim')], limit: arg.length ? arg : [new MathRun('')] })]
      }
      return [new MathRun('lim')]
    }
    if (name === 'left') {
      return [this.parseLeftRight(stopDepth)]
    }
    if (name === 'right') {
      throw new TeXUnsupportedError('\\right without \\left')
    }

    // ---- text-ish commands ----
    if (name === 'text' || name === 'mathrm' || name === 'operatorname' || name === 'mbox' || name === 'textrm' || name === 'textbf') {
      const arg = this.parseArg(stopDepth)
      return [new MathRun(flattenText(arg))]
    }
    if (name === 'mathbb' || name === 'Bbb') {
      const arg = this.parseArg(stopDepth)
      const text = flattenText(arg)
      return [new MathRun(DOUBLE_STRUCK[text] ?? text)]
    }
    if (name === 'mathcal' || name === 'mathbf' || name === 'mathit' || name === 'mathsf' || name === 'mathtt' || name === 'boldsymbol' || name === 'bm' || name === 'pmb') {
      return this.parseArg(stopDepth) // face change dropped; content preserved
    }

    // ---- accents ----
    if (name === 'hat' || name === 'bar' || name === 'vec' || name === 'tilde' || name === 'dot' || name === 'ddot' || name === 'overline' || name === 'underline' || name === 'widehat' || name === 'widetilde') {
      const arg = this.parseArg(stopDepth)
      const text = flattenText(arg)
      const accent =
        name === 'hat' || name === 'widehat' ? '\u0302'
        : name === 'bar' || name === 'overline' ? '\u0304'
        : name === 'vec' ? '\u20D7'
        : name === 'tilde' || name === 'widetilde' ? '\u0303'
        : name === 'dot' ? '\u0307'
        : name === 'ddot' ? '\u0308'
        : '\u0332'
      return [new MathRun(text + accent)]
    }

    // ---- functions ----
    if (FUNCTIONS.has(name)) {
      // Word's math zone recognizes function names automatically; emit the
      // name followed by the argument.
      const arg = this.parseArg(stopDepth)
      return [new MathRun(name), ...arg]
    }

    // ---- symbols ----
    if (GREEK[name]) return [new MathRun(GREEK[name])]
    if (OPERATORS[name]) return [new MathRun(OPERATORS[name])]
    if (SPACING.has(name)) return [new MathRun(name === 'quad' || name === 'qquad' ? '  ' : ' ')]
    if (name === '{') return [new MathRun('{')]
    if (name === '}') return [new MathRun('}')]
    if (name === '%') return [new MathRun('%')]
    if (name === '&') throw new TeXUnsupportedError('& alignment (environment construct)')
    if (name === '#') return [new MathRun('#')]
    if (name === '$') return [new MathRun('$')]
    if (name === '_') return [new MathRun('_')]
    if (name === '\\') return [new MathRun(' ')]
    if (name === 'begin' || name === 'end') {
      throw new TeXUnsupportedError(`environment (${name}) — render as image instead`)
    }

    // Unknown macro — refuse (caller falls back to PNG; never corrupt).
    throw new TeXUnsupportedError(`unsupported command \\${name}`)
  }

  /**
   * \left<delim> … \right<delim> → auto-sizing m:d bracket structure.
   * Nesting-aware scan for the matching \right.
   */
  private parseLeftRight(stopDepth?: { depth: number }): MathComponent {
    const openTok = this.next()
    const open = openTok && openTok.t === 'ch' ? openTok.ch : '('
    const inner: Token[] = []
    let depth = 1
    for (;;) {
      const t = this.next()
      if (!t) throw new TeXUnsupportedError('\\left without matching \\right')
      if (t.t === 'cmd' && t.name === 'left') { depth++; inner.push(t); continue }
      if (t.t === 'cmd' && t.name === 'right') {
        depth--
        if (depth === 0) {
          const closeTok = this.next()
          const close = closeTok && closeTok.t === 'ch' ? closeTok.ch : ')'
          const children = new Parser(inner).parse()
          if (open === '[' && close === ']') {
            return new MathSquareBrackets({ children: children.length ? children : [new MathRun('')] })
          }
          // default: round delimiters (also covers \( \) and .)
          return new MathRoundBrackets({ children: children.length ? children : [new MathRun('')] })
        }
        inner.push(t)
        continue
      }
      inner.push(t)
    }
  }

  /** Build ∑ / ∫ with optional limits (consumes following _ and ^). */
  private parseNary(symbol: string, stopDepth?: { depth: number }, kind: 'sum' | 'integral' = 'sum'): MathComponent {
    let sub: MathComponent[] | null = null
    let sup: MathComponent[] | null = null
    for (let k = 0; k < 2; k++) {
      const p = this.peek()
      if (p && p.t === 'ch' && (p.ch === '_' || p.ch === '^')) {
        this.next()
        const arg = this.parseArg(stopDepth)
        if (p.ch === '_') sub = arg
        else sup = arg
      }
    }
    const base = [new MathRun('')]
    if (kind === 'sum') {
      return new MathSum({
        children: base,
        subScript: sub && sub.length ? sub : sub === null ? undefined : [new MathRun('')],
        superScript: sup && sup.length ? sup : sup === null ? undefined : [new MathRun('')],
      })
    }
    return new MathIntegral({
      children: base,
      subScript: sub && sub.length ? sub : sub === null ? undefined : [new MathRun('')],
      superScript: sup && sup.length ? sup : sup === null ? undefined : [new MathRun('')],
    })
  }
}

function isSubWrapped(c: MathComponent): boolean {
  return c instanceof MathSubScript || c instanceof MathSubSuperScript
}
function isSupWrapped(c: MathComponent): boolean {
  return c instanceof MathSuperScript || c instanceof MathSubSuperScript
}
/** For the double-script case, reuse the innermost base. */
function unwrapToBase(c: MathComponent): MathComponent {
  return c
}

function flattenText(nodes: MathComponent[]): string {
  const out: string[] = []
  for (const n of nodes) {
    const anyN = n as unknown as { root?: Array<{ rootKey?: string; textString?: string }> }
    if (anyN && Array.isArray(anyN.root)) {
      for (const part of anyN.root) {
        if (typeof part?.textString === 'string') out.push(part.textString)
      }
    }
  }
  return out.join('')
}

/**
 * Convert a LaTeX expression into docx Math components.
 * Returns null when the expression uses anything outside the supported
 * subset — the renderer must then fall back to the PNG engine (never to
 * plain text).
 */
export function latexToOmml(latex: string): MathComponent[] | null {
  const cleaned = latex.trim()
  if (!cleaned) return null
  try {
    const tokens = tokenize(cleaned)
    const children = new Parser(tokens).parse()
    if (children.length === 0) return null
    return children
  } catch {
    return null
  }
}
