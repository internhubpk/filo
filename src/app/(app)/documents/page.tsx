"use client";

import { FileText } from "lucide-react";
import { ArtifactLibrary } from "@/components/shared/artifact-library";

export default function DocumentsPage() {
  return (
    <ArtifactLibrary
      title="Documents"
      description="Reports, proposals, memos and essays — generated and stored as real files."
      artifactType="document"
      typeMeta={{ icon: FileText, label: "DOCX", chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400" }}
      createHref="/create?type=document"
      createLabel="New document"
    />
  );
}
