"use client";

// =============================================================================
// /documents — the ONE file library (documents, spreadsheets, presentations).
// =============================================================================
// All generated files live here with type filters, search, sort, grid/list
// views, multi-select, bulk ZIP download, bulk delete, per-file version
// history and per-format export — real Convex-backed data with the four
// mandatory states handled inside <ArtifactsWorkspace>.
// =============================================================================
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ArtifactsWorkspace } from "@/components/shared/artifacts-workspace";

export default function DocumentsPage() {
  return (
    <Suspense fallback={null}>
      <DocumentsWithParams />
    </Suspense>
  );
}

function DocumentsWithParams() {
  const params = useSearchParams();
  const type = params.get("type");
  const valid = ["document", "spreadsheet", "presentation"];
  const initialType = type && valid.includes(type) ? type : "all";

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <ArtifactsWorkspace
          variant="page"
          title="Documents"
          description="Everything you've generated in Chat — filter, select and manage your files."
          initialType={initialType}
        />
      </div>
    </div>
  );
}
