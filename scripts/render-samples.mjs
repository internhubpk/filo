// Render visual samples: DOCX/PDF/PPTX/XLSX from the rich fixture across
// themes, so a human (or multimodal model) can inspect layout quality.
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(REPO)

const BUILD_DIR = path.join(REPO, 'tests', '.build')
execFileSync('npx', ['tsc', '--project', path.join(REPO, 'tests', 'unit', 'tsconfig.test.json')], { stdio: 'inherit' })
const Module = require('module')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith('@/')) request = path.join(BUILD_DIR, request.slice(2))
  return origResolve.call(this, request, ...args)
}

const { renderArtifact } = require(path.join(BUILD_DIR, 'services/document-renderer.js'))
const { fixtures } = await import('./verify-render-quality.mjs')
const { buildRichSpec, compsFor } = fixtures

const OUT = path.join(REPO, 'tests', '.samples')
mkdirSync(OUT, { recursive: true })

const samples = [
  ['executive', 'DOCX'],
  ['executive', 'PDF'],
  ['financial', 'PDF'],
  ['editorial', 'DOCX'],
  ['professional-dark', 'PPTX'],
  ['financial', 'XLSX'],
]
for (const [theme, format] of samples) {
  const spec = buildRichSpec(theme)
  spec.outputFormat = format
  const out = await renderArtifact(spec, compsFor(spec), format)
  const file = path.join(OUT, `sample_${theme}.${format.toLowerCase()}`)
  require('fs').writeFileSync(file, out.buffer)
  console.log('wrote', file, `${(out.buffer.length / 1024).toFixed(0)}KB`)
}
console.log('done')
