import { SUPPLIER_BRANDS } from "@/domain/brand-registry";
import type {
  BrowserClassificationDimensions,
  BrowserDiscipline,
  BrowserDocumentRecord,
  BrowserDocumentType,
  BrowserRelationType,
  BrowserScanState,
  ClassificationConfidence
} from "@/browser-projects/types";

export type BrowserPdfInspection = {
  pageCount: number;
  metadata: Record<string, unknown>;
  text: string;
  textLayerCharacterCount: number;
  inspectedPageCount: number;
  pagesWithText: number;
};

export type BrowserDocumentClassification = {
  detectedDocumentType: BrowserDocumentType;
  documentType: BrowserDocumentType;
  discipline: BrowserDiscipline;
  supplierName: string | null;
  offerNumber: string | null;
  documentVersion: string | null;
  revision: number | null;
  revisionOfDocumentId: string | null;
  relationType: BrowserRelationType;
  scanState: BrowserScanState;
  projectName: string | null;
  projectNumber: string | null;
  lvNumber: string | null;
  confidence: ClassificationConfidence;
  dimensions: BrowserClassificationDimensions;
  signals: string[];
  warnings: string[];
  preliminaryPositionCount: number;
};

export type BrowserDocumentCluster = {
  id: string;
  projectName: string | null;
  projectNumber: string | null;
  discipline: BrowserDiscipline;
  basisDocumentIds: string[];
  supplierDocumentIds: string[];
  auxiliaryDocumentIds: string[];
  pendingOcrDocumentIds: string[];
};

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactOfferWord(value: string): string {
  return value.replace(/\bA\s+n\s+g\s+e\s+b\s+o\s+t\b/giu, "Angebot");
}

function matchValue(value: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return normalized(match[1]).replace(/[.,;]+$/u, "");
  }
  return null;
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function supplierFrom(value: string): string | null {
  for (const supplier of SUPPLIER_BRANDS) {
    if (
      [supplier.displayName, supplier.shortName, ...supplier.aliases].some(
        (alias) =>
          new RegExp(
            `(?:^|[^\\p{L}\\p{N}])${escapePattern(alias).replace(/\\ /g, "\\s+")}(?:$|[^\\p{L}\\p{N}])`,
            "iu"
          ).test(value)
      )
    ) {
      return supplier.shortName;
    }
  }
  if (/pfeiffer\s*&\s*may|p\s*&\s*m\b/iu.test(value)) return "P&M";
  return matchValue(value, [
    /(?:Lieferant|Anbieter)\s*[:_-]?\s*([\p{L}\p{N}& .-]{2,80})/iu
  ]);
}

function count(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function preliminaryPositionCount(value: string): number {
  const basis = value.match(/\b\d+(?:\.\d+){2,}\.?(?=\s)/gu) ?? [];
  const supplier = value.match(/\b(?:LV\.?\s*Pos\.?|LVNR)\s*\d+(?:[ .]\d+){2,}/giu) ?? [];
  return new Set([...basis, ...supplier].map((item) => item.replace(/\s+/g, "."))).size;
}

function disciplineFrom(value: string): {
  discipline: BrowserDiscipline;
  confidence: ClassificationConfidence;
  signals: string[];
} {
  const heatingStrong = count(
    value,
    /\b(?:Heizungsinstallation|Wärmeerzeugungsanlage|Wärmeverteilnetze|Heizungsleitungen)\b/giu
  );
  const sanitaryStrong = count(
    value,
    /\b(?:Sanitärinstallation|Sanitaerinstallation|Sanitärobjekte|Trinkwasserinstallation|Entwässerungsanlage)\b/giu
  );
  const heatingWeak = count(value, /\b(?:Heizung|Heizkreis|Wärme)\w*/giu);
  const heatingProducts = count(
    value,
    /\b(?:Wärmepumpe|Heizkessel|Heizgerät|Brenner|Heizungsregler)\w*/giu
  );
  const sanitaryWeak = count(
    value,
    /\b(?:Sanitär|Sanitaer|Trinkwasser|Abfluss|Abwasser|Waschtisch|WC|Urinal|Dusch|Geberit|Viega)\w*/giu
  );
  const installationSystems = count(
    value,
    /\b(?:GIS Tragsystem|Installationssysteme|Geberit ProPlanner)\b/giu
  );
  if (installationSystems >= 1 && sanitaryStrong === 0 && heatingStrong === 0) {
    return {
      discipline: "INSTALLATIONSSYSTEME",
      confidence: "HIGH",
      signals: ["Installationssysteme/GIS erkannt"]
    };
  }
  const heatingScore =
    heatingStrong * 4 +
    Math.min(heatingWeak, 8) +
    Math.min(heatingProducts, 6) * 2;
  const sanitaryScore = sanitaryStrong * 4 + Math.min(sanitaryWeak, 8);
  if (heatingScore >= sanitaryScore + 4) {
    return {
      discipline: "HEIZUNG",
      confidence: heatingStrong > 0 ? "HIGH" : "MEDIUM",
      signals: ["Heizungs-Fachstruktur erkannt"]
    };
  }
  if (sanitaryScore >= heatingScore + 4) {
    return {
      discipline: "SANITAER",
      confidence: sanitaryStrong > 0 ? "HIGH" : "MEDIUM",
      signals: ["Sanitär-Fachstruktur erkannt"]
    };
  }
  if (heatingScore > 0 && sanitaryScore > 0) {
    return {
      discipline: "MULTI",
      confidence: "MEDIUM",
      signals: ["Heizungs- und Sanitärmerkmale erkannt"]
    };
  }
  return { discipline: "UNKNOWN", confidence: "LOW", signals: [] };
}

function roleScores(value: string, fileName: string) {
  const basisSignals = [
    ["Angebotsaufforderung", /\bAngebotsaufforderung\b/iu, 6],
    ["LV-Daten", /\bLV[- ]?Daten\b/iu, 6],
    ["LV-Bezeichnung", /\bLV[- ]?Bezeichnung\b/iu, 4],
    ["LV-Nummer", /\bLV[- ]?Nummer\b/iu, 4],
    ["Inhaltsverzeichnis", /\bInhaltsverzeichnis\b/iu, 2],
    ["Basis-Positionsstruktur", /\b\d+(?:\.\d+){2,}\.\s+\p{L}/iu, 4]
  ] as const;
  const offerSignals = [
    ["Angebot", /\b(?:Referenzangebot|Angebot)\b/iu, 4],
    ["Angebotsnummer", /\b(?:Angebotsnummer|Angebot\s*Nr\.?)\b/iu, 5],
    ["Preisstruktur", /\b(?:E-?Preis|Einzelpreis|Gesamtpreis|Materialpreis|LVNR|LV\.Pos\.)\b/iu, 3],
    ["Lieferantenanschreiben", /\b(?:Kd-Nr|Kundennummer|Gültig bis|Außendienst|Innendienst)\b/iu, 2]
  ] as const;
  let basis = 0;
  let offer = 0;
  const signals: string[] = [];
  for (const [label, pattern, score] of basisSignals) {
    if (pattern.test(value)) {
      basis += score;
      signals.push(label);
    }
  }
  for (const [label, pattern, score] of offerSignals) {
    if (pattern.test(value)) {
      offer += score;
      signals.push(label);
    }
  }
  if (/\b(?:Basis[-_ ]?LV|LV\s+(?:Heizung|Sanitär|Sanitaer))\b/iu.test(fileName)) {
    basis += 1;
    signals.push("Dateiname unterstützt Basis-LV");
  }
  return { basis, offer, signals };
}

function offerNumberFrom(value: string, fileName: string): string | null {
  return matchValue(value, [
    /(?:Referenzangebot\s*-\s*Netto\s*)?Angebotsnummer\s*[:#]?\s*(\d{6,}(?:[-/]\d{1,3})?)/iu,
    /\bAngebot\s+(?:Nr\.?\s*[:#]?\s*)?(\d{6,}(?:[-/]\d{1,3})?)/iu,
    /\b(\d{6,}(?:[-/]\d{1,3})?)\s+Angebot\s+Nr\.?/iu
  ]) ?? matchValue(fileName, [/\b(\d{6,}(?:-\d{1,3})?)\b/u]);
}

export function classifyBrowserDocumentContent(input: {
  fileName: string;
  inspection: BrowserPdfInspection;
}): BrowserDocumentClassification {
  const metadataText = Object.values(input.inspection.metadata)
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const value = compactOfferWord(
    normalized(`${metadataText}\n${input.inspection.text}`)
  );
  const scanState: BrowserScanState =
    input.inspection.textLayerCharacterCount < 40
      ? "OCR_REQUIRED"
      : input.inspection.pagesWithText < input.inspection.inspectedPageCount
        ? "PARTIAL_TEXT"
        : "TEXT_AVAILABLE";
  const supplierName = supplierFrom(value);
  const offerNumber = offerNumberFrom(
    value,
    supplierName ? input.fileName : ""
  );
  const versionPatterns = [
    /\bVersion\s*[:.]?\s*([A-Z0-9.-]+)/iu,
    /\bV\.\s*([0-9]+)\b/iu
  ];
  const documentVersion =
    matchValue(normalized(input.inspection.text), versionPatterns) ??
    matchValue(normalized(metadataText), versionPatterns);
  const lvNumber = matchValue(value, [
    /\bLV[- ]?Nummer\s*[:#]?\s*([A-Z0-9]+(?:[-/][A-Z0-9]+)+(?:\s+[A-Z])?)/iu
  ]);
  const matchedProjectName = matchValue(value, [
    /\bProjektbezeichnung\s*:\s*([^\r\n]{2,100}?)(?=\s+Projektnummer|\s+PLZ:)/iu,
    /\bProjekt\s*:\s*([^\r\n]{2,100}?)(?=\s+TEL:|\s+FAX:|\s+Best\.Nr)/iu,
    /\bIhre Referenz\s*:\s*([^\r\n]{2,100}?)(?=\s+\d{2}\.\d{2}\.\d{2,4}|\s+Anfragedatum)/iu
  ]);
  const projectName =
    matchedProjectName &&
    /\p{L}/u.test(matchedProjectName) &&
    !/^\d{1,2}\.\d{1,2}\.\d{2,4}$/u.test(matchedProjectName)
      ? matchedProjectName
      : null;
  const projectNumber = matchValue(value, [
    /\bProjektnummer\s*:\s*([A-Z0-9./-]+)/iu,
    /\bProjekt\s*:\s*([0-9]{3,})\b/iu
  ]);
  const discipline = disciplineFrom(value);
  const scores = roleScores(value, input.fileName);
  const signals = [...scores.signals, ...discipline.signals];
  const warnings: string[] = [];
  let documentType: BrowserDocumentType;
  let roleConfidence: ClassificationConfidence;

  if (scanState === "OCR_REQUIRED") {
    documentType = "SCAN_OCR_REQUIRED";
    roleConfidence = "HIGH";
    signals.push("Keine nutzbare Textebene");
    warnings.push("Scan erkannt. OCR erforderlich.");
  } else if (
    /\b(?:kein\s+Angebot|nicht\s+angeboten|wir\s+sehen\s+von\s+einem\s+Angebot\s+ab|Absage)\b/iu.test(
      value
    )
  ) {
    documentType = "EXPLICIT_NO_BID";
    roleConfidence = supplierName ? "HIGH" : "MEDIUM";
    signals.push("Explizite Nichtangebots-Erklärung erkannt");
  } else if (
    /\bKalkulation\s*\(Gesamt\)|\bGeberit\s+ProPlanner\b|\bGIS\s+Tragsystem\b/iu.test(
      value
    )
  ) {
    documentType = "TECHNICAL_CALCULATION";
    roleConfidence = "HIGH";
    signals.push("Technische Kalkulationsstruktur erkannt");
  } else if (scores.basis >= 12 && scores.basis >= scores.offer + 5) {
    documentType = "BASIS_LV";
    roleConfidence = "HIGH";
  } else if (
    scores.offer >= 8 ||
    (scores.offer >= 4 && Boolean(supplierName && offerNumber))
  ) {
    documentType = "SUPPLIER_OFFER";
    roleConfidence = supplierName && offerNumber ? "HIGH" : "MEDIUM";
  } else if (/\b(?:Datenblatt|Produktinformation|Technische Unterlage)\b/iu.test(value)) {
    documentType = "TECHNICAL_DOCUMENT";
    roleConfidence = "MEDIUM";
  } else if (/\b(?:Begleitschreiben|Anschreiben)\b/iu.test(value)) {
    documentType = "COVER_LETTER";
    roleConfidence = "MEDIUM";
  } else if (/\b(?:Anlage|Anhang)\b/iu.test(value)) {
    documentType = "OFFER_ATTACHMENT";
    roleConfidence = "LOW";
  } else {
    documentType = "UNKNOWN";
    roleConfidence = "LOW";
    warnings.push("Dokumentrolle konnte nicht sicher bestimmt werden.");
  }

  if (
    documentType === "BASIS_LV" &&
    scores.offer > scores.basis
  ) {
    documentType = "SUPPLIER_OFFER";
    roleConfidence = "HIGH";
    warnings.push("Eindeutige Angebotsmerkmale schließen Basis-LV aus.");
  }
  if (
    ["SUPPLIER_OFFER", "MANUFACTURER_OFFER"].includes(documentType) &&
    !supplierName
  ) {
    warnings.push("Lieferant konnte nicht sicher erkannt werden.");
  }
  if (discipline.discipline === "UNKNOWN") {
    warnings.push("Disziplin konnte nicht sicher erkannt werden.");
  }

  const dimensions: BrowserClassificationDimensions = {
    documentRole: roleConfidence,
    supplier: supplierName ? "HIGH" : documentType === "BASIS_LV" ? "HIGH" : "LOW",
    discipline: discipline.confidence,
    projectIdentity: projectName || projectNumber ? "HIGH" : "LOW",
    offerNumber:
      offerNumber && documentType !== "BASIS_LV"
        ? "HIGH"
        : documentType === "BASIS_LV"
          ? "HIGH"
          : "LOW",
    relation:
      documentType === "SUPPLIER_OFFER" && offerNumber ? "HIGH" : "LOW",
    scanState: "HIGH"
  };
  return {
    detectedDocumentType: documentType,
    documentType,
    discipline: discipline.discipline,
    supplierName: documentType === "BASIS_LV" ? null : supplierName,
    offerNumber: documentType === "BASIS_LV" ? null : offerNumber,
    documentVersion,
    revision: null,
    revisionOfDocumentId: null,
    relationType:
      documentType === "SUPPLIER_OFFER"
        ? "SEPARATE_OFFER"
        : "UNKNOWN_RELATION",
    scanState,
    projectName,
    projectNumber,
    lvNumber,
    confidence: roleConfidence,
    dimensions,
    signals,
    warnings,
    preliminaryPositionCount: preliminaryPositionCount(value)
  };
}

export function isStructurallyPlausibleBasis(
  document: Pick<
    BrowserDocumentRecord,
    | "documentType"
    | "detectedDocumentType"
    | "classificationSignals"
    | "preliminaryPositionCount"
    | "supplierName"
    | "offerNumber"
    | "scanState"
  >
): boolean {
  const signalCount = document.classificationSignals.filter((signal) =>
    ["Angebotsaufforderung", "LV-Daten", "LV-Bezeichnung", "LV-Nummer", "Basis-Positionsstruktur"].includes(
      signal
    )
  ).length;
  return (
    document.documentType === "BASIS_LV" &&
    document.detectedDocumentType === "BASIS_LV" &&
    document.scanState !== "OCR_REQUIRED" &&
    !document.supplierName &&
    !document.offerNumber &&
    signalCount >= 2 &&
    document.preliminaryPositionCount > 0
  );
}

export function invalidManualBasisWarning(
  document: BrowserDocumentRecord
): string | null {
  if (document.detectedDocumentType !== "SUPPLIER_OFFER") return null;
  const supplier = document.supplierName ?? "einem Lieferanten";
  return `Die Datei enthält eindeutige Merkmale eines Lieferantenangebots von ${supplier} und entspricht wahrscheinlich keinem Basis-LV.`;
}

export function reconcileDocumentRelations(
  documents: readonly BrowserDocumentRecord[]
): BrowserDocumentRecord[] {
  return documents.map((document) => {
    if (
      !["SUPPLIER_OFFER", "MANUFACTURER_OFFER"].includes(document.documentType) ||
      !document.offerNumber
    ) {
      return document;
    }
    const related = documents
      .filter(
        (candidate) =>
          candidate.documentId !== document.documentId &&
          candidate.supplierName === document.supplierName &&
          candidate.offerNumber === document.offerNumber
      )
      .sort((left, right) => left.uploadedAt.localeCompare(right.uploadedAt));
    if (!related.length) {
      return {
        ...document,
        relationType: "SEPARATE_OFFER" as const,
        revisionOfDocumentId: null
      };
    }
    const predecessor = related.at(-1)!;
    const versionChanged =
      Boolean(document.documentVersion) &&
      document.documentVersion !== predecessor.documentVersion;
    return {
      ...document,
      relationType: versionChanged ? "NEW_REVISION" : "UNKNOWN_RELATION",
      revisionOfDocumentId: versionChanged ? predecessor.documentId : null
    };
  });
}

export function applyAutomaticBasisSelection(
  documents: readonly BrowserDocumentRecord[]
): BrowserDocumentRecord[] {
  const candidatesByDiscipline = new Map<BrowserDiscipline, string[]>();
  for (const document of documents) {
    if (document.documentType !== "BASIS_LV") continue;
    const candidates = candidatesByDiscipline.get(document.discipline) ?? [];
    candidates.push(document.documentId);
    candidatesByDiscipline.set(document.discipline, candidates);
  }
  return documents.map((document) => {
    const candidates = candidatesByDiscipline.get(document.discipline) ?? [];
    const manuallyActive = documents.filter(
      (candidate) =>
        candidate.discipline === document.discipline &&
        candidate.documentType === "BASIS_LV" &&
        candidate.activeBasis
    );
    return {
      ...document,
      activeBasis:
        document.documentType === "BASIS_LV" &&
        ((candidates.length === 1 &&
          candidates[0] === document.documentId) ||
          (candidates.length > 1 &&
            manuallyActive.length === 1 &&
            manuallyActive[0].documentId === document.documentId))
    };
  });
}

export function buildDocumentClusters(
  documents: readonly BrowserDocumentRecord[]
): BrowserDocumentCluster[] {
  const map = new Map<string, BrowserDocumentCluster>();
  const basisProjectsByDiscipline = new Map<
    BrowserDiscipline,
    Array<{
      canonical: string;
      aliases: string[];
      projectName: string | null;
      projectNumber: string | null;
    }>
  >();
  for (const document of documents) {
    if (document.documentType !== "BASIS_LV") continue;
    const identity = document.projectNumber ?? document.projectName;
    if (!identity) continue;
    const projects =
      basisProjectsByDiscipline.get(document.discipline) ?? [];
    if (!projects.some((project) => project.canonical === identity)) {
      projects.push({
        canonical: identity,
        aliases: [document.projectNumber, document.projectName].filter(
          (value): value is string => Boolean(value)
        ),
        projectName: document.projectName,
        projectNumber: document.projectNumber
      });
    }
    basisProjectsByDiscipline.set(document.discipline, projects);
  }
  for (const document of documents) {
    const discipline =
      document.discipline === "INSTALLATIONSSYSTEME"
        ? "SANITAER"
        : document.discipline;
    const knownProjects = basisProjectsByDiscipline.get(discipline);
    const documentIdentities = [
      document.projectNumber,
      document.projectName
    ].filter((value): value is string => Boolean(value));
    const fuzzyBasisProject =
      documentIdentities.length && knownProjects
        ? knownProjects.find((project) =>
            documentIdentities.some((documentIdentity) => {
              const normalizedIdentity =
                documentIdentity.toLocaleLowerCase("de");
              return project.aliases.some((identity) => {
                const candidate = identity.toLocaleLowerCase("de");
                return (
                  normalizedIdentity.includes(candidate) ||
                  candidate.includes(normalizedIdentity)
                );
              });
            })
          )
        : null;
    const resolvedBasisProject =
      fuzzyBasisProject ?? (knownProjects?.length === 1 ? knownProjects[0] : null);
    const inferredProject = resolvedBasisProject?.canonical ?? null;
    const key = [
      inferredProject ??
        document.projectNumber ??
        document.projectName ??
        "unknown-project",
      discipline
    ].join(":");
    const cluster = map.get(key) ?? {
      id: key,
      projectName: resolvedBasisProject?.projectName ?? document.projectName,
      projectNumber:
        resolvedBasisProject?.projectNumber ?? document.projectNumber,
      discipline,
      basisDocumentIds: [],
      supplierDocumentIds: [],
      auxiliaryDocumentIds: [],
      pendingOcrDocumentIds: []
    };
    if (document.documentType === "BASIS_LV") {
      cluster.basisDocumentIds.push(document.documentId);
    } else if (
      ["SUPPLIER_OFFER", "MANUFACTURER_OFFER", "EXPLICIT_NO_BID"].includes(
        document.documentType
      )
    ) {
      cluster.supplierDocumentIds.push(document.documentId);
    } else if (document.documentType === "SCAN_OCR_REQUIRED") {
      cluster.pendingOcrDocumentIds.push(document.documentId);
    } else {
      cluster.auxiliaryDocumentIds.push(document.documentId);
    }
    map.set(key, cluster);
  }
  return [...map.values()];
}
