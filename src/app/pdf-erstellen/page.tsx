import { PlannedWorkspacePage } from "@/components/planned-workspace-page";

export default function PdfCreationPage() {
  return (
    <PlannedWorkspacePage
      eyebrow="DOKUMENTENTWURF"
      title="PDF erstellen"
      description="Technische Produktunterlagen aus freigegebenen Quellen vorbereiten."
      boundary="Der Assistent wird Quellen, Pflichtinhalte und Dokumenttyp abfragen. Jeder Entwurf bleibt bis zur fachlichen Freigabe deutlich als Entwurf markiert."
    />
  );
}
