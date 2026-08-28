// =============================================================================
// FILO THEME ENGINE (spec §9)
// =============================================================================
// A registry of validated, professional theme families. The AI Designer stage
// (see design-planning.ts) selects a theme by id; this module resolves it into
// the full DesignSpecification consumed by every renderer (DOCX / PDF / PPTX /
// XLSX). Theme selection is therefore CLOSED-WORLD: the AI cannot invent
// random colors or fonts — it may only fine-tune the accent within safe
// constraints.
//
// This module is deliberately PURE (no 'docx', no 'sharp', no DOM): it is
// imported by the Convex worker bundle as well as the Next.js render runtime.
// =============================================================================

import type {
  ColorPalette,
  DesignSpecification,
  LayoutConfig,
  SpacingConfig,
  ThemeConfig,
  TypographyConfig,
} from '@/types'

// ==================== THEME TOKENS ====================

export interface ThemeTokens {
  id: string
  label: string
  /** Short description surfaced to the AI designer so it can pick well. */
  description: string
  colors: ColorPalette
  typography: TypographyConfig
  spacing: SpacingConfig
  layout: Partial<LayoutConfig>
  /** How tables should look in this theme. */
  table: 'minimal' | 'banded' | 'boxed' | 'dark-header' | 'editorial'
  /** How the cover page should look. */
  cover: 'banner' | 'centered' | 'sidebar' | 'minimal' | 'gradient-bar'
  /** Chart color sequence (hex) — mathematically rendered by the chart engine. */
  chartPalette: string[]
  /** Preferred heading treatment for PPTX slides. */
  headingCase: 'title' | 'upper'
}

const BASE_LAYOUT: LayoutConfig = {
  pageSize: 'A4',
  orientation: 'portrait',
  columns: 1,
  margins: { top: '72pt', right: '72pt', bottom: '72pt', left: '72pt' },
  headerEnabled: true,
  footerEnabled: true,
  pageNumberPosition: 'bottom',
}

const BASE_SPACING: SpacingConfig = {
  unit: '8px',
  pageMargin: '72pt',
  sectionSpacing: '24pt',
  paragraphSpacing: '12pt',
  itemSpacing: '6pt',
}

function palette(
  primary: string,
  accent: string,
  foreground: string,
  background: string,
  muted: string,
  mutedForeground: string,
  border: string,
  card: string
): ColorPalette {
  return {
    primary,
    secondary: foreground,
    accent,
    background,
    foreground,
    muted,
    mutedForeground,
    border,
    card,
    cardForeground: foreground,
    success: '#16a34a',
    warning: '#d97706',
    error: '#dc2626',
    info: '#2563eb',
  }
}

function typography(headingFont: string, bodyFont: string, monoFont = 'Courier New'): TypographyConfig {
  return {
    headingFont,
    bodyFont,
    monoFont,
    headingSizes: { h1: 28, h2: 22, h3: 18, h4: 15, h5: 13, h6: 12 },
    bodySize: 11,
    lineHeight: 1.5,
    scale: 1.25,
  }
}

// ==================== THE 18 THEME FAMILIES ====================

export const THEMES: ThemeTokens[] = [
  {
    id: 'executive',
    label: 'Executive',
    description: 'Authoritative boardroom style — deep navy, gold accents, generous spacing. Ideal for board reports and executive briefings.',
    colors: palette('#1e3a5f', '#b8860b', '#1a2332', '#ffffff', '#f4f6f9', '#5a6b7f', '#d5dce4', '#fbfcfd'),
    typography: typography('Georgia', 'Calibri'),
    spacing: { ...BASE_SPACING, sectionSpacing: '28pt' },
    layout: { headerEnabled: true, footerEnabled: true },
    table: 'banded',
    cover: 'banner',
    chartPalette: ['#1e3a5f', '#b8860b', '#4a6fa5', '#8b9dc3', '#c9a227', '#2c4f7c'],
    headingCase: 'title',
  },
  {
    id: 'corporate',
    label: 'Corporate',
    description: 'Clean corporate identity — primary blue, structured grids, safe for internal communications and business documentation.',
    colors: palette('#1d4ed8', '#3b82f6', '#0f172a', '#ffffff', '#f1f5f9', '#64748b', '#e2e8f0', '#f8fafc'),
    typography: typography('Arial', 'Calibri'),
    spacing: BASE_SPACING,
    layout: {},
    table: 'boxed',
    cover: 'banner',
    chartPalette: ['#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd', '#1e40af', '#0ea5e9'],
    headingCase: 'title',
  },
  {
    id: 'academic',
    label: 'Academic',
    description: 'Scholarly serif typography, restrained grayscale plus deep green, formal citations. Ideal for theses and papers.',
    colors: palette('#14532d', '#166534', '#1f2937', '#ffffff', '#f3f4f6', '#4b5563', '#d1d5db', '#f9fafb'),
    typography: typography('Times New Roman', 'Times New Roman'),
    spacing: { ...BASE_SPACING, paragraphSpacing: '12pt' },
    layout: {},
    table: 'minimal',
    cover: 'centered',
    chartPalette: ['#14532d', '#4b5563', '#6b7280', '#9ca3af', '#166534', '#374151'],
    headingCase: 'title',
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Technical report style — indigo primary, teal accent, data-forward tables and figures. Ideal for research reports and white papers.',
    colors: palette('#312e81', '#0d9488', '#111827', '#ffffff', '#eef2ff', '#63728a', '#dbe2ea', '#fafbff'),
    typography: typography('Calibri', 'Calibri', 'Consolas'),
    spacing: BASE_SPACING,
    layout: {},
    table: 'banded',
    cover: 'sidebar',
    chartPalette: ['#312e81', '#0d9488', '#4f46e5', '#14b8a6', '#6366f1', '#2dd4bf'],
    headingCase: 'title',
  },
  {
    id: 'modern-tech',
    label: 'Modern Tech',
    description: 'Contemporary technology aesthetic — electric violet, cyan accents, geometric spacing. Ideal for product and engineering docs.',
    colors: palette('#6d28d9', '#06b6d4', '#18181b', '#fafafa', '#f1f0f7', '#71717a', '#e4e4e7', '#ffffff'),
    typography: typography('Verdana', 'Segoe UI', 'Consolas'),
    spacing: { ...BASE_SPACING, sectionSpacing: '22pt' },
    layout: {},
    table: 'banded',
    cover: 'gradient-bar',
    chartPalette: ['#6d28d9', '#06b6d4', '#8b5cf6', '#22d3ee', '#a78bfa', '#67e8f9'],
    headingCase: 'title',
  },
  {
    id: 'startup',
    label: 'Startup',
    description: 'Energetic pitch style — vivid indigo and coral, bold headings. Ideal for pitch decks and growth proposals.',
    colors: palette('#4f46e5', '#f97316', '#111827', '#ffffff', '#fef2f2', '#6b7280', '#fecaca', '#fffbeb'),
    typography: typography('Trebuchet MS', 'Segoe UI'),
    spacing: { ...BASE_SPACING, sectionSpacing: '20pt' },
    layout: {},
    table: 'minimal',
    cover: 'gradient-bar',
    chartPalette: ['#4f46e5', '#f97316', '#818cf8', '#fb923c', '#a5b4fc', '#fdba74'],
    headingCase: 'upper',
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Swiss minimalism — near-black text, hairline rules, maximum whitespace. Lets content carry the design.',
    colors: palette('#111111', '#444444', '#111111', '#ffffff', '#f5f5f5', '#737373', '#e5e5e5', '#ffffff'),
    typography: typography('Helvetica', 'Helvetica'),
    spacing: { ...BASE_SPACING, sectionSpacing: '30pt', paragraphSpacing: '14pt' },
    layout: {},
    table: 'minimal',
    cover: 'minimal',
    chartPalette: ['#111111', '#555555', '#888888', '#aaaaaa', '#cccccc', '#333333'],
    headingCase: 'title',
  },
  {
    id: 'editorial',
    label: 'Editorial',
    description: 'Magazine-style layout — crimson accents, serif headlines, pull-quote friendly. Ideal for newsletters and feature reports.',
    colors: palette('#7f1d1d', '#b91c1c', '#1c1917', '#fffbf5', '#fef3e2', '#78716c', '#e7d8c3', '#fffdf8'),
    typography: typography('Georgia', 'Georgia'),
    spacing: BASE_SPACING,
    layout: {},
    table: 'editorial',
    cover: 'sidebar',
    chartPalette: ['#7f1d1d', '#b45309', '#b91c1c', '#d97706', '#991b1b', '#f59e0b'],
    headingCase: 'title',
  },
  {
    id: 'luxury',
    label: 'Luxury',
    description: 'Premium brand aesthetic — charcoal and champagne gold, refined serif headings. Ideal for high-end proposals and brochures.',
    colors: palette('#292524', '#a98548', '#1c1917', '#fdfcfa', '#f5f0e8', '#8a837a', '#e3dcd2', '#fffef9'),
    typography: typography('Palatino Linotype', 'Palatino Linotype'),
    spacing: { ...BASE_SPACING, sectionSpacing: '28pt' },
    layout: {},
    table: 'editorial',
    cover: 'centered',
    chartPalette: ['#292524', '#a98548', '#57534e', '#c9a86a', '#8a837a', '#e0c891'],
    headingCase: 'upper',
  },
  {
    id: 'financial',
    label: 'Financial',
    description: 'Analyst-grade styling — deep green, tabular numerals focus, dense but readable. Ideal for budgets, forecasts and financial statements.',
    colors: palette('#064e3b', '#059669', '#0f172a', '#ffffff', '#ecfdf5', '#4b6570', '#d1e7dd', '#f6fef9'),
    typography: typography('Calibri', 'Calibri', 'Consolas'),
    spacing: { ...BASE_SPACING, paragraphSpacing: '10pt' },
    layout: { orientation: 'portrait' },
    table: 'banded',
    cover: 'banner',
    chartPalette: ['#064e3b', '#059669', '#0d9488', '#34d399', '#0f766e', '#6ee7b7'],
    headingCase: 'title',
  },
  {
    id: 'medical',
    label: 'Medical',
    description: 'Clinical clarity — teal primary, calm blue accents, high legibility. Ideal for healthcare reports and patient-facing material.',
    colors: palette('#0e7490', '#0284c7', '#0f172a', '#ffffff', '#ecfeff', '#64748b', '#cffafe', '#f8feff'),
    typography: typography('Calibri', 'Calibri'),
    spacing: BASE_SPACING,
    layout: {},
    table: 'boxed',
    cover: 'banner',
    chartPalette: ['#0e7490', '#0284c7', '#06b6d4', '#38bdf8', '#155e75', '#7dd3fc'],
    headingCase: 'title',
  },
  {
    id: 'legal',
    label: 'Legal',
    description: 'Formal legal styling — oxblood and navy, conservative serif faces, numbered clauses. Ideal for contracts and legal memoranda.',
    colors: palette('#3f1d38', '#1e3a5f', '#111827', '#ffffff', '#f8f7f9', '#52525b', '#ddd8de', '#fcfbfd'),
    typography: typography('Times New Roman', 'Times New Roman'),
    spacing: { ...BASE_SPACING, sectionSpacing: '26pt' },
    layout: {},
    table: 'minimal',
    cover: 'centered',
    chartPalette: ['#3f1d38', '#1e3a5f', '#6b7280', '#9ca3af', '#5b2c4f', '#2c4f7c'],
    headingCase: 'title',
  },
  {
    id: 'government',
    label: 'Government',
    description: 'Public-sector style — navy and slate, strict hierarchy, accessible contrast. Ideal for policy briefs and official reports.',
    colors: palette('#1e3a5f', '#475569', '#0f172a', '#ffffff', '#f1f5f9', '#475569', '#cbd5e1', '#f8fafc'),
    typography: typography('Arial', 'Arial'),
    spacing: BASE_SPACING,
    layout: {},
    table: 'boxed',
    cover: 'banner',
    chartPalette: ['#1e3a5f', '#475569', '#64748b', '#94a3b8', '#2c4f7c', '#334155'],
    headingCase: 'upper',
  },
  {
    id: 'education',
    label: 'Education',
    description: 'Friendly learning style — warm amber and sky blue, approachable headings. Ideal for lesson plans and course material.',
    colors: palette('#b45309', '#0284c7', '#292524', '#fffdf7', '#fef3c7', '#78716c', '#fde68a', '#fffbeb'),
    typography: typography('Verdana', 'Segoe UI'),
    spacing: BASE_SPACING,
    layout: {},
    table: 'banded',
    cover: 'gradient-bar',
    chartPalette: ['#b45309', '#0284c7', '#f59e0b', '#38bdf8', '#d97706', '#7dd3fc'],
    headingCase: 'title',
  },
  {
    id: 'creative',
    label: 'Creative',
    description: 'Studio energy — magenta and tangerine, expressive headings. Ideal for portfolios, campaign decks and creative briefs.',
    colors: palette('#be185d', '#ea580c', '#1f2937', '#fffbfd', '#fdf2f8', '#6b7280', '#fbcfe8', '#fff5fa'),
    typography: typography('Trebuchet MS', 'Segoe UI'),
    spacing: { ...BASE_SPACING, sectionSpacing: '22pt' },
    layout: {},
    table: 'minimal',
    cover: 'gradient-bar',
    chartPalette: ['#be185d', '#ea580c', '#ec4899', '#f97316', '#f472b6', '#fb923c'],
    headingCase: 'upper',
  },
  {
    id: 'professional-dark',
    label: 'Professional Dark',
    description: 'Dark-premium slides — near-black canvas, emerald and cyan highlights. Ideal for investor decks and screen-first reading.',
    colors: palette('#f8fafc', '#34d399', '#f8fafc', '#0b1220', '#1e293b', '#94a3b8', '#334155', '#111c2e'),
    typography: typography('Verdana', 'Segoe UI', 'Consolas'),
    spacing: { ...BASE_SPACING, sectionSpacing: '22pt' },
    layout: {},
    table: 'dark-header',
    cover: 'gradient-bar',
    chartPalette: ['#34d399', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#60a5fa'],
    headingCase: 'title',
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    description: 'Showcase style — graphite base with a single violet accent, strong typography scale. Ideal for personal portfolios and case studies.',
    colors: palette('#312e81', '#4338ca', '#1e1b4b', '#ffffff', '#eef2ff', '#6e7491', '#d9defa', '#f8f9ff'),
    typography: typography('Georgia', 'Segoe UI'),
    spacing: { ...BASE_SPACING, sectionSpacing: '26pt' },
    layout: {},
    table: 'editorial',
    cover: 'sidebar',
    chartPalette: ['#312e81', '#4338ca', '#6366f1', '#818cf8', '#3730a3', '#a5b4fc'],
    headingCase: 'upper',
  },
  {
    id: 'marketing',
    label: 'Marketing',
    description: 'Campaign-ready style — royal blue and lime, punchy metrics blocks. Ideal for marketing plans and campaign reports.',
    colors: palette('#1d4ed8', '#65a30d', '#111827', '#ffffff', '#f7fee7', '#64748b', '#d9f99d', '#fcffef'),
    typography: typography('Trebuchet MS', 'Segoe UI'),
    spacing: { ...BASE_SPACING, sectionSpacing: '22pt' },
    layout: {},
    table: 'banded',
    cover: 'gradient-bar',
    chartPalette: ['#1d4ed8', '#65a30d', '#3b82f6', '#84cc16', '#60a5fa', '#a3e635'],
    headingCase: 'upper',
  },
]

export const THEME_IDS = THEMES.map((t) => t.id)

// ==================== RESOLUTION ====================

export function getTheme(id: string | undefined | null): ThemeTokens {
  const normalized = String(id || '').toLowerCase().trim()
  const found = THEMES.find((t) => t.id === normalized)
  return found ?? THEMES[0] // executive is the safe default
}

export function themeExists(id: string): boolean {
  return THEMES.some((t) => t.id === String(id).toLowerCase().trim())
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/**
 * Resolve a theme into a full DesignSpecification, applying SAFE fine-tuning.
 * The AI may override `accent` only, and only with a valid hex color — every
 * other token comes from the validated registry (spec §9: "The AI chooses a
 * theme and optionally fine-tunes its tokens within safe constraints").
 */
export function resolveTheme(
  themeId: string | undefined | null,
  options?: {
    accentOverride?: string | null
    format?: 'DOCX' | 'PDF' | 'XLSX' | 'PPTX' | 'CSV'
    orientation?: 'portrait' | 'landscape'
  }
): { design: DesignSpecification; tokens: ThemeTokens } {
  const tokens = getTheme(themeId)
  const isSpreadsheet = options?.format === 'XLSX' || options?.format === 'CSV'
  const isPresentation = options?.format === 'PPTX'

  let accent = tokens.colors.accent
  if (options?.accentOverride && HEX_COLOR_RE.test(options.accentOverride)) {
    accent = options.accentOverride
  }

  const themeConfig: ThemeConfig = {
    name: tokens.id,
    variant: isPresentation ? 'modern' : 'professional',
    primaryStyle: 'formal',
  }

  const layout: LayoutConfig = {
    ...BASE_LAYOUT,
    ...tokens.layout,
    orientation:
      options?.orientation ??
      (isSpreadsheet ? 'landscape' : tokens.layout.orientation ?? 'portrait'),
    headerEnabled: isSpreadsheet ? false : (tokens.layout.headerEnabled ?? true),
    footerEnabled: isSpreadsheet ? false : (tokens.layout.footerEnabled ?? true),
  }

  const design: DesignSpecification = {
    theme: themeConfig,
    typography: {
      ...tokens.typography,
      bodySize: isPresentation ? 14 : tokens.typography.bodySize,
    },
    spacing: { ...tokens.spacing },
    colors: { ...tokens.colors, accent },
    layout,
  }

  return { design, tokens }
}

/** Chart palette for a theme (accent-tuned). Renderers pass this to the chart engine. */
export function chartPaletteFor(tokens: ThemeTokens, accent?: string | null): string[] {
  if (accent && HEX_COLOR_RE.test(accent)) {
    return [accent, ...tokens.chartPalette.slice(0, -1)]
  }
  return tokens.chartPalette
}

/** One-line catalog for AI designer prompts (id — description). */
export function themeCatalogForPrompt(): string {
  return THEMES.map((t) => `- ${t.id}: ${t.description}`).join('\n')
}
