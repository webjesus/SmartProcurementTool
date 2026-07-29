import { createHash } from "node:crypto";
import type {
  EvidenceReference,
  ExtractionEnvelope,
  ExtractionRunProvenance,
  MoneyCandidate,
  OfferLine,
  OfferLineRole,
  PageExtraction
} from "@/domain/contracts";
import type { ParsedPage } from "@/domain/repositories";
import {
  canMachineValidate,
  parseGermanNumber,
  pricesApproximatelyEqual,
  validatePageExtraction,
  type ValidationIssue
} from "@/domain/validation";

export const DETERMINISTIC_SUPPLIER_PARSER_VERSION =
  "deterministic-supplier-text-v1";
export const DETERMINISTIC_BASIS_CONTINUATION_VERSION =
  "deterministic-basis-continuation-v1";

type TextItem = ParsedPage["textItems"][number];

export interface ReconstructedTextLine {
  id: string;
  text: string;
  items: TextItem[];
  region: EvidenceReference["region"];
}

export interface ExtractionRoute {
  primary: "DETERMINISTIC_TEXT_LAYER" | "OCR_VISUAL";
  fallback:
    | "AMBIGUOUS_BLOCKS_ONLY"
    | "VISUAL_REGIONS_WITHOUT_TEXT"
    | "OCR_OR_VISUAL";
  textLayerConfidence: number;
  reason: string;
}

export interface TextLayerPageMetrics {
  mode: ParsedPage["mode"];
  textItems: number;
  characters: number;
  geometryRatio?: number;
}

export function routeTextLayerMetrics(
  metrics: TextLayerPageMetrics
): ExtractionRoute {
  const geometryRatio = metrics.geometryRatio ?? 1;
  const textLayerConfidence = Math.min(
    1,
    metrics.characters / 800,
    metrics.textItems / 80,
    geometryRatio
  );
  if (metrics.mode === "DIGITAL") {
    return {
      primary: "DETERMINISTIC_TEXT_LAYER",
      fallback: "AMBIGUOUS_BLOCKS_ONLY",
      textLayerConfidence,
      reason: "Digital page has a native text layer."
    };
  }
  if (
    metrics.mode === "HYBRID" &&
    metrics.characters >= 160 &&
    metrics.textItems >= 20 &&
    geometryRatio >= 0.97
  ) {
    return {
      primary: "DETERMINISTIC_TEXT_LAYER",
      fallback: "VISUAL_REGIONS_WITHOUT_TEXT",
      textLayerConfidence,
      reason: "Hybrid page has a reliable native text layer."
    };
  }
  return {
    primary: "OCR_VISUAL",
    fallback: "OCR_OR_VISUAL",
    textLayerConfidence,
    reason: "Native text coverage is insufficient for deterministic parsing."
  };
}

export function estimateDeterministicFirstCoverage(
  pages: readonly TextLayerPageMetrics[]
): {
  totalPages: number;
  deterministicPages: number;
  ambiguousOrVisualPages: number;
  deterministicShare: number;
} {
  const deterministicPages = pages.filter(
    (page) => routeTextLayerMetrics(page).primary === "DETERMINISTIC_TEXT_LAYER"
  ).length;
  return {
    totalPages: pages.length,
    deterministicPages,
    ambiguousOrVisualPages: pages.length - deterministicPages,
    deterministicShare:
      pages.length > 0 ? deterministicPages / pages.length : 0
  };
}

export interface DeterministicSupplierResult {
  envelope: ExtractionEnvelope;
  validationIssues: ValidationIssue[];
  provenance: ExtractionRunProvenance;
  lineConfidence: Record<string, number>;
}

const normalizeText = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

const normalizedSearchText = (value: string) =>
  normalizeText(value)
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

function itemCenterY(item: TextItem): number {
  return item.region.y + item.region.height / 2;
}

export function reconstructTextLines(
  page: ParsedPage
): ReconstructedTextLine[] {
  const items = page.textItems
    .filter((item) => normalizeText(item.normalizedText || item.rawText))
    .map((item) => ({
      ...item,
      normalizedText: normalizeText(item.normalizedText || item.rawText)
    }))
    .sort(
      (left, right) =>
        itemCenterY(left) - itemCenterY(right) ||
        left.region.x - right.region.x ||
        left.order - right.order
    );
  const medianHeight =
    [...items]
      .map((item) => item.region.height)
      .sort((left, right) => left - right)[Math.floor(items.length / 2)] ??
    0.01;
  const tolerance = Math.min(0.008, Math.max(0.0025, medianHeight * 0.55));
  const groups: Array<{ centerY: number; items: TextItem[] }> = [];

  for (const item of items) {
    const centerY = itemCenterY(item);
    const group = groups.find(
      (candidate) => Math.abs(candidate.centerY - centerY) <= tolerance
    );
    if (group) {
      group.items.push(item);
      group.centerY =
        group.items.reduce((sum, entry) => sum + itemCenterY(entry), 0) /
        group.items.length;
    } else {
      groups.push({ centerY, items: [item] });
    }
  }

  return groups
    .sort((left, right) => left.centerY - right.centerY)
    .map((group, index) => {
      const lineItems = group.items.sort(
        (left, right) =>
          left.region.x - right.region.x || left.order - right.order
      );
      return {
        id: stableId(
          "textline",
          page.pageNumber,
          index,
          lineItems.map((item) => item.id)
        ),
        text: lineItems.map((item) => item.normalizedText).join(" "),
        items: lineItems,
        region: unionRegion(lineItems)
      };
    });
}

export function routeExtractionPage(page: ParsedPage): ExtractionRoute {
  const nonEmpty = page.textItems.filter((item) =>
    normalizeText(item.normalizedText || item.rawText)
  );
  const characters = nonEmpty.reduce(
    (sum, item) => sum + normalizeText(item.normalizedText).length,
    0
  );
  const validGeometry = nonEmpty.filter(
    (item) =>
      item.region.width >= 0 &&
      item.region.height > 0 &&
      item.region.x >= 0 &&
      item.region.y >= 0 &&
      item.region.x + item.region.width <= 1.001 &&
      item.region.y + item.region.height <= 1.001
  ).length;
  const geometryRatio =
    nonEmpty.length > 0 ? validGeometry / nonEmpty.length : 0;
  return routeTextLayerMetrics({
    mode: page.mode,
    textItems: nonEmpty.length,
    characters,
    geometryRatio
  });
}

function evidence(
  documentId: string,
  pageNumber: number,
  key: string,
  items: readonly TextItem[]
): EvidenceReference {
  const sorted = [...items].sort(
    (left, right) =>
      left.region.y - right.region.y ||
      left.region.x - right.region.x ||
      left.order - right.order
  );
  return {
    id: stableId(
      "evidence",
      documentId,
      pageNumber,
      key,
      sorted.map((item) => item.id)
    ),
    documentId,
    pageNumber,
    textItemIds: sorted.map((item) => item.id),
    sourceText: sorted
      .map((item) => normalizeText(item.normalizedText || item.rawText))
      .join(" "),
    region: unionRegion(sorted),
    cropPath: null,
    status: "VERIFIED_NATIVE"
  };
}

function normalizePositionReference(value: string): string | null {
  const match = normalizeText(value).match(
    /(?:^|\()\s*(\d+)\s*(?:[.\-]|\s)\s*(\d+)\s*(?:[.\-]|\s)\s*(\d+)\s*\)?/
  );
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

export function detectPositionAnchor(
  line: ReconstructedTextLine
): string | null {
  const text = normalizedSearchText(line.text);
  if (
    !/\b(angebotsposition|lv(?:nr|position)?|position)\b/.test(text) &&
    !/^\s*\(\s*\d/.test(line.text)
  ) {
    return null;
  }
  return normalizePositionReference(line.text);
}

interface ColumnModel {
  anchors: [number, number, number, number, number];
  header: ReconstructedTextLine;
}

function itemX(item: TextItem): number {
  return item.region.x + item.region.width / 2;
}

function detectColumns(lines: readonly ReconstructedTextLine[]): ColumnModel | null {
  for (const line of lines) {
    const labels = line.items.map((item) => ({
      item,
      text: normalizedSearchText(item.normalizedText || item.rawText)
    }));
    const find = (pattern: RegExp) =>
      labels.find((candidate) => pattern.test(candidate.text))?.item;
    const position = find(/^pos(?:ition)?\.?$/);
    const article = find(/^artikel$/);
    const quantity = find(/^menge$/);
    const unitPrice = find(/e[\s-]*preis|einheitspreis/);
    const totalPrice = find(/gesamt/);
    if (position && article && quantity && unitPrice && totalPrice) {
      return {
        anchors: [
          itemX(position),
          itemX(article),
          itemX(quantity),
          itemX(unitPrice),
          itemX(totalPrice)
        ],
        header: line
      };
    }
  }
  return null;
}

function columnIndex(item: TextItem, model: ColumnModel): number {
  const boundaries = model.anchors
    .slice(0, -1)
    .map((anchor, index) => (anchor + model.anchors[index + 1]) / 2);
  const x = itemX(item);
  return boundaries.findIndex((boundary) => x < boundary) === -1
    ? 4
    : boundaries.findIndex((boundary) => x < boundary);
}

function cellItems(
  line: ReconstructedTextLine,
  model: ColumnModel,
  index: number
): TextItem[] {
  return line.items.filter((item) => columnIndex(item, model) === index);
}

function cellText(
  line: ReconstructedTextLine,
  model: ColumnModel,
  index: number
): string {
  return cellItems(line, model, index)
    .map((item) => normalizeText(item.normalizedText || item.rawText))
    .join(" ");
}

function isSubtotalOrPageFurniture(value: string): boolean {
  const text = normalizedSearchText(value);
  return (
    /^(objektsumme|zwischensumme|subtotal|summe|ubertrag|seitenubertrag)\b/.test(
      text
    ) ||
    /^(pos\.?\s+artikel|seite\s+\d+|angebot\s+\d+)/.test(text)
  );
}

function isOptionalMarker(value: string): boolean {
  return /\b(optional|wahlweise|alternativ)\b.*\b(bieten|angebot|position)?\b/i.test(
    normalizedSearchText(value)
  );
}

function rowSupplierPosition(
  line: ReconstructedTextLine,
  model: ColumnModel
): string | null {
  const value = cellText(line, model, 0).replace(/\s/g, "");
  return /^\d{2,10}$/.test(value) ? value : null;
}

function parseQuantityUnit(value: string): {
  quantity: number | null;
  unit: string | null;
} {
  const match = normalizeText(value).match(
    /([+\-]?\d[\d.,]*)\s*(St(?:ück|ueck)?|Stk\.?|m|kg)\b/i
  );
  return {
    quantity: match ? parseGermanNumber(match[1]) : null,
    unit: match
      ? /^(st|stk)/i.test(match[2])
        ? "St"
        : normalizeText(match[2])
      : null
  };
}

function likelyManufacturer(description: string): string | null {
  const first = normalizeText(description).split(" ")[0];
  return /^[\p{Lu}][\p{L}\p{N}&.-]{2,}$/u.test(first) ? first : null;
}

function moneyCandidate(input: {
  documentId: string;
  pageNumber: number;
  lineId: string;
  kind: "UNIT_PRICE" | "TOTAL_PRICE";
  rawValue: string;
  items: readonly TextItem[];
}): MoneyCandidate {
  return {
    id: stableId("money", input.lineId, input.kind, input.rawValue),
    kind: input.kind,
    rawValue: input.rawValue,
    amount: parseGermanNumber(input.rawValue),
    currency: "EUR",
    priceBasis: 1,
    evidence: [
      evidence(
        input.documentId,
        input.pageNumber,
        `${input.lineId}:${input.kind}`,
        input.items
      )
    ]
  };
}

function lineConfidence(line: OfferLine): number {
  let score = 1;
  if (!line.sourcePositionNumber) score -= 0.12;
  if (!line.supplierPositionNumber) score -= 0.12;
  if (!line.articleNumber) score -= 0.1;
  if (line.quantity === null || !line.unit) score -= 0.14;
  if (
    line.interpretedUnitPrice === null ||
    line.interpretedTotalPrice === null
  ) {
    score -= 0.2;
  } else if (
    line.quantity === null ||
    !pricesApproximatelyEqual(
      line.quantity,
      line.interpretedUnitPrice,
      line.interpretedTotalPrice,
      line.priceBasis ?? 1
    )
  ) {
    score -= 0.3;
  }
  if (line.evidence.length === 0) score -= 0.25;
  return Math.max(0, Math.min(1, score));
}

function fallbackIssue(
  documentId: string,
  pageNumber: number,
  lineId: string,
  confidence: number
): ValidationIssue {
  return {
    id: stableId("issue", "AI_FALLBACK_CANDIDATE", lineId),
    code: "AI_FALLBACK_CANDIDATE",
    severity: "WARNING",
    message: `Deterministic block confidence ${confidence.toFixed(2)} is below the automatic acceptance threshold; no fallback was sent.`,
    documentId,
    pageNumber,
    lineId,
    affectedFields: ["deterministicBlock"]
  };
}

export function extractSupplierPageDeterministically(input: {
  documentId: string;
  documentRevisionId: string;
  documentType?: PageExtraction["documentType"];
  discipline?: PageExtraction["discipline"];
  page: ParsedPage;
  createdAt?: string;
}): DeterministicSupplierResult {
  const route = routeExtractionPage(input.page);
  if (route.primary !== "DETERMINISTIC_TEXT_LAYER") {
    throw new Error(`Page is not eligible for deterministic text extraction: ${route.reason}`);
  }
  const lines = reconstructTextLines(input.page);
  const columns = detectColumns(lines);
  if (!columns) {
    throw new Error("Deterministic parser could not identify supplier table columns.");
  }
  const groupId = stableId(
    "group",
    input.documentId,
    input.page.pageNumber,
    "deterministic"
  );
  const offerLines: OfferLine[] = [];
  const confidenceByLine: Record<string, number> = {};
  let currentPosition: string | null = null;
  let currentGroupKey: string | null = null;
  let optionalMode = false;
  let hasPrimary = false;

  for (let index = 0; index < lines.length; index += 1) {
    const textLine = lines[index];
    const anchor = detectPositionAnchor(textLine);
    if (anchor) {
      currentPosition = anchor;
      currentGroupKey = stableId(
        "bundle",
        input.documentId,
        input.page.pageNumber,
        anchor
      );
      optionalMode = false;
      hasPrimary = false;
      continue;
    }
    if (isOptionalMarker(textLine.text)) {
      optionalMode = true;
      continue;
    }
    if (isSubtotalOrPageFurniture(textLine.text)) continue;
    const supplierPositionNumber = rowSupplierPosition(textLine, columns);
    if (!supplierPositionNumber || !currentPosition || !currentGroupKey) continue;

    let end = index + 1;
    while (end < lines.length) {
      const next = lines[end];
      if (
        detectPositionAnchor(next) ||
        isOptionalMarker(next.text) ||
        isSubtotalOrPageFurniture(next.text) ||
        rowSupplierPosition(next, columns)
      ) {
        break;
      }
      end += 1;
    }
    const block = lines.slice(index, end);
    const articleCell = cellText(textLine, columns, 1);
    const [articleNumber = "", ...inlineDescription] = articleCell.split(" ");
    const descriptionParts = [
      inlineDescription.join(" "),
      ...block
        .slice(1)
        .map((line) => cellText(line, columns, 1) || line.text)
    ].filter(Boolean);
    const description =
      normalizeText(descriptionParts.join(" ")) || `Artikel ${articleNumber}`;
    const quantityUnit = parseQuantityUnit(cellText(textLine, columns, 2));
    const unitPriceRaw = cellText(textLine, columns, 3);
    const totalPriceRaw = cellText(textLine, columns, 4);
    const role: OfferLineRole = optionalMode
      ? "OPTIONAL"
      : hasPrimary
        ? "MANDATORY_COMPONENT"
        : "PRIMARY";
    const lineId = stableId(
      "line",
      input.documentId,
      input.page.pageNumber,
      currentPosition,
      supplierPositionNumber,
      articleNumber
    );
    const blockItems = block.flatMap((line) => line.items);
    const moneyCandidates = [
      ...(unitPriceRaw
        ? [
            moneyCandidate({
              documentId: input.documentId,
              pageNumber: input.page.pageNumber,
              lineId,
              kind: "UNIT_PRICE",
              rawValue: unitPriceRaw,
              items: cellItems(textLine, columns, 3)
            })
          ]
        : []),
      ...(totalPriceRaw
        ? [
            moneyCandidate({
              documentId: input.documentId,
              pageNumber: input.page.pageNumber,
              lineId,
              kind: "TOTAL_PRICE",
              rawValue: totalPriceRaw,
              items: cellItems(textLine, columns, 4)
            })
          ]
        : [])
    ];
    const line: OfferLine = {
      id: lineId,
      sourcePositionNumber: currentPosition,
      supplierPositionNumber,
      description,
      manufacturer: likelyManufacturer(description),
      articleNumber: articleNumber || null,
      quantity: quantityUnit.quantity,
      unit: quantityUnit.unit,
      priceBasis: 1,
      currency: "EUR",
      moneyCandidates,
      interpretedUnitPrice:
        moneyCandidates.find((candidate) => candidate.kind === "UNIT_PRICE")
          ?.amount ?? null,
      interpretedTotalPrice:
        moneyCandidates.find((candidate) => candidate.kind === "TOTAL_PRICE")
          ?.amount ?? null,
      role,
      groupId: currentGroupKey,
      continuation: false,
      evidence: [
        evidence(
          input.documentId,
          input.page.pageNumber,
          `line:${lineId}`,
          blockItems
        )
      ],
      verificationStatus: "NEEDS_REVIEW",
      lockedFields: [],
      completenessStatus: "PRICED_OFFER",
      completenessReason: "Native text-layer columns and arithmetic parsed deterministically"
    };
    offerLines.push(line);
    confidenceByLine[line.id] = lineConfidence(line);
    if (!optionalMode) hasPrimary = true;
    index = end - 1;
  }

  const headerEvidence = evidence(
    input.documentId,
    input.page.pageNumber,
    "table-header",
    columns.header.items
  );
  const envelope: ExtractionEnvelope = {
    promptVersion: DETERMINISTIC_SUPPLIER_PARSER_VERSION,
    schemaVersion: "deterministic-extraction-contract-v1",
    preprocessingVersion: "pdfjs-text-layer-v1",
    extraction: {
      documentId: input.documentId,
      pageNumber: input.page.pageNumber,
      pageMode: input.page.mode,
      documentType: input.documentType ?? "SUPPLIER_OFFER",
      discipline: input.discipline ?? "UNKNOWN",
      documentMetadataCandidates: [],
      sections: [
        {
          id: stableId(
            "section",
            input.documentId,
            input.page.pageNumber,
            "supplier-table"
          ),
          parentId: null,
          label: columns.header.text,
          kind: "TABLE",
          evidence: [headerEvidence]
        }
      ],
      offerGroups: [
        {
          id: groupId,
          documentId: input.documentId,
          label: "Deterministic supplier positions",
          lines: offerLines,
          adjustments: [],
          evidence: [headerEvidence]
        }
      ],
      basisPositions: [],
      unresolvedNotes: []
    }
  };
  let validationIssues = validatePageExtraction(envelope, input.page);
  const fallbackCandidateBlockIds = offerLines
    .filter((line) => confidenceByLine[line.id] < 0.8)
    .map((line) => line.id);
  validationIssues = [
    ...validationIssues,
    ...fallbackCandidateBlockIds.map((lineId) =>
      fallbackIssue(
        input.documentId,
        input.page.pageNumber,
        lineId,
        confidenceByLine[lineId]
      )
    )
  ];
  for (const line of offerLines) {
    const issues = validationIssues.filter((candidate) => candidate.lineId === line.id);
    line.verificationStatus = canMachineValidate(line, issues)
      ? "MACHINE_VALIDATED"
      : "REVIEW_REQUIRED";
  }
  const confidence =
    offerLines.length > 0
      ? offerLines.reduce(
          (sum, line) => sum + confidenceByLine[line.id],
          0
        ) / offerLines.length
      : 0;
  const blocking = validationIssues.some((issue) => issue.severity === "BLOCKING");
  const createdAt = input.createdAt ?? new Date().toISOString();
  const rawTextItemsHash = createHash("sha256")
    .update(
      JSON.stringify(
        input.page.textItems.map((item) => ({
          id: item.id,
          text: item.rawText,
          region: item.region
        }))
      )
    )
    .digest("hex");
  return {
    envelope,
    validationIssues,
    lineConfidence: confidenceByLine,
    provenance: {
      extractionMethod: "DETERMINISTIC_TEXT_LAYER",
      documentRevisionId: input.documentRevisionId,
      pageNumber: input.page.pageNumber,
      rawTextItemsHash,
      parserVersion: DETERMINISTIC_SUPPLIER_PARSER_VERSION,
      validationStatus: blocking
        ? "FAILED"
        : fallbackCandidateBlockIds.length > 0
          ? "NEEDS_REVIEW"
          : "COMPLETED",
      confidence,
      fallbackCandidateBlockIds,
      createdAt
    }
  };
}

export function linkBasisPositionContinuations(input: {
  positions: readonly import("@/domain/contracts").BasisPosition[];
  continuationPages: readonly ParsedPage[];
}): import("@/domain/contracts").BasisPosition[] {
  const pages = new Map(
    input.continuationPages.map((page) => [page.pageNumber, page])
  );
  return input.positions.map((position) => {
    if (position.quantity !== null && position.unit !== null) return position;
    const anchorPage = Math.max(
      0,
      ...position.evidence.map((item) => item.pageNumber)
    );
    const anchorBottom = Math.max(
      0,
      ...position.evidence.map(
        (item) => item.region.y + item.region.height
      )
    );
    if (anchorPage === 0 || anchorBottom < 0.75) return position;
    const continuationPage = pages.get(anchorPage + 1);
    if (!continuationPage) return position;
    const lines = reconstructTextLines(continuationPage);
    const firstNextAnchor = lines.findIndex((line) =>
      Boolean(detectPositionAnchor(line))
    );
    const candidates =
      firstNextAnchor >= 0 ? lines.slice(0, firstNextAnchor) : lines;
    const quantityLine = candidates.find((line) =>
      /[+\-]?\d[\d.,]*\s*(?:St(?:ück|ueck)?|Stk\.?|m|kg)\b/i.test(
        normalizeText(line.text)
      )
    );
    if (!quantityLine) return position;
    const parsed = parseQuantityUnit(quantityLine.text);
    if (parsed.quantity === null || !parsed.unit) return position;
    const continuationEvidence = evidence(
      position.documentId,
      continuationPage.pageNumber,
      `basis-continuation:${position.id}`,
      quantityLine.items
    );
    const executionText = candidates
      .filter(
        (line) =>
          line.region.y < quantityLine.region.y &&
          /\b(liefer|montier|dichtung|kleinmaterial|ausfuhr)\w*/i.test(
            normalizedSearchText(line.text)
          )
      )
      .map((line) => line.text);
    return {
      ...position,
      quantity: parsed.quantity,
      unit: parsed.unit,
      requiredScope: Array.from(
        new Set([...position.requiredScope, ...executionText])
      ),
      evidence: [...position.evidence, continuationEvidence],
      verificationStatus: "MACHINE_VALIDATED"
    };
  });
}
