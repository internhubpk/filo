// =============================================================================
// XLSX FORMULA HELPERS — A1 row remapping for AI-authored formulas
// =============================================================================
// Extracted from the renderer so the phase-9/10 suites can exercise the
// remapping contract in isolation.
// =============================================================================

/**
 * Remap A1-style row references in an AI-provided formula to the table's
 * ACTUAL placement on the worksheet. The AI writes formulas assuming its
 * table starts at row 1 (headers) — the renderer may place the table lower
 * (title banner + paragraphs first), so every row reference shifts by the
 * offset. Function names (LOG10, ATAN2…) are excluded via the negative
 * lookahead on '('.
 */
export function remapFormulaRows(formula: string, rowOffset: number): string {
  if (!rowOffset) return formula
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d{1,7})(?!\()/g, (_m, dollar1, col, dollar2, row) => {
    return `${dollar1}${col}${dollar2}${Number(row) + rowOffset}`
  })
}
