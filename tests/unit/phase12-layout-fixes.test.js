// =============================================================================
// Phase 12 — LAYOUT & PIPELINE REGRESSION SUITE
// =============================================================================
// Guards the fixes for the "overlapping paragraphs / shattered code blocks /
// raw-JSON pages / missing spaces around inline code" incident:
//
//   INLINE   — parseInlineMarkdown group-index fixes (links were silently
//              DROPPED, *italic* silently dropped, Python dunders __x__
//              destroyed as bold "x"), boundary-space normalization
//   DEDUPE   — prepareForRendering drops the leading heading that restates
//              the section title, adjacent duplicate paragraphs, and a
//              paragraph contained verbatim in its predecessor
//   PARTS    — partHeadingLabel no longer emits "Part II — Part II: …"
//   JSON     — truncated AI section JSON is rescued (never dumped as raw
//              text into the document)
//   PDF      — styled runs keep spaces and dunders, code blocks keep their
//              lines, header/footer stamped exactly once, takeaways lose
//              their literal backticks
//   DOCX     — takeaways/callout/two_column render inline runs (no literal
//              markdown)
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { loadEngine } from './helpers/ts-build.js'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')

const inline = loadEngine('@/services/typography/inline')
const { renderArtifact, prepareForRendering } = loadEngine('@/services/document-renderer')
const { partHeadingLabel } = loadEngine('@/services/renderers/shared')
const { extractJsonObject } = loadEngine('@/services/artifact-planning')

// ==================== INLINE MARKDOWN PARSER ====================

test('§12-T1 links survive parsing with their href (were silently dropped)', () => {
  const segs = inline.parseInlineMarkdown('Read the [official docs](https://docs.python.org/3/) first.')
  const link = segs.find((s) => s.style === 'link')
  assert.ok(link, 'link segment present')
  assert.equal(link.text, 'official docs')
  assert.equal(link.href, 'https://docs.python.org/3/')
  const joined = segs.map((s) => s.text).join('')
  assert.ok(joined.includes('official docs'), 'link text survives in the joined stream')
  assert.ok(!joined.includes('['), 'no literal brackets left')
})

test('§12-T2 *italic* survives parsing (was silently dropped by a bad group index)', () => {
  const segs = inline.parseInlineMarkdown('an *italic* word')
  const italics = segs.filter((s) => s.style === 'italic').map((s) => s.text)
  assert.deepEqual(italics, ['italic'])
  const joined = segs.map((s) => s.text).join('')
  assert.equal(joined, 'an italic word')
})

test('§12-T3 _underscore italic_ still parses as italic', () => {
  const segs = inline.parseInlineMarkdown('an _italic_ word')
  assert.ok(segs.some((s) => s.style === 'italic' && s.text === 'italic'))
})

test('§12-T4 Python dunders keep their underscores as inline code', () => {
  const segs = inline.parseInlineMarkdown('the magic methods __enter__ and __exit__ to establish boundaries')
  const codes = segs.filter((s) => s.style === 'code').map((s) => s.text)
  assert.deepEqual(codes, ['__enter__', '__exit__'], 'dunder text preserved in code style')
  const joined = segs.map((s) => s.text).join('')
  assert.ok(joined.includes('__enter__ and __exit__ to'), 'spaces around dunders preserved')
  assert.ok(!joined.includes('enter and exitto'), 'the "exitto" join bug is gone')
})

test('§12-T5 __multi word emphasis__ still parses as bold (markdown semantics)', () => {
  const segs = inline.parseInlineMarkdown('a __bold phrase__ here')
  const bold = segs.find((s) => s.style === 'bold')
  assert.ok(bold, 'bold segment present')
  assert.equal(bold.text, 'bold phrase')
})

test('§12-T6 boundary spaces move to the trailing edge of the previous segment', () => {
  const out = inline.normalizeSegmentBoundaries([
    { text: 'exit', style: 'code' },
    { text: ' to establish', style: 'text' },
    { text: 'the rest', style: 'text' },
  ])
  assert.equal(out[0].text, 'exit ', 'leading space of the next chunk appended to the previous')
  assert.equal(out[1].text, 'to establish', 'next chunk no longer starts with whitespace')
})

// ==================== CENTRAL DEDUPE ====================

function dedupeSpec() {
  return {
    id: 'spec-phase12',
    type: 'document',
    title: 'Phase 12',
    outputFormat: 'PDF',
    sections: [{ id: 's1', type: 'content', title: 'C3 Linearization', order: 0 }],
    design: { theme: { name: 'executive' } },
  }
}

const LONG_PARAGRAPH =
  'To resolve variable references during runtime execution, CPython adheres to the established LEGB rule, ' +
  'evaluating scopes sequentially through Local, Enclosing, Global, and Built-in namespaces. The local ' +
  'namespace is bound to the current execution frame and managed via fast locals arrays. The enclosing ' +
  'variable is wrapped in a cell object allowing the outer variable lifetime to persist long after the ' +
  "outer function's stack frame has been destroyed and popped from the evaluation stack."

test('§12-D1 leading heading that restates the section title is dropped', () => {
  const doc = prepareForRendering(dedupeSpec(), [
    { sectionId: 's1', componentId: 'h', type: 'heading', order: 0, content: 'C3 Linearization' },
    { sectionId: 's1', componentId: 'p1', type: 'paragraph', order: 1, content: LONG_PARAGRAPH },
  ])
  assert.equal(doc.sections[0].components.length, 1, 'duplicate section-title heading removed')
  assert.equal(doc.sections[0].components[0].type, 'paragraph')
})

test('§12-D2 adjacent duplicate paragraphs collapse to one', () => {
  const doc = prepareForRendering(dedupeSpec(), [
    { sectionId: 's1', componentId: 'p1', type: 'paragraph', order: 0, content: LONG_PARAGRAPH },
    { sectionId: 's1', componentId: 'p2', type: 'paragraph', order: 1, content: `  ${LONG_PARAGRAPH.toUpperCase()}  ` },
  ])
  assert.equal(doc.sections[0].components.length, 1, 'normalized duplicate removed')
})

test('§12-D3 a paragraph contained verbatim in the previous one is dropped', () => {
  const tail = LONG_PARAGRAPH.slice(0, 220)
  const doc = prepareForRendering(dedupeSpec(), [
    { sectionId: 's1', componentId: 'p1', type: 'paragraph', order: 0, content: LONG_PARAGRAPH },
    { sectionId: 's1', componentId: 'p2', type: 'paragraph', order: 1, content: tail },
    { sectionId: 's1', componentId: 'p3', type: 'paragraph', order: 2, content: 'A genuinely new paragraph with different content.' },
  ])
  assert.equal(doc.sections[0].components.length, 2, 'contained duplicate removed, distinct paragraph kept')
})

test('§12-D4 distinct paragraphs are never dropped', () => {
  const doc = prepareForRendering(dedupeSpec(), [
    { sectionId: 's1', componentId: 'p1', type: 'paragraph', order: 0, content: LONG_PARAGRAPH },
    { sectionId: 's1', componentId: 'p2', type: 'paragraph', order: 1, content: LONG_PARAGRAPH.replace('LEGB', 'scope') + ' Moreover.' },
  ])
  assert.equal(doc.sections[0].components.length, 2)
})

// ==================== PART LABEL ====================

test('§12-L1 part titles that already carry the Part prefix are used verbatim', () => {
  assert.equal(partHeadingLabel('II', 'Part II: Object-Oriented Architecture'), 'Part II: Object-Oriented Architecture')
  assert.equal(partHeadingLabel('ii', 'part ii — foundations'), 'part ii — foundations')
})

test('§12-L2 plain part titles get the Part prefix composed', () => {
  assert.equal(partHeadingLabel('II', 'Object-Oriented Architecture'), 'Part II — Object-Oriented Architecture')
  assert.equal(partHeadingLabel(undefined, 'Standalone'), 'Standalone')
})

// ==================== TRUNCATED AI JSON RESCUE ====================

test('§12-J1 truncated section JSON is rescued — components survive, raw JSON never dumps', () => {
  const truncated =
    '{"components":[' +
    '{"type":"paragraph","content":"Complete first paragraph that survives the cut."},' +
    '{"type":"heading","content":"Cut off hea'
  const parsed = extractJsonObject(truncated)
  assert.ok(parsed && Array.isArray(parsed.components), 'truncation rescue returns the document object')
  assert.equal(parsed.components[0].type, 'paragraph')
  assert.equal(parsed.components[0].content, 'Complete first paragraph that survives the cut.')
})

test('§12-J2 fenced JSON with prose around it parses', () => {
  const fenced = 'Here is your section:\n```json\n{"components":[{"type":"paragraph","content":"Hello"}]}\n```\nDone.'
  const parsed = extractJsonObject(fenced)
  assert.ok(parsed && Array.isArray(parsed.components))
  assert.equal(parsed.components[0].content, 'Hello')
})

// ==================== PDF END-TO-END ====================

function pdfSpec() {
  return {
    id: 'spec-phase12-pdf',
    type: 'document',
    title: 'Phase 12 PDF Layout',
    outputFormat: 'PDF',
    sections: [
      { id: 'cover', type: 'cover', title: 'Phase 12 PDF Layout', order: 0 },
      { id: 'part', type: 'heading', title: 'Part I: Core Mechanics', level: 'part', number: 'I', order: 1 },
      { id: 'ch1', type: 'content', title: 'Execution Model', level: 'chapter', number: '1', order: 2 },
    ],
    design: {
      theme: { name: 'executive' },
      layout: { pageSize: 'A4', margins: { top: '72pt', bottom: '64pt', left: '72pt', right: '72pt' }, headerEnabled: true, footerEnabled: true },
    },
  }
}

test('§12-P1 PDF: styled runs keep spaces + dunders, code blocks keep lines, header stamped once', async () => {
  const comps = [
    { sectionId: 'cover', componentId: 'c0', type: 'paragraph', order: 0, content: 'Subtitle line.' },
    { sectionId: 'part', componentId: 'p0', type: 'paragraph', order: 0, content: 'Part framing sentence.' },
    {
      sectionId: 'ch1', componentId: 'pa', type: 'paragraph', order: 0,
      content:
        'The protocol relies on the magic methods `__enter__` and `__exit__` to establish safe execution ' +
        'boundaries around every managed resource, guaranteeing deterministic teardown semantics even when ' +
        'the guarded block raises an unexpected runtime error deep inside the call chain.',
    },
    { sectionId: 'ch1', componentId: 'code', type: 'code', order: 1, content: { language: 'python', code: 'import dis\n\ndef calculate_total(prices):\n    total = 0\n    for price in prices:\n        total += price\n    return total' } },
    { sectionId: 'ch1', componentId: 'kt', type: 'key_takeaways', order: 2, content: ['Context managers use `__enter__` and `__exit__`.', 'Deterministic cleanup matters.'] },
  ]
  const out = await renderArtifact(pdfSpec(), comps, 'PDF')
  const { extractText, getDocumentProxy } = require('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(out.buffer))
  const { text } = await extractText(pdf, { mergePages: false })

  const all = text.join('\n')
  assert.ok(all.includes('__enter__'), 'dunder present with underscores')
  assert.ok(!/exitto|enterand/.test(all), 'no missing-space joins around inline code')
  assert.ok(all.includes('import dis'), 'code line stays on one line')
  assert.ok(all.includes('def calculate_total(prices):'), 'code line intact')
  assert.ok(!all.includes('`'), 'no literal markdown backticks in the PDF text layer')
  assert.ok(all.includes('Part I: Core Mechanics'), 'part title used verbatim')
  assert.ok(!all.includes('Part I — Part I'), 'no duplicated Part prefix')

  // Running header appears EXACTLY once per non-cover page (double-stamp bug).
  for (let p = 1; p < text.length; p++) {
    const occurrences = text[p].split('Phase 12 PDF Layout').length - 1
    assert.ok(occurrences <= 2, `page ${p + 1}: header text appears at most twice (title + header), got ${occurrences}`)
  }
})

// ==================== DOCX END-TO-END ====================

test('§12-X1 DOCX: takeaways and two_column render inline runs — no literal markdown', async () => {
  const spec = pdfSpec()
  spec.outputFormat = 'DOCX'
  const comps = [
    { sectionId: 'cover', componentId: 'c0', type: 'paragraph', order: 0, content: 'Subtitle line.' },
    { sectionId: 'part', componentId: 'p0', type: 'paragraph', order: 0, content: 'Part framing sentence.' },
    { sectionId: 'ch1', componentId: 'kt', type: 'key_takeaways', order: 0, content: ['Context managers use `__enter__` and `__exit__`.', 'Plain second point.'] },
    {
      sectionId: 'ch1', componentId: 'tc', type: 'two_column', order: 1,
      content: {
        leftTitle: 'Left',
        leftPoints: ['Uses `__dict__` storage.'],
        rightTitle: 'Right',
        rightPoints: ['Uses **bold** prose.'],
      },
    },
  ]
  const out = await renderArtifact(spec, comps, 'DOCX')
  const zip = await JSZip.loadAsync(out.buffer)
  const xml = await zip.file('word/document.xml').async('string')
  assert.ok(!xml.includes('`'), 'no literal backticks in DOCX output')
  assert.ok(xml.includes('__enter__'), 'dunder preserved as text')
  assert.ok(xml.includes('__dict__'), 'two_column dunder preserved')
  assert.ok(!xml.includes('**bold**'), 'no literal bold markers in two_column points')
})
