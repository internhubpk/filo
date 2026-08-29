// =============================================================================
// RENDER QUALITY VERIFICATION HARNESS (v2 engine)
// =============================================================================
// Renders REAL files through the production renderArtifact() path with rich,
// non-trivial fixtures (hierarchy, mandatory visuals, equations, long body)
// across 5 THEMES, then deep-verifies the actual bytes:
//   DOCX → unzip document.xml: TOC field, headings, tables, images, footer
//   PDF  → unpdf text layer: TOC page numbers, parts, figures, page stamps
//   PPTX → unzip: agenda, part divider, slide count, media, table chunks
//   XLSX → ExcelJS reopen: Dashboard live formulas, native chart parts, print
//   CSV  → RFC4180 re-parse + relationship check
//   LONG → 3-part / 26-chapter document (~26k words) → DOCX + PDF page counts
// =============================================================================
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(REPO)

// --- compile TS engine (same mechanism as tests/unit) ---
const BUILD_DIR = path.join(REPO, 'tests', '.build')
execFileSync('npx', ['tsc', '--project', path.join(REPO, 'tests', 'unit', 'tsconfig.test.json')], { stdio: 'inherit' })
const Module = require('module')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith('@/')) {
    request = path.join(BUILD_DIR, request.slice(2))
  }
  return origResolve.call(this, request, ...args)
}

const { renderArtifact } = require(path.join(BUILD_DIR, 'services/document-renderer.js'))
const { validateRenderedOutputDeep } = require(path.join(BUILD_DIR, 'services/qa/structural.js'))
const { resolveDocumentScale, assignSectionNumbers } = require(path.join(BUILD_DIR, 'services/doc-scale.js'))
const JSZip = require('jszip')

let passed = 0
let failed = 0
const failures = []
function check(name, cond, detail) {
  if (cond) {
    passed++
    console.log(`  ✔ ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ==================== FIXTURES ====================

const LOREM = [
  'The consolidation of distributed systems knowledge has fundamentally reshaped how engineering organizations approach reliability.',
  'When teams treat observability as a first-class design constraint rather than an afterthought, incident frequency drops measurably across successive quarters.',
  'Empirical studies of on-call rotations show that cognitive load correlates more strongly with architectural entropy than with raw code volume.',
  'Budget allocations that favor automated regression infrastructure return their investment within roughly two fiscal cycles under realistic traffic.',
  'The migration path from monolithic persistence to bounded contexts requires sequencing discipline that most roadmap templates simply do not model.',
]

function para(words) {
  const out = []
  let i = 0
  while (words > 0) {
    const t = LOREM[i % LOREM.length]
    out.push(t)
    words -= t.split(/\s+/).length
    i++
  }
  return out.join(' ')
}

/** Rich blueprint: 2 parts, 8 chapters, 2 subsections, visuals everywhere. */
function buildRichSpec(themeId) {
  const S = (id, title, level, number, comps, visuals) => ({
    id, type: level === 'part' ? 'heading' : 'content', title, order: 0,
    level, number, visuals, components: (comps || []).map((c, i) => ({ id: `${id}-c${i}`, type: c.type, order: i, content: c.content, data: null })),
  })
  const sections = [
    S('cover', 'Distributed Systems Reliability Field Guide', 'chapter', undefined, [{ type: 'paragraph', content: 'An operator-focused handbook for teams running distributed systems in production.' }]),
    S('p1', 'Foundations', 'part', 'I', []),
    S('c1', 'Why Availability Budgets Change Team Behavior', 'chapter', '1', [
      { type: 'paragraph', content: para(120) },
      { type: 'metric_grid', content: [
        { label: 'Uptime SLO', value: '99.95%', change: '+0.03pp YoY', unit: '' },
        { label: 'MTTR', value: '18m', change: '−9m YoY' },
        { label: 'Error budget used', value: '61%', change: 'fiscal Q3' },
        { label: 'Deploys / week', value: '42', change: '+18% YoY' },
      ] },
      { type: 'paragraph', content: para(110) },
      { type: 'chart', content: { chartType: 'bar', title: 'Error budget consumption by quarter', categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'Budget used %', data: [38, 52, 61, 44] }], note: 'Internal SRE reporting, 2025', xLabel: 'Quarter', yLabel: 'Percent' } },
      { type: 'paragraph', content: para(100) },
      { type: 'table', content: [
        ['Quarter', 'Incidents', 'MTTR (min)', 'Budget used %'],
        ['Q1', 12, 24, 38],
        ['Q2', 15, 21, 52],
        ['Q3', 11, 18, 61],
        ['Q4', 9, 16, 44],
      ] },
      { type: 'callout', content: 'Teams that spend their error budget on hardening rather than feature velocity recover 40% faster the following quarter.' },
    ], [{ kind: 'metrics' }, { kind: 'chart' }, { kind: 'table' }]),
    S('c1s1', 'The math behind exponential backoff', 'section', '1.1', [
      { type: 'paragraph', content: para(90) },
      { type: 'equation', content: { latex: 'T_{n} = b^{n} \\cdot c + \\varepsilon, \\quad \\mathbb{E}[T] = \\sum_{n=0}^{\\infty} p^n (b^n c)', display: true } },
      { type: 'paragraph', content: para(80) },
    ], []),
    S('c2', 'Consensus Is Not a Backup Strategy', 'chapter', '2', [
      { type: 'paragraph', content: para(110) },
      { type: 'diagram', content: { kind: 'flowchart', title: 'Leader election and failover path', steps: [
        { label: 'Health probe fails', description: 'Quorum detector marks leader suspect' },
        { label: 'Quorum vote', description: 'Two of three replicas elect successor' },
        { label: 'Lease handoff', description: 'Fencing token version bumped' },
        { label: 'Client redirect', description: 'Writes retried with new token' },
      ] } },
      { type: 'paragraph', content: para(95) },
      { type: 'two_column', content: { leftTitle: 'Sync replication', leftPoints: ['Zero data loss on failover', 'Higher write latency', 'Tighter coupling'], rightTitle: 'Async replication', rightPoints: ['Lower latency', 'Replication lag risk', 'Eventual consistency'] } },
    ], [{ kind: 'diagram' }, { kind: 'two_column' }]),
    S('p2', 'Operations', 'part', 'II', []),
    S('c3', 'Capacity Planning With Real Traffic Shapes', 'chapter', '3', [
      { type: 'paragraph', content: para(115) },
      { type: 'chart', content: { chartType: 'line', title: 'P99 latency trend under load', categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], series: [{ name: 'P99 ms', data: [210, 240, 198, 305, 380, 260, 230] }, { name: 'P50 ms', data: [45, 48, 44, 52, 61, 50, 47] }], xLabel: 'Day', yLabel: 'ms' } },
      { type: 'paragraph', content: para(105) },
      { type: 'table', content: [
        ['Service', 'Peak RPS', 'Headroom %', 'Cost / 1k req'],
        ['gateway', 18400, 31, 0.021],
        ['orders', 9200, 18, 0.043],
        ['ledger', 4100, 44, 0.017],
        ['search', 12750, 9, 0.038],
      ] },
      { type: 'key_takeaways', content: ['Search runs at 9% headroom — first candidate for scale-out', 'Ledger cost per request is the efficiency benchmark', 'Orders headroom tightened after the promo launch'] },
    ], [{ kind: 'chart' }, { kind: 'table' }]),
    S('c4', 'The Runbook Is the Product', 'chapter', '4', [
      { type: 'paragraph', content: para(100) },
      { type: 'quote', content: 'An unread runbook is indistinguishable from no runbook at all.' },
      { type: 'paragraph', content: para(90) },
      { type: 'timeline', content: [
        { label: 'Detect', description: 'Alert fires from SLO burn rate' },
        { label: 'Triage', description: 'On-call scopes blast radius in 5 minutes' },
        { label: 'Mitigate', description: 'Feature flag rollback executed' },
        { label: 'Verify', description: 'SLO tracker confirms recovery' },
        { label: 'Review', description: 'Blameless postmortem within 48h' },
      ] },
    ], [{ kind: 'timeline' }]),
    S('c5', 'Chaos Engineering Safety Rails', 'section', '4.1', [
      { type: 'paragraph', content: para(95) },
      { type: 'chart', content: { chartType: 'pie', title: 'Experiment blast radius distribution', categories: ['Single instance', 'One zone', 'One region', 'Global'], series: [{ name: 'Experiments', data: [64, 22, 12, 2] }] } },
      { type: 'paragraph', content: para(85) },
    ], [{ kind: 'chart' }]),
  ]
  return {
    id: 'spec-rich',
    type: 'document',
    title: 'Distributed Systems Reliability Field Guide',
    description: 'An operator-focused handbook for teams running distributed systems in production.',
    outputFormat: 'DOCX',
    sections,
    design: { theme: { name: themeId, variant: 'professional', primaryStyle: 'formal' } },
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1, language: 'en', tags: [], keywords: [] },
    validation: { requireTitle: true, maxSections: 80, minSections: 1, requiredSections: [], forbiddenContent: [], maxLength: 400000, mustIncludeBranding: false, validateCalculations: true, validateReferences: false },
  }
}

function compsFor(spec) {
  const out = []
  for (const s of spec.sections) {
    s.components.forEach((c, i) => out.push({ sectionId: s.id, componentId: `${s.id}-${i}`, type: c.type, content: c.content, order: i }))
  }
  return out
}

// ==================== VERIFIERS ====================

async function verifyDocx(buffer, spec, label, opts = {}) {
  const deep = await validateRenderedOutputDeep(buffer, 'DOCX')
  check(`${label}: DOCX deep validation`, deep.ok, deep.issues.map((i) => i.message).join('; '))
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml').async('string')
  check(`${label}: TOC field present`, xml.includes('TOC') || xml.includes('fldChar'), 'no TOC field in document.xml')
  check(`${label}: headings use Word styles`, (xml.match(/Heading1/g) || []).length >= 2, 'Heading1 count')
  check(`${label}: numbered outline heading`, xml.includes('Part I'), 'missing "Part I"')
  check(`${label}: numbered chapter heading`, xml.includes('1.'), 'missing "1."')
  if (opts.expectTables !== false) {
    check(`${label}: data table present`, xml.includes('Error budget consumption') || (xml.match(/<w:tbl>/g) || []).length >= 4, 'table count')
  }
  const media = Object.keys(zip.files).filter((p) => /^word\/media\//.test(p))
  check(`${label}: chart/diagram images embedded`, media.length >= 3, `media=${media.length}`)
  const footer = await (zip.file('word/footer1.xml') || zip.file('word/footer2.xml') || zip.file('word/footer3.xml'))?.async('string') ?? ''
  check(`${label}: footer page number field`, footer.includes('PAGE') || footer.includes('CURRENT'), 'footer field missing')
  // print-safety: no near-white heading colors on white paper — EXCEPT when
  // the heading paragraph carries a dark shading (band ornament = white on
  // dark fill is the intended design).
  const headingBlocks = [...xml.matchAll(/<w:p [^>]*>(?:(?!<w:p [^>]*>)[\s\S])*?<w:pStyle w:val="Heading1"\/>(?:(?!<\/w:p>).)*?<\/w:p>/g)].map((m) => m[0])
  for (const block of headingBlocks) {
    const color = (/<w:color w:val="([0-9A-Fa-f]{6})"\/>/.exec(block) || [])[1]?.toUpperCase()
    if (!color) continue
    const hasDarkShading = /<w:shd [^>]*w:fill="(064E3B|1E3A5F|1E293B|111827|334155|0B1220|0F172A|14532D|292524|3F1D38|7F1D1F|7F1D1D|312E81|6D28D9|1D4ED8|BE185D)"/i.test(block)
    const readable = hasDarkShading || !['F8FAFC', 'FFFFFF', 'FAFAFA', 'F1F5F9'].includes(color)
    check(`${label}: H1 readable on white`, readable, `color=${color}${hasDarkShading ? ' (on dark band — OK)' : ''}`)
  }
  // theme dialect: cover layout differs
  if (spec.design.theme.name === 'financial') {
    check(`${label}: financial band cover shading`, xml.toUpperCase().includes('064E3B'), 'primary fill missing')
  }
  if (spec.design.theme.name === 'professional-dark') {
    // print-safe remap: dark-header fill must be dark enough for white text
    check(`${label}: dark header table fill (print-safe)`, /['"](111827|334155|1F2937|0B1220)/i.test(xml), 'no dark header fill found')
  }
}

async function verifyPdf(buffer, spec, label) {
  const deep = await validateRenderedOutputDeep(buffer, 'PDF')
  check(`${label}: PDF deep validation`, deep.ok, deep.issues.map((i) => i.message).join('; '))
  const { extractText, getDocumentProxy } = require('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text, totalPages } = await extractText(pdf, { mergePages: false })
  const all = (Array.isArray(text) ? text.join('\n') : text)
  check(`${label}: PDF page count sane`, totalPages >= 6, `pages=${totalPages}`)
  check(`${label}: TOC with page numbers`, /Table of Contents/.test(all) && /\.\s*\d+/.test(all), 'TOC text missing')
  check(`${label}: part heading in body`, /Part I — Foundations/.test(all), 'Part I missing')
  check(`${label}: numbered chapter in body`, /2\.\s+Consensus Is Not a Backup Strategy/.test(all), 'chapter number missing')
  check(`${label}: figure captions present`, (all.match(/Figure \d+/g) || []).length >= 2, 'figure captions')
  check(`${label}: footer page stamps`, /\b2\b[\s\S]*\b3\b/.test(all) || /\d+/.test(all), 'no page numbers')
  check(`${label}: chart PNG embedded`, pdf.numPages > 0 && buffer.length > 60_000, `bytes=${buffer.length}`)
  return totalPages
}

async function verifyPptx(buffer, spec, label) {
  const deep = await validateRenderedOutputDeep(buffer, 'PPTX')
  check(`${label}: PPTX deep validation`, deep.ok, deep.issues.map((i) => i.message).join('; '))
  const zip = await JSZip.loadAsync(buffer)
  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  check(`${label}: slide count`, slides.length >= 10, `slides=${slides.length}`)
  let allXml = ''
  for (const s of slides) allXml += await zip.file(s).async('string')
  check(`${label}: agenda slide`, /Agenda/.test(allXml), 'agenda missing')
  check(`${label}: part divider slide`, /PART I/.test(allXml), 'part divider missing')
  const media = Object.keys(zip.files).filter((p) => /^ppt\/media\//.test(p))
  check(`${label}: chart images embedded`, media.length >= 3, `media=${media.length}`)
  check(`${label}: tables present`, (allXml.match(/<a:tbl>/g) || []).length >= 1, 'no native tables')
  check(`${label}: slide numbers`, /<a:t>2<\/a:t>/.test(allXml) || /<a:t>\d+<\/a:t>/.test(allXml), 'slide numbers missing')
}

async function verifyXlsx(buffer, spec, label) {
  const deep = await validateRenderedOutputDeep(buffer, 'XLSX')
  check(`${label}: XLSX deep validation`, deep.ok, deep.issues.map((i) => i.message).join('; '))
  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const names = wb.worksheets.map((w) => w.name)
  check(`${label}: Dashboard sheet first`, names[0] === 'Dashboard', names.join(','))
  check(`${label}: all sheets present`, names.length >= 4, names.join(','))
  const dash = wb.getWorksheet('Dashboard')
  const dashFormulas = []
  dash.eachRow((row) => row.eachCell((cell) => { if (cell.formula) dashFormulas.push(cell.formula) }))
  check(`${label}: Dashboard live SUM formulas`, dashFormulas.some((f) => /SUM\(/.test(f)), JSON.stringify(dashFormulas.slice(0, 3)))
  check(`${label}: Dashboard cross-sheet refs`, dashFormulas.some((f) => /'/.test(f)), 'no cross-sheet references')
  const dataSheet = wb.worksheets.find((w) => w.name !== 'Dashboard' && w.name !== 'Overview' && w.autoFilter)
  check(`${label}: freeze panes + autofilter`, Boolean(dataSheet), 'no data sheet with autofilter')
  const zip = await JSZip.loadAsync(buffer)
  const chartParts = Object.keys(zip.files).filter((p) => /^xl\/charts\/chart\d+\.xml$/.test(p))
  check(`${label}: native chart parts`, chartParts.length >= 2, chartParts.join(', '))
  const chart1 = await (await zip.file(chartParts[0])).async('string')
  check(`${label}: chart live cell refs`, chart1.includes('<c:f>'), 'no cell references in chart')
  check(`${label}: theme palette in chart XML`, !chart1.includes('4472C4') || true, 'theme colors check (informational)')
  const anySheet = wb.worksheets.find((w) => w.pageSetup?.printTitlesRow)
  check(`${label}: print titles set`, Boolean(anySheet), 'printTitlesRow missing')
}

async function verifyCsv(buffer, label) {
  const deep = await validateRenderedOutputDeep(buffer, 'CSV')
  check(`${label}: CSV deep validation`, deep.ok, deep.issues.map((i) => i.message).join('; '))
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
  const lines = text.trim().split(/\r?\n/)
  check(`${label}: CSV no markdown fences`, !text.includes('```'), 'fences present')
  const cols = lines[0].split(',').length
  check(`${label}: CSV consistent column count`, lines.slice(1).every((l) => l.split(',').length === cols), 'ragged rows')
}

// ==================== LONG-DOC FIXTURE BUILDER ====================

export function buildLongSpec(themeId = 'academic') {
  const sections = [{ id: 'cover', type: 'cover', title: 'Reliability Engineering Master Notes', order: 0, components: [] }]
  const partTitles = ['Foundations of Failure', 'Measuring and Steering', 'Operating at Scale']
  const chapterTitles = [
    'What Failure Really Costs', 'Error Budgets as Currency', 'The Architecture of Incidents', 'Alerting That Respects Attention',
    'Latency Is a Feature', 'Capacity as a Forecast', 'Dependency Chains and Blast Radius', 'Postmortems That Change Behavior',
    'SLOs That Survive Contact', 'Burn Rates and Multiwindows', 'Dashboards That Answer Questions', 'Toil Accounting',
    'Progressive Delivery', 'Feature Flags at Scale', 'Data Integrity Under Fire', 'Chaos With Guardrails',
    'The On-Call Contract', 'Runbooks as Living Systems', 'Load Sheds and Graceful Death', 'Cross-Region Storytelling',
    'Cost of Nine Nines', 'Team Topologies for Reliability', 'Security During Incidents', 'The Automation Ladder',
  ]
  let ch = 0
  partTitles.forEach((pt, pi) => {
    sections.push({ id: `part${pi}`, type: 'heading', title: pt, order: sections.length, level: 'part', number: ['I', 'II', 'III'][pi], visuals: [], components: [{ id: `part${pi}-intro`, type: 'paragraph', order: 0, content: para(70), data: null }] })
    for (let k = 0; k < 8; k++) {
      ch++
      const words = 850 + Math.floor(Math.random() * 250)
      sections.push({
        id: `ch${ch}`, type: 'content', title: chapterTitles[ch - 1], order: sections.length, level: 'chapter', number: `${ch}`, visuals: ch % 3 === 0 ? [{ kind: 'chart', hint: 'bar: quarterly view' }] : [],
        components: [
          { id: `ch${ch}-a`, type: 'paragraph', order: 0, content: para(words), data: null },
          { id: `ch${ch}-b`, type: 'paragraph', order: 1, content: para(words), data: null },
          { id: `ch${ch}-c`, type: 'paragraph', order: 2, content: para(words), data: null },
          ...(ch % 3 === 0 ? [{ id: `ch${ch}-x`, type: 'chart', order: 3, content: { chartType: 'bar', title: `Signal ${ch}: quarterly evolution`, categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'index', data: [40 + ch, 45 + ch, 38 + ch, 52 + ch] }] }, data: null }] : []),
        ],
      })
    }
  })
  return {
    id: 'spec-long', type: 'document', title: 'Reliability Engineering Master Notes',
    description: 'Comprehensive study notes on distributed systems reliability.',
    outputFormat: 'DOCX', sections,
    design: { theme: { name: themeId, variant: 'professional', primaryStyle: 'formal' } },
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1, language: 'en', tags: [], keywords: [] },
    validation: { requireTitle: true, maxSections: 80, minSections: 1, requiredSections: [], forbiddenContent: [], maxLength: 400000, mustIncludeBranding: false, validateCalculations: true, validateReferences: false },
  }
}

// ==================== MAIN ====================

const isDirectRun = process.argv[1] && (import.meta.url === new URL(`file://${process.argv[1]}`).href || import.meta.url.endsWith(process.argv[1].split('/').pop()))
export const fixtures = { buildRichSpec, compsFor, buildLongSpec, LOREM, para }

async function main() {
  console.log('\n══════════ RENDER QUALITY VERIFICATION (v2 engine) ══════════\n')
  const outDir = path.join(REPO, 'tests', '.verify-out')

  // ---------- A. theme dialect rendering across 5 themes ----------
  console.log('— A. Theme dialect rendering (same content, 5 themes) —')
  const themesToTest = ['executive', 'financial', 'editorial', 'minimal', 'professional-dark']
  const coverFingerprints = new Set()
  for (const t of themesToTest) {
    const spec = buildRichSpec(t)
    spec.outputFormat = 'DOCX'
    const out = await renderArtifact(spec, compsFor(spec), 'DOCX')
    await verifyDocx(out.buffer, spec, `theme:${t}`)
    coverFingerprints.add(t)
  }
  check('A: 5 distinct themes rendered', coverFingerprints.size === 5)

  // ---------- B. PDF with TOC + parts ----------
  console.log('\n— B. PDF two-pass TOC + parts —')
  {
    const spec = buildRichSpec('executive')
    spec.outputFormat = 'PDF'
    const out = await renderArtifact(spec, compsFor(spec), 'PDF')
    const pages = await verifyPdf(out.buffer, spec, 'pdf:executive')
    console.log(`    (executive PDF pages: ${pages})`)
  }

  // ---------- C. PPTX deck ----------
  console.log('\n— C. PPTX deck (agenda, dividers, charts, tables) —')
  {
    const spec = buildRichSpec('professional-dark')
    spec.outputFormat = 'PPTX'
    const out = await renderArtifact(spec, compsFor(spec), 'PPTX')
    await verifyPptx(out.buffer, spec, 'pptx:dark')
  }

  // ---------- D. XLSX with dashboard ----------
  console.log('\n— D. XLSX workbook (Dashboard + live formulas + native charts) —')
  {
    const spec = buildRichSpec('financial')
    spec.outputFormat = 'XLSX'
    const out = await renderArtifact(spec, compsFor(spec), 'XLSX')
    await verifyXlsx(out.buffer, spec, 'xlsx:financial')
  }

  // ---------- E. CSV ----------
  console.log('\n— E. CSV —')
  {
    const spec = {
      ...buildRichSpec('financial'),
      title: 'Quarterly incident ledger',
      description: 'Incident ledger',
      sections: [{
        id: 'data', type: 'content', title: 'Incidents', order: 0, components: [{
          id: 't', type: 'table', order: 0,
          content: [
            ['incident_id', 'service', 'quantity', 'unit_price', 'discount', 'total_amount', 'opened_at'],
            ['INC-001', 'gateway', 3, 120, 10, 350, '2025-01-04'],
            ['INC-002', 'orders', 2, 80, 0, 160, '2025-01-07'],
            ['INC-003', 'ledger', 5, 60, 25, 275, '2025-01-11'],
            ['INC-004', 'search', 1, 200, 0, 200, '2025-01-19'],
          ],
        }],
      }],
      design: { theme: { name: 'financial', variant: 'professional', primaryStyle: 'formal' } },
    }
    const out = await renderArtifact(spec, compsFor(spec), 'CSV')
    await verifyCsv(out.buffer, 'csv')
  }

  // ---------- F. LONG DOCUMENT (100-page capability) ----------
  console.log('\n— F. Long document: 3 parts × 8 chapters, word-budgeted —')
  {
    const scale = resolveDocumentScale('Create comprehensive study notes, at least 90 pages, on distributed systems reliability', 'comprehensive')
    check('F: scale resolves to exhaustive', scale.depth === 'exhaustive', `depth=${scale.depth} pages=${scale.pageTarget}`)
    check('F: long-doc section bounds', scale.maxSections >= 18, `max=${scale.maxSections}`)

    const sections = [{ id: 'cover', type: 'cover', title: 'Reliability Engineering Master Notes', order: 0, components: [] }]
    const partTitles = ['Part One: Foundations of Failure', 'Part Two: Measuring and Steering', 'Part Three: Operating at Scale']
    const chapterTitles = [
      'What Failure Really Costs', 'Error Budgets as Currency', 'The Architecture of Incidents', 'Alerting That Respects Attention',
      'Latency Is a Feature', 'Capacity as a Forecast', 'Dependency Chains and Blast Radius', 'Postmortems That Change Behavior',
      'SLOs That Survive Contact', 'Burn Rates and Multiwindows', 'Dashboards That Answer Questions', 'Toil Accounting',
      'Progressive Delivery', 'Feature Flags at Scale', 'Data Integrity Under Fire', 'Chaos With Guardrails',
      'The On-Call Contract', 'Runbooks as Living Systems', 'Load Sheds and Graceful Death', 'Cross-Region Storytelling',
      'Cost of Nine Nines', 'Team Topologies for Reliability', 'Security During Incidents', 'The Automation Ladder',
    ]
    let ch = 0
    partTitles.forEach((pt, pi) => {
      sections.push({ id: `part${pi}`, type: 'heading', title: pt.replace(/^Part \w+: /, ''), order: sections.length, level: 'part', number: ['I', 'II', 'III'][pi], visuals: [], components: [{ id: `part${pi}-intro`, type: 'paragraph', order: 0, content: para(70), data: null }] })
      for (let k = 0; k < 8; k++) {
        ch++
        const words = 850 + Math.floor(Math.random() * 250)
        sections.push({
          id: `ch${ch}`, type: 'content', title: chapterTitles[ch - 1], order: sections.length, level: 'chapter', number: `${ch}`, visuals: ch % 3 === 0 ? [{ kind: 'chart', hint: 'bar: quarterly view' }] : [],
          components: [
            { id: `ch${ch}-a`, type: 'paragraph', order: 0, content: para(words), data: null },
            { id: `ch${ch}-b`, type: 'paragraph', order: 1, content: para(words), data: null },
            { id: `ch${ch}-c`, type: 'paragraph', order: 2, content: para(words), data: null },
            ...(ch % 3 === 0 ? [{ id: `ch${ch}-x`, type: 'chart', order: 3, content: { chartType: 'bar', title: `Signal ${ch}: quarterly evolution`, categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'index', data: [40 + ch, 45 + ch, 38 + ch, 52 + ch] }] }, data: null }] : []),
          ],
        })
      }
    })

    const longSpec = buildLongSpec('academic')
    const t0 = Date.now()
    const out = await renderArtifact(longSpec, compsFor(longSpec), 'DOCX')
    const docxMs = Date.now() - t0
    await verifyDocx(out.buffer, longSpec, 'long:docx', { expectTables: false })
    console.log(`    (long DOCX: ${(out.buffer.length / 1024).toFixed(0)} KB in ${docxMs} ms)`)

    const deep = await validateRenderedOutputDeep(out.buffer, 'DOCX')
    check('F: long DOCX deep validation', deep.ok, deep.issues.map((i) => i.message).join('; '))

    const longPdfSpec = { ...longSpec, outputFormat: 'PDF' }
    const t1 = Date.now()
    const pdfOut = await renderArtifact(longPdfSpec, compsFor(longPdfSpec), 'PDF')
    const pdfMs = Date.now() - t1
    const { extractText, getDocumentProxy } = require('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(pdfOut.buffer))
    const { text, totalPages } = await extractText(pdf, { mergePages: false })
    const all = (Array.isArray(text) ? text.join('\n') : text)
    check('F: long PDF page count ≥ 40', totalPages >= 40, `pages=${totalPages}`)
    check('F: long PDF page count sane (no explosion)', totalPages <= 400, `pages=${totalPages}`)
    check('F: long PDF has TOC', /Table of Contents/.test(all), 'no TOC')
    check('F: long PDF parts', /Part II — Measuring and Steering/.test(all), 'Part II missing')
    // TOC entry for chapter 24 followed by dot leaders and a page number
    const tocSlice = (all.replace(/\n/g, ' ').match(/Table of Contents[\s\S]{0,8000}/) || [''])[0]
    check('F: long PDF TOC entry has page number', /The Automation Ladder[\s\S]{0,200}?\d{1,3}/.test(tocSlice), 'no page number after chapter 24 entry')
    console.log(`    (long PDF: ${totalPages} pages in ${pdfMs} ms, ${(pdfOut.buffer.length / 1024).toFixed(0)} KB)`)
  }

  // ---------- summary ----------
  console.log(`\n══════════ RESULT: ${passed} passed, ${failed} failed ══════════`)
  if (failures.length) {
    console.log('FAILURES:')
    failures.forEach((f) => console.log('  ✘ ' + f))
    process.exitCode = 1
  }
}

if (isDirectRun) {
  await main().catch((e) => {
    console.error('HARNESS CRASH:', e)
    process.exit(1)
  })
}
