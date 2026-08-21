// Document Rendering Service
// Converts ArtifactSpecifications into actual files

import type {
  ArtifactSpecification,
  OutputFormat,
  RenderableDocument,
  BrandingConfig,
} from '@/types'
import { prepareForRendering } from './artifact-engine'

// ==================== RENDERER INTERFACE ====================

export interface RendererOutput {
  buffer: Buffer
  filename: string
  mimeType: string
  size: number
}

export interface DocumentRenderer {
  format: OutputFormat
  render(document: RenderableDocument): Promise<RendererOutput>
}

// ==================== DOCX RENDERER ====================

export class DocxRenderer implements DocumentRenderer {
  readonly format: OutputFormat = 'DOCX'

  async render(document: RenderableDocument): Promise<RendererOutput> {
    // In production, this would use a library like docx
    // For now, we'll create a proper structure that can be passed to a docx library
    
    const content = this.buildDocxContent(document)
    
    // This is where we'd use the `docx` npm package to create actual .docx files
    // For now, returning a placeholder implementation
    
    const filename = `${this.sanitizeFilename(document.specification.title)}.docx`
    
    // Placeholder: In production, generate actual DOCX using:
    // import { Document, Packer, Paragraph, HeadingLevel } from 'docx'
    // const doc = new Document({ sections: [...] })
    // const buffer = await Packer.toBuffer(doc)
    
    return {
      buffer: Buffer.from(JSON.stringify(content, null, 2), 'utf-8'),
      filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 0, // Would be buffer.length
    }
  }

  private buildDocxContent(document: RenderableDocument) {
    const sections = document.sections.map(section => ({
      type: section.type,
      title: section.title,
      components: section.components.map(comp => ({
        type: comp.type,
        content: comp.content,
      })),
    }))

    return {
      title: document.specification.title,
      metadata: document.specification.metadata,
      design: document.specification.design,
      branding: document.branding,
      sections,
    }
  }

  private sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)
  }
}

// ==================== PDF RENDERER ====================

export class PdfRenderer implements DocumentRenderer {
  readonly format: OutputFormat = 'PDF'

  async render(document: RenderableDocument): Promise<RendererOutput> {
    // In production, this would use libraries like:
    // - pdfkit for basic PDFs
    // - puppeteer with HTML template for styled PDFs
    // - @react-pdf/renderer for React-based PDF generation
    
    const content = this.buildPdfContent(document)
    const filename = `${this.sanitizeFilename(document.specification.title)}.pdf`

    return {
      buffer: Buffer.from(JSON.stringify(content, null, 2), 'utf-8'),
      filename,
      mimeType: 'application/pdf',
      size: 0,
    }
  }

  private buildPdfContent(document: RenderableDocument) {
    return {
      title: document.specification.title,
      author: document.specification.metadata.author || 'Filo',
      subject: document.specification.description,
      pageSize: document.specification.design.layout.pageSize,
      orientation: document.specification.design.layout.orientation,
      margins: document.specification.design.layout.margins,
      colors: document.specification.design.colors,
      fonts: document.specification.design.typography,
      sections: document.sections.map(section => ({
        type: section.type,
        title: section.title,
        content: section.components,
      })),
      headers: document.specification.design.layout.headerEnabled ? {
        text: document.branding?.companyName || document.specification.title,
      } : null,
      footers: document.specification.design.layout.footerEnabled ? {
        text: document.branding?.footerText || '',
        pageNumber: true,
      } : null,
    }
  }

  private sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)
  }
}

// ==================== XLSX RENDERER ====================

export class XlsxRenderer implements DocumentRenderer {
  readonly format: OutputFormat = 'XLSX'

  async render(document: RenderableDocument): Promise<RendererOutput> {
    // In production, this would use:
    // - exceljs for comprehensive Excel support
    // - xlsx (SheetJS) for basic functionality
    
    const content = this.buildXlsxContent(document)
    const filename = `${this.sanitizeFilename(document.specification.title)}.xlsx`

    return {
      buffer: Buffer.from(JSON.stringify(content, null, 2), 'utf-8'),
      filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 0,
    }
  }

  private buildXlsxContent(document: RenderableDocument) {
    // Build worksheets from sections
    const worksheets = document.sections.map((section, index) => ({
      name: section.title.substring(0, 31), // Excel worksheet name limit
      data: this.extractTableData(section.components),
      formatting: {
        headerRow: true,
        freezePane: 'A2',
        autoFilter: true,
        columnWidths: this.calculateColumnWidths(section.components),
      },
    }))

    return {
      title: document.specification.title,
      creator: 'Filo',
      worksheets,
      branding: document.branding,
    }
  }

  private extractTableData(components: Array<{ type: string; content: unknown }>) {
    return components
      .filter(comp => comp.type === 'TABLE' || comp.type === 'DATA_CELL')
      .map(comp => comp.content)
  }

  private calculateColumnWidths(components: Array<{ type: string; content: unknown }>) {
    // Calculate optimal widths based on content
    return [15, 20, 15, 15, 15] // Default widths
  }

  private sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)
  }
}

// ==================== PPTX RENDERER ====================

export class PptxRenderer implements DocumentRenderer {
  readonly format: OutputFormat = 'PPTX'

  async render(document: RenderableDocument): Promise<RendererOutput> {
    // In production, this would use:
    // - pptxgenjs for PowerPoint generation
    
    const content = this.buildPptxContent(document)
    const filename = `${this.sanitizeFilename(document.specification.title)}.pptx`

    return {
      buffer: Buffer.from(JSON.stringify(content, null, 2), 'utf-8'),
      filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      size: 0,
    }
  }

  private buildPptxContent(document: RenderableDocument) {
    const slides = document.sections.map(section => ({
      type: section.type === 'cover' ? 'title' : 
            section.type === 'heading' ? 'section' : 'content',
      title: section.title,
      content: section.components.map(comp => ({
        type: comp.type,
        content: comp.content,
      })),
    }))

    return {
      title: document.specification.title,
      author: document.specification.metadata.author || 'Filo',
      subject: document.specification.description,
      design: {
        theme: document.specification.design.theme.variant,
        colors: document.specification.design.colors,
        fonts: document.specification.design.typography,
      },
      slides,
      branding: document.branding,
    }
  }

  private sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)
  }
}

// ==================== CSV RENDERER ====================

export class CsvRenderer implements DocumentRenderer {
  readonly format: OutputFormat = 'CSV'

  async render(document: RenderableDocument): Promise<RendererOutput> {
    const csvContent = this.buildCsvContent(document)
    const filename = `${this.sanitizeFilename(document.specification.title)}.csv`

    return {
      buffer: Buffer.from(csvContent, 'utf-8'),
      filename,
      mimeType: 'text/csv',
      size: csvContent.length,
    }
  }

  private buildCsvContent(document: RenderableDocument): string {
    const rows: string[][] = []
    
    // Extract table data from all sections
    for (const section of document.sections) {
      for (const component of section.components) {
        if (component.type === 'TABLE' && Array.isArray(component.content)) {
          rows.push(...(component.content as string[][]))
        }
      }
    }

    if (rows.length === 0) {
      // Fallback: create CSV from text content
      rows.push(['Title', 'Content'])
      for (const section of document.sections) {
        const textContent = section.components
          .filter(c => c.type === 'PARAGRAPH')
          .map(c => typeof c.content === 'object' && c.content !== null && 'text' in c.content 
            ? (c.content as { text: string }).text 
            : JSON.stringify(c.content))
          .join(' ')
        rows.push([section.title, textContent])
      }
    }

    // Escape and format as CSV
    return rows.map(row =>
      row.map(cell => {
        const str = String(cell)
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }).join(',')
    ).join('\n')
  }

  private sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)
  }
}

// ==================== RENDERER REGISTRY ====================

export const renderers: Map<OutputFormat, DocumentRenderer> = new Map([
  ['DOCX', new DocxRenderer()],
  ['PDF', new PdfRenderer()],
  ['XLSX', new XlsxRenderer()],
  ['PPTX', new PptxRenderer()],
  ['CSV', new CsvRenderer()],
])

/**
 * Get renderer for a specific format
 */
export function getRenderer(format: OutputFormat): DocumentRenderer | undefined {
  return renderers.get(format)
}

/**
 * Render an artifact specification to the specified format
 */
export async function renderArtifact(
  specification: ArtifactSpecification,
  components: Array<{ sectionId: string; componentId: string; type: string; content: unknown; style?: Record<string, unknown>; order: number }>,
  format: OutputFormat
): Promise<RendererOutput> {
  const renderer = getRenderer(format)
  
  if (!renderer) {
    throw new Error(`No renderer available for format: ${format}`)
  }

  const document = prepareForRendering(specification, components)
  return renderer.render(document)
}

/**
 * Get supported export formats
 */
export function getSupportedFormats(): OutputFormat[] {
  return Array.from(renderers.keys())
}
