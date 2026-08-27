"use client";

import { FileSpreadsheet } from "lucide-react";
import { ArtifactLibrary } from "@/components/shared/artifact-library";

export default function SpreadsheetsPage() {
  return (
    <ArtifactLibrary
      title="Spreadsheets"
      description="Budgets, models, trackers and data sheets with working formulas and sheets."
      artifactType="spreadsheet"
      typeMeta={{ icon: FileSpreadsheet, label: "XLSX", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" }}
      createHref="/create?type=spreadsheet"
      createLabel="New spreadsheet"
    />
  );
}
