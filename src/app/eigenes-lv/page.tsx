import { PlannedWorkspacePage } from "@/components/planned-workspace-page";

export default function OwnLvPage() {
  return (
    <PlannedWorkspacePage
      eyebrow="LV-AUTORING"
      title="Eigenes LV"
      description="Eigene Positionen, Mengen und technische Merkmale zu einem LV-Entwurf zusammenstellen."
      boundary="Dieser Editor bleibt getrennt von Angebotsvergleich und Kalkulation. Produktpositionen erhalten vor Export eine fachliche Prüfung."
    />
  );
}
