// =============================================================================
// FILO TYPOGRAPHY — CODE SYNTAX HIGHLIGHTING
// =============================================================================
// Server-side token extraction via Shiki (bundled WASM + TextMate grammars —
// fully offline, deterministic). Every renderer (DOCX runs, PDF runs, PPTX
// runs, HTML spans) consumes the SAME token stream and styles it with its own
// native mechanism, so code looks consistently professional in every format.
//
// Design constraints:
//   • LAZY: the highlighter (WASM + grammars) loads on the first CODE
//     component; documents without code never pay the cost.
//   • LANGUAGES load on demand from Shiki's bundled set; unknown/missing
//     languages degrade to plain monochrome tokens — never a failure.
//   • A 1.5s timeout guards against pathological grammars; fallback is
//     plain text, and the block still renders.
//   • Colors: `github-light` palette tuned for white/code-surface documents;
//     renderers may darken via withBackground.
// =============================================================================

export interface CodeToken {
  text: string
  /** Hex color WITHOUT '#', ready for docx/pptx; '#'-ful for HTML/CSS. */
  color: string
}

interface Highlighter {
  codeToTokens(code: string, opts: { lang: string; theme: string }): { tokens: Array<Array<{ content: string; color: string }>> }
  getLoadedLanguages(): string[]
}

let highlighterPromise: Promise<Highlighter | null> | null = null
const loadedLangs = new Set<string>()

const THEME = 'github-light'

/** AI language strings → Shiki bundled ids (safe subset; unknown → text). */
const LANG_ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', python3: 'python',
  rb: 'ruby', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
  yml: 'yaml', dockerfile: 'docker', docker: 'docker',
  'c++': 'cpp', cxx: 'cpp', cs: 'csharp', csharp: 'csharp', 'c#': 'csharp',
  kt: 'kotlin', rs: 'rust', golang: 'go',
  postgres: 'sql', postgresql: 'sql', mysql: 'sql', sqlite: 'sql', plsql: 'sql',
  htm: 'html', xml: 'html', xhtml: 'html',
  md: 'markdown', jsonc: 'json', json5: 'json',
  env: 'ini', toml: 'ini', conf: 'ini',
}

function resolveLang(language: string): string {
  const l = String(language ?? '').toLowerCase().trim()
  if (!l || l === 'text' || l === 'plain' || l === 'plaintext') return 'text'
  return LANG_ALIASES[l] ?? l
}

async function getHighlighter(lang: string): Promise<Highlighter | null> {
  if (lang === 'text') return null
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      try {
        const { createHighlighter } = await import('shiki')
        return (await createHighlighter({ themes: [THEME], langs: ['javascript'] })) as unknown as Highlighter
      } catch {
        return null
      }
    })()
  }
  const hl = await highlighterPromise
  if (!hl) return null
  if (!loadedLangs.has(lang)) {
    try {
      // loadLanguage guard with timeout — a pathological grammar must never
      // hang a document render.
      const load = (hl as unknown as {
        loadLanguage?: (l: string) => Promise<unknown>
      }).loadLanguage?.(lang)
      if (load) await Promise.race([load, new Promise((_, rej) => setTimeout(() => rej(new Error('grammar timeout')), 1500))])
      loadedLangs.add(lang)
    } catch {
      return null // unknown language → plain rendering
    }
  }
  return hl
}

/**
 * Tokenize source code into colored runs. Falls back to a single uncolored
 * run when Shiki or the grammar is unavailable — the block still renders,
 * styled by the caller's monospace surface.
 */
export async function highlightCode(code: string, language: string): Promise<CodeToken[][]> {
  const lang = resolveLang(language)
  const source = String(code ?? '')
  if (!source) return []

  try {
    const hl = await getHighlighter(lang)
    if (hl) {
      const result = hl.codeToTokens(source, { lang, theme: THEME })
      const lines = result.tokens.map((line) =>
        line
          .filter((t) => t.content.length > 0)
          .map((t) => ({ text: t.content, color: t.color.replace('#', '').toUpperCase() }))
      )
      // Preserve trailing newlines as empty lines (Shiki drops them).
      const srcLines = source.replace(/\n+$/, '').split('\n')
      while (lines.length < srcLines.length) lines.push([{ text: '', color: '24292E' }])
      return lines
    }
  } catch {
    /* fall through to plain */
  }

  return source.replace(/\n+$/, '').split('\n').map((line) => [{ text: line, color: '24292E' }])
}

/** Reset the lazy singleton (tests). */
export function resetHighlighter(): void {
  highlighterPromise = null
  loadedLangs.clear()
}
