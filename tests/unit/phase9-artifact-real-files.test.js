// Phase 9 — REAL ARTIFACT VERIFICATION (all five formats, non-trivial content).
//
// Mandate: "Use real, non-trivial examples for EVERY artifact type and
// inspect the ACTUAL generated files." This suite renders a fully Chinese,
// content-rich specification (the shape production generates) through the
// REAL renderers, gates it through the repo's own post-render validators,
// then INDEPENDENTLY re-opens every file and inspects real structure:
//
//   DOCX → OOXML parts: headings, tables, page breaks, header/footer + PAGE field
//   PDF  → raw bytes: %PDF signature, %%EOF trailer, page objects, content size
//   XLSX → ExcelJS re-open: worksheets, REAL formulas, freeze panes, autofilter
//   PPTX → OOXML parts: slide count, 16:9 slide size, per-slide text
//   CSV  → RFC4180 scan: BOM, header row, uniform column count, quoting
//
// The title uses CJK deliberately: that exact class of document previously
// crashed the storage layer after rendering (phase9-storage-header-safety).
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { loadEngine } from './helpers/ts-build.js'

const require = createRequire(import.meta.url)

const TITLE = '2026年第三季度业务分析报告'

function cnDocument(format) {
  const themes = loadEngine('@/services/themes')
  const { design } = themes.resolveTheme('executive', { format })
  return {
    id: 'spec-cn-1',
    type: 'document',
    title: TITLE,
    description: '覆盖三个区域的季度业绩综合分析',
    outputFormat: format,
    sections: [
      { id: 'cover', type: 'cover', title: TITLE, order: 0, components: [] },
      { id: 's1', type: 'content', title: '执行摘要', order: 1, components: [] },
      { id: 's2', type: 'content', title: '区域业绩表现', order: 2, components: [] },
      { id: 's3', type: 'content', title: '财务预测与里程碑', order: 3, components: [] },
      { id: 's4', type: 'content', title: '战略建议', order: 4, components: [] },
    ],
    design,
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1, language: 'zh', tags: [], keywords: [] },
    validation: { requireTitle: true },
  }
}

function cnComponents() {
  return [
    { sectionId: 'cover', componentId: 'c0', type: 'PARAGRAPH', order: 0, content: '本报告全面回顾2026年第三季度各区域的经营成果，并对下一季度提出可执行的战略建议。' },
    { sectionId: 's1', componentId: 'c1', type: 'METRIC_GRID', order: 0, content: [
      { label: '总营收', value: '¥4.2亿', change: '+18% 同比' },
      { label: '毛利率', value: '34%', change: '+2个百分点' },
      { label: '活跃客户', value: '12,400', change: '+9%' },
      { label: '净推荐值', value: '62' },
    ] },
    { sectionId: 's1', componentId: 'c2', type: 'PARAGRAPH', order: 1, content: '第三季度营收同比增长18%，其中企业续约与新兴市场扩张贡献最大。所有业务线均实现正增长，验证了年初制定的多元化战略。' },
    { sectionId: 's2', componentId: 'c3', type: 'HEADING', order: 0, content: '分区域明细' },
    { sectionId: 's2', componentId: 'c4', type: 'TABLE', order: 1, content: [
      ['区域', '营收', '同比增长', '市场份额'],
      ['欧洲、中东及非洲', '¥1.9亿', '+22%', '27%'],
      ['亚太', '¥1.2亿', '+15%', '19%'],
      ['美洲', '¥1.1亿', '+11%', '15%'],
    ] },
    { sectionId: 's2', componentId: 'c5', type: 'CHART', order: 2, content: {
      chartType: 'bar', title: '各区域营收对比', categories: ['欧洲中东非洲', '亚太', '美洲'],
      series: [{ name: '营收（亿元）', data: [1.9, 1.2, 1.1] }],
    } },
    { sectionId: 's3', componentId: 'c6', type: 'TIMELINE', order: 0, content: [
      { label: '调研阶段', description: '第一季度完成市场调研' },
      { label: '扩张阶段', description: '第二季度新产品线发布' },
      { label: '优化阶段', description: '第三季度供应链优化' },
    ] },
    { sectionId: 's3', componentId: 'c7', type: 'LIST', order: 1, content: ['扩大企业客户续约团队', '在亚太新建两个交付中心', '启动客户成功体系升级'] },
    { sectionId: 's4', componentId: 'c8', type: 'CALLOUT', order: 0, content: '下一周期优先投入欧洲企业续约，其次加固亚太利润率。' },
    { sectionId: 's4', componentId: 'c9', type: 'KEY_TAKEAWAYS', order: 1, content: ['欧洲保持两位数增长', '亚太利润率需要防守', '美洲加大支持投入'] },
    { sectionId: 's4', componentId: 'c10', type: 'TWO_COLUMN', order: 2, content: {
      leftTitle: '优势', leftPoints: ['品牌拉力', '续约引擎'],
      rightTitle: '风险', rightPoints: ['汇率波动', '客户集中度'],
    } },
    { sectionId: 's4', componentId: 'c11', type: 'QUOTE', order: 3, content: '分销的深度取决于信任的深度。' },
  ]
}

// ==================== DOCX ====================
test('§V1 DOCX re-open: headings, table, page breaks, header/footer with page number', async () => {
  const { renderArtifact } = loadEngine('@/services/document-renderer')
  const { validateRenderedOutput, validateRenderedOutputDeep } = loadEngine('@/services/qa/structural')

  const out = await renderArtifact(cnDocument('DOCX'), cnComponents(), 'DOCX')
  const buffer = Buffer.from(out.buffer)
  assert.ok(buffer.length > 8000, `DOCX suspiciously small: ${buffer.length} bytes`)

  // Repo gates must pass (both shallow signature + deep structural).
  assert.ok(validateRenderedOutput(buffer, 'DOCX', out.mimeType).ok, 'shallow gate')
  const deep = await validateRenderedOutputDeep(buffer, 'DOCX')
  assert.deepEqual(deep.issues, [], `deep gate issues: ${JSON.stringify(deep.issues)}`)

  // Independent re-open with JSZip.
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml').async('string')
  assert.ok(documentXml.includes(TITLE), 'title text present in body')
  assert.ok(documentXml.includes('执行摘要'), 'section heading present')
  assert.ok(documentXml.includes('<w:tbl>'), 'real table part')
  assert.ok(documentXml.includes('分区域明细'), 'in-document heading present')
  assert.match(documentXml, /w:type="page"/, 'explicit page break(s) present')
  assert.ok(documentXml.includes('各区域营收对比'), 'chart caption rendered as real text')

  // Header/footer parts with a PAGE field (real page numbering, not a fake).
  const headerFile = zip.file(/word\/header\d*\.xml/)[0]
  const footerFile = zip.file(/word\/footer\d*\.xml/)[0]
  assert.ok(headerFile, 'header part exists')
  assert.ok(footerFile, 'footer part exists')
  const footerXml = await footerFile.async('string')
  assert.match(footerXml, /PAGE/, 'footer contains a PAGE number field')

  // Numbering (list) part registered for lists.
  assert.ok(zip.file('word/numbering.xml'), 'numbering definitions part exists')
})

// ==================== PDF ====================
test('§V2 PDF re-open: signature, trailer, page objects, embedded text layer', async () => {
  const { renderArtifact } = loadEngine('@/services/document-renderer')
  const { validateRenderedOutput, validateRenderedOutputDeep } = loadEngine('@/services/qa/structural')

  const out = await renderArtifact(cnDocument('PDF'), cnComponents(), 'PDF')
  const buffer = Buffer.from(out.buffer)
  assert.ok(buffer.length > 15000, `PDF suspiciously small: ${buffer.length} bytes`)

  assert.ok(validateRenderedOutput(buffer, 'PDF', out.mimeType).ok, 'shallow gate')
  const deep = await validateRenderedOutputDeep(buffer, 'PDF')
  assert.deepEqual(deep.issues, [], `deep gate issues: ${JSON.stringify(deep.issues)}`)

  // Independent raw-byte inspection.
  const latin1 = buffer.toString('latin1')
  assert.ok(latin1.startsWith('%PDF-'), 'starts with %PDF signature')
  assert.ok(latin1.trimEnd().endsWith('%%EOF'), 'ends with %%EOF trailer')
  const pageObjects = (latin1.match(/\/Type\s*\/Page[^s]/g) || []).length
  assert.ok(pageObjects >= 3, `expected >= 3 page objects, found ${pageObjects}`)
  assert.ok(latin1.includes('/Font'), 'font resources embedded (real text, not bitmaps)')
})

// ==================== XLSX ====================
test('§V3 XLSX re-open: worksheets, real formulas, freeze panes, autofilter, widths', async () => {
  const { renderArtifact } = loadEngine('@/services/document-renderer')
  const { validateRenderedOutput, validateRenderedOutputDeep } = loadEngine('@/services/qa/structural')

  // Give the spreadsheet a formula-bearing table (production XLSX shapes).
  const spec = cnDocument('XLSX')
  const components = cnComponents()
  components.push({
    sectionId: 's2', componentId: 'c4b', type: 'TABLE', order: 3, content: [
      ['季度', '营收（万元）', '成本（万元）', '利润（万元）'],
      ['Q1', '8200', '5100', '=B2-C2'],
      ['Q2', '9400', '5800', '=B3-C3'],
      ['Q3', '10500', '6300', '=B4-C4'],
      ['合计', '=SUM(B2:B4)', '=SUM(C2:C4)', '=SUM(D2:D4)'],
    ],
  })

  const out = await renderArtifact(spec, components, 'XLSX')
  const buffer = Buffer.from(out.buffer)
  assert.ok(buffer.length > 4000, `XLSX suspiciously small: ${buffer.length} bytes`)

  assert.ok(validateRenderedOutput(buffer, 'XLSX', out.mimeType).ok, 'shallow gate')
  const deep = await validateRenderedOutputDeep(buffer, 'XLSX')
  assert.deepEqual(deep.issues, [], `deep gate issues: ${JSON.stringify(deep.issues)}`)

  // Independent re-open with ExcelJS (the same library Excel itself-class parses with).
  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  assert.ok(wb.worksheets.length >= 3, `expected >= 3 worksheets, got ${wb.worksheets.length}`)

  const first = wb.worksheets[0]
  assert.ok(first.getRow(1).cellCount > 0, 'first sheet has header content')

  // Find the quarterly table sheet and verify REAL formulas (not text).
  let formulaFound = null
  let freezeFound = false
  let filterFound = false
  for (const ws of wb.worksheets) {
    if (ws.views?.some?.((v) => v.state === 'frozen')) freezeFound = true
    if (ws.autoFilter) filterFound = true
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.formula && /SUM|B2-C2|B3-C3|B4-C4/.test(String(cell.formula))) {
          formulaFound = String(cell.formula)
        }
      })
    })
  }
  assert.ok(formulaFound, `expected a real Excel formula, none found (sheets: ${wb.worksheets.map((w) => w.name).join(', ')})`)
  assert.ok(freezeFound, 'at least one sheet freezes its header row')
  assert.ok(filterFound, 'at least one sheet has an autofilter')

  // Column widths were set (no default 8.43-wide cramped columns).
  const withWidth = wb.worksheets.some((ws) => ws.columns?.some?.((c) => c.width && c.width > 10))
  assert.ok(withWidth, 'column widths customized')
})

// ==================== PPTX ====================
test('§V4 PPTX re-open: 16:9 slide size, one slide per section, real text on every slide', async () => {
  const { renderArtifact } = loadEngine('@/services/document-renderer')
  const { validateRenderedOutput, validateRenderedOutputDeep } = loadEngine('@/services/qa/structural')

  const spec = cnDocument('PPTX')
  const out = await renderArtifact(spec, cnComponents(), 'PPTX')
  const buffer = Buffer.from(out.buffer)
  assert.ok(buffer.length > 20000, `PPTX suspiciously small: ${buffer.length} bytes`)

  assert.ok(validateRenderedOutput(buffer, 'PPTX', out.mimeType).ok, 'shallow gate')
  const deep = await validateRenderedOutputDeep(buffer, 'PPTX')
  assert.deepEqual(deep.issues, [], `deep gate issues: ${JSON.stringify(deep.issues)}`)

  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(buffer)

  // Slide size: 16:9 widescreen in EMU.
  const presXml = await zip.file('ppt/presentation.xml').async('string')
  const sizeMatch = presXml.match(/sldSz[^/]*cx="(\d+)"[^/]*cy="(\d+)"/)
  assert.ok(sizeMatch, 'sldSz present')
  const [cx, cy] = [Number(sizeMatch[1]), Number(sizeMatch[2])]
  assert.ok(Math.abs(cx / cy - 16 / 9) < 0.01, `slide size must be 16:9, got ${cx}x${cy}`)

  // Every planned section becomes at least one slide (content-heavy sections
  // legitimately SPLIT into several slides — the renderer's overflow guard).
  const slideFiles = zip.file(/ppt\/slides\/slide\d+\.xml$/)
  assert.ok(
    slideFiles.length >= spec.sections.length,
    `expected >= ${spec.sections.length} slides, got ${slideFiles.length}`
  )

  // Every slide carries real text; every section title lands somewhere in the deck.
  const deckText = []
  for (const f of slideFiles) {
    const xml = await f.async('string')
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('')
    assert.ok(texts.trim().length >= 8, `${f.name} carries real text (${texts.length} chars)`)
    deckText.push(texts)
  }
  const allText = deckText.join('\n')
  for (const section of spec.sections) {
    assert.ok(allText.includes(section.title), `section "${section.title}" present in the deck`)
  }

  // Charts render through the shared image pipeline: the PNG is embedded in
  // ppt/media/ and referenced from the slide's relationships (pptxgenjs keeps
  // an empty ppt/charts/ dir in its template even with zero native charts).
  const mediaPngs = zip.file(/ppt\/media\/image.*\.png$/)
  assert.ok(mediaPngs.length > 0, 'chart PNG embedded in ppt/media/')
  // The chart image is referenced from whichever slide carries it (not
  // necessarily slide 1 — content slides hold the chart).
  const allRels = await Promise.all(
    zip
      .file(/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/)
      .map((f) => f.async('string'))
  )
  assert.ok(
    allRels.some((xml) => /relationships\/image/.test(xml)),
    'at least one slide references the embedded chart image'
  )
})

// ==================== CSV ====================
test('§V5 CSV re-open: BOM, RFC4180 uniform columns, quoted CJK cells', async () => {
  const { renderArtifact } = loadEngine('@/services/document-renderer')
  const { validateRenderedOutput, validateRenderedOutputDeep } = loadEngine('@/services/qa/structural')

  const spec = cnDocument('CSV')
  const components = [
    { sectionId: 's1', componentId: 'c1', type: 'TABLE', order: 0, content: [
      ['区域', '营收（万元）', '同比增长'],
      ['欧洲、中东及非洲', '19000', '22%'],
      ['亚太', '12000', '15%'],
      ['美洲,北美', '11000', '11%'], // comma inside a cell → must be quoted
    ] },
  ]
  const out = await renderArtifact(spec, components, 'CSV')
  const buffer = Buffer.from(out.buffer)

  assert.ok(validateRenderedOutput(buffer, 'CSV', out.mimeType).ok, 'shallow gate')
  const deep = await validateRenderedOutputDeep(buffer, 'CSV')
  assert.deepEqual(deep.issues, [], `deep gate issues: ${JSON.stringify(deep.issues)}`)

  // Independent RFC4180-aware parse (BOM verified above, then stripped —
  // the BOM lives INSIDE the first cell's bytes, not outside them).
  const text = buffer.toString('utf-8')
  assert.ok(text.startsWith('\uFEFF'), 'UTF-8 BOM present (Excel compatibility)')
  const body = text.replace(/^\uFEFF/, '')

  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inQuotes) {
      if (ch === '"' && body[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }

  assert.ok(rows.length >= 4, `expected >= 4 records, got ${rows.length}`)
  const widths = rows.map((r) => r.length)
  assert.deepEqual(new Set(widths).size, 1, `uniform column count, got ${JSON.stringify(widths)}`)
  assert.equal(rows[0][0], '区域', 'header row present')
  assert.equal(rows[3][0], '美洲,北美', 'comma cell correctly quoted and recovered')
  assert.ok(!/(#REF!|#VALUE!|#DIV\/0!)/.test(body), 'no formula error markers')
})

// ==================== Filename professionalism (spec §44) ====================
test('§V6 buildArtifactFilename: CJK titles yield professional, header-safe names after upload', () => {
  const { buildArtifactFilename } = loadEngine('@/services/renderers/shared')
  const name = buildArtifactFilename(TITLE, 'XLSX')
  assert.ok(name.startsWith('2026年第三季度业务分析报告'), 'readable CJK base kept')
  assert.match(name, /_2026\.xlsx$/, 'year suffix + lowercase extension')
  // Windows-hostile characters are gone even if the title contained them.
  const hostile = buildArtifactFilename('A/B: bad * name? "quoted" <x|y> z', 'DOCX')
  assert.doesNotMatch(hostile, /[/\\:*?"<>|]/)
})
