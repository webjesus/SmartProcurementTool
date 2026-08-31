import { PlannedWorkspacePage } from "@/components/planned-workspace-page";

export default function RevisionDocumentsPage() {
  return (
    <PlannedWorkspacePage
      eyebrow="VORLAGENSTRUKTUR"
      title="Revisionsunterlagen"
      description="Freigegebene Ordnerstruktur und Ablageregeln nachvollziehbar bereitstellen."
      boundary="Die verbindliche Ordnerpyramide wird erst übernommen, sobald die Firmenvorlage vollständig vorliegt. Bis dahin wird keine Struktur erfunden."
    />
  );
}
