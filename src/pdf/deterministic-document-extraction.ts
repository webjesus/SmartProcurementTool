import { createHash } from "node:crypto";
import type {
  BasisPosition,
  Discipline,
  DocumentType,
  EvidenceReference,
  ExtractionEnvelope,
  ExtractionRunProvenance,
  ExtractedSection,
  MoneyCandidate,
  OfferLine,
  OfferLineRole
} from "@/domain/contracts";
import type { ParsedPage } from "@/domain/repositories";
import {
  parseGermanNumber,
  pricesApproximatelyEqual,
  type ValidationIssue
} from "@/domain/validation";
import {
  reconstructTextLines,
  routeExtractionPage,
  type ReconstructedTextLine
} from "@/pdf/deterministic-extraction";

export const DETERMINISTIC_BASIS_DOCUMENT_PARSER_VERSION =
  "deterministic-basis-document-v1";
export const DETERMINISTIC_SUPPLIER_DOCUMENT_PARSER_VERSION =
  "deterministic-supplier-layout-v1";

type TextItem = ParsedPage["textItems"][number];

interface DocumentLine {
  pageNumber: number;
  order: number;
  line: ReconstructedTextLine;
}

export interface DeterministicDocumentPageResult {
  pageNumber: number;
  envelope: ExtractionEnvelope;
  validationIssues: ValidationIssue[];
  provenance: ExtractionRunProvenance;
  parsedRecordCount: number;
  candidateAnchorCount: number;
  continuationRecordCount: number;
}

export interface DeterministicBasisDocumentResult {
  pages: DeterministicDocumentPageResult[];
  leafPositions: BasisPosition[];
  headingPositions: BasisPosition[];
  sections: ExtractedSection[];
  metrics: {
    totalCandidateAnchors: number;
    totalValidLeafPositions: number;
    duplicatePositionNumbers: string[];
    missingQuantityOrUnit: string[];
    continuationPositions: string[];
    unresolvedBlocks: string[];
  };
}

export interface DeterministicSupplierDocumentResult {
  layout: "GC_LVNR" | "P_AND_M" | "REISSER_LV_POS" | "SPECIALIZED_LV_POS";
  pages: DeterministicDocumentPageResult[];
  lines: OfferLine[];
  metrics: {
    parsedLines: number;
    explicitNoOfferLines: number;
    optionalLines: number;
    alternativeLines: number;
    continuationLines: number;
    fallbackCandidateIds: string[];
  };
}

const clean = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

const search = (value: string) =>
  clean(value)
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");

function stableId(prefix: string, ...parts: unknown[]): string {
  return `${prefix}_${createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 18)}`;
}

function unionRegion(items: readonly TextItem[]): EvidenceReference["region"] {
  if (items.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...items.map((item) => item.region.x));
  const top = Math.min(...items.map((item) => item.region.y));
  const right = Math.max(
    ...items.map((item) => item.region.x + item.region.width)
  );
  const bottom = Math.max(
    ...items.map((item) => item.region.y + item.region.height)
  );
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function evidenceForLines(
  documentId: string,
  key: string,
  lines: readonly DocumentLine[]
): EvidenceReference[] {
  const byPage = new Map<number, TextItem[]>();
  for (const entry of lines) {
    const pageItems = byPage.get(entry.pageNumber) ?? [];
    pageItems.push(...entry.line.items);
    byPage.set(entry.pageNumber, pageItems);
  }
  return [...byPage.entries()].map(([pageNumber, items]) => {
    const uniqueItems = Array.from(
      new Map(items.map((item) => [item.id, item])).values()
    ).sort((left, right) => left.order - right.order);
    return {
      id: stableId(
        "evidence",
        documentId,
        pageNumber,
        key,
        uniqueItems.map((item) => item.id)
      ),
      documentId,
      pageNumber,
      textItemIds: uniqueItems.map((item) => item.id),
      sourceText: uniqueItems
        .map((item) => clean(item.normalizedText || item.rawText))
        .join(" "),
      region: unionRegion(uniqueItems),
      cropPath: null,
      status: "VERIFIED_NATIVE" as const
    };
  });
}

function documentLines(pages: readonly ParsedPage[]): DocumentLine[] {
  return [...pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .flatMap((page) =>
      reconstructTextLines(page)
        .filter((line) => line.region.y < 0.92)
        .map((line, order) => ({ pageNumber: page.pageNumber, order, line }))
    );
}

function rawTextItemsHash(page: ParsedPage): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        page.textItems.map((item) => ({
          id: item.id,
          text: item.normalizedText,
          region: item.region,
          order: item.order
        }))
      )
    )
    .digest("hex");
}

function issue(input: {
  code: ValidationIssue["code"];
  severity: ValidationIssue["severity"];
  message: string;
  documentId: string;
  pageNumber: number;
  lineId?: string;
  affectedFields?: string[];
}): ValidationIssue {
  return {
    id: stableId(
      "issue",
      input.code,
      input.documentId,
      input.pageNumber,
      input.lineId,
      input.message
    ),
    code: input.code,
    severity: input.severity,
    message: input.message,
    documentId: input.documentId,
    pageNumber: input.pageNumber,
    lineId: input.lineId,
    affectedFields: input.affectedFields
  };
}

function provenance(input: {
  documentRevisionId: string;
  page: ParsedPage;
  parserVersion: string;
  issues: readonly ValidationIssue[];
  fallbackIds: readonly string[];
  confidence: number;
  createdAt: string;
}): ExtractionRunProvenance {
  const blocking = input.issues.some((candidate) => candidate.severity === "BLOCKING");
  return {
    extractionMethod: "DETERMINISTIC_TEXT_LAYER",
    documentRevisionId: input.documentRevisionId,
    pageNumber: input.page.pageNumber,
    rawTextItemsHash: rawTextItemsHash(input.page),
    parserVersion: input.parserVersion,
    validationStatus: blocking
      ? "FAILED"
      : input.fallbackIds.length > 0
        ? "NEEDS_REVIEW"
        : "COMPLETED",
    confidence: Math.max(0, Math.min(1, input.confidence)),
    fallbackCandidateBlockIds: [...input.fallbackIds],
    createdAt: input.createdAt
  };
}

function normalizePositionParts(
  first: string,
  second: string,
  third: string
): string {
  return `${Number(first)}.${Number(second)}.${Number(third)}`;
}

function normalizePositionKey(value: string): string {
  const numbers = value.match(/\d+/g)?.slice(0, 3).map(Number);
  return numbers?.length === 3 ? numbers.join(".") : clean(value);
}

function parseBasisAnchor(value: string): {
  normalized: string;
  display: string;
  trailingText: string;
  hasFourthLevel: boolean;
} | null {
  const match = clean(value).match(
    /^(\d+)\s*\.\s*(\d+)\s*\.\s*(\d+)\s*\.(.*)$/
  );
  if (!match) return null;
  const normalized = normalizePositionParts(match[1], match[2], match[3]);
  const trailingText = clean(match[4]);
  return {
    normalized,
    display: `${normalized}.`,
    trailingText,
    hasFourthLevel: /^\d+\b/.test(trailingText)
  };
}

function parseQuantityUnit(value: string): {
  quantity: number | null;
  unit: string | null;
} {
  const match = clean(value).match(
    /^([+\-]?\d[\d.,]*)\s+(St(?:ück|ueck)?|Stk\.?|m|kg|psch|Std|h|Wo|Tag|Satz|L)\b/i
  );
  if (!match) return { quantity: null, unit: null };
  const rawUnit = clean(match[2]);
  return {
    quantity: parseGermanNumber(match[1]),
    unit: /^(st|stk)/i.test(rawUnit) ? "St" : rawUnit
  };
}

function isBasisFurniture(value: string): boolean {
  const normalized = search(value);
  return (
    /^he plantechnik\b/.test(normalized) ||
    /^hohnerstr\./.test(normalized) ||
    /^angebotsaufforderung$/.test(normalized) ||
    /^projekt:/.test(normalized) ||
    /^lv:/.test(normalized) ||
    /^ordnungszahl leistungsbeschreibung/.test(normalized) ||
    /^in eur/.test(normalized) ||
    /^druckdatum:/.test(normalized)
  );
}

function basisRequirements(text: string): string[] {
  const requirements: string[] = [];
  const value = search(text);
  if (/\b(warmedamm|warmedaemm|dammschale|daemmschale|isolier)\w*/.test(value)) {
    requirements.push("Wärmedämmschale");
  }
  if (/\bgegenflansch/.test(value)) requirements.push("Gegenflansche");
  if (/\bdichtung/.test(value)) requirements.push("Dichtungsmaterial");
  if (/\bkleinmaterial/.test(value)) requirements.push("Kleinmaterial");
  if (/\banschlusskabel/.test(value)) requirements.push("Anschlusskabel");
  if (/\bkomplett liefern und montieren\b/.test(value)) {
    requirements.push("Komplett liefern und montieren");
  }
  return Array.from(new Set(requirements));
}

function basisTechnicalAttributes(lines: readonly DocumentLine[]): Array<{
  name: string;
  value: string;
}> {
  return lines.flatMap((entry) => {
    const match = clean(entry.line.text).match(
      /^([^:]{2,48}):\s*(.{1,100})$/
    );
    if (!match) return [];
    const name = clean(match[1]);
    if (/^(fabrikat|typ|art\.-nr|projekt|lv)$/i.test(name)) return [];
    return [{ name, value: clean(match[2]) }];
  });
}

function basisManufacturerRequirements(lines: readonly DocumentLine[]): string[] {
  return Array.from(
    new Set(
      lines.flatMap((entry) => {
        const match = clean(entry.line.text).match(/^Fabrikat\s*:\s*(.+)$/i);
        return match ? [clean(match[1])] : [];
      })
    )
  );
}

function headingSection(
  documentId: string,
  entry: DocumentLine,
  level: "TITLE" | "SECTION" | "SUBSECTION"
): ExtractedSection {
  return {
    id: stableId(
      "section",
      documentId,
      entry.pageNumber,
      level,
      entry.line.text
    ),
    parentId: null,
    label: clean(entry.line.text),
    kind: "HEADING",
    evidence: evidenceForLines(documentId, `section:${level}`, [entry])
  };
}

function detectHierarchySections(
  documentId: string,
  lines: readonly DocumentLine[]
): Array<{ index: number; level: number; section: ExtractedSection }> {
  return lines.flatMap((entry, index) => {
    const value = clean(entry.line.text);
    if (/^\d+\.\s+\d{3}\s+\S/.test(value)) {
      return [{ index, level: 1, section: headingSection(documentId, entry, "TITLE") }];
    }
    if (/^\d+\.\d+\.\s+\d{3}\.\d+\s+\S/.test(value)) {
      return [
        {
          index,
          level: 2,
          section: headingSection(documentId, entry, "SUBSECTION")
        }
      ];
    }
    return [];
  });
}

export function extractBasisDocumentDeterministically(input: {
  documentId: string;
  documentRevisionId: string;
  pages: readonly ParsedPage[];
  discipline?: Discipline;
  existingPositionIdsByNumber?: Readonly<Record<string, string>>;
  createdAt?: string;
}): DeterministicBasisDocumentResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const pages = [...input.pages].sort(
    (left, right) => left.pageNumber - right.pageNumber
  );
  for (const page of pages) {
    const route = routeExtractionPage(page);
    if (route.primary !== "DETERMINISTIC_TEXT_LAYER") {
      throw new Error(
        `Basis page ${page.pageNumber} is not deterministic-text eligible: ${route.reason}`
      );
    }
  }
  const lines = documentLines(pages);
  const hierarchy = detectHierarchySections(input.documentId, lines);
  const anchorCandidates = lines.flatMap((entry, index) => {
    const anchor = parseBasisAnchor(entry.line.text);
    return anchor ? [{ entry, index, anchor }] : [];
  });
  const leafPositions: BasisPosition[] = [];
  const headingPositions: BasisPosition[] = [];
  const unresolvedBlocks: string[] = [];
  const missingQuantityOrUnit: string[] = [];
  const continuationPositions: string[] = [];

  for (let candidateIndex = 0; candidateIndex < anchorCandidates.length; candidateIndex += 1) {
    const candidate = anchorCandidates[candidateIndex];
    const nextIndex =
      anchorCandidates[candidateIndex + 1]?.index ?? lines.length;
    const block = lines.slice(candidate.index, nextIndex);
    const quantityIndex = block.findIndex((entry) => {
      const parsed = parseQuantityUnit(entry.line.text);
      return parsed.quantity !== null && parsed.unit !== null;
    });
    const structuralHeading =
      candidate.anchor.hasFourthLevel ||
      /\.{5,}/.test(candidate.entry.line.text) ||
      /^summe\b/i.test(candidate.anchor.trailingText);
    if (quantityIndex < 0) {
      if (!structuralHeading) {
        unresolvedBlocks.push(candidate.anchor.normalized);
      }
      continue;
    }
    const positionLines = block
      .slice(0, quantityIndex + 1)
      .filter((entry) => !isBasisFurniture(entry.line.text));
    const quantity = parseQuantityUnit(block[quantityIndex].line.text);
    const descriptionParts = [
      candidate.anchor.trailingText,
      ...positionLines
        .slice(1, -1)
        .map((entry) => clean(entry.line.text))
    ].filter(Boolean);
    const description =
      clean(descriptionParts.join(" ")) || `LV-Position ${candidate.anchor.normalized}`;
    const positionEvidence = evidenceForLines(
      input.documentId,
      `basis:${candidate.anchor.normalized}`,
      positionLines
    );
    const continuationEvidence = positionEvidence.filter(
      (reference) => reference.pageNumber !== candidate.entry.pageNumber
    );
    if (continuationEvidence.length > 0) {
      continuationPositions.push(candidate.anchor.normalized);
    }
    if (quantity.quantity === null || quantity.unit === null) {
      missingQuantityOrUnit.push(candidate.anchor.normalized);
    }
    const precedingSections = hierarchy
      .filter((section) => section.index < candidate.index)
      .sort((left, right) => left.index - right.index);
    const hierarchyPath = Array.from(
      new Map(
        precedingSections
          .slice(-2)
          .map((item) => [item.level, item.section.label])
      ).values()
    );
    const existingId =
      input.existingPositionIdsByNumber?.[candidate.anchor.normalized];
    leafPositions.push({
      id:
        existingId ??
        stableId(
          "basis",
          input.documentId,
          candidate.anchor.normalized
        ),
      documentId: input.documentId,
      parentId: precedingSections.at(-1)?.section.id ?? null,
      positionNumber: candidate.anchor.display,
      description,
      quantity: quantity.quantity,
      unit: quantity.unit,
      technicalAttributes: basisTechnicalAttributes(positionLines),
      manufacturerRequirements: basisManufacturerRequirements(positionLines),
      requiredScope: basisRequirements(description),
      notes: candidate.anchor.trailingText
        ? [`Ankertext: ${candidate.anchor.trailingText}`]
        : [],
      optional: /\bbedarfsposition\b|\boptional\b/i.test(search(description)),
      alternative: /\balternativ\b/i.test(search(description)),
      heading: false,
      evidence: positionEvidence,
      hierarchyPath,
      continuationEvidence,
      verificationStatus: "MACHINE_VALIDATED"
    });
  }

  const executionHeadings = lines.flatMap((entry, index) => {
    const match = clean(entry.line.text).match(
      /^\*{3}\s*Ausführungsbeschreibung\s+(\d+)\b/i
    );
    return match ? [{ entry, index, reference: match[1] }] : [];
  });
  for (let index = 0; index < executionHeadings.length; index += 1) {
    const heading = executionHeadings[index];
    const nextHeadingIndex =
      executionHeadings[index + 1]?.index ?? lines.length;
    const firstLeafIndex = anchorCandidates.find(
      (candidate) =>
        candidate.index > heading.index &&
        candidate.index < nextHeadingIndex &&
        leafPositions.some(
          (position) =>
            normalizePositionKey(position.positionNumber) ===
            candidate.anchor.normalized
        )
    )?.index;
    const end = firstLeafIndex ?? nextHeadingIndex;
    const headingLines = lines
      .slice(heading.index, end)
      .filter((entry) => !isBasisFurniture(entry.line.text));
    const description = clean(
      headingLines.map((entry) => entry.line.text).join(" ")
    );
    const evidence = evidenceForLines(
      input.documentId,
      `execution:${heading.reference}`,
      headingLines
    );
    headingPositions.push({
      id: stableId(
        "basis_heading",
        input.documentId,
        heading.reference,
        heading.entry.pageNumber
      ),
      documentId: input.documentId,
      parentId: null,
      positionNumber: `AUSFUEHRUNGSBESCHREIBUNG-${heading.reference}`,
      description,
      quantity: null,
      unit: null,
      technicalAttributes: basisTechnicalAttributes(headingLines),
      manufacturerRequirements: basisManufacturerRequirements(headingLines),
      requiredScope: basisRequirements(description),
      notes: [`Ausführungsbeschreibung ${heading.reference}`],
      optional: false,
      alternative: false,
      heading: true,
      evidence,
      hierarchyPath: [],
      continuationEvidence: evidence.slice(1),
      verificationStatus: "MACHINE_VALIDATED"
    });
  }

  const duplicatePositionNumbers = Array.from(
    new Set(
      leafPositions
        .map((position) => normalizePositionKey(position.positionNumber))
        .filter(
          (number, index, values) => values.indexOf(number) !== index
        )
    )
  );
  const allPositions = [...leafPositions, ...headingPositions];
  const pageResults = pages.map((page) => {
    const pagePositions = allPositions.filter((position) =>
      position.evidence.some(
        (reference, index) =>
          index === 0 && reference.pageNumber === page.pageNumber
      )
    );
    const pageSections = hierarchy
      .filter((entry) => entry.section.evidence[0]?.pageNumber === page.pageNumber)
      .map((entry) => entry.section);
    const pageUnresolved = anchorCandidates
      .filter(
        (candidate) =>
          candidate.entry.pageNumber === page.pageNumber &&
          unresolvedBlocks.includes(candidate.anchor.normalized)
      )
      .map((candidate) => candidate.anchor.normalized);
    const validationIssues: ValidationIssue[] = [
      ...pageUnresolved.map((blockId) =>
        issue({
          code: "PAGE_CONTINUATION_AMBIGUOUS",
          severity: "BLOCKING",
          message: `Basis block ${blockId} has no objectively parseable quantity/unit before the next anchor.`,
          documentId: input.documentId,
          pageNumber: page.pageNumber,
          lineId: blockId,
          affectedFields: ["quantity", "unit", "rowBoundary"]
        })
      ),
      ...duplicatePositionNumbers
        .filter((number) =>
          pagePositions.some(
            (position) => normalizePositionKey(position.positionNumber) === number
          )
        )
        .map((number) =>
          issue({
            code: "ROW_BOUNDARY_AMBIGUOUS",
            severity: "BLOCKING",
            message: `Duplicate Basis position ${number}.`,
            documentId: input.documentId,
            pageNumber: page.pageNumber,
            lineId: number,
            affectedFields: ["positionNumber"]
          })
        )
    ];
    const fallbackIds = validationIssues
      .filter((candidate) => candidate.severity === "BLOCKING")
      .map((candidate) => candidate.lineId)
      .filter((value): value is string => Boolean(value));
    const envelope: ExtractionEnvelope = {
      promptVersion: DETERMINISTIC_BASIS_DOCUMENT_PARSER_VERSION,
      schemaVersion: "deterministic-extraction-contract-v1",
      preprocessingVersion: "pdfjs-text-layer-v1",
      extraction: {
        documentId: input.documentId,
        pageNumber: page.pageNumber,
        pageMode: page.mode,
        documentType: "BASIS_LV",
        discipline: input.discipline ?? "HEIZUNG",
        documentMetadataCandidates: [],
        sections: pageSections,
        offerGroups: [],
        basisPositions: pagePositions,
        unresolvedNotes: pageUnresolved.map(
          (blockId) =>
            `AI_FALLBACK_CANDIDATE ${blockId}: deterministic block unresolved; no automatic fallback sent.`
        )
      }
    };
    return {
      pageNumber: page.pageNumber,
      envelope,
      validationIssues,
      provenance: provenance({
        documentRevisionId: input.documentRevisionId,
        page,
        parserVersion: DETERMINISTIC_BASIS_DOCUMENT_PARSER_VERSION,
        issues: validationIssues,
        fallbackIds,
        confidence:
          validationIssues.length === 0 ? 1 : Math.max(0, 1 - validationIssues.length * 0.2),
        createdAt
      }),
      parsedRecordCount: pagePositions.filter((position) => !position.heading).length,
      candidateAnchorCount: anchorCandidates.filter(
        (candidate) => candidate.entry.pageNumber === page.pageNumber
      ).length,
      continuationRecordCount: pagePositions.filter(
        (position) => (position.continuationEvidence?.length ?? 0) > 0
      ).length
    };
  });
  return {
    pages: pageResults,
    leafPositions,
    headingPositions,
    sections: hierarchy.map((entry) => entry.section),
    metrics: {
      totalCandidateAnchors: anchorCandidates.length,
      totalValidLeafPositions: leafPositions.length,
      duplicatePositionNumbers,
      missingQuantityOrUnit,
      continuationPositions,
      unresolvedBlocks
    }
  };
}

function extractBasisReference(value: string): string | null {
  const range = clean(value).match(
    /(\d+)\s*[.\s]\s*(\d+)\s*[.\s]\s*(\d+)\s*(?:-|bis)\s*(?:(\d+)\s*[.\s]\s*(\d+)\s*[.\s]\s*)?(\d+)/i
  );
  if (range) {
    const start = normalizePositionParts(range[1], range[2], range[3]);
    const end = range[4]
      ? normalizePositionParts(range[4], range[5], range[6])
      : normalizePositionParts(range[1], range[2], range[6]);
    return `${start}-${end}`;
  }
  const match = clean(value).match(
    /(?:^|[(:\s])(\d+)\s*[.\s]\s*(\d+)\s*[.\s]\s*(\d+)(?:\.|\s|$)/
  );
  return match
    ? normalizePositionParts(match[1], match[2], match[3])
    : null;
}

function supplierLayout(lines: readonly DocumentLine[]): DeterministicSupplierDocumentResult["layout"] {
  const sample = lines.map((entry) => entry.line.text).join("\n");
  if (/\bPOS\s+\d+\s+LVNR\b/i.test(sample)) return "GC_LVNR";
  if (/\bAngebotsposition\b/i.test(sample)) return "P_AND_M";
  if (/\bzu\s+LV-Pos\.\s*:/i.test(sample)) return "SPECIALIZED_LV_POS";
  if (/Materialnr\./i.test(sample) && /LV\.Pos\./i.test(sample)) {
    return "REISSER_LV_POS";
  }
  throw new Error("No supported deterministic supplier layout signature found.");
}

function supplierManufacturer(description: string): string | null {
  const first = clean(description).split(" ")[0]?.replace(/[,:;]+$/, "");
  if (!first || first.length < 3 || /^\d/.test(first)) return null;
  return /^[\p{Lu}][\p{L}\p{N}&.-]+$/u.test(first) ? first : null;
}

interface ParsedSupplierRecord {
  pageNumber: number;
  sourcePositionNumber: string | null;
  supplierPositionNumber: string | null;
  articleNumber: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  unitPriceRaw: string | null;
  totalPriceRaw: string | null;
  priceBasis?: 1 | 10 | 100 | 1000;
  role: OfferLineRole;
  evidenceLines: DocumentLine[];
  continuation: boolean;
}

function money(
  documentId: string,
  lineId: string,
  kind: "UNIT_PRICE" | "TOTAL_PRICE",
  rawValue: string,
  evidenceLines: readonly DocumentLine[]
): MoneyCandidate {
  return {
    id: stableId("money", lineId, kind, rawValue),
    kind,
    rawValue,
    amount: parseGermanNumber(rawValue),
    currency: "EUR",
    priceBasis: 1,
    evidence: evidenceForLines(
      documentId,
      `money:${lineId}:${kind}`,
      evidenceLines
    )
  };
}

function toOfferLine(
  documentId: string,
  record: ParsedSupplierRecord
): OfferLine {
  const lineId = stableId(
    "line",
    documentId,
    record.pageNumber,
    record.sourcePositionNumber,
    record.supplierPositionNumber,
    record.articleNumber,
    record.role
  );
  const candidates: MoneyCandidate[] = [
    ...(record.unitPriceRaw
      ? [money(documentId, lineId, "UNIT_PRICE", record.unitPriceRaw, record.evidenceLines)]
      : []),
    ...(record.totalPriceRaw
      ? [money(documentId, lineId, "TOTAL_PRICE", record.totalPriceRaw, record.evidenceLines)]
      : [])
  ];
  const explicitNoOffer = ["NOT_OFFERED", "PROVIDED_BY_OTHERS"].includes(
    record.role
  );
  return {
    id: lineId,
    sourcePositionNumber: record.sourcePositionNumber,
    supplierPositionNumber: record.supplierPositionNumber,
    description: clean(record.description),
    manufacturer: supplierManufacturer(record.description),
    articleNumber: record.articleNumber,
    quantity: record.quantity,
    unit: record.unit,
    priceBasis: record.priceBasis ?? 1,
    currency: "EUR",
    moneyCandidates: candidates,
    interpretedUnitPrice: record.unitPrice,
    interpretedTotalPrice: record.totalPrice,
    role: record.role,
    groupId: record.sourcePositionNumber
      ? stableId("bundle", documentId, record.sourcePositionNumber)
      : null,
    continuation: record.continuation,
    evidence: evidenceForLines(documentId, `line:${lineId}`, record.evidenceLines),
    verificationStatus: "MACHINE_VALIDATED",
    lockedFields: [],
    completenessStatus: explicitNoOffer ? "NOT_OFFERED" : "PRICED_OFFER",
    completenessReason: explicitNoOffer
      ? "Supplier source explicitly states that no offer is provided."
      : "Native text-layer row, prices and evidence parsed deterministically."
  };
}

function parseSupplierQuantity(value: string): number | null {
  const normalized = clean(value);
  if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    return Number(normalized.replace(/\./g, ""));
  }
  return parseGermanNumber(normalized);
}

function parsePandM(lines: readonly DocumentLine[]): ParsedSupplierRecord[] {
  const anchors = lines.flatMap((entry, index) => {
    if (!/\bAngebotsposition\b/i.test(entry.line.text)) return [];
    const reference = extractBasisReference(entry.line.text);
    return reference ? [{ entry, index, reference }] : [];
  });
  const records: ParsedSupplierRecord[] = [];
  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const anchor = anchors[anchorIndex];
    const end = anchors[anchorIndex + 1]?.index ?? lines.length;
    const block = lines.slice(anchor.index, end);
    if (block.some((entry) => /\bnicht anbieten\b/i.test(entry.line.text))) {
      records.push({
        pageNumber: anchor.entry.pageNumber,
        sourcePositionNumber: anchor.reference,
        supplierPositionNumber: null,
        articleNumber: null,
        description: "Diese Ausschreibungsposition können wir Ihnen nicht anbieten.",
        quantity: null,
        unit: null,
        unitPrice: null,
        totalPrice: null,
        unitPriceRaw: null,
        totalPriceRaw: null,
        role: "NOT_OFFERED",
        evidenceLines: block.filter((entry) => entry.line.region.y < 0.9),
        continuation: false
      });
      continue;
    }
    let optional = false;
    let alternative = /\balternativ\b/i.test(anchor.entry.line.text);
    let primarySeen = false;
    for (let index = 1; index < block.length; index += 1) {
      const entry = block[index];
      if (/optional bieten wir/i.test(entry.line.text)) {
        optional = true;
        continue;
      }
      if (/\balternativ\b/i.test(entry.line.text)) alternative = true;
      const row = clean(entry.line.text).match(
        /^(\d+)\s+(\S+)\s+([\d.,]+)\s+(St(?:ück|ueck)?|Stk\.?|m|kg|L)\s+([\d.,]+)\s+([\d.,]+)$/i
      );
      if (!row) continue;
      let next = index + 1;
      while (
        next < block.length &&
        !/^(\d+)\s+\S+\s+[\d.,]+\s+(?:St|Stück|Stueck|Stk|m|kg|L)\b/i.test(
          clean(block[next].line.text)
        ) &&
        !/optional bieten wir/i.test(block[next].line.text)
      ) {
        next += 1;
      }
      const descriptionLines = block
        .slice(index + 1, next)
        .filter((candidate) => candidate.line.region.y < 0.9);
      const role: OfferLineRole = optional
        ? "OPTIONAL"
        : alternative
          ? "ALTERNATIVE"
          : primarySeen
            ? "MANDATORY_COMPONENT"
            : "PRIMARY";
      records.push({
        pageNumber: entry.pageNumber,
        sourcePositionNumber: anchor.reference,
        supplierPositionNumber: row[1],
        articleNumber: row[2],
        description:
          descriptionLines.map((candidate) => candidate.line.text).join(" ") ||
          row[2],
        quantity: parseSupplierQuantity(row[3]),
        unit: /^st/i.test(row[4]) ? "St" : clean(row[4]),
        unitPrice: parseGermanNumber(row[5]),
        totalPrice: parseGermanNumber(row[6]),
        unitPriceRaw: row[5],
        totalPriceRaw: row[6],
        role,
        evidenceLines: [entry, ...descriptionLines],
        continuation: entry.pageNumber !== anchor.entry.pageNumber
      });
      if (!optional && !alternative) primarySeen = true;
      index = next - 1;
    }
  }
  return records;
}

function parseGcLvnr(lines: readonly DocumentLine[]): ParsedSupplierRecord[] {
  const records: ParsedSupplierRecord[] = [];
  const primaryByReference = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const entry = lines[index];
    const anchor = clean(entry.line.text).match(
      /^POS\s+(\d+)\s+LVNR\s+(\d+)\s+(\d+)\s+(\d+)\b(.*)$/i
    );
    if (anchor) {
      const reference = normalizePositionParts(anchor[2], anchor[3], anchor[4]);
      const next = lines[index + 1];
      const row = next?.line.text.match(
        /^(\S+)\s+(.+?)\s+([\d.,]+)\s+(ST|M|KG|L)\s+([\d.,]+)\s+([\d.,]+)$/i
      );
      if (!row) continue;
      let end = index + 2;
      while (
        end < lines.length &&
        !/^POS\s+\d+\s+LVNR\b/i.test(lines[end].line.text) &&
        !/^\d+\s+\d+\s+\d+(?:-\d+)?\s+(?:Bauseits|siehe vorige Pos)/i.test(
          lines[end].line.text
        ) &&
        !/^(Objektsumme|Zwischensumme|Endbetrag)\b/i.test(lines[end].line.text)
      ) {
        end += 1;
      }
      const descriptionLines = lines
        .slice(index + 2, end)
        .filter((candidate) => candidate.line.region.y < 0.9);
      const alternative = /\balternativ\b/i.test(anchor[5]);
      const role: OfferLineRole = alternative
        ? "ALTERNATIVE"
        : primaryByReference.has(reference)
          ? "MANDATORY_COMPONENT"
          : "PRIMARY";
      records.push({
        pageNumber: entry.pageNumber,
        sourcePositionNumber: reference,
        supplierPositionNumber: anchor[1],
        articleNumber: row[1],
        description: clean(`${row[2]} ${descriptionLines.map((item) => item.line.text).join(" ")}`),
        quantity: parseSupplierQuantity(row[3]),
        unit: /^st$/i.test(row[4]) ? "St" : clean(row[4]),
        unitPrice: parseGermanNumber(row[5]),
        totalPrice: parseGermanNumber(row[6]),
        unitPriceRaw: row[5],
        totalPriceRaw: row[6],
        priceBasis: /\bper\s+100\b/i.test(
          `${row[2]} ${descriptionLines.map((item) => item.line.text).join(" ")}`
        )
          ? 100
          : 1,
        role,
        evidenceLines: [entry, next, ...descriptionLines],
        continuation: false
      });
      if (!alternative) primaryByReference.add(reference);
      index = end - 1;
      continue;
    }
    const noOffer = clean(entry.line.text).match(
      /^(\d+)\s+(\d+)\s+(\d+(?:-\d+)?)\s+(Bauseits|siehe vorige Pos)$/i
    );
    if (noOffer) {
      const third = noOffer[3].split("-");
      const start = normalizePositionParts(noOffer[1], noOffer[2], third[0]);
      const reference =
        third.length === 2
          ? `${start}-${normalizePositionParts(noOffer[1], noOffer[2], third[1])}`
          : start;
      records.push({
        pageNumber: entry.pageNumber,
        sourcePositionNumber: reference,
        supplierPositionNumber: null,
        articleNumber: null,
        description: noOffer[4],
        quantity: null,
        unit: null,
        unitPrice: null,
        totalPrice: null,
        unitPriceRaw: null,
        totalPriceRaw: null,
        role: noOffer[4].toLocaleLowerCase("de").includes("bauseits")
          ? "PROVIDED_BY_OTHERS"
          : "NOT_OFFERED",
        evidenceLines: [entry],
        continuation: false
      });
    }
  }
  return records;
}

function parseReisser(lines: readonly DocumentLine[]): ParsedSupplierRecord[] {
  const records: ParsedSupplierRecord[] = [];
  let currentReference: string | null = null;
  const primaryByReference = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const entry = lines[index];
    const row = clean(entry.line.text).match(
      /^([\d.]+)\s+\S+\s+(\d{7,})\s+(.+?)\s+([\d.,]+)\s+(ST|M|KG|L)\s+([\d.,]+)\s+([\d.,]+)$/i
    );
    const alternativeMarker = clean(entry.line.text).match(
      /^([\d.]+)\s+Wahlweise bieten wir an:?$/i
    );
    const noOffer = clean(entry.line.text).match(/^([\d.]+)\s+\*{2}\s+bauseits$/i);
    if (!row && !noOffer && !alternativeMarker) continue;
    let end = index + 1;
    while (
      end < lines.length &&
      !/^[\d.]+\s+\S+\s+\d{7,}\s+.+?\s+[\d.,]+\s+(?:ST|M|KG|L)\s+[\d.,]+\s+[\d.,]+$/i.test(
        clean(lines[end].line.text)
      ) &&
      !/^[\d.]+\s+\*{2}\s+bauseits$/i.test(clean(lines[end].line.text)) &&
      !/^[\d.]+\s+Wahlweise bieten wir an:?$/i.test(clean(lines[end].line.text)) &&
      !/^(Summe Positionen|Mehrwertsteuer|Endbetrag)\b/i.test(lines[end].line.text)
    ) {
      end += 1;
    }
    const block = lines.slice(index, end);
    const explicitReference = block
      .map((candidate) => extractBasisReference(candidate.line.text))
      .find((value): value is string => Boolean(value));
    if (explicitReference) currentReference = explicitReference;
    if (alternativeMarker) {
      const alternativeRow = block
        .slice(1)
        .map((candidate) => ({
          candidate,
          match: clean(candidate.line.text).match(
            /^\S+\s+(\d{7,})\s+(.+?)\s+([\d.,]+)\s+(ST|M|KG|L)\s+([\d.,]+)$/i
          )
        }))
        .find(
          (candidate): candidate is {
            candidate: DocumentLine;
            match: RegExpMatchArray;
          } => Boolean(candidate.match)
        );
      if (alternativeRow) {
        const descriptionLines = block.filter(
          (candidate) =>
            candidate !== entry &&
            candidate !== alternativeRow.candidate &&
            !/^(\d+\.){2}\d+(?:-\d+)?\.?$/.test(clean(candidate.line.text)) &&
            !/^(Alte Materialnr|Stat\. WarenNr|PME:)/i.test(candidate.line.text)
        );
        records.push({
          pageNumber: entry.pageNumber,
          sourcePositionNumber: currentReference,
          supplierPositionNumber: alternativeMarker[1],
          articleNumber: alternativeRow.match[1],
          description: clean(
            `${alternativeRow.match[2]} ${descriptionLines
              .map((candidate) => candidate.line.text)
              .join(" ")}`
          ),
          quantity: parseSupplierQuantity(alternativeRow.match[3]),
          unit: /^st$/i.test(alternativeRow.match[4])
            ? "St"
            : clean(alternativeRow.match[4]),
          unitPrice: parseGermanNumber(alternativeRow.match[5]),
          totalPrice: null,
          unitPriceRaw: alternativeRow.match[5],
          totalPriceRaw: null,
          role: "ALTERNATIVE",
          evidenceLines: block,
          continuation: false
        });
      }
      index = end - 1;
      continue;
    }
    if (noOffer) {
      records.push({
        pageNumber: entry.pageNumber,
        sourcePositionNumber: currentReference,
        supplierPositionNumber: noOffer[1],
        articleNumber: null,
        description: "bauseits",
        quantity: null,
        unit: null,
        unitPrice: null,
        totalPrice: null,
        unitPriceRaw: null,
        totalPriceRaw: null,
        role: "PROVIDED_BY_OTHERS",
        evidenceLines: block,
        continuation: false
      });
      index = end - 1;
      continue;
    }
    const reference = currentReference;
    const role: OfferLineRole =
      reference && primaryByReference.has(reference)
        ? "MANDATORY_COMPONENT"
        : "PRIMARY";
    const descriptionLines = block.slice(1).filter(
      (candidate) =>
        !/^(\d+\.){2}\d+(?:-\d+)?\.?$/.test(clean(candidate.line.text)) &&
        !/^(Alte Materialnr|Stat\. WarenNr|PME:)/i.test(candidate.line.text)
    );
    records.push({
      pageNumber: entry.pageNumber,
      sourcePositionNumber: reference,
      supplierPositionNumber: row![1],
      articleNumber: row![2],
      description: clean(
        `${row![3]} ${descriptionLines.map((candidate) => candidate.line.text).join(" ")}`
      ),
      quantity: parseSupplierQuantity(row![4]),
      unit: /^st$/i.test(row![5]) ? "St" : clean(row![5]),
      unitPrice: parseGermanNumber(row![6]),
      totalPrice: parseGermanNumber(row![7]),
      unitPriceRaw: row![6],
      totalPriceRaw: row![7],
      role,
      evidenceLines: block,
      continuation: false
    });
    if (reference) primaryByReference.add(reference);
    index = end - 1;
  }
  return records;
}

function parseSpecialized(lines: readonly DocumentLine[]): ParsedSupplierRecord[] {
  const anchors = lines.flatMap((entry, index) => {
    if (!/\bzu\s+LV-Pos\.\s*:/i.test(entry.line.text)) return [];
    const reference = extractBasisReference(entry.line.text);
    const supplierPosition = clean(entry.line.text).match(/^(\d+)\b/)?.[1] ?? null;
    return reference ? [{ entry, index, reference, supplierPosition }] : [];
  });
  const primaryByReference = new Set<string>();
  const records: ParsedSupplierRecord[] = [];
  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const anchor = anchors[anchorIndex];
    const end = anchors[anchorIndex + 1]?.index ?? lines.length;
    const block = lines.slice(anchor.index, end);
    const productIndex = block.findIndex((entry, index) =>
      index > 0 &&
      /^\d{8,}\s+[\d.,]+\s+(?:ST|M|KG|L)\s+[\d.,]+\s+[\d.,]+$/i.test(
        clean(entry.line.text)
      )
    );
    if (productIndex < 0) continue;
    const product = clean(block[productIndex].line.text).match(
      /^(\d{8,})\s+([\d.,]+)\s+(ST|M|KG|L)\s+([\d.,]+)\s+([\d.,]+)$/i
    )!;
    const net = block
      .map((entry) =>
        clean(entry.line.text).match(
          /^Positionsnetto\s+([\d.,]+)\s+([\d.,]+)$/i
        )
      )
      .find((value): value is RegExpMatchArray => Boolean(value));
    const descriptionLines = block
      .slice(productIndex + 1)
      .filter(
        (entry) =>
          !/^(Kundenrabatt|Positionsnetto|Anschrift:|Schelmenwasenstraße|E-Mail:|Internet:)/i.test(
            clean(entry.line.text)
          ) && entry.line.region.y < 0.9
      );
    const unitPriceRaw = net?.[1] ?? product[4];
    const totalPriceRaw = net?.[2] ?? product[5];
    const role: OfferLineRole = primaryByReference.has(anchor.reference)
      ? "MANDATORY_COMPONENT"
      : "PRIMARY";
    records.push({
      pageNumber: anchor.entry.pageNumber,
      sourcePositionNumber: anchor.reference,
      supplierPositionNumber: anchor.supplierPosition,
      articleNumber: product[1],
      description:
        descriptionLines.map((entry) => entry.line.text).join(" ") || product[1],
      quantity: parseSupplierQuantity(product[2]),
      unit: /^st$/i.test(product[3]) ? "St" : clean(product[3]),
      unitPrice: parseGermanNumber(unitPriceRaw),
      totalPrice: parseGermanNumber(totalPriceRaw),
      unitPriceRaw,
      totalPriceRaw,
      role,
      evidenceLines: block.filter((entry) => entry.line.region.y < 0.9),
      continuation:
        block.some((entry) => entry.pageNumber !== anchor.entry.pageNumber)
    });
    primaryByReference.add(anchor.reference);
  }
  return records;
}

function validateSupplierLines(
  documentId: string,
  lines: readonly OfferLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const keys = new Map<string, OfferLine[]>();
  for (const line of lines) {
    const key = [
      line.sourcePositionNumber,
      line.supplierPositionNumber,
      line.articleNumber,
      line.role
    ].join(":");
    keys.set(key, [...(keys.get(key) ?? []), line]);
    if (
      !["NOT_OFFERED", "PROVIDED_BY_OTHERS"].includes(line.role) &&
      (line.quantity === null ||
        !line.unit ||
        line.interpretedUnitPrice === null ||
        line.interpretedTotalPrice === null)
    ) {
      issues.push(
        issue({
          code: "ROW_BOUNDARY_AMBIGUOUS",
          severity: "BLOCKING",
          message: "Supplier row is missing quantity, unit or a price.",
          documentId,
          pageNumber: line.evidence[0]?.pageNumber ?? 1,
          lineId: line.id,
          affectedFields: ["quantity", "unit", "price"]
        })
      );
    }
    if (
      line.quantity !== null &&
      line.interpretedUnitPrice !== null &&
      line.interpretedTotalPrice !== null &&
      !pricesApproximatelyEqual(
        line.quantity,
        line.interpretedUnitPrice,
        line.interpretedTotalPrice,
        line.priceBasis ?? 1
      )
    ) {
      issues.push(
        issue({
          code: "PRICE_ARITHMETIC_MISMATCH",
          severity: "BLOCKING",
          message: "Supplier row arithmetic is inconsistent.",
          documentId,
          pageNumber: line.evidence[0]?.pageNumber ?? 1,
          lineId: line.id,
          affectedFields: ["quantity", "unitPrice", "totalPrice"]
        })
      );
    }
    if (!line.sourcePositionNumber) {
      issues.push(
        issue({
          code: "AI_FALLBACK_CANDIDATE",
          severity: "WARNING",
          message: "Supplier row has no unambiguous Basis reference; no automatic fallback was sent.",
          documentId,
          pageNumber: line.evidence[0]?.pageNumber ?? 1,
          lineId: line.id,
          affectedFields: ["sourcePositionNumber"]
        })
      );
    }
  }
  for (const duplicates of keys.values()) {
    if (duplicates.length < 2) continue;
    for (const line of duplicates) {
      issues.push(
        issue({
          code: "ROW_BOUNDARY_AMBIGUOUS",
          severity: "BLOCKING",
          message: "Duplicate deterministic supplier record.",
          documentId,
          pageNumber: line.evidence[0]?.pageNumber ?? 1,
          lineId: line.id,
          affectedFields: ["duplicateRecord"]
        })
      );
    }
  }
  return issues;
}

export function extractSupplierDocumentDeterministically(input: {
  documentId: string;
  documentRevisionId: string;
  documentType: Extract<DocumentType, "SUPPLIER_OFFER" | "SPECIALIZED_SUPPLIER_OFFER">;
  discipline?: Discipline;
  pages: readonly ParsedPage[];
  createdAt?: string;
}): DeterministicSupplierDocumentResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const pages = [...input.pages].sort(
    (left, right) => left.pageNumber - right.pageNumber
  );
  for (const page of pages) {
    const route = routeExtractionPage(page);
    if (route.primary !== "DETERMINISTIC_TEXT_LAYER") {
      throw new Error(
        `Supplier page ${page.pageNumber} is not deterministic-text eligible: ${route.reason}`
      );
    }
  }
  const sourceLines = documentLines(pages);
  const layout = supplierLayout(sourceLines);
  const parsed =
    layout === "P_AND_M"
      ? parsePandM(sourceLines)
      : layout === "GC_LVNR"
        ? parseGcLvnr(sourceLines)
        : layout === "REISSER_LV_POS"
          ? parseReisser(sourceLines)
          : parseSpecialized(sourceLines);
  const offerLines = parsed.map((record) => toOfferLine(input.documentId, record));
  const allIssues = validateSupplierLines(input.documentId, offerLines);
  const pageResults = pages.map((page) => {
    const pageLines = offerLines.filter(
      (line) => line.evidence[0]?.pageNumber === page.pageNumber
    );
    const pageIssues = allIssues.filter(
      (candidate) => candidate.pageNumber === page.pageNumber
    );
    const fallbackIds = Array.from(
      new Set(
        pageIssues
          .filter(
            (candidate) =>
              candidate.severity === "BLOCKING" ||
              candidate.code === "AI_FALLBACK_CANDIDATE"
          )
          .map((candidate) => candidate.lineId)
          .filter((value): value is string => Boolean(value))
      )
    );
    for (const line of pageLines) {
      if (pageIssues.some((candidate) => candidate.lineId === line.id)) {
        line.verificationStatus = "REVIEW_REQUIRED";
      }
    }
    const header = reconstructTextLines(page).find((line) =>
      /(Position|Pos\.|Bestell-Nr\.|Materialnr\.).*(Menge|Einzelpreis|E-Preis)/i.test(
        line.text
      )
    );
    const headerEvidence = header
      ? evidenceForLines(input.documentId, `table-header:${page.pageNumber}`, [
          { pageNumber: page.pageNumber, order: 0, line: header }
        ])
      : [];
    const envelope: ExtractionEnvelope = {
      promptVersion: DETERMINISTIC_SUPPLIER_DOCUMENT_PARSER_VERSION,
      schemaVersion: "deterministic-extraction-contract-v1",
      preprocessingVersion: "pdfjs-text-layer-v1",
      extraction: {
        documentId: input.documentId,
        pageNumber: page.pageNumber,
        pageMode: page.mode,
        documentType: input.documentType,
        discipline: input.discipline ?? "HEIZUNG",
        documentMetadataCandidates: [],
        sections: header
          ? [
              {
                id: stableId(
                  "section",
                  input.documentId,
                  page.pageNumber,
                  layout
                ),
                parentId: null,
                label: header.text,
                kind: "TABLE",
                evidence: headerEvidence
              }
            ]
          : [],
        offerGroups: pageLines.length
          ? [
              {
                id: stableId(
                  "group",
                  input.documentId,
                  page.pageNumber,
                  layout
                ),
                documentId: input.documentId,
                label: `Deterministic ${layout} supplier rows`,
                lines: pageLines,
                adjustments: [],
                evidence: headerEvidence
              }
            ]
          : [],
        basisPositions: [],
        unresolvedNotes: fallbackIds.map(
          (blockId) =>
            `AI_FALLBACK_CANDIDATE ${blockId}: deterministic validation requires review; no automatic fallback sent.`
        )
      }
    };
    return {
      pageNumber: page.pageNumber,
      envelope,
      validationIssues: pageIssues,
      provenance: provenance({
        documentRevisionId: input.documentRevisionId,
        page,
        parserVersion: DETERMINISTIC_SUPPLIER_DOCUMENT_PARSER_VERSION,
        issues: pageIssues,
        fallbackIds,
        confidence:
          pageIssues.length === 0 ? 1 : Math.max(0, 1 - pageIssues.length * 0.12),
        createdAt
      }),
      parsedRecordCount: pageLines.length,
      candidateAnchorCount: pageLines.filter((line) => line.role === "PRIMARY").length,
      continuationRecordCount: pageLines.filter((line) => line.continuation).length
    };
  });
  return {
    layout,
    pages: pageResults,
    lines: offerLines,
    metrics: {
      parsedLines: offerLines.length,
      explicitNoOfferLines: offerLines.filter((line) =>
        ["NOT_OFFERED", "PROVIDED_BY_OTHERS"].includes(line.role)
      ).length,
      optionalLines: offerLines.filter((line) => line.role === "OPTIONAL").length,
      alternativeLines: offerLines.filter((line) => line.role === "ALTERNATIVE").length,
      continuationLines: offerLines.filter((line) => line.continuation).length,
      fallbackCandidateIds: Array.from(
        new Set(
          allIssues
            .filter(
              (candidate) =>
                candidate.severity === "BLOCKING" ||
                candidate.code === "AI_FALLBACK_CANDIDATE"
            )
            .map((candidate) => candidate.lineId)
            .filter((value): value is string => Boolean(value))
        )
      )
    }
  };
}
