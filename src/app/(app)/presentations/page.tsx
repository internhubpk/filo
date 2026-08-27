"use client";

import { Presentation } from "lucide-react";
import { ArtifactLibrary } from "@/components/shared/artifact-library";

export default function PresentationsPage() {
  return (
    <ArtifactLibrary
      title="Presentations"
      description="Pitch decks, business reviews and training slides — structured slide by slide."
      artifactType="presentation"
      typeMeta={{ icon: Presentation, label: "PPTX", chip: "bg-orange-500/10 text-orange-600 dark:text-orange-400" }}
      createHref="/create?type=presentation"
      createLabel="New presentation"
    />
  );
}
