// Export sample artifacts (rich fixtures per format + a 150-page long doc)
// to /home/z/my-project/download for human review.
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = '/home/z/my-project/download'
fs.mkdirSync(OUT, { recursive: true })
execFileSync('npx', ['tsc', '--project', path.join(REPO, 'tests', 'unit', 'tsconfig.test.json')], { stdio: 'inherit' })
const BUILD = path.join(REPO, 'tests', '.build')
const Module = require('module')
const orig = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith('@/')) request = path.join(BUILD, request.slice(2))
  return orig.call(this, request, ...args)
}
const { renderArtifact } = require(path.join(BUILD, 'services/document-renderer.js'))
const { fixtures } = await import('./verify-render-quality.mjs')
const { buildRichSpec, compsFor, buildLongSpec } = fixtures

function slug(title, format) {
  const base = String(title).replace(/[\\/:*?"<>|]+/g, ' ').replace(/['’]/g, '').trim().replace(/\s+/g, '_').slice(0, 80)
  const year = new Date().getFullYear()
  return `${base}_${year}.${format.toLowerCase()}`
}

async function save(spec, format, outName) {
  const s = { ...spec, outputFormat: format }
  const out = await renderArtifact(s, compsFor(s), format)
  const file = path.join(OUT, outName || slug(spec.title, format))
  fs.writeFileSync(file, out.buffer)
  console.log(`saved ${file} (${(out.buffer.length / 1024).toFixed(0)} KB)`)
}

async function main() {
  // Rich fixture in 4 different themes — shows the design dialects
  await save(buildRichSpec('executive'), 'DOCX')
  await save(buildRichSpec('editorial'), 'PDF')
  await save(buildRichSpec('professional-dark'), 'PPTX')
  await save(buildRichSpec('financial'), 'XLSX')

  // Long document: ~150 pages, 3 parts, 24 numbered chapters, 8 charts
  const long = buildLongSpec('academic')
  await save(long, 'PDF', 'Reliability_Engineering_Master_Notes_150pp_' + new Date().getFullYear() + '.pdf')
}

await main()
