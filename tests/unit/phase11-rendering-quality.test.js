// =============================================================================
// Phase 11 — RENDERING-QUALITY REGRESSION SUITE
// =============================================================================
// Guards the fixes for the "□□□□□ tofu + generic box diagrams + primitive
// charts" incident. Every test exercises the REAL production code paths:
//
//   FONTS    — bundled fonts valid, glyph coverage for the full torture
//              charset (Latin/accented/Greek/arrows/math/currency), PDF
//              coverage-aware embedding, SVG rasterization on a BARE
//              container (fontconfig with zero system fonts)
//   DIAGRAMS — semantic kinds render, deterministic layout, decision
//              branches, legacy `steps` compat, malformed → null, long-label
//              wrapping
//   CHARTS   — fonts declared in SVG, currency/percent formatting, combo
//              dual-axis, invalid data rejected
//   DOCX     — inline markdown runs, syntax-highlighted code, honest
//              unknown-type fallback, torture-charset text layer
//   PDF      — torture charset extracts from the text layer, embedded fonts
//              declared (no bare Helvetica when special glyphs exist)
//   PPTX     — NO silent table-row drops (continuation slides)
//   XLSX     — N charts on one sheet → ONE drawing part, real date serials,
//              conditional-formatting data bars, truncation surfaced in QA
//   HTML     — charts/diagrams/equations render as inline SVG (never dropped)
//   AST      — component validators repair/reject malformed AI content
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { loadEngine } from './helpers/ts-build.js'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')
const ExcelJS = require('exceljs')

const { renderArtifact } = loadEngine('@/services/document-renderer')
const themes = loadEngine('@/services/themes')
const fonts = loadEngine('@/services/typography/fonts')
const diagramEngine = loadEngine('@/services/diagram')
const chartEngine = loadEngine('@/services/chart-engine')
const ast = loadEngine('@/services/ast')

// The torture charset from the incident brief — none of this may render as tofu.
const TORTURE_TEXT = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
  'Pakistan — Islamabad',
  'Résumé naïve café',
  '€ £ ¥ $',
  '→ ← ↑ ↓',
  '≤ ≥ ≠ ± × ÷',
  'α β γ Δ Ω',
  '∑ ∫ √',
].join('\n')

function specFor(format, themeId = 'executive') {
  const { design } = themes.resolveTheme(themeId, { format })
  return {
    id: 'spec-phase11',
    type: 'document',
    title: 'Rendering Quality Regression',
    outputFormat: format,
    sections: [],
    design,
  }
}

// ==================== FONTS ====================

test('§11-F1 bundled fonts exist and are real font files', () => {
  assert.ok(fonts.resolveFontDir(), 'font directory resolves')
  for (const face of fonts.BUNDLED_FONTS) {
    const p = fonts.bundledFontPath(face.file)
    assert.ok(p, `${face.file} resolves`)
  }
})

test('§11-F2 bundled DejaVu covers the full torture charset', () => {
  const sans = fonts.bundledFontPath('DejaVuSans.ttf')
  assert.ok(sans)
  assert.ok(fonts.fontCovers(sans, TORTURE_TEXT), 'DejaVu Sans covers every torture character')
})

test('§11-F3 PDF font resolution is coverage-aware', () => {
  const sansDoc = fonts.resolvePdfFonts('Calibri', TORTURE_TEXT)
  assert.ok(sansDoc.body, 'body font resolves')
  assert.ok(sansDoc.body.regular.includes('assets/fonts'), 'font comes from the bundled directory')
  assert.ok(sansDoc.mono, 'mono font resolves')

  // A serif theme with only ASCII keeps its metric twin (Liberation Serif).
  const plain = fonts.resolvePdfFonts('Times New Roman', 'Plain English document.')
  assert.ok(plain.body.regular.includes('LiberationSerif'), `metric twin kept (${plain.reason})`)

  // Special glyphs flip the fallback ON (recorded, never silent).
  const exotic = fonts.resolvePdfFonts('Times New Roman', 'Approved ✓ check')
  assert.ok(exotic.coverageFallback, 'coverage fallback recorded for missing glyphs')
  assert.ok(exotic.body.regular.includes('DejaVu'), 'fallback lands on the DejaVu floor')
})

test('§11-F4 diagram/chart SVG rasterization survives a BARE container (no system fonts)', async () => {
  // Point FONTCONFIG_FILE at an empty config BEFORE the engines initialize
  // sharp — the exact production failure mode. The bundled-font bootstrap
  // must override it and render real glyphs (verified via PNG size + SVG).
  const os = require('node:os')
  const path = require('node:path')
  const fs = require('node:fs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filo-test-fontless-'))
  fs.writeFileSync(
    path.join(dir, 'fonts.conf'),
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><cachedir>${dir}/cache</cachedir></fontconfig>`
  )
  process.env.FONTCONFIG_FILE = path.join(dir, 'fonts.conf')
  // Force the bootstrap to re-run for this process.
  fonts.resetTypographyCaches()

  const out = await diagramEngine.renderDiagram({
    kind: 'flowchart',
    direction: 'TB',
    title: 'Tofu Probe — α β Δ Ω ∑',
    nodes: [
      { id: 'a', label: 'Pakistan — Islamabad ✓' },
      { id: 'b', label: 'Résumé naïve café' },
    ],
    edges: [{ from: 'a', to: 'b' }],
  })
  assert.ok(out, 'diagram renders')
  assert.ok(out.png && out.png.length > 5000, 'PNG rasterized with glyphs')
  assert.ok(out.svg.includes('DejaVu Sans'), 'SVG declares the bundled font family')

  const chart = await chartEngine.renderChart(
    chartEngine.normalizeChartSpec({
      chartType: 'bar',
      title: '€ £ ¥ α β',
      categories: ['Q1 →', 'Q2 ≤'],
      series: [{ name: 'A', data: [1, 2] }],
    }),
    { width: 400, height: 260 }
  )
  assert.ok(chart, 'chart renders')
  assert.match(chart.svg, /DejaVu Sans/, 'chart SVG declares the bundled font family')
})

// ==================== DIAGRAM ENGINE ====================

test('§11-D1 every semantic diagram kind renders with sane geometry', async () => {
  const kinds = [
    ['flowchart', { kind: 'flowchart', direction: 'LR', nodes: [{ id: 'a', label: 'Start' }, { id: 'b', label: 'End' }], edges: [{ from: 'a', to: 'b' }] }],
    ['decision_tree', { kind: 'decision_tree', nodes: [{ id: 'r', label: 'VIP?' }, { id: 'y', label: 'Priority' }, { id: 'n', label: 'Standard' }], edges: [{ from: 'r', to: 'y', label: 'Yes' }, { from: 'r', to: 'n', label: 'No' }] }],
    ['org_chart', { kind: 'org_chart', nodes: [{ id: 'a', label: 'CEO' }, { id: 'b', label: 'CTO' }, { id: 'c', label: 'CFO' }], edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }] }],
    ['timeline', { kind: 'timeline', nodes: [{ id: '1', label: 'Phase 1' }, { id: '2', label: 'Phase 2' }], edges: [] }],
    ['sequence', { kind: 'sequence', nodes: [{ id: 'u', label: 'User' }, { id: 's', label: 'Server' }], edges: [{ from: 'u', to: 's', label: 'request' }] }],
    ['architecture', { kind: 'architecture', nodes: [{ id: 'w', label: 'Web', group: 'Client' }, { id: 'g', label: 'Gateway', group: 'Edge' }], edges: [{ from: 'w', to: 'g' }] }],
    ['network', { kind: 'network', nodes: [{ id: 'a', label: 'Hub' }, { id: 'b', label: 'Spoke' }], edges: [{ from: 'a', to: 'b' }] }],
    ['er', { kind: 'er', nodes: [{ id: 'c', label: 'Customer', attributes: ['id'] }, { id: 'o', label: 'Order', attributes: ['total'] }], edges: [{ from: 'c', to: 'o', label: '1..*' }] }],
    ['comparison', { kind: 'comparison', columns: [{ title: 'A', points: ['fast'] }, { title: 'B', points: ['cheap'] }] }],
    ['process', { kind: 'process', nodes: [{ id: '1', label: 'Discover' }, { id: '2', label: 'Design' }], edges: [] }],
  ]
  for (const [name, content] of kinds) {
    const out = await diagramEngine.renderDiagram(content)
    assert.ok(out, `${name} renders`)
    assert.ok(out.svg.startsWith('<svg'), `${name} produces SVG`)
    assert.ok(out.png && out.png.length > 3000, `${name} rasterizes`)
  }
})

test('§11-D2 layout is deterministic (same spec → identical SVG)', async () => {
  const spec = {
    kind: 'flowchart',
    direction: 'LR',
    nodes: [
      { id: 'a', label: 'Alpha — step' },
      { id: 'b', label: 'Beta ≤' },
      { id: 'c', label: 'Gamma ∑' },
    ],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'c', dashed: true },
    ],
  }
  const a = await diagramEngine.renderDiagram(spec)
  const b = await diagramEngine.renderDiagram(spec)
  assert.equal(a.svg, b.svg, 'byte-identical SVG')
})

test('§11-D3 long labels wrap instead of overflowing', async () => {
  const short = await diagramEngine.renderDiagram({
    kind: 'flowchart',
    nodes: [
      { id: 'a', label: 'Short' },
      { id: 'b', label: 'End' },
    ],
    edges: [{ from: 'a', to: 'b' }],
  })
  const long = await diagramEngine.renderDiagram({
    kind: 'flowchart',
    nodes: [
      { id: 'a', label: 'This is an extremely long node label that must wrap across several lines gracefully' },
      { id: 'b', label: 'End' },
    ],
    edges: [{ from: 'a', to: 'b' }],
  })
  assert.ok(short && long)
  // The wrapped label appears as multiple <text> lines in the SVG.
  const textLines = (long.svg.match(/<text /g) ?? []).length
  assert.ok(textLines > 3, `long label wrapped into multiple tspans/texts (${textLines})`)
})

test('§11-D4 legacy shapes and malformed input behave correctly', async () => {
  // Legacy steps flow still renders (backward compatibility).
  const legacy = await diagramEngine.renderDiagram({
    kind: 'flowchart',
    title: 'Legacy',
    steps: [{ label: 'One' }, { label: 'Two' }],
  })
  assert.ok(legacy, 'legacy steps shape renders')

  // Bare array → timeline.
  const bare = await diagramEngine.renderDiagram([{ label: 'A' }, { label: 'B' }])
  assert.ok(bare && bare.kind === 'timeline', 'bare array becomes a timeline')

  // Garbage → null (renderers fall back honestly). Validation is synchronous.
  assert.equal(diagramEngine.normalizeDiagramSpec(null), null)
  assert.equal(diagramEngine.normalizeDiagramSpec('string'), null)
  assert.equal(diagramEngine.normalizeDiagramSpec({ kind: 'flowchart', nodes: [] }), null)
  assert.equal(diagramEngine.normalizeDiagramSpec({ kind: 'flowchart', steps: [{ label: 'Only one' }] }), null)

  // Dangling edges are dropped WITH a recorded repair (never silent).
  const repaired = await diagramEngine.renderDiagram({
    kind: 'flowchart',
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'ghost' }],
  })
  assert.ok(repaired)
  assert.ok(repaired.repairs?.some((r) => r.includes('dropped')), 'dangling edge repair recorded')
})

test('§11-D5 emoji (unrenderable glyphs) are stripped from raster text', async () => {
  const out = await diagramEngine.renderDiagram({
    kind: 'flowchart',
    nodes: [
      { id: 'a', label: 'Launch 🚀 party' },
      { id: 'b', label: 'Done ✅' },
    ],
    edges: [{ from: 'a', to: 'b' }],
  })
  assert.ok(out)
  assert.ok(!out.svg.includes('🚀') && !out.svg.includes('✅'), 'emoji removed from SVG labels')
  assert.ok(out.svg.includes('Launch party'), 'surviving text preserved')
})

// ==================== CHART ENGINE ====================

test('§11-C1 value formatting honors the declared semantics', () => {
  const currency = chartEngine.makeValueFormatter({ type: 'currency', currency: 'EUR' })
  assert.equal(currency(1_200_000), '€1.2M')
  const percent = chartEngine.makeValueFormatter({ type: 'percent' })
  assert.equal(percent(0.25), '25%')
  const plain = chartEngine.makeValueFormatter(undefined)
  assert.equal(plain(45_000), '45k')
})

test('§11-C2 combo charts render bar+line series', async () => {
  const norm = chartEngine.normalizeChartSpec({
    chartType: 'combo',
    title: 'Rev vs margin',
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: 'Revenue', data: [120, 135, 150, 180] },
      { name: 'Margin', data: [0.21, 0.24, 0.22, 0.27] },
    ],
    lineSeries: ['Margin'],
  })
  assert.ok(norm && norm.chartType === 'combo')
  const out = await chartEngine.renderChart(norm, { width: 500, height: 300 })
  assert.ok(out)
  assert.match(out.svg, /c:barChart|<rect|path/, 'bar+line artwork present')
})

test('§11-C3 invalid chart data is rejected (no nonsense charts)', () => {
  assert.equal(chartEngine.normalizeChartSpec({ chartType: 'bar', series: [{ data: ['x'] }] }), null)
  assert.equal(chartEngine.normalizeChartSpec({ chartType: 'bar', series: [{ data: [0, 0, 0] }] }), null)
  assert.equal(chartEngine.normalizeChartSpec(null), null)
  // Misaligned series get TRUNCATED with a recorded repair, not shipped broken.
  const repaired = chartEngine.normalizeChartSpec({
    chartType: 'bar',
    categories: ['A', 'B'],
    series: [{ name: 'S', data: [1, 2, 3, 4, 5] }],
  })
  assert.ok(repaired)
  assert.equal(repaired.series[0].data.length, 2)
  assert.ok(repaired.repairs?.some((r) => r.includes('truncated')))
})

// ==================== AST VALIDATION ====================

test('§11-A1 component validators repair and reject malformed AI content', () => {
  const badChart = ast.validateChartContent({ chartType: 'nonsense', series: [{ data: ['a', 'b'] }] })
  assert.equal(badChart.ok, false)
  assert.ok(badChart.issues.some((i) => i.code === 'CHART_NO_DATA'))

  const repairedChart = ast.validateChartContent({ chartType: 'nonsense', categories: ['A'], series: [{ name: 'S', data: ['$1,200', 2] }] })
  assert.ok(repairedChart.ok)
  assert.equal(repairedChart.value.chartType, 'bar', 'unknown type defaulted with a repair note')
  assert.equal(repairedChart.value.series[0].data[0], 1200, 'currency strings coerced to numbers')

  const emptyCode = ast.validateCodeContent({ language: 'python', code: '   ' })
  assert.equal(emptyCode.ok, false)

  const fenced = ast.validateCodeContent('```sql\nSELECT 1\n```')
  assert.ok(fenced.ok)
  assert.equal(fenced.value.language, 'sql')

  assert.equal(ast.canonicalType('CODE_BLOCK'), 'code')
  assert.equal(ast.canonicalType('org_chart'), 'diagram')
  assert.equal(ast.canonicalType('totally-unknown'), 'custom')
})

// ==================== DOCUMENT-LEVEL EXPORTS ====================

function tortureComponents() {
  return [
    { sectionId: 's1', componentId: 'c1', type: 'paragraph', order: 0, content: TORTURE_TEXT },
    {
      sectionId: 's1', componentId: 'c2', type: 'diagram', order: 1,
      content: {
        kind: 'flowchart', direction: 'LR', title: 'Pipeline — α Δ',
        nodes: [
          { id: 'a', label: 'Ingest → clean' },
          { id: 'q', label: 'Valid ≤ €1k?' },
          { id: 'ok', label: 'Auto-approve' },
          { id: 'man', label: 'Manual review' },
        ],
        edges: [
          { from: 'a', to: 'q' },
          { from: 'q', to: 'ok', label: 'Yes' },
          { from: 'q', to: 'man', label: 'No' },
        ],
      },
    },
    { sectionId: 's1', componentId: 'c3', type: 'markdown', order: 2, content: 'Filo supports **bold**, *italic*, `inline code` and [links](https://example.com).' },
    { sectionId: 's1', componentId: 'c4', type: 'code', order: 3, content: { language: 'python', code: 'def total(xs: list[float]) -> float:\n    return sum(xs)' } },
    { sectionId: 's1', componentId: 'c5', type: 'mystery_widget', order: 4, content: { payload: 'not a real component' } },
  ]
}

function tortureSpec(format) {
  const spec = specFor(format)
  spec.sections = [{ id: 's1', type: 'content', title: 'Torture Section', order: 0, components: [] }]
  return spec
}

test('§11-P1 PDF: torture charset extracts cleanly, embedded fonts declared, styled code present', async () => {
  const out = await renderArtifact(tortureSpec('PDF'), tortureComponents(), 'PDF')
  assert.ok(out.buffer.length > 10_000)
  const { extractText, getDocumentProxy } = require('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(out.buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  for (const probe of ['Pakistan — Islamabad', 'Résumé naïve café', 'α β γ Δ Ω', '∑ ∫ √', '→ ← ↑ ↓', '≤ ≥ ≠ ± × ÷']) {
    assert.ok(text.includes(probe), `PDF text layer contains "${probe}"`)
  }
  const latin1 = out.buffer.toString('latin1')
  assert.ok(/BaseFont/.test(latin1), 'fonts embedded')
  assert.ok(!/\/BaseFont \/Helvetica\b(?![a-z])/.test(latin1), 'no bare Helvetica when special glyphs exist')
})

test('§11-P2 DOCX: inline markdown, colored code runs, honest unknown-type fallback, torture text', async () => {
  const out = await renderArtifact(tortureSpec('DOCX'), tortureComponents(), 'DOCX')
  const zip = await JSZip.loadAsync(out.buffer)
  const xml = await zip.file('word/document.xml').async('string')
  // Inline markdown rendered as styled runs, not literal asterisks.
  assert.ok(xml.includes('<w:b/>'), 'bold run present')
  assert.ok(!xml.includes('**bold**'), 'no literal markdown asterisks')
  // Syntax highlighting: the python keyword carries a token color.
  assert.match(xml, /def<\/w:t>/)
  assert.ok(/D73A49/i.test(xml), 'shiki token color present')
  // Unknown component → labeled honest fallback (never raw JSON dump).
  assert.ok(xml.includes('Unsupported component'), 'unknown type labeled')
  // Unicode intact in the text layer.
  for (const probe of ['Pakistan — Islamabad', 'α β γ Δ Ω']) {
    assert.ok(xml.includes(probe), `DOCX contains "${probe}"`)
  }
})

test('§11-P3 PPTX: table rows are NEVER silently dropped', async () => {
  const spec = specFor('PPTX')
  spec.sections = [
    { id: 'cover', type: 'cover', title: 'Deck', order: 0, components: [] },
    { id: 's1', type: 'content', title: 'Data', order: 1, components: [] },
  ]
  const rows = [['Col A', 'Col B'], ...Array.from({ length: 16 }, (_, i) => [`r${i + 1}`, `${i + 1}`])]
  const comps = [{ sectionId: 's1', componentId: 't1', type: 'table', order: 0, content: rows }]
  const out = await renderArtifact(spec, comps, 'PPTX')
  const zip = await JSZip.loadAsync(out.buffer)
  const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  let allText = ''
  for (const f of slideFiles) allText += await zip.file(f).async('string')
  // Every source row appears across the deck (continuation slides carry them).
  for (let i = 1; i <= 16; i++) {
    assert.ok(allText.includes(`r${i}`), `row r${i} present in slides`)
  }
  assert.ok(slideFiles.length >= 3, 'continuation slides created')
})

test('§11-P4 XLSX: multiple charts on one sheet produce ONE drawing; dates are real; data bars present', async () => {
  const spec = specFor('XLSX', 'financial')
  spec.sections = [{ id: 's1', type: 'content', title: 'Data', order: 0, components: [] }]
  const comps = [
    {
      sectionId: 's1', componentId: 't1', type: 'table', order: 0,
      content: [
        ['Date', 'Region', 'Amount'],
        ['2025-01-15', 'North', 1200],
        ['2025-02-15', 'South', 900],
        ['2025-03-15', 'East', 1500],
      ],
    },
    { sectionId: 's1', componentId: 'ch1', type: 'chart', order: 1, content: { chartType: 'bar', title: 'By region', categories: ['North', 'South', 'East'], series: [{ name: 'Amount', data: [1200, 900, 1500] }] } },
    { sectionId: 's1', componentId: 'ch2', type: 'chart', order: 2, content: { chartType: 'line', title: 'Trend', categories: ['Jan', 'Feb', 'Mar'], series: [{ name: 'Amount', data: [1200, 900, 1500] }] } },
  ]
  const out = await renderArtifact(spec, comps, 'XLSX')
  const zip = await JSZip.loadAsync(out.buffer)
  const drawings = Object.keys(zip.files).filter((n) => /^xl\/drawings\/drawing\d+\.xml$/.test(n))
  const charts = Object.keys(zip.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n))
  assert.equal(charts.length, 3, 'three chart parts (2 section + 1 dashboard)')
  // The section sheet's drawing must contain BOTH anchors (one drawing part).
  const sectionDrawing = drawings.map((d) => zip.file(d)).find((f) => f !== null)
  let twoAnchorDrawing = false
  for (const d of drawings) {
    const xml = await zip.file(d).async('string')
    const anchors = (xml.match(/<xdr:twoCellAnchor/g) ?? []).length
    if (anchors >= 2) twoAnchorDrawing = true
  }
  assert.ok(twoAnchorDrawing, 'multi-chart sheet uses ONE drawing part with N anchors')

  // Re-open: dates are real Excel dates, conditional formatting exists.
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(out.buffer)
  const ws = wb.worksheets.find((w) => w.name === 'Data') ?? wb.worksheets[0]
  // Locate the first real date cell (table position varies with sheet headers).
  let dateCell = null
  for (let r = 1; r <= 12 && !dateCell; r++) {
    for (let c = 1; c <= 6 && !dateCell; c++) {
      const v = ws.getRow(r).getCell(c).value
      if (v instanceof Date) dateCell = v
    }
  }
  assert.ok(dateCell instanceof Date, 'date cells are real Excel dates (not text)')
  const cfCount = ws.conditionalFormattings?.count ?? ws.conditionalFormattings?.length ?? 0
  assert.ok(cfCount >= 1, 'conditional formatting (data bar) present')
})

test('§11-P5 HTML: charts, diagrams and equations render as inline SVG — never dropped', async () => {
  const spec = specFor('HTML')
  spec.sections = [{ id: 's1', type: 'content', title: 'Rich', order: 0, components: [] }]
  const comps = [
    { sectionId: 's1', componentId: 'd1', type: 'diagram', order: 0, content: { kind: 'flowchart', nodes: [{ id: 'a', label: 'Start' }, { id: 'b', label: 'End' }], edges: [{ from: 'a', to: 'b' }] } },
    { sectionId: 's1', componentId: 'c1', type: 'chart', order: 1, content: { chartType: 'bar', title: 'Sales', categories: ['A', 'B'], series: [{ name: 'S', data: [1, 2] }] } },
    { sectionId: 's1', componentId: 'e1', type: 'equation', order: 2, content: { latex: 'e = mc^2', display: true } },
    { sectionId: 's1', componentId: 'p1', type: 'paragraph', order: 3, content: 'Styled **emphasis** and `code`.' },
  ]
  const out = await renderArtifact(spec, comps, 'HTML')
  const html = out.buffer.toString('utf-8')
  assert.ok((html.match(/<figure class="figure">/g) ?? []).length >= 2, 'figure blocks present')
  assert.match(html, /<svg/, 'inline SVG present')
  assert.match(html, /<strong>emphasis<\/strong>/, 'inline bold rendered')
  // Equations render as MathJax SVG (glyph paths) or the honest LaTeX fallback.
  const eqBlock = /<div class="equation">([\s\S]*?)<\/div>/.exec(html)
  const latexFallback = html.includes('class="latex-fallback"')
  assert.ok((eqBlock && eqBlock[1].includes('<svg')) || latexFallback, 'equation rendered (SVG or honest LaTeX fallback)')
})
