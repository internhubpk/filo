// =============================================================================
// Test helper: compile the pure TypeScript engine modules to CJS once, then
// require them with an '@/' alias hook. Lets the unit suite exercise the REAL
// theme engine / ingestion pipeline / chart + diagram engines / renderers /
// QA validator instead of only asserting on source text.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const REPO_ROOT = resolve(__dirname, '..', '..', '..')
export const BUILD_DIR = resolve(__dirname, '..', '..', '.build')

let compiled = false
let hooked = false

/** Compile src engine modules → tests/.build (always fresh — ~2.5s). */
export function ensureCompiled() {
  if (compiled) return
  rmSync(BUILD_DIR, { recursive: true, force: true })
  mkdirSync(BUILD_DIR, { recursive: true })
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', '--project', resolve(__dirname, '..', 'tsconfig.test.json')],
    { cwd: REPO_ROOT, stdio: 'pipe' }
  )
  compiled = true
}

/**
 * Require a compiled engine module with the '@/' path alias mapped onto the
 * build directory (mirrors the Next.js/Convex bundler behavior).
 */
export function loadEngine(relativePath) {
  ensureCompiled()
  const require = createRequire(import.meta.url)
  if (!hooked) {
    const Module = require('node:module')
    const originalResolve = Module._resolveFilename
    Module._resolveFilename = function patched(request, ...rest) {
      if (typeof request === 'string' && request.startsWith('@/')) {
        request = resolve(BUILD_DIR, request.slice(2))
      }
      return originalResolve.call(this, request, ...rest)
    }
    hooked = true
  }
  const target = relativePath.startsWith('@/')
    ? resolve(BUILD_DIR, relativePath.slice(2))
    : resolve(BUILD_DIR, relativePath)
  // Bust the require cache so reruns within a process see fresh modules.
  delete require.cache[require.resolve(target)]
  return require(require.resolve(target))
}
