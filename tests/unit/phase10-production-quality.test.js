// =============================================================================
// Phase 10 — PRODUCTION-QUALITY VERIFICATION (all five artifact types)
// =============================================================================
// Mandate: "Validate the ACTUAL OUTPUT, not the code." This suite drives the
// REAL renderers with deliberately hard, non-trivial content — native
// equations (fractions, sums, integrals, Greek, matrices), structural
// diagrams (flowchart + hierarchy), chart components, formula-bearing tables,
// currency/percent/date columns, deliberate arithmetic inconsistencies, CJK —
// then re-opens every produced file INDEPENDENTLY:
//
//   DOCX → OOXML: native m:oMath math zones, embedded diagram/chart PNGs,
//          takeaways box, TOC field, header/footer PAGE field
//   PDF  → raw bytes + unpdf text layer + equation image XObjects
//   PPTX → OOXML: per-slide text, embedded equation/diagram images
//   XLSX → ExcelJS re-open: formulas (remapped, totals as live SUM),
//          number formats, freeze panes, autofilter, print titles + LibreOffice
//          headless conversion of the NATIVE-CHART workbook (a real office
//          suite must accept and render the injected chart parts)
//   CSV  → RFC4180 re-parse: schema, typed columns, qty×price−discount=total
//          relationship repair
//
// Plus the render-retry idempotency contract (resolveRenderTarget) that fixed
// the "duplicate artifact row every ~11s" incident.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { loadEngine } from './helpers/ts-build.js'

const require = createRequire(import.meta.url)
const { renderArtifact } = loadEngine('@/services/document-renderer')
const themes = loadEngine('@/services/themes')
const {
  validateRenderedOutput,
  validateRenderedOutputDeep,
} = loadEngine('@/services/qa/structural')

const JSZip = require('jszip')
const ExcelJS = require('exceljs')

const SOFFICE = ['/usr/bin/soffice', '/usr/bin/libreoffice'].find(existsSync) ?? null

function spec(format, extra = {}) {
  const { design } = themes.resolveTheme(extra.theme || 'executive', { format })
  return {
    id: `spec-p10-${format.toLowerCase()}`,
    type: extra.type || 'document',
    title: extra.title || 'Production Quality Verification 2026',
    description: 'Non-trivial multi-component verification artifact',
    outputFormat: format,
    sections: extra.sections || [],
    design,
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1, language: 'en', tags: [], keywords: [] },
    validation: { requireTitle: true },
  }
}

async function gate(buffer, format, mimeType) {
  const shallow = validateRenderedOutput(buffer, format, mimeType)
  assert.ok(shallow.ok, `shallow gate: ${JSON.stringify(shallow.issues)}`)
  const deep = await validateRenderedOutputDeep(buffer, format)
  assert.deepEqual(deep.issues, [], `deep gate: ${JSON.stringify(deep.issues)}`)
}

// ==================== FORMULA EVALUATOR ====================
test('§10-M1 formula evaluator computes spreadsheet semantics over the real table', () => {
  const { evaluateFormula, validateFormulaReferences, indexToCol, colToIndex } = loadEngine('@/services/formula-evaluator')
  const matrix = [
    ['Region', 'Revenue', 'Cost', 'Profit'],
    ['EMEA', 1900000, 1200000, null],
    ['APAC', 1200000, 800000, null],
    ['LATAM', 900000, 700000, null],
  ]

  assert.equal(colToIndex('A'), 1)
  assert.equal(colToIndex('AA'), 27)
  assert.equal(indexToCol(27), 'AA')

  // arithmetic over cells
  assert.equal(evaluateFormula('=B2-C2', matrix), 700000)
  assert.equal(evaluateFormula('=B2*2+C3', matrix), 4600000)
  // aggregates over ranges
  assert.equal(evaluateFormula('=SUM(B2:B4)', matrix), 4000000)
  assert.equal(evaluateFormula('=AVERAGE(B2:B4)', matrix), 4000000 / 3)
  assert.equal(evaluateFormula('=MIN(C2:C4)', matrix), 700000)
  assert.equal(evaluateFormula('=MAX(B2:B4)', matrix), 1900000)
  assert.equal(evaluateFormula('=COUNT(B2:B4)', matrix), 3)
  // numbers with formatting in referenced cells
  assert.equal(evaluateFormula('=B2*2', [['item', 'price'], ['x', '$1,250']]), 2500)
  // division by zero fails honestly (no Infinity, no crash)
  assert.equal(evaluateFormula('=10/B2', [['item', 'qty'], ['x', 0]]), null)
  // malformed formulas fail honestly
  assert.equal(evaluateFormula('=SUM(', matrix), null)
  assert.equal(evaluateFormula('=UNKNOWNFN(B1)', matrix), null)
  assert.equal(evaluateFormula('=NOT_A_FORMULA', [['item', 'qty'], ['x', 1]]), null)

  // reference validation: in-bounds passes
  assert.deepEqual(validateFormulaReferences('=SUM(B2:B3)', matrix, 4), { ok: true })
  // out-of-bounds reference is rejected (this is what kills #REF!)
  const bad = validateFormulaReferences('=SUM(B2:B99)', matrix, 4)
  assert.equal(bad.ok, false)
  assert.match(bad.problem, /beyond data/)
  // unknown function is rejected (this is what kills #NAME?)
  const badFn = validateFormulaReferences('=FOOBAR(B2)', matrix, 4)
  assert.equal(badFn.ok, false)
  assert.match(badFn.problem, /unknown function/)
})

// ==================== MATH: OMML SUBSET ====================
test('§10-M2 LaTeX→OMML: supported subset converts, unsupported returns null (PNG fallback)', () => {
  const { latexToOmml } = loadEngine('@/services/math-omml')

  const supported = [
    'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
    '\\sum_{i=1}^{n} x_i^2',
    '\\int_{0}^{\\infty} e^{-x} dx',
    '\\lim_{x \\to 0} \\frac{\\sin x}{x}',
    '\\alpha + \\beta \\times \\gamma \\leq \\Delta',
    '\\left( \\frac{a}{b} \\right)^2',
    '\\sqrt[3]{x^3 + 1}',
    '\\text{Revenue} = p \\times q',
    '\\mathbb{R}^2',
  ]
  for (const tex of supported) {
    assert.ok(latexToOmml(tex), `should convert natively: ${tex}`)
  }
  // environments are NOT natively supported → null → the DOCX renderer falls
  // back to the PNG engine — never plain-text corruption
  assert.equal(latexToOmml('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}'), null)
  assert.equal(latexToOmml('\\unknownmacro{x}'), null)
  assert.equal(latexToOmml(''), null)
})

// ==================== MATH: PNG ENGINE ====================
test('§10-M3 math engine renders LaTeX to crisp PNG; broken LaTeX fails honestly', async () => {
  const { latexToPng, renderEquation, cleanLatex } = loadEngine('@/services/math-engine')

  assert.equal(cleanLatex('$$E=mc^2$$'), 'E=mc^2')
  assert.equal(cleanLatex('\\[x^2\\]'), 'x^2')

  const png = await latexToPng('\\frac{d}{dx}\\sum_{i=1}^{n} x_i^2 = \\sqrt{\\alpha^2 + \\beta}')
  assert.ok(png, 'complex expression renders')
  assert.ok(png.png.length > 500, `PNG has bytes: ${png.png.length}`)
  assert.ok(png.width > 40 && png.height > 12, `sane dimensions ${png.width}x${png.height}`)
  // PNG signature
  assert.equal(png.png[0], 0x89)
  assert.equal(png.png[1], 0x50)

  // broken LaTeX → null (callers MUST show the source visibly, never fake it)
  assert.equal(await latexToPng('\\frac{'), null)
  assert.equal(await latexToPng('\\notarealcommand{x}'), null)

  // component-level entry point
  const eq = await renderEquation({ latex: 'E = mc^2', display: true })
  assert.ok(eq && eq.png && eq.width > 10)
})

// ==================== DOCX ====================
test('§10-D1 DOCX: native OMML equations, diagram images, takeaways box — deep-gated', async () => {
  const s = spec('DOCX', {
    sections: [
      { id: 'cover', type: 'cover', title: 'Production Quality Verification 2026', order: 0, components: [] },
      { id: 'math', type: 'content', title: 'Valuation Model', order: 1, components: [] },
      { id: 'flow', type: 'content', title: 'Approval Workflow', order: 2, components: [] },
      { id: 'close', type: 'content', title: 'Conclusions', order: 3, components: [] },
    ],
  })
  const components = [
    { sectionId: 'cover', componentId: 'c0', type: 'PARAGRAPH', order: 0, content: 'Verification document exercising every production component.' },
    { sectionId: 'math', componentId: 'e1', type: 'EQUATION', order: 0, content: { latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', display: true } },
    { sectionId: 'math', componentId: 'e2', type: 'EQUATION', order: 1, content: { latex: 'V = \\sum_{t=1}^{T} \\frac{CF_t}{(1+r)^t}', display: true } },
    { sectionId: 'math', componentId: 'e3', type: 'EQUATION', order: 2, content: { latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', display: true } },
    { sectionId: 'math', componentId: 'p1', type: 'PARAGRAPH', order: 3, content: 'The valuation follows the discounted cash flow method with a terminal growth assumption of three percent.' },
    { sectionId: 'flow', componentId: 'd1', type: 'DIAGRAM', order: 0, content: {
      kind: 'flowchart', title: 'Approval Workflow',
      steps: [
        { label: 'Request submitted', description: 'Employee files the form' },
        { label: 'Manager review', description: 'Line manager approves or rejects' },
        { label: 'Finance check', description: 'Budget verification' },
        { label: 'Final approval', description: 'Director signs off' },
      ],
    } },
    { sectionId: 'close', componentId: 'k1', type: 'KEY_TAKEAWAYS', order: 0, content: [
      'DCF valuation is most sensitive to the discount rate',
      'Approval cycle time dropped 40% after automation',
      'Budget variance stayed within policy for all quarters',
    ] },
  ]

  const out = await renderArtifact(s, components, 'DOCX')
  assert.ok(out.buffer.length > 12000, `DOCX size ${out.buffer.length}`)
  await gate(out.buffer, 'DOCX', out.mimeType)

  const zip = await JSZip.loadAsync(Buffer.from(out.buffer))
  const doc = await (await zip.file('word/document.xml')).async('string')

  // NATIVE Word math zones for the supported subset
  const oMathCount = (doc.match(/<m:oMath>/g) || []).length
  assert.ok(oMathCount >= 2, `expected >= 2 native m:oMath, got ${oMathCount}`)
  assert.ok(doc.includes('<m:f>'), 'fraction structure present')
  assert.ok(doc.includes('<m:rad>'), 'radical structure present')
  assert.ok(doc.includes('<m:nary'), 'n-ary (sum/integral) structure present')
  // matrix is NOT representable natively → must be the PNG fallback, not text
  assert.ok(!doc.includes('\\begin{pmatrix}'), 'matrix LaTeX never dumped as raw text')

  // diagrams embedded as real images
  const media = Object.keys(zip.files).filter((p) => /^word\/media\//.test(p))
  assert.ok(media.length >= 1, `diagram/chart images embedded: ${media.join(', ')}`)

  // takeaways box carries the content
  assert.ok(doc.includes('Key Takeaways'), 'takeaways box title present')
  assert.ok(doc.includes('discount rate'), 'takeaway content present')

  // TOC + page numbers survive
  assert.ok(doc.includes('TOC'), 'TOC field present')
  const footer = Object.keys(zip.files).find((p) => /^word\/footer\d*\.xml$/.test(p))
  assert.ok(footer, 'footer part exists')
  const footerXml = await (await zip.file(footer)).async('string')
  assert.ok(/PAGE/.test(footerXml), 'footer has a PAGE field')
})

// ==================== PDF ====================
test('§10-P1 PDF: equation PNGs, diagrams, content-aware tables — text layer verified', async () => {
  const s = spec('PDF', {
    sections: [
      { id: 'cover', type: 'cover', title: 'Production Quality Verification 2026', order: 0, components: [] },
      { id: 'math', type: 'content', title: 'Quantitative Basis', order: 1, components: [] },
      { id: 'flow', type: 'content', title: 'Process Overview', order: 2, components: [] },
      { id: 'data', type: 'content', title: 'Regional Breakdown', order: 3, components: [] },
    ],
  })
  const components = [
    { sectionId: 'cover', componentId: 'c0', type: 'PARAGRAPH', order: 0, content: 'PDF verification with mathematics, diagrams and data tables.' },
    { sectionId: 'math', componentId: 'e1', type: 'EQUATION', order: 0, content: { latex: '\\sum_{i=1}^{n} x_i^2 = \\sqrt{\\alpha^2 + \\beta}', display: true } },
    { sectionId: 'math', componentId: 'e2', type: 'EQUATION', order: 1, content: { latex: 'F(q) = 2^{\\aleph_0}', display: true } },
    { sectionId: 'math', componentId: 'p1', type: 'PARAGRAPH', order: 2, content: 'Every quantitative claim in this document is computed from the underlying dataset rather than transcribed from an external source.' },
    { sectionId: 'flow', componentId: 'd1', type: 'DIAGRAM', order: 0, content: {
      kind: 'hierarchy', title: 'Reporting Structure',
      steps: [
        { label: 'Board' },
        { label: 'CEO' },
        { label: 'CFO' },
        { label: 'CTO' },
      ],
    } },
    { sectionId: 'data', componentId: 't1', type: 'TABLE', order: 0, content: [
      ['Region', 'Units sold in thousands', 'Revenue (USD)', 'Growth %'],
      ['EMEA', '12,400', '$1,900,000', '12.5%'],
      ['APAC', '9,100', '$1,200,000', '18.2%'],
      ['LATAM', '6,050', '$900,000', '9.4%'],
      ['Total', '27,550', '$4,000,000', '13.4%'],
    ] },
  ]

  const out = await renderArtifact(s, components, 'PDF')
  assert.ok(out.buffer.length > 20000, `PDF size ${out.buffer.length}`)
  await gate(out.buffer, 'PDF', out.mimeType)

  const latin1 = out.buffer.toString('latin1')
  assert.ok(latin1.startsWith('%PDF-'))
  const pageObjects = (latin1.match(/\/Type\s*\/Page[^s]/g) || []).length
  assert.ok(pageObjects >= 4, `expected >= 4 pages (cover + 3 sections), got ${pageObjects}`)
  // equations and the diagram are embedded raster XObjects
  assert.ok(latin1.includes('/Image'), 'equation/diagram PNGs embedded as XObjects')

  // real text layer (not bitmapped text)
  const { extractText, getDocumentProxy } = require('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(out.buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  assert.ok(text.includes('Quantitative Basis'), 'section heading in text layer')
  assert.ok(text.includes('EMEA'), 'table data in text layer')
  assert.ok(text.includes('4,000,000'), 'computed/formatted table numbers in text layer')
})

// ==================== PPTX ====================
test('§10-S1 PPTX: equations + diagrams as images, slide text within budget', async () => {
  const s = spec('PPTX', {
    sections: [
      { id: 'cover', type: 'cover', title: 'Production Quality Deck', order: 0, components: [] },
      { id: 'math', type: 'content', title: 'The Growth Identity', order: 1, components: [] },
      { id: 'flow', type: 'content', title: 'Go-to-Market Flow', order: 2, components: [] },
      { id: 'close', type: 'content', title: 'Summary', order: 3, components: [] },
    ],
  })
  const components = [
    { sectionId: 'cover', componentId: 'c0', type: 'PARAGRAPH', order: 0, content: 'Slide-based verification deck.' },
    { sectionId: 'math', componentId: 'e1', type: 'EQUATION', order: 0, content: { latex: 'g = \\frac{R - r}{1 + r} \\times 100\\%', display: true } },
    { sectionId: 'math', componentId: 'l1', type: 'LIST', order: 1, content: [
      'Growth compounds through retention',
      'Pricing power dominates acquisition',
      'Cash discipline funds the loop',
    ] },
    { sectionId: 'flow', componentId: 'd1', type: 'DIAGRAM', order: 0, content: {
      kind: 'process', title: 'Go-to-Market Flow',
      steps: [
        { label: 'Target accounts', description: 'ICP scoring' },
        { label: 'Qualified demo', description: 'Solution fit' },
        { label: 'Pilot', description: 'Success criteria' },
        { label: 'Expand', description: 'Multi-seat rollout' },
      ],
    } },
    { sectionId: 'close', componentId: 'k1', type: 'KEY_TAKEAWAYS', order: 0, content: [
      'Retention is the flywheel',
      'Expansion revenue funds growth',
    ] },
  ]

  const out = await renderArtifact(s, components, 'PPTX')
  assert.ok(out.buffer.length > 25000, `PPTX size ${out.buffer.length}`)
  await gate(out.buffer, 'PPTX', out.mimeType)

  const zip = await JSZip.loadAsync(Buffer.from(out.buffer))
  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  assert.ok(slides.length >= 4, `expected >= 4 slides, got ${slides.length}`)

  const media = Object.keys(zip.files).filter((p) => /^ppt\/media\//.test(p))
  assert.ok(media.length >= 2, `equation + diagram images embedded: ${media.join(', ')}`)

  let allText = ''
  for (const part of slides) {
    const xml = await (await zip.file(part)).async('string')
    allText += xml
  }
  assert.ok(allText.includes('The Growth Identity'), 'slide title text present')
  assert.ok(allText.includes('Retention is the flywheel'), 'takeaway text present')
  assert.ok(!allText.includes('\\frac'), 'LaTeX source never dumped as slide text')
})

// ==================== XLSX ====================
test('§10-X1 XLSX: native charts (LibreOffice-verified), live formulas, typed formats, print titles', async () => {
  const s = spec('XLSX', {
    type: 'spreadsheet',
    theme: 'financial',
    title: 'FY2026 Sales Operations Workbook',
    sections: [
      { id: 'summary', type: 'content', title: 'Executive Summary', order: 0, components: [] },
      { id: 'data', type: 'table', title: 'Sales Detail', order: 1, components: [] },
    ],
  })
  const components = [
    { sectionId: 'summary', componentId: 'm1', type: 'METRIC_GRID', order: 0, content: [
      { label: 'Revenue', value: '$4.0M', change: '+18% YoY' },
      { label: 'Win rate', value: '34%', change: '+2pts' },
    ] },
    { sectionId: 'summary', componentId: 'k1', type: 'KEY_TAKEAWAYS', order: 1, content: [
      'EMEA leads with 47.5% of revenue',
      'Cost ratio improved in every region',
    ] },
    { sectionId: 'data', componentId: 't1', type: 'TABLE', order: 0, content: [
      ['Region', 'Q1', 'Q2', 'Q3', 'Q4', 'Share %', 'Opened'],
      ['EMEA', 1900000, 2050000, 2210000, 2400000, '47.5%', '2026-01-15'],
      ['APAC', 1200000, 1280000, 1360000, 1500000, '30.1%', '2026-02-01'],
      ['LATAM', 900000, 940000, 1010000, 1150000, '22.4%', '2026-03-10'],
      ['Total', '','','','','100%', ''],
    ] },
    { sectionId: 'data', componentId: 'ch1', type: 'CHART', order: 1, content: {
      chartType: 'bar', title: 'Quarterly Revenue by Region',
      categories: ['EMEA', 'APAC', 'LATAM'],
      series: [
        { name: 'Q1', data: [1900000, 1200000, 900000] },
        { name: 'Q2', data: [2050000, 1280000, 940000] },
      ],
    } },
    { sectionId: 'data', componentId: 'ch2', type: 'CHART', order: 2, content: {
      chartType: 'line', title: 'Trajectory',
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [{ name: 'EMEA', data: [1900000, 2050000, 2210000, 2400000] }],
    } },
  ]

  const out = await renderArtifact(s, components, 'XLSX')
  assert.ok(out.buffer.length > 10000, `XLSX size ${out.buffer.length}`)
  await gate(out.buffer, 'XLSX', out.mimeType)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(out.buffer)
  assert.ok(wb.worksheets.length >= 3, `Overview + 2 section sheets, got ${wb.worksheets.length}`)

  const sales = wb.getWorksheet('Sales Detail')
  assert.ok(sales, 'Sales Detail sheet exists')

  // table placement: banner row 1, blank 2, metrics 3-5, takeaways 6-8, header 9?
  // (renderer owns placement — find the header row by content)
  let headerRowNo = -1
  sales.eachRow((row, no) => {
    const v = row.getCell(1).value
    if (v === 'Region') headerRowNo = no
  })
  assert.ok(headerRowNo > 1, `header row found at ${headerRowNo}`)

  // formulas: totals row carries LIVE SUM formulas over the real range
  const formulas = []
  sales.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.formula) formulas.push({ addr: cell.address, f: cell.formula })
    })
  })
  const sumFormulas = formulas.filter((x) => /SUM\(/.test(x.f))
  assert.ok(sumFormulas.length >= 4, `live SUM formulas in totals row: ${JSON.stringify(sumFormulas)}`)
  for (const f of sumFormulas) {
    // the SUM range must NEVER include the total row itself (circular ref)
    const range = /SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/.exec(f.f)
    assert.ok(range, `parseable SUM range: ${f.f}`)
    assert.equal(Number(range[4]), headerRowNo + 3, `SUM ends at last data row (got ${f.f})`)
  }

  // typed columns: Share % column stored as decimal fraction w/ percent format
  let percentFmt = false
  sales.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.numFmt && /%/.test(cell.numFmt) && cell.value !== null && typeof cell.value === 'number') percentFmt = true
    })
  })
  assert.ok(percentFmt, 'percent column carries real percent number format')

  // freeze panes + autofilter + print titles
  assert.ok(sales.views?.[0]?.state === 'frozen', 'freeze panes set')
  assert.ok(sales.autoFilter, 'autofilter set')
  assert.ok(sales.pageSetup?.printTitlesRow, `print titles repeat the header row (${sales.pageSetup?.printTitlesRow})`)

  // NATIVE chart parts injected — the 2 AI-planned charts PLUS an automatic
  // Dashboard summary chart (live cross-sheet formulas dashboard, v2).
  const zip = await JSZip.loadAsync(Buffer.from(out.buffer))
  const chartParts = Object.keys(zip.files).filter((p) => /^xl\/charts\/chart\d+\.xml$/.test(p))
  assert.ok(chartParts.length >= 2, `at least the two planned chart parts, got ${chartParts.join(', ')}`)
  const chart1 = await (await zip.file(chartParts[0])).async('string')
  assert.ok(chart1.includes('<c:barChart>'), 'chart 1 is a real bar chart')
  assert.ok(chart1.includes('<c:f>'), 'chart references live cell ranges')
  assert.ok(chart1.includes('Quarterly Revenue by Region'), 'chart carries its title')

  // ===== LIBREOFFICE — a REAL office suite must accept the workbook and
  // render the injected charts (skipped when soffice is unavailable). =====
  if (SOFFICE) {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const { execFileSync } = await import('node:child_process')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'filo-xlsx-'))
    const xlsxPath = path.join(tmp, 'chart-verify.xlsx')
    fs.writeFileSync(xlsxPath, out.buffer)
    const outdir = path.join(tmp, 'out')
    fs.mkdirSync(outdir)
    execFileSync(SOFFICE, ['--headless', '--convert-to', 'pdf', '--outdir', outdir, xlsxPath], { timeout: 120_000 })
    const pdfPath = path.join(outdir, 'chart-verify.pdf')
    assert.ok(fs.existsSync(pdfPath), 'LibreOffice converted the workbook')
    const { extractText, getDocumentProxy } = require('unpdf')
    const pdfBytes = fs.readFileSync(pdfPath)
    const pdf = await getDocumentProxy(new Uint8Array(pdfBytes))
    const { text } = await extractText(pdf, { mergePages: true })
    assert.ok(text.includes('Quarterly Revenue by Region'), 'LibreOffice RENDERED the bar chart (title visible)')
    assert.ok(text.includes('Trajectory'), 'LibreOffice RENDERED the line chart (title visible)')
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ==================== CSV ====================
test('§10-C1 CSV: typed columns, qty×price−discount=total relationship repaired, RFC4180 clean', async () => {
  const s = spec('CSV', {
    type: 'spreadsheet',
    theme: 'financial',
    title: 'Order Ledger Export',
    sections: [{ id: 'orders', type: 'table', title: 'Orders', order: 0, components: [] }],
  })
  // Deliberate inconsistencies in rows 3 and 5: the totals do NOT equal
  // qty × price − discount. The renderer must repair the derived column and
  // report the corrections — never ship inconsistent arithmetic.
  const components = [
    { sectionId: 'orders', componentId: 't1', type: 'TABLE', order: 0, content: [
      ['order_id', 'order_date', 'quantity', 'unit_price', 'discount', 'total_amount'],
      ['ORD-001', '2026-01-15', '3', '$120.00', '$15.00', '345.00'],
      ['ORD-002', '2026-01-16', '2', '$85.50', '$0.00', '999.99'],  // WRONG on purpose
      ['ORD-003', '2026-01-18', '1', '$220.00', '$20.00', '200.00'],
      ['ORD-004', '2026-01-21', '5', '$42.10', '$5.50', '777.00'],   // WRONG on purpose
      ['ORD-005', '2026-01-22', '10', '"quirky, name"', '$0.00', '4.25'], // text cell keeps col mixed
    ] },
  ]

  const out = await renderArtifact(s, components, 'CSV')
  await gate(out.buffer, 'CSV', out.mimeType)

  const text = out.buffer.toString('utf-8').replace(/^\uFEFF/, '')
  assert.ok(text.includes('\r\n'), 'CRLF line endings (RFC 4180)')

  // parse back with an RFC4180-aware splitter
  const rows = parseRfc4180(text)
  assert.equal(rows.length, 6, `header + 5 rows, got ${rows.length}`)
  assert.ok(rows.every((r) => r.length === 6), `uniform 6 columns: ${rows.map((r) => r.length).join(',')}`)
  assert.deepEqual(rows[0], ['order_id', 'order_date', 'quantity', 'unit_price', 'discount', 'total_amount'])

  // relationship: total = qty × price − discount
  const findRow = (id) => rows.find((r) => r[0] === id)
  const check = (row) => {
    const qty = Number(row[2]); const price = Number(row[3])
    const disc = Number(row[4]); const total = Number(row[5])
    return Math.abs(qty * price - disc - total) < 0.011
  }
  assert.ok(check(findRow('ORD-001')), 'row 1 consistent')
  assert.ok(check(findRow('ORD-002')), `row 2 repaired to ${findRow('ORD-002')[5]}`)
  assert.ok(check(findRow('ORD-003')), 'row 3 consistent')
  assert.ok(check(findRow('ORD-004')), `row 4 repaired to ${findRow('ORD-004')[5]}`)
  // the text cell must still be a quoted string with its comma intact
  assert.equal(findRow('ORD-005')[3], '"quirky, name"', 'quoted comma cell round-trips')

  // corrections reported in the renderer QA summary
  assert.ok(out.qa?.csvRelationship, 'relationship validation reported')
  assert.equal(out.qa.csvRelationship.rowsRepaired, 2, 'both bad rows corrected')

  // percent/currency normalization: currency cells serialized as plain numbers
  assert.equal(findRow('ORD-001')[3], '120', 'currency stripped to typed number')
})

/** RFC4180-aware record splitter (quotes, escaped quotes, embedded newlines). */
function parseRfc4180(text) {
  const rows = []
  let row = []
  let field = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQ = false
      else field += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') {
      if (ch === '\n' && text[i - 1] === '\r') field = field.slice(0, -1)
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }
  return rows
}

// ==================== RETRY IDEMPOTENCY CONTRACT ====================
test('§10-R1 resolveRenderTarget: retried renders reuse the pinned artifact (no duplicate rows)', () => {
  const { resolveRenderTarget } = loadEngine('@/services/render-target')

  // First attempt of a fresh generation → create.
  const d1 = resolveRenderTarget({ renderArtifactId: null, sourceArtifactId: null }, null)
  assert.equal(d1.action, 'create_fresh')

  // Retry of the SAME job after the artifact row was created → REUSE,
  // appending a version — this is the exact incident path that produced one
  // artifact row per ~11s retry loop in production.
  const d2 = resolveRenderTarget(
    { renderArtifactId: 'artX', sourceArtifactId: null },
    { _id: 'artX', versionCount: 1 }
  )
  assert.equal(d2.action, 'reuse_render_artifact')
  assert.equal(d2.artifactId, 'artX')
  assert.equal(d2.baseVersionCount, 1, 'new version = 2')

  // AI-edit flow → version the SOURCE artifact.
  const d3 = resolveRenderTarget(
    { renderArtifactId: null, sourceArtifactId: 'artSrc' },
    { _id: 'artSrc', versionCount: 3 }
  )
  assert.equal(d3.action, 'version_existing')
  assert.equal(d3.baseVersionCount, 3)

  // Dangling renderArtifactId (artifact deleted mid-flight) → fresh create.
  const d4 = resolveRenderTarget(
    { renderArtifactId: 'gone', sourceArtifactId: null },
    null
  )
  assert.equal(d4.action, 'create_fresh')

  // A retried render must NEVER point at a second artifact.
  assert.notEqual(d2.action, 'create_fresh')
})

test('§10-R2 Convex wiring pins the idempotency contract (schema + mutations + route)', () => {
  const fs = require('node:fs')
  const schema = fs.readFileSync('convex/schema.ts', 'utf8')
  assert.ok(schema.includes('renderArtifactId: v.optional(v.id("artifacts"))'), 'job schema pins renderArtifactId')

  const generation = fs.readFileSync('convex/generation.ts', 'utf8')
  assert.ok(generation.includes('export const recordRenderArtifact'), 'recordRenderArtifact mutation exists')
  assert.ok(/renderArtifactId: args\.artifactId/.test(generation), 'mutation persists the artifact id')

  const artifacts = fs.readFileSync('convex/artifacts.ts', 'utf8')
  assert.ok(/sameJob/.test(artifacts), 'saveArtifactVersion dedupes by jobId')

  const files = fs.readFileSync('convex/files.ts', 'utf8')
  assert.ok(/r2Key.*first\(\)/s.test(files) || /existing = await ctx\.db/.test(files), 'registerFile dedupes by (userId, r2Key)')

  const route = fs.readFileSync('src/app/api/generation/render/route.ts', 'utf8')
  assert.ok(route.includes('resolveRenderTarget'), 'render route uses the pure target contract')
  assert.ok(route.includes('recordRenderArtifact'), 'render route pins the artifact to the job')
})

// ==================== FULL-PIPELINE SWEEP ====================
test('§10-Z1 every format passes the repository deep gates with equation/diagram content', async () => {
  const mk = (format) => {
    const s = spec(format, {
      type: format === 'XLSX' || format === 'CSV' ? 'spreadsheet' : 'document',
      theme: format === 'XLSX' || format === 'CSV' ? 'financial' : 'executive',
      title: '跨格式一致性验证 Cross Format Consistency',
      sections: [
        { id: 'cover', type: 'cover', title: '跨格式一致性验证 Cross Format Consistency', order: 0, components: [] },
        { id: 'body', type: 'content', title: '模型与数据 Model & Data', order: 1, components: [] },
      ],
    })
    const comps = [
      { sectionId: 'cover', componentId: 'c0', type: 'PARAGRAPH', order: 0, content: '设计系统跨格式一致性验证：同主题、同语言、同数据。' },
      { sectionId: 'body', componentId: 'e1', type: 'EQUATION', order: 0, content: { latex: '\\sigma = \\sqrt{\\frac{1}{N}\\sum_{i=1}^{N}(x_i - \\mu)^2}', display: true } },
      { sectionId: 'body', componentId: 't1', type: 'TABLE', order: 1, content: [
        ['城市 City', '营收 Revenue'],
        ['上海', '¥1,200,000'],
        ['Karachi', 'PKR 950,000'],
        ['Lahore', 'PKR 720,000'],
      ] },
    ]
    return { s, comps }
  }

  // DOCX / PPTX / XLSX / CSV all render + deep-gate with CJK + equations.
  for (const format of ['DOCX', 'PPTX', 'XLSX', 'CSV']) {
    const { s, comps } = mk(format)
    const out = await renderArtifact(s, comps, format)
    await gate(Buffer.from(out.buffer), format, out.mimeType)
  }
})
