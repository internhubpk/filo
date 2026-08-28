// =============================================================================
// PPTX INGESTION (spec §22) — slide/shape/notes extraction via JSZip
// =============================================================================
// A PPTX is a zip of slide XML. We extract per-slide text runs (<a:t>),
// treat the first text block as the slide title, and pull speaker notes
// from notesSlide XML parts.
// =============================================================================

import type { IngestedFile, IngestedSlide } from './types'
import { truncateText, countWords } from './types'

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

/** Extract ordered text paragraphs from a slide XML string. */
function slideParagraphs(xml: string): string[] {
  const paragraphs: string[] = []
  const paraRe = /<a:p>([\s\S]*?)<\/a:p>/gi
  let pm: RegExpExecArray | null
  while ((pm = paraRe.exec(xml)) !== null) {
    const runs: string[] = []
    const runRe = /<a:t>([\s\S]*?)<\/a:t>/gi
    let rm: RegExpExecArray | null
    while ((rm = runRe.exec(pm[1])) !== null) {
      runs.push(decodeXmlEntities(rm[1]))
    }
    const joined = runs.join('').trim()
    if (joined) paragraphs.push(joined)
  }
  return paragraphs
}

export async function ingestPptx(buffer: Buffer, filename: string, mimeType: string): Promise<IngestedFile> {
  const warnings: string[] = []
  const JSZip = (await import('jszip')).default

  let zip: import('jszip')
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`PPTX could not be read: ${msg.slice(0, 160)}`)
  }

  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      return na - nb
    })

  if (slideNames.length === 0) {
    throw new Error('PPTX contains no slides.')
  }

  const slides: IngestedSlide[] = []
  const textParts: string[] = [`Presentation: ${filename}`, `Slides: ${slideNames.length}`]

  for (let i = 0; i < slideNames.length; i++) {
    const name = slideNames[i]
    const xml = await zip.files[name].async('string')
    const paragraphs = slideParagraphs(xml)

    // Notes part: ppt/notesSlides/notesSlideN.xml
    const notesNum = name.match(/slide(\d+)\.xml$/)?.[1]
    let notes: string | undefined
    if (notesNum) {
      const notesName = `ppt/notesSlides/notesSlide${notesNum}.xml`
      const notesFile = zip.files[notesName]
      if (notesFile) {
        const notesXml = await notesFile.async('string')
        const noteParas = slideParagraphs(notesXml).filter((p) => !/^\d+$/.test(p))
        if (noteParas.length > 0) notes = noteParas.join(' ').slice(0, 1000)
      }
    }

    const slide: IngestedSlide = {
      index: i + 1,
      title: paragraphs[0]?.slice(0, 200),
      bullets: paragraphs.slice(1, 20),
      notes,
    }
    slides.push(slide)

    textParts.push(`\n=== Slide ${i + 1}${slide.title ? ` — ${slide.title}` : ''} ===`)
    if (slide.bullets.length > 0) textParts.push(slide.bullets.map((b) => `• ${b}`).join('\n'))
    if (notes) textParts.push(`[Speaker notes] ${notes}`)
  }

  const fullText = textParts.join('\n')
  const { text, truncated } = truncateText(fullText)
  if (truncated) warnings.push('Presentation text exceeded the extraction cap and was truncated.')

  return {
    kind: 'pptx',
    filename,
    mimeType,
    size: buffer.length,
    textContent: text,
    truncated,
    structure: {
      sectionCount: slides.length,
      sections: slides.map((s) => ({ title: s.title ?? `Slide ${s.index}`, blocks: s.bullets })),
      tables: [],
      slides,
      stats: {
        characters: fullText.length,
        words: countWords(fullText),
        tables: 0,
        lists: slides.reduce((acc, s) => acc + s.bullets.length, 0),
      },
    },
    warnings,
  }
}
