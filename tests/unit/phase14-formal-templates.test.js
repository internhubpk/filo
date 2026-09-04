// =============================================================================
// Phase 14 — FORMAL TEMPLATES + TABLE TYPOGRAPHY REGRESSION SUITE
// =============================================================================
// Guards two user-reported defect classes and the new formal-template feature:
//
//   TEMPLATES — src/config/templates.ts registry (letter, memo, form, invoice,
//               quotation, meeting-minutes, agreement, notice) flows through
//               planning prompts, content prompts, the Convex job schema and
//               both enqueue routes; the composer/empty state surface it.
//   TABLES    — table cell paragraphs no longer inherit the document's 1.4-1.6
//               line spacing (airy/uneven rows), PDF header bands are
//               wrap-aware (headings that wrap to a second line are no longer
//               ellipsized into invisibility), and cover bands/rows grow
//               instead of clipping wrapped titles.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadEngine } from './helpers/ts-build.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..')

const templates = loadEngine('@/config/templates')
const planning = loadEngine('@/services/artifact-planning')
const themes = loadEngine('@/services/themes')
const { renderArtifact } = loadEngine('@/services/document-renderer')

const docxRendererSrc = readFileSync(resolve(REPO_ROOT, 'src/services/renderers/docx-renderer.ts'), 'utf8')
const pdfRendererSrc = readFileSync(resolve(REPO_ROOT, 'src/services/renderers/pdf-renderer.ts'), 'utf8')

// ==================== TEMPLATE REGISTRY ====================

test('§14-T1 registry ships the 8 formal templates with complete definitions', () => {
  const ids = templates.FORMAL_TEMPLATES.map((t) => t.id)
  assert.deepEqual(
    ids.sort(),
    ['agreement', 'form', 'formal-letter', 'invoice', 'meeting-minutes', 'memo', 'notice', 'quotation'].sort()
  )
  for (const t of templates.FORMAL_TEMPLATES) {
    assert.ok(t.label.length > 2, `${t.id}: label`)
    assert.ok(t.description.length > 10, `${t.id}: description`)
    assert.ok(t.planning.length > 200, `${t.id}: planning anatomy is substantive`)
    assert.ok(t.design.length > 40, `${t.id}: design direction`)
    assert.ok(t.content.length > 80, `${t.id}: content rules`)
    assert.ok(t.starter.length > 30, `${t.id}: starter prompt`)
    assert.ok(
      t.formats.every((f) => ['docx', 'pdf', 'xlsx', 'pptx'].includes(f)),
      `${t.id}: formats are known`
    )
  }
})

test('§14-T2 ids are unique and lookup/sanitize behave for none/unknown', () => {
  const ids = templates.FORMAL_TEMPLATES.map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length, 'unique ids')

  assert.equal(templates.getTemplate('form').id, 'form')
  assert.equal(templates.getTemplate(null), null)
  assert.equal(templates.getTemplate(undefined), null)
  assert.equal(templates.getTemplate('does-not-exist'), null)

  assert.equal(templates.sanitizeTemplateId('memo'), 'memo')
  assert.equal(templates.sanitizeTemplateId('hax'), undefined)
  assert.equal(templates.sanitizeTemplateId(undefined), undefined)
  assert.equal(templates.templatePlanningBlock('hax'), '', 'unknown id → empty planning block')
  assert.equal(templates.templatePlanningBlock(null), '', 'no template → empty planning block')
})

test('§14-T3 planning blocks carry the fixed anatomy; form template forbids underscore blanks', () => {
  const letter = templates.templatePlanningBlock('formal-letter')
  assert.ok(letter.includes('BUSINESS LETTER'), 'letter anatomy injected')
  assert.ok(letter.includes('Salutation'), 'letter anatomy mentions salutation')

  const form = templates.templatePlanningBlock('form')
  assert.ok(form.includes('FILLABLE FORM'), 'form anatomy injected')
  assert.ok(form.includes('EMPTY fill cells'), 'forms use empty fill cells')

  const content = templates.templateContentDirection('form')
  assert.ok(content.includes('underscores'), 'content rules forbid "____" blanks')
  assert.ok(content.includes('FORMAL RECORD'), 'decorative components are banned for templates')
})

test('§14-T4 content prompts embed template rules + soften the word budget', () => {
  const base = {
    sectionTitle: 'Section A — Personal Information',
    sectionType: 'content',
    componentNotes: [],
    documentTitle: 'Job Application Form',
    documentType: 'DOCUMENT',
    outputFormat: 'DOCX',
    originalPrompt: 'a job application form',
  }

  const withTemplate = planning.buildSectionContentPrompt({
    ...base,
    templateDirection: templates.templateContentDirection('form'),
  })
  assert.ok(withTemplate.system.includes('FORMAL TEMPLATE RULES'), 'template block present in system prompt')
  assert.ok(withTemplate.system.includes('FORMAL TEMPLATE exception'), 'word budget is softened for templates')

  const without = planning.buildSectionContentPrompt(base)
  assert.ok(!without.system.includes('FORMAL TEMPLATE RULES'), 'no template block without a template')
  assert.ok(!without.system.includes('FORMAL TEMPLATE exception'), 'budget unchanged without a template')
})

// ==================== PIPELINE WIRING ====================

test('§14-T5 Convex job schema + enqueue mutations carry the template field', () => {
  const schema = readFileSync(resolve(REPO_ROOT, 'convex/schema.ts'), 'utf8')
  assert.ok(/generationJobs[\s\S]*?template:\s*v\.optional\(v\.string\(\)\)/.test(schema), 'schema field exists')

  const generation = readFileSync(resolve(REPO_ROOT, 'convex/generation.ts'), 'utf8')
  const createJobArgs = generation.slice(generation.indexOf('export const createJob'), generation.indexOf('export const initializeUnits'))
  assert.ok(createJobArgs.includes('template: v.optional(v.string())'), 'createJob accepts template')
  assert.ok(createJobArgs.includes('template: args.template'), 'createJob persists template')

  const enqueue = generation.slice(generation.indexOf('export const enqueueJob'))
  assert.ok(enqueue.includes('template: v.optional(v.string())'), 'enqueueJob accepts template')
  assert.ok(enqueue.includes('template: args.template'), 'enqueueJob forwards template')
})

test('§14-T6 the worker injects template context into designer, planning and content stages', () => {
  const worker = readFileSync(resolve(REPO_ROOT, 'convex/worker.ts'), 'utf8')
  assert.ok(worker.includes('templatePlanningBlock'), 'planning stage gets the anatomy block')
  assert.ok(worker.includes('templateDesignContext'), 'designer stage gets the design direction')
  assert.ok(worker.includes('templateContentDirection'), 'content stage gets the writing rules')
  assert.ok(worker.includes('templateCapsScale'), 'scale is capped for template documents')
  assert.ok(/depth:\s*"brief"/.test(worker), 'capped scale uses the valid "brief" depth')
})

test('§14-T7 both HTTP enqueue routes validate the template server-side', () => {
  const send = readFileSync(resolve(REPO_ROOT, 'src/app/api/chat/send/route.ts'), 'utf8')
  assert.ok(send.includes('sanitizeTemplateId'), 'chat/send validates the template id')
  assert.ok(send.includes('template: opts.template'), 'chat/send forwards it to enqueueJob')

  const agent = readFileSync(resolve(REPO_ROOT, 'src/app/api/artifacts/agent-generate/route.ts'), 'utf8')
  assert.ok(agent.includes('sanitizeTemplateId(body.template)'), 'agent-generate validates the template id')
})

test('§14-T8 the composer + empty state surface the template picker', () => {
  const composer = readFileSync(resolve(REPO_ROOT, 'src/components/chat/composer.tsx'), 'utf8')
  assert.ok(composer.includes('FORMAL_TEMPLATES'), 'composer dropdown lists templates')
  assert.ok(composer.includes('onTemplateChange'), 'composer takes a template change handler')

  const workspace = readFileSync(resolve(REPO_ROOT, 'src/components/chat/workspace.tsx'), 'utf8')
  assert.ok(workspace.includes('template: currentTemplate !== DEFAULT_TEMPLATE_ID'), 'send body carries the template')
  assert.ok(workspace.includes('Start from a formal template'), 'empty state shows template chips')
})

// ==================== TABLE TYPOGRAPHY REGRESSIONS ====================

test('§14-R1 DOCX: table cells pin tight spacing instead of inheriting document line-height', () => {
  const dataTable = docxRendererSrc.slice(docxRendererSrc.indexOf('private dataTable'))
  const spacingHits = (dataTable.match(/after: 0, line: 240/g) || []).length
  assert.ok(spacingHits >= 2, `header + data cell paragraphs pin line 240 (found ${spacingHits})`)

  const metricTable = docxRendererSrc.slice(docxRendererSrc.indexOf('private metricTable'))
  assert.ok(metricTable.includes('after: 0, line: 240'), 'metric table cells pin tight spacing too')

  // Cover rows: EXACT once (the empty decorative gradient band) — the title
  // rows must be ATLEAST so wrapped titles grow instead of being clipped.
  const exactCount = (docxRendererSrc.match(/HeightRule\.EXACT/g) || []).length
  const atLeastCount = (docxRendererSrc.match(/HeightRule\.ATLEAST/g) || []).length
  assert.equal(exactCount, 1, 'only the decorative gradient band stays EXACT')
  assert.ok(atLeastCount >= 2, 'sidebar + banner cover rows use ATLEAST')
})

test('§14-R2 PDF: table header band is wrap-aware (no fixed strip, no ellipsis)', () => {
  const tableBlock = pdfRendererSrc.slice(pdfRendererSrc.indexOf('HEADER BAND — wrap-aware'), pdfRendererSrc.indexOf('const colXs'))
  assert.ok(tableBlock.includes('heightOfString'), 'band height is measured from wrapped header text')
  assert.ok(!tableBlock.includes('lineBreak: false'), 'header text is NOT forced onto one line')
  assert.ok(!tableBlock.includes('ellipsis: true'), 'header text is never ellipsized')
  assert.ok(tableBlock.includes('bandedH'), 'band height constant exists')

  const bandHeading = pdfRendererSrc.slice(pdfRendererSrc.indexOf("case 'band'"), pdfRendererSrc.indexOf("case 'left-bar'"))
  assert.ok(bandHeading.includes('heightOfString'), 'band ornament headings measure wrapped height')
  assert.ok(!bandHeading.includes('lineBreak: false'), 'band ornament headings wrap')
})

test('§14-R3 PDF: the banner cover band grows to fit wrapped titles (no white-on-white)', () => {
  const cover = pdfRendererSrc.slice(pdfRendererSrc.indexOf('private drawCover'), pdfRendererSrc.indexOf('private drawToc'))
  const banner = cover.slice(cover.indexOf("case 'banner'"))
  assert.ok(banner.includes('heightOfString'), 'title height is measured before the band is drawn')
  assert.ok(banner.includes('Math.max(150,'), 'band grows beyond the old fixed 150pt when needed')
  assert.ok(!/rect\(0, 0, pageW, 150\)/.test(banner), 'the fixed 150pt band is gone')
})

// ==================== END-TO-END RENDER SMOKE ====================

function specFor(format) {
  const { design } = themes.resolveTheme('executive', { format })
  return {
    id: 'spec-phase14',
    type: 'document',
    title: 'Phase 14 Formal Template Rendering',
    outputFormat: format,
    sections: [],
    design,
  }
}

test('§14-E1 DOCX: wide table with wrapping header cells renders without error', async () => {
  const spec = specFor('DOCX')
  spec.sections = [{ id: 's1', type: 'content', title: 'Eligibility Matrix', order: 0 }]
  const comps = [
    {
      sectionId: 's1', componentId: 'c1', type: 'table', order: 0,
      content: [
        ['Applicant Category', 'Percentage of Total Budget', 'Qualifying Examination Status', 'Remarks for the Committee'],
        ['General', 40, 'Passed', '—'],
        ['Reserved (Rural)', 25, 'Conditional', 'Subject to verification'],
      ],
    },
  ]
  const out = await renderArtifact(spec, comps, 'DOCX')
  assert.ok(out.buffer.length > 8_000, 'docx produced')
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(out.buffer)
  const xml = await zip.file('word/document.xml').async('string')
  assert.ok(xml.includes('Percentage of Total Budget'), 'wrapped header text present in full')
})

test('§14-E2 PDF: long title + wrapping table headers render without error', async () => {
  const spec = specFor('PDF')
  spec.title = 'Quarterly Infrastructure Maintenance and Capital Expenditure Review — Detailed Analysis of Findings'
  spec.sections = [
    { id: 'cover', type: 'cover', title: spec.title, order: 0 },
    { id: 's1', type: 'content', title: 'Budget Allocation', order: 1 },
  ]
  const comps = [
    {
      sectionId: 's1', componentId: 'c1', type: 'table', order: 0,
      content: [
        ['Cost Centre', 'Percentage of Total Budget', 'Approved'],
        ['Roads', 44, 'Yes'],
        ['Drainage', 18, 'No'],
      ],
    },
  ]
  const out = await renderArtifact(spec, comps, 'PDF')
  assert.ok(out.buffer.length > 10_000, 'pdf produced')
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(out.buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  assert.ok(text.includes('Percentage of Total Budget'), 'wrapped table header survives in the text layer')
  assert.ok(text.includes(spec.title), 'long banner cover title survives in the text layer')
})
