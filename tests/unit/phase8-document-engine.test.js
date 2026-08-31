// Phase 8 — Production Document Engine (spec §7-§19, §21-§31, §42-§45).
//
// FUNCTIONAL tests: the pure engine modules are compiled to CJS (helpers/
// ts-build.js) and exercised for real — themes, two-stage designer, the
// ingestion pipeline (DOCX/XLSX/PPTX/CSV/TXT built in-memory then parsed
// back), chart + diagram engines, every renderer (DOCX/PDF/XLSX/PPTX/CSV/
// TXT/HTML), structural QA with bounded repair, professional filenames, and
// source-level pins for the pipeline wiring (worker designer stage, render
// route quality gates, versioned R2 keys, versioning schema).
//
// Spec references:
//   §8  two-stage AI: designer then content
//   §9  closed-world theme registry (18 families)
//   §10 component vocabulary (metric grids, callouts, charts, timelines…)
//   §12 DOCX via `docx` (editable, native)
//   §13 PDF via pdfkit (themed, paginated, bounded)
//   §14 PPTX via pptxgenjs (layout-first, overflow-guarded)
//   §15 XLSX via ExcelJS (REAL formulas, freeze panes, autofilter, styling)
//   §16 CSV deterministic serialization (quotes/commas/newlines/UTF-8)
//   §18 chart engine — mathematically correct, never a generative image
//   §19 diagram engine — deterministic SVG geometry
//   §21/§22 file ingestion (structured extraction, never blind binary)
//   §29/§30/§31 structural QA + bounded repair + quality gates
//   §27 versioning schema and mutations
//   §42/§43 export/conversion matrix per artifact type
//   §44 professional filenames
//   §45 versioned R2 object keys users/{uid}/artifacts/{aid}/v{n}/…

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadEngine } from './helpers/ts-build.js'

// npm packages are CommonJS — require them from the ESM test file.
const require = createRequire(import.meta.url)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..')
const read = (...p) => readFileSync(resolve(REPO_ROOT, ...p), 'utf8')

// ---------------------------------------------------------------------------
// §9 — THEME ENGINE (functional)
// ---------------------------------------------------------------------------
test('§9 theme registry exposes 18 validated professional families', () => {
  const themes = loadEngine('@/services/themes')
  assert.equal(themes.THEMES.length, 18)
  const expected = [
    'executive', 'corporate', 'academic', 'research', 'modern-tech', 'startup',
    'minimal', 'editorial', 'luxury', 'financial', 'medical', 'legal',
    'government', 'education', 'creative', 'professional-dark', 'portfolio', 'marketing',
  ]
  for (const id of expected) {
    assert.ok(themes.themeExists(id), `theme "${id}" must exist`)
  }
})

test('§9 every theme carries complete, valid design tokens', () => {
  const themes = loadEngine('@/services/themes')
  const hexRe = /^#[0-9a-fA-F]{6}$/
  for (const t of themes.THEMES) {
    assert.equal(typeof t.id, 'string', `${t.id}: id`)
    assert.match(t.label, /\S/, `${t.id}: label`)
    assert.match(t.description, /\S/, `${t.id}: description for the AI designer`)
    for (const key of ['primary', 'accent', 'foreground', 'background', 'muted', 'mutedForeground', 'border', 'card']) {
      assert.match(t.colors[key], hexRe, `${t.id}: colors.${key} must be a hex color`)
    }
    assert.ok(t.chartPalette.length >= 5, `${t.id}: chart palette with >= 5 colors`)
    t.chartPalette.forEach((c, i) => assert.match(c, hexRe, `${t.id}: chartPalette[${i}]`))
    assert.ok(t.typography.headingFont && t.typography.bodyFont, `${t.id}: fonts`)
    assert.ok(['minimal', 'banded', 'boxed', 'dark-header', 'editorial'].includes(t.table), `${t.id}: table style`)
    assert.ok(['banner', 'centered', 'sidebar', 'minimal', 'gradient-bar'].includes(t.cover), `${t.id}: cover style`)
  }
})

test('§9 resolveTheme is closed-world: unknown ids fall back, accent fine-tune is constrained', () => {
  const themes = loadEngine('@/services/themes')
  // Unknown theme → safe default, never a crash or invented tokens.
  const { design } = themes.resolveTheme('definitely-not-a-theme')
  assert.equal(design.theme.name, 'executive')
  // Valid hex accent override is honored…
  const tuned = themes.resolveTheme('corporate', { accentOverride: '#0ea5e9' })
  assert.equal(tuned.design.colors.accent, '#0ea5e9')
  // …invalid accent overrides are ignored (safe constraints).
  const rejected = themes.resolveTheme('corporate', { accentOverride: 'red' })
  assert.equal(rejected.design.colors.accent, '#3b82f6')
  // Spreadsheet formats flip to landscape + no header/footer.
  const sheet = themes.resolveTheme('executive', { format: 'XLSX' })
  assert.equal(sheet.design.layout.orientation, 'landscape')
  assert.equal(sheet.design.layout.headerEnabled, false)
})

// ---------------------------------------------------------------------------
// §8 — TWO-STAGE DESIGNER (functional)
// ---------------------------------------------------------------------------
test('§8 designer stage parses a valid plan and enforces the theme registry', () => {
  const dp = loadEngine('@/services/design-planning')
  const valid = dp.parseDesignPlan(
    JSON.stringify({ artifactType: 'report', audience: 'executives', theme: 'financial', density: 'dense', accentOverride: '#059669', visualPriority: ['key metrics', 'charts'] }),
    'Q3 budget report', 'DOCX'
  )
  assert.equal(valid.theme, 'financial')
  assert.equal(valid.density, 'dense')
  assert.equal(valid.accentOverride, '#059669')
  assert.deepEqual(valid.visualPriority, ['key metrics', 'charts'])
})

test('§8 designer stage NEVER trusts free-form output — invalid values degrade to safe defaults', () => {
  const dp = loadEngine('@/services/design-planning')
  // Garbage JSON → safe defaults, not a crash (spec §36).
  const garbage = dp.parseDesignPlan('not json at all {{{', 'any request', 'PPTX')
  assert.equal(garbage.theme, 'corporate') // format-appropriate default
  assert.equal(garbage.density, 'medium')
  assert.equal(garbage.accentOverride, null)
  // Invented theme ids are rejected back to the default registry entry.
  const invented = dp.parseDesignPlan(JSON.stringify({ theme: 'vaporwave-neon-9000' }), 'x', 'DOCX')
  assert.equal(invented.theme, 'executive')
  // Bad accent format ignored.
  const badAccent = dp.parseDesignPlan(JSON.stringify({ theme: 'corporate', accentOverride: 'rgb(1,2,3)' }), 'x', 'DOCX')
  assert.equal(badAccent.accentOverride, null)
})

test('§8 applyDesignPlan resolves the validated plan into renderer tokens', () => {
  const dp = loadEngine('@/services/design-planning')
  const plan = dp.parseDesignPlan(JSON.stringify({ theme: 'legal', accentOverride: '#1e3a5f' }), 'x', 'PDF')
  const { design, tokens } = dp.applyDesignPlan(plan, 'PDF')
  assert.equal(design.theme.name, 'legal')
  assert.equal(tokens.id, 'legal')
  assert.equal(design.colors.accent, '#1e3a5f')
  assert.equal(design.layout.pageSize, 'A4')
})

// ---------------------------------------------------------------------------
// §22 — INGESTION PIPELINE (functional; files built in-memory then parsed)
// ---------------------------------------------------------------------------
test('§22 CSV ingestion: RFC 4180 quoting, type inference, headers', async () => {
  const ingestion = loadEngine('@/services/ingestion')
  const csv = `Name,Revenue,Active\n"Smith, John",1200000,yes\n"Multi\nline note",95000.5,no\n`
  const result = await ingestion.ingestFile(Buffer.from(csv, 'utf-8'), 'customers.csv', 'text/csv')
  assert.equal(result.kind, 'csv')
  assert.equal(result.structure.tables.length, 1)
  const table = result.structure.tables[0]
  assert.deepEqual(table.headers, ['Name', 'Revenue', 'Active'])
  // Embedded comma preserved inside quotes; numbers inferred; not "na".
  assert.equal(table.rows[0][0], 'Smith, John')
  assert.equal(table.rows[0][1], 1200000)
  assert.equal(table.rows[1][1], 95000.5)
  // Embedded newline preserved.
  assert.ok(String(table.rows[1][0]).includes('line note'))
})

test('§22 DOCX ingestion: headings, paragraphs, tables survive a round-trip', async () => {
  const ingestion = loadEngine('@/services/ingestion')
  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell } = require('docx')
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'Market Analysis 2026', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: 'Revenue grew strongly across all regions this fiscal year.' }),
        new Paragraph({ text: 'Regional Breakdown', heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: 'Detailed regional performance follows in the table below.' }),
        new Table({
          rows: [
            new TableRow({ children: [new TableCell({ children: [new Paragraph('Region')] }), new TableCell({ children: [new Paragraph('Revenue')] })] }),
            new TableRow({ children: [new TableCell({ children: [new Paragraph('EMEA')] }), new TableCell({ children: [new Paragraph('1200000')] })] }),
            new TableRow({ children: [new TableCell({ children: [new Paragraph('APAC')] }), new TableCell({ children: [new Paragraph('980000')] })] }),
          ],
        }),
      ],
    }],
  })
  const buffer = await Packer.toBuffer(doc)
  const result = await ingestion.ingestFile(Buffer.from(buffer), 'report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(result.kind, 'docx')
  assert.ok(result.structure.headings.includes('Market Analysis 2026'), 'H1 extracted')
  assert.ok(result.structure.headings.includes('Regional Breakdown'), 'H2 extracted')
  assert.equal(result.structure.tables.length, 1, 'table extracted')
  assert.deepEqual(result.structure.tables[0].headers, ['Region', 'Revenue'])
  assert.equal(result.structure.tables[0].rows.length, 2)
  assert.ok(result.textContent.includes('Revenue grew strongly'), 'paragraph text extracted')
})

test('§22 XLSX ingestion: sheets, typed cells, formulas — never flattened to text', async () => {
  const ingestion = loadEngine('@/services/ingestion')
  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Budget')
  ws.getRow(1).values = ['Region', 'Q1', 'Q2', 'Total']
  ws.getRow(2).values = ['EMEA', 120, 135]
  ws.getRow(3).values = ['APAC', 98, 110]
  // Real workbooks carry formulas WITH cached results.
  ws.getCell('D2').value = { formula: 'B2+C2', result: 255 }
  ws.getCell('D3').value = { formula: 'B3+C3', result: 208 }
  const buf = await wb.xlsx.writeBuffer()
  const result = await ingestion.ingestFile(Buffer.from(buf), 'budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.equal(result.kind, 'xlsx')
  const sheet = result.structure.sheets[0]
  assert.equal(sheet.name, 'Budget')
  assert.deepEqual(sheet.headers, ['Region', 'Q1', 'Q2', 'Total'])
  assert.equal(sheet.rows[0][1], 120, 'numeric cell typed')
  assert.ok(sheet.formulas.some((f) => f.includes('B2+C2')), `formula captured: ${JSON.stringify(sheet.formulas)}`)
})

test('§22 PPTX ingestion: slides, bullets and speaker notes extracted', async () => {
  const ingestion = loadEngine('@/services/ingestion')
  const PptxGenJS = require('pptxgenjs')
  const pres = new PptxGenJS()
  pres.defineLayout({ name: 'T', width: 10, height: 5.625 })
  pres.layout = 'T'
  pres.addSlide().addText('Q3 Strategy', { x: 0.5, y: 0.3, fontSize: 30 })
  const s2 = pres.addSlide()
  s2.addText('Roadmap', { x: 0.5, y: 0.3, fontSize: 24 })
  s2.addText([{ text: 'Ship ingestion', options: { bullet: true } }, { text: 'Ship QA', options: { bullet: true } }], { x: 0.5, y: 1 })
  s2.addNotes('Emphasize the ingestion milestone.')
  const buf = await pres.write({ outputType: 'nodebuffer' })
  const result = await ingestion.ingestFile(Buffer.from(buf), 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  assert.equal(result.kind, 'pptx')
  assert.equal(result.structure.slides.length, 2, 'both slides found')
  assert.equal(result.structure.slides[0].title, 'Q3 Strategy')
  assert.ok(result.structure.slides[1].bullets.some((b) => b.includes('ingestion')), 'bullets extracted')
  assert.ok((result.structure.slides[1].notes || '').includes('ingestion milestone'), 'speaker notes extracted')
})

test('§22 magic-byte detection refuses to trust the declared MIME alone', async () => {
  const ingestion = loadEngine('@/services/ingestion')
  // A PDF payload renamed to .docx with a DOCX mime type — detected as PDF.
  const PDFDocument = require('pdfkit')
  const chunks = []
  const pdf = new PDFDocument()
  pdf.on('data', (c) => chunks.push(c))
  pdf.on('end', () => {})
  pdf.text('signature test')
  pdf.end()
  await new Promise((r) => pdf.on('end', r))
  const pdfBuffer = Buffer.concat(chunks)
  const detected = ingestion.detectFileType(pdfBuffer, 'evil.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(detected.kind, 'pdf', 'magic bytes win over extension/mime')

  // Unsupported binary → clean error, not a crash.
  await assert.rejects(
    () => ingestion.ingestFile(Buffer.from([0x00, 0x01, 0x02, 0x03]), 'weird.bin', 'application/octet-stream'),
    /Unsupported file type/
  )
})

test('§22 PDF ingestion: page-aware text extraction', async () => {
  const ingestion = loadEngine('@/services/ingestion')
  const PDFDocument = require('pdfkit')
  const chunks = []
  const pdf = new PDFDocument()
  pdf.on('data', (c) => chunks.push(c))
  pdf.text('First page content about revenue.')
  pdf.addPage().text('Second page content about growth.')
  pdf.end()
  await new Promise((r) => pdf.on('end', r))
  const result = await ingestion.ingestFile(Buffer.concat(chunks), 'doc.pdf', 'application/pdf')
  assert.equal(result.kind, 'pdf')
  assert.equal(result.structure.pageCount, 2)
  assert.ok(result.textContent.includes('First page content'), 'page 1 text')
  assert.ok(result.textContent.includes('Second page content'), 'page 2 text')
})

test('§22 buildSourceContext produces a bounded AI context with structure + content', async () => {
  const ingestion = loadEngine('@/services/ingestion')
  const csvResult = await ingestion.ingestFile(
    Buffer.from('Region,Revenue\nEMEA,1200000\nAPAC,980000\n', 'utf-8'),
    'regions.csv', 'text/csv'
  )
  const context = ingestion.buildSourceContext([csvResult], 10_000)
  assert.ok(context.includes('FILE: regions.csv'), 'file header present')
  assert.ok(context.includes('Region | Revenue'), 'table preview present')
  assert.ok(context.length <= 12_000, 'context stays bounded')
})

// ---------------------------------------------------------------------------
// §18/§19 — CHART + DIAGRAM ENGINES (functional)
// ---------------------------------------------------------------------------
test('§18 chart engine renders mathematically correct charts to PNG (bar + pie)', async () => {
  const chartEngine = loadEngine('@/services/chart-engine')
  const spec = chartEngine.normalizeChartSpec({
    chartType: 'bar',
    title: 'Revenue by Quarter',
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [{ name: 'Revenue', data: [120, 135, 150, 180] }],
  })
  assert.ok(spec, 'valid chart data normalizes')
  const bar = await chartEngine.renderChart(spec, { palette: ['#1e3a5f', '#b8860b', '#4a6fa5'] })
  assert.ok(bar, 'bar chart renders')
  assert.ok(bar.png.length > 2000, `PNG has real content (${bar.png.length} bytes)`)
  assert.equal(bar.png[0], 0x89, 'PNG magic byte')
  assert.ok(bar.svg.startsWith('<svg'), 'SVG string produced')

  const pieSpec = chartEngine.normalizeChartSpec({
    chartType: 'donut',
    categories: ['EMEA', 'APAC', 'AMER'],
    series: [{ name: 'Revenue', data: [45, 30, 25] }],
  })
  const pie = await chartEngine.renderChart(pieSpec)
  assert.ok(pie, 'donut renders')
  assert.ok(pie.png.length > 1500)
})

test('§18 chart engine rejects structurally invalid chart data', () => {
  const chartEngine = loadEngine('@/services/chart-engine')
  assert.equal(chartEngine.normalizeChartSpec({ chartType: 'bar', series: [{ data: ['a', 'b'] }] }), null, 'non-numeric data rejected')
  assert.equal(chartEngine.normalizeChartSpec('not an object'), null, 'garbage rejected')
  assert.equal(chartEngine.normalizeChartSpec({ chartType: 'pie', series: [{ data: [1] }] }), null, 'single-point pie rejected')
})

test('§19 diagram engine computes deterministic SVG geometry (flowchart + timeline)', async () => {
  const diagramEngine = loadEngine('@/services/diagram-engine')
  const flow = await diagramEngine.renderDiagram({
    kind: 'flowchart',
    title: 'Order pipeline',
    steps: [
      { label: 'Order received', description: 'Customer submits' },
      { label: 'Validate payment' },
      { label: 'Ship order' },
    ],
  }, { colors: { primary: '#1e3a5f', accent: '#3b82f6', foreground: '#1f2937', border: '#e2e8f0' } })
  assert.ok(flow, 'flowchart renders')
  assert.ok(flow.svg.startsWith('<svg'))
  assert.ok(flow.png.length > 1500, 'PNG rasterized')
  // 3 boxes + 2 arrows: deterministic layout contains every label.
  for (const label of ['Order received', 'Validate payment', 'Ship order']) {
    assert.ok(flow.svg.includes(label), `label "${label}" present in SVG`)
  }

  const timeline = await diagramEngine.renderDiagram({
    kind: 'timeline',
    steps: [{ label: 'Phase 1', description: 'Discovery' }, { label: 'Phase 2' }, { label: 'Phase 3' }],
  })
  assert.ok(timeline, 'timeline renders')
  assert.ok(timeline.svg.includes('Phase 1'))
  assert.ok(timeline.svg.includes('Phase 3'))
})

// ---------------------------------------------------------------------------
// §10/§12/§13/§14/§15/§16 — RENDERERS (functional, full format matrix)
// ---------------------------------------------------------------------------
function testDocument(overrides = {}) {
  const themes = loadEngine('@/services/themes')
  const { design } = themes.resolveTheme(overrides.theme || 'executive', { format: 'DOCX' })
  return {
    id: 'spec-1',
    type: 'document',
    title: 'Market Analysis Report',
    description: 'Comprehensive regional performance review',
    outputFormat: 'DOCX',
    sections: [
      { id: 'cover', type: 'cover', title: 'Market Analysis Report', order: 0, components: [] },
      { id: 's1', type: 'content', title: 'Executive Summary', order: 1, components: [] },
      { id: 's2', type: 'content', title: 'Regional Performance', order: 2, components: [] },
      { id: 's3', type: 'content', title: 'Outlook', order: 3, components: [] },
      { id: 's4', type: 'content', title: 'Recommendations', order: 4, components: [] },
    ],
    design,
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1, language: 'en', tags: [], keywords: [] },
    validation: { requireTitle: true },
    ...overrides,
  }
}

function richComponents() {
  return [
    { sectionId: 'cover', componentId: 'c0', type: 'PARAGRAPH', order: 0, content: 'A concise brief of the findings.' },
    { sectionId: 's1', componentId: 'c1', type: 'METRIC_GRID', order: 0, content: [
      { label: 'Revenue', value: '$4.2M', change: '+18% YoY' },
      { label: 'Margin', value: '34%', change: '+2pt' },
      { label: 'Customers', value: '12,400', change: '+9%' },
      { label: 'NPS', value: '62' },
    ] },
    { sectionId: 's1', componentId: 'c2', type: 'PARAGRAPH', order: 1, content: 'Revenue expanded across every region with EMEA leading on enterprise renewals.' },
    { sectionId: 's2', componentId: 'c3', type: 'HEADING', order: 0, content: 'By region' },
    { sectionId: 's2', componentId: 'c4', type: 'TABLE', order: 1, content: [
      ['Region', 'Revenue', 'Growth'],
      ['EMEA', '$1.9M', '+22%'],
      ['APAC', '$1.2M', '+15%'],
      ['AMER', '$1.1M', '+11%'],
    ] },
    { sectionId: 's2', componentId: 'c5', type: 'CHART', order: 2, content: {
      chartType: 'bar', title: 'Revenue by region', categories: ['EMEA', 'APAC', 'AMER'],
      series: [{ name: 'Revenue ($M)', data: [1.9, 1.2, 1.1] }],
    } },
    { sectionId: 's3', componentId: 'c6', type: 'TIMELINE', order: 0, content: [
      { label: 'Discovery', description: 'Q1 research' },
      { label: 'Expansion', description: 'Q2 rollout' },
      { label: 'Consolidation', description: 'Q3 optimization' },
    ] },
    { sectionId: 's4', componentId: 'c7', type: 'CALLOUT', order: 0, content: 'Prioritize EMEA enterprise renewals in the next planning cycle.' },
    { sectionId: 's4', componentId: 'c8', type: 'KEY_TAKEAWAYS', order: 1, content: ['Grow EMEA', 'Defend APAC margins', 'Invest in AMER support'] },
    { sectionId: 's4', componentId: 'c9', type: 'TWO_COLUMN', order: 2, content: {
      leftTitle: 'Strengths', leftPoints: ['Brand pull', 'Renewal engine'],
      rightTitle: 'Risks', rightPoints: ['FX exposure', 'Concentration'],
    } },
    { sectionId: 's4', componentId: 'c10', type: 'QUOTE', order: 3, content: 'Distribution follows trust.' },
  ]
}

test('§12 DOCX renderer: editable native DOCX with cover, TOC and rich components', async () => {
  const { renderArtifact } = loadEngine('@/services/document-renderer')
  const spec = testDocument()
  const out = await renderArtifact(spec, richComponents(), 'DOCX')
  assert.ok(out.buffer.length > 20_000, `substantial DOCX (${out.buffer.length} bytes)`)
  assert.equal(out.buffer[0], 0x50, 'ZIP magic byte (DOCX is a zip)')
  assert.ok(out.filename.endsWith('.docx'))
  assert.match(out.mimeType, /wordprocessingml/)
  // It is a REAL zip: parse it back and confirm document.xml carries content.
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(out.buffer)
  const docXml = await zip.file('word/document.xml').async('string')
  assert.ok(docXml.includes('Executive Summary'), 'section heading present')
  assert.ok(docXml.includes('EMEA'), 'table data present')
  assert.ok(docXml.includes('$4.2M'), 'metric grid present')
  assert.ok(docXml.includes('>Contents<'), 'table of contents page present')
})

test('§13 PDF renderer: themed paginated PDF with page breaks + validation', async () => {
  const { renderArtifact } = loadEngine('@/services/document-renderer')
  const spec = testDocument({ theme: 'corporate' })
  const out = await renderArtifact(spec, richComponents(), 'PDF')
  assert.ok(out.buffer.length > 5_000, `substantial PDF (${out.buffer.length} bytes)`)
  assert.equal(out.buffer[0], 0x25, '%PDF magic byte')
  const text = out.buffer.toString('latin1')
  assert.ok(text.includes('/Type /Page'), 'page objects present')
  assert.match(out.mimeType, /application\/pdf/)
})

test('§14 PPTX renderer: layout-first slides for every component type', async () => {
  const { renderArtifact } = loadEngine('@/services/document-renderer')
  const themes = loadEngine('@/services/themes')
  const { design } = themes.resolveTheme('corporate', { format: 'PPTX' })
  const spec = testDocument({ theme: 'corporate', outputFormat: 'PPTX', design })
  const out = await renderArtifact(spec, richComponents(), 'PPTX')
  assert.ok(out.buffer.length > 20_000, `substantial PPTX (${out.buffer.length} bytes)`)
  assert.equal(out.buffer[0], 0x50, 'ZIP magic byte')
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(out.buffer)
  const slideNames = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  assert.ok(slideNames.length >= 5, `cover + content slides + closing (got ${slideNames.length})`)
  const slide1 = await zip.files[slideNames[0]].async('string')
  assert.ok(slide1.toUpperCase().includes('MARKET ANALYSIS'), 'cover title present')
})

test('§15 XLSX renderer: ExcelJS workbook with REAL formulas, freeze panes, autofilter', async () => {
  const { renderArtifact } = loadEngine('@/services/document-renderer')
  const themes = loadEngine('@/services/themes')
  const { design } = themes.resolveTheme('financial', { format: 'XLSX' })
  const spec = {
    ...testDocument({ theme: 'financial' }),
    outputFormat: 'XLSX',
    design,
    sections: [
      { id: 'data', type: 'table', title: 'Regional Data', order: 0, components: [] },
    ],
  }
  const components = [
    { sectionId: 'data', componentId: 'x1', type: 'TABLE', order: 0, content: [
      ['Region', 'Revenue', 'Cost', 'Profit'],
      ['EMEA', 1900000, 1200000, '=B2-C2'],
      ['APAC', 1200000, 800000, '=B3-C3'],
      ['Total', '=SUM(B2:B3)', '=SUM(C2:C3)', '=SUM(D2:D3)'],
    ] },
  ]
  const out = await renderArtifact(spec, components, 'XLSX')
  assert.ok(out.buffer.length > 4_000)
  assert.equal(out.buffer[0], 0x50, 'ZIP magic byte')
  // Read back with ExcelJS: formulas must be FORMULAS, not hardcoded strings.
  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(out.buffer)
  assert.ok(wb.worksheets.length >= 2, 'Overview + data sheet')
  const data = wb.getWorksheet('Regional Data')
  assert.ok(data, 'data sheet exists')
  // Layout: row 1 = section banner, row 2 blank, row 3 = header, row 4+ = data.
  // The AI wrote formulas for ITS row numbering (table at row 1) — the
  // renderer must remap them to the actual placement (+2 rows here).
  const emeaRow = data.getRow(4)
  assert.equal(emeaRow.getCell(1).value, 'EMEA')
  const profitCell = emeaRow.getCell(4)
  assert.ok(
    profitCell.formula || (profitCell.value && profitCell.value.formula),
    `profit cell is a real formula: ${JSON.stringify(profitCell.value)}`
  )
  assert.equal(profitCell.formula, 'B4-C4', 'row references remapped to actual placement')
  const formulas = []
  data.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.formula) formulas.push(cell.formula)
    })
  })
  assert.ok(formulas.some((f) => f.includes('B4-C4')), 'row formula preserved + remapped')
  assert.ok(formulas.some((f) => f.includes('SUM(B4:B5)')), 'aggregate formula remapped to the real range')
  // Freeze panes below the header row + autofilter over the table.
  assert.ok(data.views && data.views[0] && data.views[0].state === 'frozen', 'freeze panes set')
  assert.ok(data.autoFilter, 'autofilter set')
})

test('§16 CSV renderer: deterministic RFC 4180 output with BOM', async () => {
  const { renderArtifact } = loadEngine('@/services/document-renderer')
  const spec = {
    ...testDocument(),
    outputFormat: 'CSV',
    sections: [{ id: 's2', type: 'table', title: 'Regional', order: 0, components: [] }],
  }
  const components = [
    { sectionId: 's2', componentId: 'v1', type: 'TABLE', order: 0, content: [
      ['Region', 'Note', 'Revenue'],
      ['EMEA', 'Strong, consistent growth', 1900000],
      ['APAC', 'Emerging "winner"', 1200000],
    ] },
  ]
  const out = await renderArtifact(spec, components, 'CSV')
  const text = out.buffer.toString('utf-8')
  assert.equal(out.buffer[0], 0xef, 'UTF-8 BOM for Excel (EF BB BF)')
  assert.equal(out.buffer[1], 0xbb)
  assert.equal(out.buffer[2], 0xbf)
  assert.ok(text.includes('"Strong, consistent growth"'), 'embedded comma quoted')
  assert.ok(text.includes('"Emerging ""winner"""'), 'embedded quotes doubled')
  assert.ok(out.filename.endsWith('.csv'))
})

test('§16/§17 TXT + HTML renderers produce clean structured output', async () => {
  const { renderArtifact } = loadEngine('@/services/document-renderer')
  const spec = testDocument()
  const comps = richComponents()
  const txt = await renderArtifact(spec, comps, 'TXT')
  const txtText = txt.buffer.toString('utf-8')
  assert.ok(txtText.includes('EXECUTIVE SUMMARY') || txtText.toUpperCase().includes('EXECUTIVE SUMMARY'), 'TXT has section headings')
  assert.ok(txtText.includes('•'), 'TXT renders bullets')
  const html = await renderArtifact(spec, comps, 'HTML')
  const htmlText = html.buffer.toString('utf-8')
  assert.ok(htmlText.includes('<!DOCTYPE html>'), 'HTML document')
  assert.ok(htmlText.includes('Executive Summary'), 'HTML carries sections')
  assert.ok(htmlText.includes('class="metric"'), 'HTML metric grid')
})

test('§10 prepareForRendering: canonical lowercase types — every vocabulary type has a renderer path', async () => {
  const { prepareForRendering } = loadEngine('@/services/document-renderer')
  const spec = testDocument()
  const prepared = prepareForRendering(spec, richComponents())
  const types = new Set(prepared.sections.flatMap((s) => s.components.map((c) => c.type)))
  for (const t of ['paragraph', 'heading', 'list', 'table', 'quote', 'metric_grid', 'callout', 'chart', 'timeline', 'key_takeaways', 'two_column']) {
    assert.ok(types.has(t) || t === 'list', `component path exists for "${t}"`)
  }
  // Casing bug fixed: UPPERCASE input no longer falls through to default.
  assert.ok(prepared.sections.some((s) => s.components.some((c) => c.type === 'metric_grid')), 'METRIC_GRID → metric_grid')
  assert.ok(prepared.sections.some((s) => s.components.some((c) => c.type === 'chart')), 'CHART → chart')
})

// ---------------------------------------------------------------------------
// §29/§30/§31 — STRUCTURAL QA + BOUNDED REPAIR (functional)
// ---------------------------------------------------------------------------
test('§29 QA validator catches placeholder text, empty sections, oversized tables, bad charts', () => {
  const qa = loadEngine('@/services/qa/structural')
  const spec = testDocument()
  spec.sections = [
    { id: 'a', type: 'content', title: 'Good section', order: 0, components: [] },
    { id: 'b', type: 'content', title: 'Empty section', order: 1, components: [] },
  ]
  spec.title = 'Untitled document' // generic title → error
  const components = [
    { sectionId: 'a', index: 0, type: 'PARAGRAPH', content: 'Solid professional paragraph with real substance.' },
    { sectionId: 'a', index: 1, type: 'PARAGRAPH', content: 'This section uses lorem ipsum placeholder text.' },
    { sectionId: 'a', index: 2, type: 'TABLE', content: [['h1', 'h2'], ['only header row data']] },
    { sectionId: 'a', index: 3, type: 'CHART', content: { chartType: 'bar', series: [{ data: ['no', 'numbers'] }] } },
  ]
  const report = qa.validateDocument(spec, components)
  assert.equal(report.passed, false)
  const issueTypes = report.issues.map((i) => i.type)
  assert.ok(issueTypes.includes('MISSING_TITLE'))
  assert.ok(issueTypes.includes('EMPTY_SECTION'))
  assert.ok(issueTypes.includes('PLACEHOLDER_CONTENT'))
  assert.ok(issueTypes.includes('INVALID_CHART_DATA'))
  assert.ok(report.checks.length >= 8, 'comprehensive check suite')
})

test('§30 bounded auto-repair: one deterministic pass, no AI, no loops', () => {
  const qa = loadEngine('@/services/qa/structural')
  const spec = testDocument()
  const longText = 'Revenue grew. '.repeat(600) // ~8400 chars > 6000 cap
  const components = [
    { sectionId: 's1', index: 0, type: 'PARAGRAPH', content: longText },
    { sectionId: 's1', index: 1, type: 'LIST', content: ['single item'] },
    { sectionId: 's2', index: 0, type: 'TABLE', content: [['header']] }, // header-only → dropped
  ]
  const report = qa.validateDocument(spec, components)
  const { components: repaired, report: repairedReport } = qa.autoRepair(spec, components, report)
  assert.ok(repairedReport.repaired >= 3, `repairs applied (${repairedReport.repaired})`)
  // Long paragraph split into chunks
  const paragraphs = repaired.filter((c) => c.type === 'PARAGRAPH')
  assert.ok(paragraphs.length >= 2, 'overlong paragraph split')
  assert.ok(paragraphs.every((p) => String(p.content).length <= 6100), 'all chunks within cap')
  // Single-item list became a paragraph
  assert.ok(!repaired.some((c) => c.type === 'LIST' && Array.isArray(c.content) && c.content.length === 1), 'tiny list converted')
  // Header-only table dropped
  assert.ok(!repaired.some((c) => c.type === 'TABLE' && Array.isArray(c.content) && c.content.length === 1), 'empty table removed')
})

test('§31 rendered-output validation gates signatures and sizes', () => {
  const qa = loadEngine('@/services/qa/structural')
  // Tiny buffer → fail
  assert.equal(qa.validateRenderedOutput(Buffer.alloc(100), 'PDF', 'application/pdf').ok, false)
  // Wrong signature → fail
  assert.equal(qa.validateRenderedOutput(Buffer.alloc(2048, 7), 'PDF', 'application/pdf').ok, false)
  // Valid PDF signature + sane size → pass
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)])
  assert.equal(qa.validateRenderedOutput(pdf, 'PDF', 'application/pdf').ok, true)
  // Suspicious mime → fail
  assert.equal(qa.validateRenderedOutput(pdf, 'PDF', 'application/json').ok, false)
})

// ---------------------------------------------------------------------------
// §44 — PROFESSIONAL FILENAMES (functional)
// ---------------------------------------------------------------------------
test('§44 professional filename generator: Snake_Case + year + sanitization', () => {
  const shared = loadEngine('@/services/renderers/shared')
  assert.equal(
    shared.buildArtifactFilename('Market Analysis Report', 'docx'),
    `Market_Analysis_Report_${new Date().getFullYear()}.docx`
  )
  assert.equal(shared.buildArtifactFilename('Q3: Business/Budget?', 'xlsx'), `Q3_Business_Budget_${new Date().getFullYear()}.xlsx`)
  assert.equal(shared.buildArtifactFilename('  Investor "Pitch" Deck  ', 'pptx'), `Investor_Pitch_Deck_${new Date().getFullYear()}.pptx`)
  assert.equal(shared.buildArtifactFilename('', 'pdf'), `Generated_Document_${new Date().getFullYear()}.pdf`)
  // No path traversal survives
  assert.ok(!shared.buildArtifactFilename('../../etc/passwd', 'txt').includes('/'))
})

// ---------------------------------------------------------------------------
// §45 + §27 — PIPELINE WIRING (source pins)
// ---------------------------------------------------------------------------
test('§45 versioned R2 keys: users/{uid}/artifacts/{aid}/v{n}/ with ownsObjectKey', () => {
  const client = read('src', 'lib', 'r2', 'client.ts')
  assert.match(client, /ownsObjectKey/, 'ownership helper exported')
  assert.match(
    client,
    /k\.startsWith\(`uploads\/\$\{userId\}\/`\) \|\| k\.startsWith\(`users\/\$\{userId\}\/`\)/,
    'both live key namespaces authorize'
  )
  const renderRoute = read('src', 'app', 'api', 'generation', 'render', 'route.ts')
  assert.match(renderRoute, /users\/\$\{userId\}\/artifacts\/\$\{artifactId\}\/v\$\{version\}/, 'render route uses versioned artifact keys')
  // Ownership checks updated in both file routes
  const download = read('src', 'app', 'api', 'files', '[fileId]', 'download', 'route.ts')
  assert.match(download, /ownsObjectKey/, 'download route authorizes both namespaces')
  const signed = read('src', 'app', 'api', 'files', 'signed-url', 'route.ts')
  assert.match(signed, /ownsObjectKey/, 'signed-url route authorizes both namespaces')
})

test('§27 versioning: convex schema + mutations + API routes wired', () => {
  const schema = read('convex', 'schema.ts')
  assert.match(schema, /artifactVersions: defineTable/, 'version table exists')
  assert.match(schema, /v\.number\(\), \/\/ 1-based, monotonically increasing per artifact/, 'version numbering documented')
  const artifacts = read('convex', 'artifacts.ts')
  for (const fn of ['saveArtifactVersion', 'listArtifactVersions', 'restoreArtifactVersion', 'getArtifactSourceJob']) {
    assert.ok(artifacts.includes(`export const ${fn}`), `${fn} mutation exists`)
  }
  assert.match(artifacts, /operation: "restore"/, 'restore is append-only history')
  // Routes
  const versionsRoute = read('src', 'app', 'api', 'artifacts', '[id]', 'versions', 'route.ts')
  assert.match(versionsRoute, /listArtifactVersions/, 'GET versions wired')
  assert.match(versionsRoute, /restoreArtifactVersion/, 'POST restore wired')
  // Render route records versions
  const renderRoute = read('src', 'app', 'api', 'generation', 'render', 'route.ts')
  assert.match(renderRoute, /saveArtifactVersion/, 'render route appends a version row')
  assert.match(renderRoute, /operation = job\.sourceArtifactId \? 'ai_edit' : 'generate'/, 'regeneration creates ai_edit versions')
})

test('§8 worker runs the two-stage pipeline: designer before architect', () => {
  const worker = read('convex', 'worker.ts')
  assert.match(worker, /buildDesignerSystemPrompt/, 'Stage A designer prompt imported')
  assert.match(worker, /designStage\(/, 'designer stage invoked')
  assert.match(worker, /applyDesignPlan/, 'design plan resolved into renderer tokens')
  assert.match(worker, /initializeUnits[\s\S]{0,400}designPlan/, 'design plan persisted with the blueprint')
  // Designer failure never fails the job (graceful degradation).
  assert.match(worker, /designer stage failed — using safe default design/, 'designer outage degrades to defaults')
  // Worker constraints preserved (phase 3 pins).
  assert.ok(!/ctx\.db\b/.test(worker), 'worker is still action-only (no ctx.db)')
  assert.match(worker, /aiRouter/, 'still uses the canonical aiRouter')
})

test('§21/§26 ingestion wired into the enqueue route with bounded context', () => {
  const route = read('src', 'app', 'api', 'artifacts', 'agent-generate', 'route.ts')
  assert.match(route, /ingestFile/, 'files are really ingested')
  assert.match(route, /buildSourceContext/, 'structured context built')
  assert.match(route, /sourceContext: sourceContext \|\| undefined/, 'context passed to the job')
  assert.match(route, /48_000/, 'context bounded below the 1MB Convex cap')
  assert.match(route, /ingestionWarnings/, 'per-file failures surfaced without blocking generation')
  // Schema + worker consume it
  const schema = read('convex', 'schema.ts')
  assert.match(schema, /sourceContext: v\.optional\(v\.string\(\)\)/, 'job schema carries the context')
  const worker = read('convex', 'worker.ts')
  assert.match(worker, /sourceContext/, 'worker threads the context into prompts')
})

test('§31 render route quality gates: QA before render, signature validation after', () => {
  const renderRoute = read('src', 'app', 'api', 'generation', 'render', 'route.ts')
  assert.match(renderRoute, /validateDocument/, 'pre-render structural QA')
  assert.match(renderRoute, /autoRepair/, 'bounded auto-repair pass')
  assert.match(renderRoute, /validateRenderedOutput/, 'post-render signature/size validation')
  assert.match(renderRoute, /DOCUMENT_VALIDATION_FAILED/, 'validation failure surfaces a real error code')
  assert.match(renderRoute, /qaReport: qaSummary/, 'QA summary stored with the version')
})

test('§42/§43 export/conversion route: matrix + version append + no AI spend', () => {
  const route = read('src', 'app', 'api', 'artifacts', '[id]', 'export', 'route.ts')
  assert.match(route, /EXPORT_MATRIX/, 'format matrix enforced server-side')
  assert.match(route, /UNSUPPORTED_FORMAT/, 'irrelevant formats rejected')
  assert.match(route, /operation: 'export'/, 'export recorded as a version')
  assert.match(route, /renderArtifact/, 're-renders the original semantic model')
  // UI exposes the same matrix
  const library = read('src', 'components', 'shared', 'artifact-library.tsx')
  assert.match(library, /EXPORT_FORMATS/, 'library shows format-aware export options')
  assert.match(library, /Version history/, 'version history UI present')
})

test('§41 quick-edit actions appear when files are attached', () => {
  // REBUILD v2: the create page was replaced by the chat workspace + the
  // unified Documents library. Quick-edit now lives in the library's
  // "Edit with AI" dialog.
  const page = read('src', 'components', 'shared', 'artifacts-workspace.tsx')
  assert.match(page, /QUICK_EDIT_ACTIONS/, 'action chips defined')
  for (const action of ['Rewrite', 'Improve', 'Redesign', 'Summarize', 'Expand', 'Convert', 'Fix grammar', 'Analyze']) {
    assert.ok(page.includes(`label: "${action}"`), `action "${action}" available`)
  }
})

test('§9 closed-world themes: planning prompts reference the registry, renderers consume tokens', () => {
  const planning = read('src', 'services', 'artifact-planning.ts')
  assert.match(planning, /metric_grid|callout|chart|timeline|key_takeaways|two_column/, 'component vocabulary documented in prompts')
  assert.match(planning, /DESIGN DIRECTION/, 'architect prompt carries the designer constraints')
  const shared = read('src', 'services', 'renderers', 'shared.ts')
  assert.match(shared, /deriveTheme/, 'renderers derive tokens from the theme registry')
  // formula instruction for spreadsheets (spec §15)
  assert.match(planning, /=SUM\(B2:B10\)/, 'XLSX formula guidance in content prompts')
})
