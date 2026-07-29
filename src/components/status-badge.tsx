const toneMap: Record<string, string> = {
  CLEAR_RECOMMENDATION: "success",
  EXACT: "success",
  VERIFIED_NATIVE: "success",
  "Extrahiert": "success",
  "Geprüft": "success",
  "Klassifiziert": "neutral",
  "Isoliert": "neutral",
  PROBABLE: "warning",
  PRICE_UNCLEAR: "warning",
  MATCHING_UNCLEAR: "warning",
  DECISION_REQUIRED: "warning",
  DIFFERENT_SCOPE_OF_SUPPLY: "warning",
  TECHNICAL_DEVIATION: "danger",
  NO_OFFER: "muted",
  BLOCKING: "danger",
  WARNING: "warning",
  VISUAL_ONLY_UNCONFIRMED: "warning",
  "Prüfung offen": "warning",
  "Automatisch ausgewählt": "success",
  "Entscheidung durch Leitung erforderlich": "warning",
  "Technische Systemprüfung erforderlich": "danger",
  "Manuell entschieden": "success",
  "Zurückgestellt": "muted",
  "Kein vergleichbares Angebot": "muted",
  "Verarbeitung ausstehend": "warning",
  "Verarbeitungsfehler": "danger",
  "3 Hinweise": "warning"
};

export function StatusBadge({ children }: { children: string }) {
  const tone = toneMap[children] ?? "neutral";
  const label = children.replaceAll("_", " ");
  return <span className={`status-badge status-${tone}`}>{label}</span>;
}
