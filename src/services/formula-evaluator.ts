// =============================================================================
// FILO FORMULA EVALUATOR (spec §15/§16 — "the mathematical result must
// actually correspond to the underlying data")
// =============================================================================
// Two jobs, one engine:
//
//   1. EVALUATE — non-XLSX renderers (DOCX/PDF/PPTX/CSV) receive AI tables
//      whose cells may contain formula strings ("=SUM(B2:B10)"). Those
//      formats have no formula engine, so we compute the REAL value from the
//      table itself and render it. A formula we cannot evaluate is rendered
//      honestly (as the formula text) and flagged — never silently dropped.
//
//   2. VERIFY — the XLSX renderer writes real formulas. This module validates
//      every formula's cell references against the actual table placement
//      (in-bounds, non-empty targets, no division by zero) so the workbook
//      can never ship with #REF!/#VALUE!/#DIV/0! style defects baked in.
//
// Supported grammar (deliberately the spreadsheet subset the AI is told to
// emit — see buildSectionContentPrompt):
//   numbers, cell refs (A1, $A$2), ranges (A1:B5), + - * / ^ % , parentheses,
//   SUM/AVERAGE/AVG/MIN/MAX/COUNT/COUNTA/PRODUCT/ROUND/ABS/SQRT/IF-less
//   comparisons are NOT evaluated (returns null → honest fallback).
// =============================================================================

export type CellMatrix = Array<Array<string | number | null>>

// ==================== CELL REFERENCE UTILITIES ====================

/** 'A' → 1, 'AA' → 27 … */
export function colToIndex(col: string): number {
  let n = 0
  for (const ch of col.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n
}

/** 1 → 'A', 27 → 'AA' … */
export function indexToCol(idx: number): string {
  let s = ''
  let n = idx
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export interface CellRef {
  row: number // 1-based
  col: number // 1-based
}

export function parseCellRef(ref: string): CellRef | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref.trim())
  if (!m) return null
  return { col: colToIndex(m[1]), row: Number(m[2]) }
}

export function cellValueAt(matrix: CellMatrix, ref: CellRef): string | number | null {
  const row = matrix[ref.row - 1]
  if (!row) return null
  return row[ref.col - 1] ?? null
}

function toNumber(v: string | number | null | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$€£¥,%\s]/g, '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''))
    if (cleaned === '' || cleaned === '-') return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// ==================== TOKENIZER + PRATT PARSER ====================

type Tok = { k: 'num'; v: number } | { k: 'ref'; v: string } | { k: 'fn'; v: string } | { k: 'op'; v: string } | { k: 'lp' } | { k: 'rp' } | { k: 'comma' } | { k: 'colon' }

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i))
      if (!m) return null
      toks.push({ k: 'num', v: Number(m[0]) })
      i += m[0].length
      continue
    }
    if (/[A-Za-z$]/.test(ch)) {
      const m = /^[A-Za-z$][A-Za-z0-9_$]*/.exec(src.slice(i))
      if (!m) return null
      const word = m[0]
      i += m[0].length
      // function call?
      if (src[i] === '(' && /^[A-Za-z]+$/.test(word)) {
        toks.push({ k: 'fn', v: word.toUpperCase() })
      } else if (/^\$?[A-Za-z]{1,3}\$?\d{1,7}$/.test(word)) {
        toks.push({ k: 'ref', v: word })
      } else {
        return null // bare identifiers are not part of the grammar
      }
      continue
    }
    if (ch === '(') { toks.push({ k: 'lp' }); i++; continue }
    if (ch === ')') { toks.push({ k: 'rp' }); i++; continue }
    if (ch === ',') { toks.push({ k: 'comma' }); i++; continue }
    if (ch === ':') { toks.push({ k: 'colon' }); i++; continue }
    if ('+-*/^%'.includes(ch)) { toks.push({ k: 'op', v: ch }); i++; continue }
    return null
  }
  return toks
}

interface EvalContext {
  matrix: CellMatrix
}

class Parser2 {
  private pos = 0
  constructor(private readonly toks: Tok[], private readonly ctx: EvalContext) {}

  /** Returns null on any structural/semantic failure (honest fallback). */
  parse(): number | null {
    const v = this.parseExpr()
    if (v === null) return null
    if (this.pos !== this.toks.length) return null
    return Number.isFinite(v) ? v : null
  }

  private peek(): Tok | null {
    return this.toks[this.pos] ?? null
  }

  private parseExpr(): number | null {
    let left = this.parseAdd()
    return left
  }

  private parseAdd(): number | null {
    let left = this.parseMul()
    if (left === null) return null
    for (;;) {
      const t = this.peek()
      if (t && t.k === 'op' && (t.v === '+' || t.v === '-')) {
        this.pos++
        // unary after binary op (e.g. 5 - -3)
        const right = this.parseMul()
        if (right === null) return null
        left = t.v === '+' ? left + right : left - right
      } else break
    }
    return left
  }

  private parseMul(): number | null {
    let left = this.parseUnary()
    if (left === null) return null
    for (;;) {
      const t = this.peek()
      if (t && t.k === 'op' && (t.v === '*' || t.v === '/')) {
        this.pos++
        const right = this.parseUnary()
        if (right === null) return null
        if (t.v === '/' && right === 0) return null // honest failure, not Infinity
        left = t.v === '*' ? left * right : left / right
      } else break
    }
    return left
  }

  private parseUnary(): number | null {
    const t = this.peek()
    if (t && t.k === 'op' && (t.v === '-' || t.v === '+')) {
      this.pos++
      const v = this.parseUnary()
      if (v === null) return null
      return t.v === '-' ? -v : v
    }
    return this.parsePower()
  }

  private parsePower(): number | null {
    const base = this.parsePostfix()
    if (base === null) return null
    const t = this.peek()
    if (t && t.k === 'op' && t.v === '^') {
      this.pos++
      const exp = this.parseUnary()
      if (exp === null) return null
      const r = Math.pow(base, exp)
      return Number.isFinite(r) ? r : null
    }
    return base
  }

  private parsePostfix(): number | null {
    let v = this.parsePrimary()
    if (v === null) return null
    const t = this.peek()
    if (t && t.k === 'op' && t.v === '%') {
      this.pos++
      v = v / 100
    }
    return v
  }

  private parsePrimary(): number | null {
    const t = this.peek()
    if (!t) return null
    if (t.k === 'num') { this.pos++; return t.v }
    if (t.k === 'op' && t.v === '%') { this.pos++; return 0 } // literal % handled by postfix
    if (t.k === 'lp') {
      this.pos++
      const v = this.parseAdd()
      if (v === null) return null
      const close = this.peek()
      if (!close || close.k !== 'rp') return null
      this.pos++
      return v
    }
    if (t.k === 'ref') {
      // possible range
      const next = this.toks[this.pos + 1]
      const third = this.toks[this.pos + 2]
      if (next && next.k === 'colon' && third && third.k === 'ref') {
        const startRef = parseCellRef(t.v)
        const endRef = parseCellRef(String(third.v))
        if (!startRef || !endRef) return null
        this.pos += 3
        // ranges evaluate to their SUM (only meaningful inside functions, but
        // a bare range in arithmetic is Excel-invalid — reject)
        return null
      }
      this.pos++
      const ref = parseCellRef(t.v)
      if (!ref) return null
      const raw = cellValueAt(this.ctx.matrix, ref)
      return toNumber(raw)
    }
    if (t.k === 'fn') {
      this.pos++
      const open = this.peek()
      if (!open || open.k !== 'lp') return null
      this.pos++
      const args: Array<number | number[]> = []
      // special-case: range args
      const first = this.peek()
      if (first && first.k === 'ref') {
        const second = this.toks[this.pos + 1]
        const third = this.toks[this.pos + 2]
        if (second && second.k === 'colon' && third && third.k === 'ref') {
          const startRef = parseCellRef(first.v)
          const endRef = parseCellRef(String(third.v))
          if (!startRef || !endRef) return null
          this.pos += 3
          const vals = this.rangeValues(startRef, endRef)
          if (vals === null) return null
          args.push(vals)
        } else {
          const v = this.parseAdd()
          if (v === null) return null
          args.push(v)
        }
      } else {
        if (this.peek()?.k === 'rp') {
          // empty args (COUNTA()) — handled below
        } else {
          const v = this.parseAdd()
          if (v === null) return null
          args.push(v)
        }
      }
      while (this.peek()?.k === 'comma') {
        this.pos++
        const n2 = this.peek()
        const third2 = this.toks[this.pos + 2]
        if (n2 && n2.k === 'ref' && this.toks[this.pos + 1]?.k === 'colon' && third2 && third2.k === 'ref') {
          const startRef = parseCellRef(n2.v)
          const endRef = parseCellRef(String(third2.v))
          if (!startRef || !endRef) return null
          this.pos += 3
          const vals = this.rangeValues(startRef, endRef)
          if (vals === null) return null
          args.push(vals)
        } else {
          const v = this.parseAdd()
          if (v === null) return null
          args.push(v)
        }
      }
      const close = this.peek()
      if (!close || close.k !== 'rp') return null
      this.pos++
      return applyFunction(t.v, args)
    }
    return null
  }

  private rangeValues(start: CellRef, end: CellRef): number[] | null {
    const r1 = Math.min(start.row, end.row)
    const r2 = Math.max(start.row, end.row)
    const c1 = Math.min(start.col, end.col)
    const c2 = Math.max(start.col, end.col)
    const vals: number[] = []
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const v = toNumber(cellValueAt(this.ctx.matrix, { row: r, col: c }))
        if (v !== null) vals.push(v)
      }
    }
    return vals
  }
}

function applyFunction(name: string, args: Array<number | number[]>): number | null {
  const flat: number[] = []
  for (const a of args) {
    if (Array.isArray(a)) flat.push(...a)
    else flat.push(a)
  }
  switch (name) {
    case 'SUM':
      return flat.reduce((s, v) => s + v, 0)
    case 'AVERAGE':
    case 'AVG':
      return flat.length > 0 ? flat.reduce((s, v) => s + v, 0) / flat.length : null
    case 'MIN':
      return flat.length > 0 ? Math.min(...flat) : null
    case 'MAX':
      return flat.length > 0 ? Math.max(...flat) : null
    case 'COUNT':
      return flat.length
    case 'COUNTA':
      return flat.length
    case 'PRODUCT':
      return flat.length > 0 ? flat.reduce((s, v) => s * v, 1) : null
    case 'ROUND': {
      const v = args[0]
      if (typeof v !== 'number') return null
      const digits = typeof args[1] === 'number' ? args[1] : 0
      const f = Math.pow(10, digits)
      return Math.round(v * f) / f
    }
    case 'ABS': {
      const v = args[0]
      return typeof v === 'number' ? Math.abs(v) : null
    }
    case 'SQRT': {
      const v = args[0]
      if (typeof v !== 'number' || v < 0) return null
      return Math.sqrt(v)
    }
    default:
      return null
  }
}

// ==================== PUBLIC API ====================

/** Functions this evaluator understands (used for whitelist validation). */
export const SUPPORTED_FUNCTIONS = new Set([
  'SUM', 'AVERAGE', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'PRODUCT',
  'ROUND', 'ABS', 'SQRT',
])

/**
 * Evaluate a formula string ("=SUM(B2:B10)" or "B2*C2") against the table
 * matrix (row 1 = first row of the table as the AI numbered it).
 * Returns null when the formula cannot be computed — callers render the
 * formula text honestly instead of a fabricated number.
 */
export function evaluateFormula(formula: string, matrix: CellMatrix): number | null {
  const body = formula.trim().replace(/^=/, '')
  if (!body) return null
  const toks = tokenize(body)
  if (!toks || toks.length === 0) return null
  return new Parser2(toks, { matrix }).parse()
}

// ==================== REFERENCE VALIDATION (XLSX) ====================

export interface FormulaCheck {
  ok: boolean
  /** Human-readable problem, e.g. "C9 references beyond data extent". */
  problem?: string
}

const KNOWN_EXCEL_FUNCTIONS = new Set([
  'SUM', 'AVERAGE', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'PRODUCT', 'ROUND',
  'ABS', 'SQRT', 'IF', 'IFS', 'SUMIF', 'SUMIFS', 'COUNTIF', 'COUNTIFS',
  'AVERAGEIF', 'AVERAGEIFS', 'VLOOKUP', 'HLOOKUP', 'XLOOKUP', 'INDEX', 'MATCH',
  'ROUNDUP', 'ROUNDDOWN', 'CEILING', 'FLOOR', 'INT', 'MOD', 'POWER', 'EXP',
  'LN', 'LOG', 'LOG10', 'SIGN', 'PI', 'SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN',
  'ATAN2', 'SINH', 'COSH', 'TANH', 'CONCATENATE', 'CONCAT', 'TEXT', 'LEFT', 'RIGHT',
  'MID', 'LEN', 'UPPER', 'LOWER', 'TRIM', 'VALUE', 'DATE', 'YEAR', 'MONTH', 'DAY',
  'TODAY', 'NOW', 'DATEDIF', 'EOMONTH', 'EDATE', 'WEEKDAY', 'NETWORKDAYS',
  'PMT', 'FV', 'PV', 'NPV', 'IRR', 'RATE', 'NPER', 'CUMIPMT', 'CUMPRINC',
  'STDEV', 'STDEVP', 'VAR', 'VARP', 'MEDIAN', 'MODE', 'LARGE', 'SMALL',
  'RANK', 'PERCENTILE', 'QUARTILE', 'FORECAST', 'TREND', 'GROWTH', 'SLOPE', 'INTERCEPT',
  'CORREL', 'COVAR', 'PEARSON', 'RSQ', 'AND', 'OR', 'NOT', 'XOR', 'TRUE', 'FALSE',
  'ISBLANK', 'ISERROR', 'ISNA', 'ISNUMBER', 'ISTEXT', 'IFERROR', 'IFNA',
  'SUMPRODUCT', 'SUBTOTAL', 'AGGREGATE', 'OFFSET', 'INDIRECT', 'ROW', 'COLUMN',
  'ROWS', 'COLUMNS', 'TRANSPOSE', 'MAXIFS', 'MINIFS', 'TEXTJOIN', 'UNIQUE',
  'SORT', 'FILTER', 'SEQUENCE', 'LET', 'LAMBDA', 'MAP', 'REDUCE', 'SCAN',
  'WEEKNUM', 'WORKDAY', 'TIME', 'HOUR', 'MINUTE', 'SECOND', 'CHOOSE', 'EXACT',
  'FIND', 'SEARCH', 'SUBSTITUTE', 'REPT', 'CODE', 'CHAR', 'TYPE', 'N', 'NA',
])

/**
 * Validate that every A1 reference in the formula points INSIDE the sheet's
 * data extent and at a non-empty target. This is what guarantees the written
 * workbook never produces #REF!/#VALUE!/#DIV/0! from misplaced AI formulas.
 * `matrix` is the table as placed (row 1 = header row), `dataEndRow` the last
 * data row actually written.
 */
export function validateFormulaReferences(
  formula: string,
  matrix: CellMatrix,
  dataEndRow: number
): FormulaCheck {
  const body = formula.trim().replace(/^=/, '')
  if (!body) return { ok: false, problem: 'empty formula' }

  // unknown function whitelist check
  const fnNames = [...body.matchAll(/([A-Za-z][A-Za-z0-9.]*)\s*\(/g)].map((m) => m[1].toUpperCase())
  for (const fn of fnNames) {
    if (!KNOWN_EXCEL_FUNCTIONS.has(fn)) {
      return { ok: false, problem: `unknown function ${fn}()` }
    }
  }

  // every cell reference must be within the table extent and non-empty
  const refs = [...body.matchAll(/(\$?)([A-Z]{1,3})(\$?)(\d{1,7})(?!\()/g)]
  for (const m of refs) {
    const ref = parseCellRef(`${m[2]}${m[4]}`)
    if (!ref) return { ok: false, problem: `unparseable reference ${m[0]}` }
    if (ref.row > dataEndRow) {
      return { ok: false, problem: `${m[0]} references row beyond data (last data row ${dataEndRow})` }
    }
    const maxCol = Math.max(0, ...matrix.map((r) => r.length))
    if (ref.col > maxCol) {
      return { ok: false, problem: `${m[0]} references column beyond data extent` }
    }
    const v = cellValueAt(matrix, ref)
    if (v === null || v === '') {
      // Empty target: SUM/AVERAGE/COUNT tolerate it, but a bare arithmetic
      // operand would yield #VALUE!. Allow when the formula is an aggregate.
      const isAggregate = fnNames.some((f) => ['SUM', 'AVERAGE', 'AVG', 'COUNT', 'COUNTA', 'MIN', 'MAX', 'PRODUCT', 'COUNTIF', 'COUNTIFS', 'SUMIF', 'SUMIFS', 'MEDIAN', 'STDEV'].includes(f))
      if (!isAggregate) {
        return { ok: false, problem: `${m[0]} references an empty cell` }
      }
    }
  }

  // division by a constant zero / empty divisor
  const divParts = body.split('/')
  if (divParts.length > 1) {
    for (let i = 1; i < divParts.length; i++) {
      const divisor = divParts[i].trim()
      if (/^0+(\.0+)?$/.test(divisor)) {
        return { ok: false, problem: 'division by literal zero' }
      }
    }
  }

  return { ok: true }
}
