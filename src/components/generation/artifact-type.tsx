"use client";

// =============================================================================
// Artifact type model — shared by the Create experience and the libraries.
// The output format the AI generation pipeline supports (from
// src/services/agent-router: DocumentFormat).
// =============================================================================

import { FileText, FileSpreadsheet, Presentation, FileType2, Table2, type LucideIcon } from "lucide-react";

export interface DocumentTypeMeta {
  icon: LucideIcon;
  label: string;
  chip: string;
}

export interface ArtifactTypeOption {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Output formats the pipeline can render for this type. */
  formats: string[];
  suggestedFormat: string;
  examples: string[];
}

export const ARTIFACT_TYPES: ArtifactTypeOption[] = [
  {
    id: "document",
    label: "Document",
    description: "Reports, proposals, memos, essays",
    icon: FileText,
    formats: ["DOCX", "PDF", "TXT"],
    suggestedFormat: "DOCX",
    examples: [
      "A 10-page investor update for our fintech seed round: metrics summary, product progress, runway — confident tone",
      "A project status report for a hospital management system rollout, with risks and next milestones",
      "A university essay on the impact of remote work on productivity, with a references section",
    ],
  },
  {
    id: "spreadsheet",
    label: "Spreadsheet",
    description: "Models, budgets, trackers, data sheets",
    icon: FileSpreadsheet,
    formats: ["XLSX", "CSV"],
    suggestedFormat: "XLSX",
    examples: [
      "A 12-month startup budget with salary, marketing and infrastructure lines, and a burn-rate summary sheet",
      "A personal finance tracker with monthly income vs expense categories and a savings goal sheet",
      "An inventory sheet for a clothing store with reorder thresholds and supplier contacts",
    ],
  },
  {
    id: "presentation",
    label: "Presentation",
    description: "Decks, pitch stories, training slides",
    icon: Presentation,
    formats: ["PPTX"],
    suggestedFormat: "PPTX",
    examples: [
      "A 12-slide pitch deck for a delivery app targeting secondary cities in Pakistan",
      "An onboarding training deck for new customer support agents, with a quiz section",
      "A quarterly business review presentation for a marketing agency",
    ],
  },
  {
    id: "pdf",
    label: "PDF",
    description: "Fixed-layout reports, one-pagers",
    icon: FileType2,
    formats: ["PDF"],
    suggestedFormat: "PDF",
    examples: [
      "A one-page product overview PDF for our SaaS billing platform",
      "A terms-of-service summary document formatted for print",
      "A research summary PDF on renewable energy adoption in South Asia",
    ],
  },
  {
    id: "csv",
    label: "CSV data",
    description: "Clean tabular data exports",
    icon: Table2,
    formats: ["CSV"],
    suggestedFormat: "CSV",
    examples: [
      "A CSV of 30 sample customers with name, city, plan and signup date for testing an import flow",
      "A product catalog CSV with SKU, category, price and stock columns",
    ],
  },
];

export function findType(id: string | null | undefined): ArtifactTypeOption {
  return ARTIFACT_TYPES.find((t) => t.id === id) ?? ARTIFACT_TYPES[0];
}
