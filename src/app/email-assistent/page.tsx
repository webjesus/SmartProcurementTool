import { PlannedWorkspacePage } from "@/components/planned-workspace-page";

export default function EmailAssistantPage() {
  return (
    <PlannedWorkspacePage
      eyebrow="KOMMUNIKATIONSENTWURF"
      title="E-Mail-Assistent"
      description="Deutsche Geschäftskorrespondenz im Projektkontext formulieren."
      boundary="Der Assistent erzeugt nur einen prüfbaren Textentwurf. Ein autonomer Versand oder Zugriff auf Postfächer ist im MVP nicht vorgesehen."
    />
  );
}
