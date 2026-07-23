export const project = {
  id: "demo-project",
  name: "Projekt Nordtor",
  reference: "SPT-2026-014",
  discipline: "Heizung & Sanitär",
  status: "IN PRÜFUNG",
  documents: 8,
  pages: 146,
  progress: 72
};

export const documents = [
  {
    id: "doc-basis",
    name: "Basis-LV Heizung.pdf",
    type: "BASIS_LV",
    supplier: "—",
    pages: 38,
    mode: "Digital",
    status: "Extrahiert"
  },
  {
    id: "doc-a",
    name: "Angebot Alpha.pdf",
    type: "SUPPLIER_OFFER",
    supplier: "Lieferant Alpha",
    pages: 24,
    mode: "Digital",
    status: "Geprüft"
  },
  {
    id: "doc-b",
    name: "Angebot Beta.pdf",
    type: "SUPPLIER_OFFER",
    supplier: "Lieferant Beta",
    pages: 31,
    mode: "Hybrid",
    status: "3 Hinweise"
  },
  {
    id: "doc-c",
    name: "Angebot Gamma Scan.pdf",
    type: "SUPPLIER_OFFER",
    supplier: "Lieferant Gamma",
    pages: 18,
    mode: "Scan",
    status: "Prüfung offen"
  },
  {
    id: "doc-calc",
    name: "Hersteller-Auslegung.pdf",
    type: "MANUFACTURER_CALCULATION",
    supplier: "Hersteller",
    pages: 17,
    mode: "Hybrid",
    status: "Klassifiziert"
  },
  {
    id: "doc-history",
    name: "Historischer Vergleich.xlsx.pdf",
    type: "HISTORICAL_CALCULATION",
    supplier: "—",
    pages: 4,
    mode: "Digital",
    status: "Isoliert"
  }
];

export const issues = [
  {
    id: "issue-price",
    code: "PRICE_BASIS_UNCLEAR",
    severity: "BLOCKING",
    title: "Preisbasis nicht eindeutig",
    description: "EP und GP sind belegt, die Preisbasis 100 ist im Tabellenkopf jedoch nur indirekt erkennbar.",
    document: "Angebot Beta.pdf",
    page: 12,
    field: "Preisbasis",
    current: "100",
    candidates: ["1", "100"],
    source: "je 100 Stück · EP 248,00 · GP 744,00"
  },
  {
    id: "issue-bundle",
    code: "BUNDLE_COMPOSITION_DIFFERENCE",
    severity: "WARNING",
    title: "Abweichender Lieferumfang",
    description: "Das erforderliche Anschlussset ist als separate Zeile ausgewiesen.",
    document: "Angebot Gamma Scan.pdf",
    page: 6,
    field: "Rolle",
    current: "REQUIRED_COMPONENT",
    candidates: ["REQUIRED_COMPONENT", "OPTIONAL"],
    source: "Anschlussset, passend zu Position 2.3.10"
  },
  {
    id: "issue-match",
    code: "UNMATCHED_OFFER_LINE",
    severity: "WARNING",
    title: "Angebotszeile nicht zugeordnet",
    description: "Die Positionsnummer stimmt nicht mit dem LV überein; die Beschreibung ist nur wahrscheinlich.",
    document: "Angebot Alpha.pdf",
    page: 19,
    field: "Zuordnung",
    current: "—",
    candidates: ["2.4.20", "2.4.30"],
    source: "Regelmodul DN 25, komplett"
  }
];

export const comparisonRows = [
  {
    position: "2.3.10",
    description: "Hocheffizienz-Umwälzpumpe",
    quantity: "3 Stk",
    alpha: "2.380,00 €",
    beta: "2.412,00 €",
    gamma: "2.190,00 €",
    recommendation: "Lieferant Alpha",
    status: "CLEAR_RECOMMENDATION",
    scope: "vollständig"
  },
  {
    position: "2.3.20",
    description: "Anschlussset mit Absperrung",
    quantity: "3 Stk",
    alpha: "inklusive",
    beta: "324,00 €",
    gamma: "289,00 €",
    recommendation: "Entscheidung",
    status: "DIFFERENT_SCOPE_OF_SUPPLY",
    scope: "abweichend"
  },
  {
    position: "2.4.10",
    description: "Regelventil DN 20",
    quantity: "8 Stk",
    alpha: "1.184,00 €",
    beta: "1.096,00 €",
    gamma: "—",
    recommendation: "Lieferant Beta",
    status: "CLEAR_RECOMMENDATION",
    scope: "vollständig"
  },
  {
    position: "2.4.20",
    description: "Regelmodul, vorkonfiguriert",
    quantity: "2 Stk",
    alpha: "684,00 €",
    beta: "Preis offen",
    gamma: "712,00 €",
    recommendation: "Prüfung",
    status: "PRICE_UNCLEAR",
    scope: "vollständig"
  },
  {
    position: "3.1.10",
    description: "Pufferspeicher 500 l",
    quantity: "1 Stk",
    alpha: "3.940,00 €",
    beta: "3.780,00 €",
    gamma: "4.115,00 €",
    recommendation: "Technik prüfen",
    status: "TECHNICAL_DEVIATION",
    scope: "Alternative"
  },
  {
    position: "3.2.10",
    description: "Wärmedämmung Speicher",
    quantity: "1 Stk",
    alpha: "inklusive",
    beta: "inklusive",
    gamma: "—",
    recommendation: "Kein Angebot",
    status: "NO_OFFER",
    scope: "Pflichtteil"
  }
];

export const extractedLines = [
  {
    source: "Angebot Alpha",
    position: "A-120",
    description: "Hocheffizienzpumpe mit Regelmodul",
    quantity: "3",
    unit: "Stk",
    role: "PRIMARY",
    ep: "793,33 €",
    gp: "2.380,00 €",
    evidence: "VERIFIED_NATIVE"
  },
  {
    source: "Angebot Alpha",
    position: "A-121",
    description: "Anschlussset",
    quantity: "3",
    unit: "Stk",
    role: "INCLUDED_ACCESSORY",
    ep: "inkl.",
    gp: "inkl.",
    evidence: "VERIFIED_NATIVE"
  },
  {
    source: "Angebot Beta",
    position: "B-88",
    description: "Umwälzpumpe, elektronisch geregelt",
    quantity: "3",
    unit: "Stk",
    role: "PRIMARY",
    ep: "804,00 €",
    gp: "2.412,00 €",
    evidence: "VERIFIED_NATIVE"
  },
  {
    source: "Angebot Gamma",
    position: "17",
    description: "Anschlussset passend zu Position 16",
    quantity: "3",
    unit: "Satz",
    role: "UNKNOWN",
    ep: "96,33 €",
    gp: "289,00 €",
    evidence: "VISUAL_ONLY_UNCONFIRMED"
  }
];

export const matchingRows = [
  {
    basis: "2.3.10",
    offer: "A-120",
    supplier: "Lieferant Alpha",
    kind: "ONE_TO_ONE",
    score: 0.94,
    status: "EXACT",
    reason: "Beschreibung, Menge und Einheit stimmen überein."
  },
  {
    basis: "2.3.10 + 2.3.20",
    offer: "B-88 + B-89",
    supplier: "Lieferant Beta",
    kind: "MANY_TO_MANY",
    score: 0.82,
    status: "PROBABLE",
    reason: "Hauptgerät und Anschlussset sind getrennt angeboten."
  },
  {
    basis: "2.4.20",
    offer: "A-144",
    supplier: "Lieferant Alpha",
    kind: "ONE_TO_ONE",
    score: 0.67,
    status: "PROBABLE",
    reason: "Beschreibung ähnlich, Positionsnummer weicht ab."
  },
  {
    basis: "3.1.10",
    offer: "G-42 + G-43",
    supplier: "Lieferant Gamma",
    kind: "ONE_TO_MANY",
    score: 0.74,
    status: "REPLACEMENT",
    reason: "Alternatives Fabrikat mit separater Dämmung."
  }
];

export const workflowSteps = [
  { label: "Dokumente", value: 8, state: "done" },
  { label: "Extraktion", value: 146, state: "done" },
  { label: "Prüfung", value: 3, state: "active" },
  { label: "Zuordnung", value: 84, state: "active" },
  { label: "Entscheidungen", value: 4, state: "pending" },
  { label: "Export", value: 0, state: "pending" }
];
