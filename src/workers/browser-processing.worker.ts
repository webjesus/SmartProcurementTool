import type {
  BrowserDocumentDiagnostics,
  BrowserLineReviewReason,
  BrowserProcessingCommand,
  BrowserProcessingEvent,
  BrowserProcessingIssue,
  BrowserWorkerDocument,
  BrowserWorkerResult,
  ParsedBasisLine,
  ParsedSupplierLine
} from "@/browser-projects/processing-protocol";
import type { BrowserProcessingCheckpoint, BrowserProcessingStage } from "@/browser-projects/types";
import {
  ocrWordsToPdfGeometry,
  mergeBrowserOcrGeometry,
  estimateBrowserRasterCoverage,
  shouldRunBrowserOcr,
  summarizeBrowserOcr
} from "@/browser-projects/ocr-fallback";
import {
  recognizeBrowserPage,
  type BrowserOcrRenderablePdfPage
} from "@/browser-projects/browser-ocr-engine";
import {
  findPdfPositionMarkers,
  locatePdfContinuationRegion,
  locatePdfSourceRegion,
  pdfTextInVisualOrder,
  type PdfPositionMarker,
  type PdfTextGeometryItem
} from "@/pdf/source-region";
import { browserPdfLoadingOptions, configureBrowserPdfJs } from "@/pdf/browser-pdfjs-config";
import {
  applyFullRunDocumentClassification,
  classifyBrowserDocumentContent
} from "@/browser-projects/document-classification";

const workerScope = self as unknown as {
  postMessage(message: BrowserProcessingEvent): void;
  onmessage: ((event: MessageEvent<BrowserProcessingCommand>) => void) | null;
};

let cancelled = false;

type ExtractedPdfPage = {
  text: string;
  items: PdfTextGeometryItem[];
  width: number;
  height: number;
  viewportTransform?: readonly number[];
  extractionMethod: "NATIVE" | "OCR";
};

type ExtractedDocumentPages = {
  pages: ExtractedPdfPage[];
  issues: BrowserProcessingIssue[];
  ocrProcessedPages: number;
  ocrFailedPages: number;
  ocrRequiredPages: number;
};

const stages: BrowserProcessingStage[] = [
  "CLASSIFY_DOCUMENTS",
  "EXTRACT_BASIS",
  "EXTRACT_SUPPLIERS",
  "NORMALIZE",
  "MATCH",
  "BUILD_OPTIONS",
  "VALIDATE",
  "FINALIZE"
];

const MAX_POSITION_DESCRIPTION_CHARACTERS = 64_000;

function emit(message: BrowserProcessingEvent) {
  workerScope.postMessage(message);
}

function number(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalized(value: string): string {
  return value.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
}

type QuantityCandidate = {
  quantity: number | null;
  unit: string | null;
  rawQuantity: string;
  index: number;
  end: number;
  reviewReason: BrowserLineReviewReason | null;
};

function quantityIn(value: string, allowOcrNoise = false): QuantityCandidate | null {
  const candidates = [
    ...value.matchAll(
      /(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?)\s+(Stück|Stk|Std|Stunden?|St|m2|m²|m3|m³|Meter|m|kg|Psch|Tage?|h|d)\b/giu
    )
  ].flatMap((match) => {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    const lineStart = value.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
    const lineEnd = value.indexOf("\n", end);
    const prefix = value.slice(lineStart, index).trim();
    const suffix = value.slice(end, lineEnd < 0 ? value.length : lineEnd).trim();
    // Rates and dimensions belong to technical prose, never to a procurement column.
    if (
      /^\//u.test(suffix) ||
      /(?:gewicht|volumenstrom|(?:rohr|kabel|bau)?länge|höhe|breite|tiefe|abmessung|durchmesser|inhalt|leistung|(?:preis(?:e)?|EP)\s+(?:je|pro)|(?:EUR|€)\s*\/)\s*:?\s*$/iu.test(
        prefix
      )
    )
      return [];
    const priceOnlySuffix =
      /^(?:(?:EP|GP|E-Preis|Einzelpreis|Gesamtpreis)\s*:?\s*)?(?:-?\d{1,3}(?:\.\d{3})*,\d{2}|[.·…]+)(?:\s+(?:(?:EP|GP)\s*:?\s*)?(?:-?\d{1,3}(?:\.\d{3})*,\d{2}|[.·…]+))*$/iu.test(
        suffix
      );
    // OCR can read the printed quantity correctly but turn handwriting in the
    // adjacent price columns into letters. Retain only standalone quantity rows;
    // the enclosing OCR source remains explicitly unconfirmed for review.
    const noisyOcrColumns = allowOcrNoise && !prefix && suffix.length > 0 && suffix.length <= 60;
    if (suffix && !priceOnlySuffix && !noisyOcrColumns) return [];
    return [
      {
        candidate: {
          quantity: number(match[1]),
          unit: match[2],
          rawQuantity: match[0].trim(),
          index,
          end,
          reviewReason: noisyOcrColumns && !priceOnlySuffix ? "OCR_SOURCE" : null
        } as QuantityCandidate,
        strength: !prefix ? 3 : priceOnlySuffix ? 2 : 1
      }
    ];
  });
  const strongest = Math.max(0, ...candidates.map((candidate) => candidate.strength));
  const preferred = candidates.filter((candidate) => candidate.strength === strongest);
  if (!preferred.length) return null;
  const distinct = new Set(
    preferred.map(
      ({ candidate }) => `${candidate.quantity}:${candidate.unit?.toLocaleLowerCase("de")}`
    )
  );
  if (distinct.size > 1) {
    return {
      quantity: null,
      unit: null,
      rawQuantity: preferred.map(({ candidate }) => candidate.rawQuantity).join(" / "),
      index: value.length,
      end: value.length,
      reviewReason: "QUANTITY_AMBIGUOUS"
    };
  }
  return preferred[0].candidate;
}

function unknownQuantityIn(value: string): QuantityCandidate | null {
  const excludedTokens = new Set(["bar", "dn", "ep", "eur", "gp", "hz", "kw", "mm", "v"]);
  let offset = 0;
  for (const line of value.split("\n")) {
    const match = line.match(
      /^\s*(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?)\s+([\p{L}][\p{L}\d./-]{0,11})(.*)$/u
    );
    const trailingColumns = match?.[3].trim() ?? "";
    const hasOnlyPriceColumns =
      !trailingColumns ||
      /^(?:(?:EP|GP)\s+)?-?\d{1,3}(?:\.\d{3})*,\d{2}(?:\s+(?:(?:EP|GP)\s+)?-?\d{1,3}(?:\.\d{3})*,\d{2})*$/iu.test(
        trailingColumns
      );
    if (match && hasOnlyPriceColumns && !excludedTokens.has(match[2].toLocaleLowerCase("de"))) {
      const localIndex = line.indexOf(match[1]);
      const rawQuantity = `${match[1]} ${match[2]}`;
      return {
        quantity: null,
        unit: null,
        rawQuantity,
        index: offset + Math.max(0, localIndex),
        end: offset + Math.max(0, localIndex) + rawQuantity.length,
        reviewReason: "UNKNOWN_UNIT"
      };
    }
    offset += line.length + 1;
  }
  return null;
}

function quantityCandidateIn(value: string, allowOcrNoise = false): QuantityCandidate | null {
  return quantityIn(value, allowOcrNoise) ?? unknownQuantityIn(value);
}

function requiredQuantityCandidate(value: string, allowOcrNoise = false): QuantityCandidate {
  return (
    quantityCandidateIn(value, allowOcrNoise) ?? {
      quantity: null,
      unit: null,
      rawQuantity: "",
      index: value.length,
      end: value.length,
      reviewReason: "QUANTITY_MISSING"
    }
  );
}

function currencyValues(value: string): number[] {
  return [...value.matchAll(/\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/gu)]
    .map((match) => number(match[1]))
    .filter((candidate): candidate is number => candidate !== null);
}

function explicitPriceBasis(value: string): number | null | undefined {
  const prefix =
    /(?:\b(?:Einzelpreis|Preise?|EP)\s+(?:je|pro)|(?:EUR|€)\s*\/|(?:^|\n|\()\s*per)\s*([^\s)]+)/giu;
  const matches = [...value.matchAll(prefix)];
  if (!matches.length) return undefined;
  const bases = matches.map((match) => {
    const token = match[1].match(
      /^(\d{1,3}(?:\.\d{3})*(?:,0+)?|\d+)(?:Stück|Stk|Std|Stunden?|St|m[23²³]?|kg|Tage?|h|d)?$/iu
    );
    return token ? number(token[1]) : null;
  });
  if (bases.some((basis) => basis === null || basis <= 0 || basis > 1_000_000)) return null;
  return new Set(bases).size === 1 ? bases[0] : null;
}

function pricesIn(value: string): { unitPrice: number | null; totalPrice: number | null } {
  // Position-level net totals can follow the gross columns on a continuation page.
  const positionsnetto = value.match(/\bPositionsnetto\b/iu);
  if (positionsnetto) {
    const candidates = currencyValues(
      value.slice((positionsnetto.index ?? 0) + positionsnetto[0].length)
    ).slice(0, 2);
    return {
      unitPrice: candidates.length >= 2 ? candidates[0] : null,
      totalPrice: candidates.at(-1) ?? null
    };
  }
  const explicitUnit = value.match(
    /\b(?:EP|E-Preis|Einzelpreis)\s*[:.]?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:[.,]\d+)?)/iu
  );
  const explicitTotal = value.match(
    /\b(?:GP|Gesamtpreis)\s*[:.]?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:[.,]\d+)?)/iu
  );
  if (explicitUnit || explicitTotal) {
    return {
      unitPrice: number(explicitUnit?.[1]),
      totalPrice: number(explicitTotal?.[1])
    };
  }
  const leadingPriceColumns = value.match(
    /^\s*-?\d{1,3}(?:\.\d{3})*,\d{2}(?:\s+-?\d{1,3}(?:\.\d{3})*,\d{2})?/u
  );
  const candidates = currencyValues(leadingPriceColumns?.[0] ?? "");
  return {
    unitPrice: candidates.length >= 2 ? candidates.at(-2)! : null,
    totalPrice: candidates.length ? candidates.at(-1)! : null
  };
}

function leadingArticleNumber(value: string): string | null {
  const match = value.match(/^[.,;:]?\s*([A-Z0-9][A-Z0-9._/-]{4,})$/iu);
  return match && /\d/u.test(match[1]) ? match[1] : null;
}

function descriptionAfterPriceColumns(value: string): string {
  const withoutLeadingPrices = value.replace(
    /^\s*(?:(?:EP|E-Preis|Einzelpreis)\s*:?\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}(?:\s+(?:(?:GP|Gesamtpreis)\s*:?\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2})?\s*/iu,
    ""
  );
  return normalized(
    withoutLeadingPrices
      .split(
        /\b(?:Kundenrabatt|Positionsnetto|Zwischensumme|Nettosumme|Gesamtsumme|Seitenübertrag|Übertrag)\b/iu,
        1
      )[0]
      .replace(/\s+\d+\s+zu\s+LV-Pos\.?:?\s*$/iu, "")
      .replace(/([\p{L}\p{N}])-\s+(?=[\p{L}\p{N}])/gu, "$1-")
  );
}

type PositionedTextMarker = PdfPositionMarker & {
  index: number;
  end: number;
  reviewReasons: BrowserLineReviewReason[];
  supplierPositionNumber?: string | null;
  placement?: "LEADING" | "TRAILING";
};

const flexiblePositionNumber = String.raw`\d+(?:(?:\s*\.\s*|\s+)\d+){2,}`;

function normalizedPositionNumber(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, ".")
    .replace(/^\.|\.$/g, "")
    .toLocaleLowerCase("de");
}

function markerSpanInLine(
  line: string,
  marker: PdfPositionMarker
): { index: number; end: number } | null {
  const patterns: RegExp[] =
    marker.form === "EXPLICIT" && marker.kind === "SUPPLIER"
      ? [/\bAngebotsposition\s+([\p{L}\p{N}./-]+)\b/giu]
      : marker.form === "EXPLICIT"
        ? [
            new RegExp(
              String.raw`\b(?:Position|LVNR|(?:zu\s+)?LV-Pos(?:ition)?\.?)\s*:?\s*(${flexiblePositionNumber})\.?\b`,
              "giu"
            )
          ]
        : marker.form === "PARENTHESIZED"
          ? [new RegExp(String.raw`\((${flexiblePositionNumber})\)`, "gu")]
          : [/\b(\d+(?:\s*\.\s*\d+){2,})\.?\b/gu];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      if (normalizedPositionNumber(match[1]) === marker.positionNumber) {
        const index = match.index ?? 0;
        return { index, end: index + match[0].length };
      }
    }
  }
  return null;
}

function isPlausibleBarePosition(marker: PdfPositionMarker): boolean {
  const segments = marker.positionNumber.split(".");
  return (
    marker.form === "BARE" &&
    marker.x <= 0.28 &&
    segments.length >= 3 &&
    segments.every((segment) => /^\d{1,3}$/u.test(segment))
  );
}

function positionMarkersFromGeometry(page: ExtractedPdfPage): PositionedTextMarker[] {
  const markers = findPdfPositionMarkers({
    items: page.items,
    pageWidth: page.width,
    pageHeight: page.height,
    viewportTransform: page.viewportTransform
  });
  const plausibleBare = markers.filter(isPlausibleBarePosition);
  const trusted = markers.filter((marker) => {
    if (marker.form !== "BARE") return true;
    return isPlausibleBarePosition(marker);
  });
  const canonical = trusted.filter(
    (marker) =>
      marker.kind !== "SUPPLIER" ||
      !trusted.some(
        (candidate) =>
          candidate.kind === "LV" &&
          candidate.lineIndex === marker.lineIndex &&
          Math.abs(candidate.x - marker.x) <= 0.22
      )
  );
  const lines = page.text.split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return canonical
    .flatMap((marker): PositionedTextMarker[] => {
      const line = lines[marker.lineIndex];
      if (line === undefined) return [];
      const span = markerSpanInLine(line, marker);
      if (!span) return [];
      const lineOffset = offsets[marker.lineIndex] ?? 0;
      return [
        {
          ...marker,
          index: lineOffset + span.index,
          end: lineOffset + span.end,
          placement:
            marker.kind === "LV" &&
            marker.form === "BARE" &&
            /\b(?:Stat\.?\s*WarenNr\.?|WarenNr\.?|PME)\b/iu.test(line.slice(span.end))
              ? "TRAILING"
              : "LEADING",
          reviewReasons:
            marker.form === "BARE" &&
            plausibleBare.filter(
              (candidate) => candidate !== marker && Math.abs(candidate.x - marker.x) <= 0.04
            ).length === 0
              ? ["BARE_POSITION_SINGLETON"]
              : []
        }
      ];
    })
    .sort((left, right) => left.index - right.index)
    .filter(
      (marker, index, all) =>
        index === 0 ||
        !all
          .slice(0, index)
          .some(
            (previous) =>
              previous.positionNumber === marker.positionNumber && previous.index === marker.index
          )
    );
}

function legacyBasisPositionMarkers(text: string): PositionedTextMarker[] {
  return [...text.matchAll(/\b(?:Position\s+)?(\d+(?:\.\d+){2,})\.?\s+/giu)].map(
    (match, lineIndex) => ({
      positionNumber: match[1],
      kind: "LV",
      form: "EXPLICIT",
      lineIndex,
      x: 0,
      y: 0,
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      reviewReasons: []
    })
  );
}

function legacySupplierPositionMarkers(text: string): PositionedTextMarker[] {
  const markers: PositionedTextMarker[] = [];
  for (const match of text.matchAll(/\bLVNR\s+(\d+)\s+(\d+)\s+(\d+)\b/giu)) {
    markers.push({
      positionNumber: `${match[1]}.${match[2]}.${match[3]}`,
      kind: "LV",
      form: "EXPLICIT",
      lineIndex: 0,
      x: 0,
      y: 0,
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      reviewReasons: []
    });
  }
  for (const match of text.matchAll(/\b(\d+(?:\.\d+){2,})(?:-\d+)?\b/gu)) {
    markers.push({
      positionNumber: match[1],
      kind: "LV",
      form: "BARE",
      lineIndex: 0,
      x: 0,
      y: 0,
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      reviewReasons: ["BARE_POSITION_SINGLETON"]
    });
  }
  if (!markers.length) {
    for (const match of text.matchAll(/\bAngebotsposition\s+(\d+)\b/giu)) {
      markers.push({
        positionNumber: match[1],
        kind: "SUPPLIER",
        form: "EXPLICIT",
        lineIndex: 0,
        x: 0,
        y: 0,
        index: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        reviewReasons: [],
        supplierPositionNumber: match[1]
      });
    }
  }
  return markers.sort((left, right) => left.index - right.index);
}

function pairSupplierMarkers(
  markers: readonly PositionedTextMarker[],
  text: string
): PositionedTextMarker[] {
  const result: PositionedTextMarker[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const next = markers[index + 1];
    const isAdjacentPair =
      marker.kind === "LV" &&
      next?.kind === "SUPPLIER" &&
      next.lineIndex - marker.lineIndex <= 2 &&
      text.slice(marker.end, next.index).replace(/[\s.:;,_-]/gu, "").length === 0;
    if (isAdjacentPair) {
      result.push({
        ...marker,
        end: next.end,
        supplierPositionNumber: next.positionNumber
      });
      index += 1;
      continue;
    }
    result.push({
      ...marker,
      supplierPositionNumber: marker.kind === "SUPPLIER" ? marker.positionNumber : null
    });
  }
  return result;
}

function supplierPositionMarkers(page: ExtractedPdfPage): PositionedTextMarker[] {
  if (page.items.length) {
    const lines = page.text.split("\n");
    const offsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
      offsets.push(offset);
      offset += line.length + 1;
    }
    const markers = positionMarkersFromGeometry(page).map((marker) => {
      const previousLine = lines[marker.lineIndex - 1]?.trim();
      return marker.kind === "LV" && /^\d{1,6}$/u.test(previousLine ?? "")
        ? { ...marker, index: offsets[marker.lineIndex - 1] ?? marker.index }
        : marker;
    });
    return pairSupplierMarkers(markers, page.text);
  }
  return pairSupplierMarkers(legacySupplierPositionMarkers(page.text), page.text);
}

type DocumentPositionMarker = {
  marker: PositionedTextMarker;
  pageIndex: number;
};

type PositionTextBlock = DocumentPositionMarker & {
  text: string;
  firstPageText: string;
  continuationPageNumbers: number[];
  continuationPages: Array<{
    pageIndex: number;
    text: string;
    nextPositionNumber: string | null;
  }>;
};

function normalizedFurnitureKey(value: string): string {
  return normalized(value).toLocaleLowerCase("de");
}

function repeatedPageFurniture(pages: readonly ExtractedPdfPage[]): Set<string> {
  const occurrences = new Map<string, Set<number>>();
  for (const [pageIndex, page] of pages.entries()) {
    const lines = page.text.split("\n");
    const edgeLines = [...lines.slice(0, 6), ...lines.slice(-4)];
    for (const line of new Set(edgeLines.map(normalizedFurnitureKey).filter(Boolean))) {
      const pagesWithLine = occurrences.get(line) ?? new Set<number>();
      pagesWithLine.add(pageIndex);
      occurrences.set(line, pagesWithLine);
    }
  }
  return new Set(
    [...occurrences.entries()]
      .filter(([, pageIndexes]) => pageIndexes.size >= 2)
      .map(([line]) => line)
  );
}

function continuationBodyText(input: {
  text: string;
  fullPageText: string;
  repeatedFurniture: ReadonlySet<string>;
}): string {
  const pageLines = input.fullPageText.split("\n");
  return input.text
    .split("\n")
    .filter((line, lineIndex) => {
      const key = normalizedFurnitureKey(line);
      if (!key) return false;
      const nearTop = lineIndex < 6;
      const nearBottom = lineIndex >= Math.max(0, pageLines.length - 4);
      if ((nearTop || nearBottom) && input.repeatedFurniture.has(key)) return false;
      if (
        nearTop &&
        /(?:\bangebotsübersicht\b|^(?:angebotsaufforderung\b|leistungsverzeichnis\b|lv[-\s]?(?:daten|bezeichnung|nummer)\b|projekt\s*:|kunde\s*:|kundennr\.?\s*:|bearbeiter\s*:|datum\s*:|pos\.?\s+(?:artikel|beschreibung)\b))/iu.test(
          key
        )
      ) {
        return false;
      }
      if (
        nearBottom &&
        /^(?:druckdatum|seite\s*:?[\s\d/]+|seitenübertrag|übertrag)\b/iu.test(key)
      ) {
        return false;
      }
      return true;
    })
    .join("\n")
    .trim();
}

function buildPositionBlocks(
  pages: readonly ExtractedPdfPage[],
  markersForPage: (page: ExtractedPdfPage) => PositionedTextMarker[]
): PositionTextBlock[] {
  const repeatedFurniture = repeatedPageFurniture(pages);
  const markers = pages.flatMap((page, pageIndex) =>
    markersForPage(page).map((marker) => ({ marker, pageIndex }))
  );
  return markers.map((current, markerIndex) => {
    const previous = markers[markerIndex - 1];
    const next = markers[markerIndex + 1];
    if (current.marker.placement === "TRAILING") {
      const pageText = pages[current.pageIndex]?.text ?? "";
      const start = previous?.pageIndex === current.pageIndex ? previous.marker.end : 0;
      const lineEndCandidate = pageText.indexOf("\n", current.marker.end);
      const lineEnd = lineEndCandidate === -1 ? pageText.length : lineEndCandidate;
      const text = pageText.slice(start, current.marker.index);
      return {
        ...current,
        text,
        firstPageText: pageText.slice(start, lineEnd),
        continuationPageNumbers: [],
        continuationPages: []
      };
    }
    const chunks: Array<{ pageIndex: number; text: string }> = [];
    const lastPageIndex = next?.pageIndex ?? pages.length - 1;
    for (let pageIndex = current.pageIndex; pageIndex <= lastPageIndex; pageIndex += 1) {
      const pageText = pages[pageIndex]?.text ?? "";
      const start = pageIndex === current.pageIndex ? current.marker.end : 0;
      const end = next && pageIndex === next.pageIndex ? next.marker.index : pageText.length;
      const rawText = pageText.slice(start, Math.max(start, end));
      const text =
        pageIndex === current.pageIndex
          ? rawText
          : continuationBodyText({
              text: rawText,
              fullPageText: pageText,
              repeatedFurniture
            });
      if (text.trim()) chunks.push({ pageIndex, text });
    }
    return {
      ...current,
      text: chunks.map((chunk) => chunk.text).join("\n"),
      firstPageText: chunks.find((chunk) => chunk.pageIndex === current.pageIndex)?.text ?? "",
      continuationPageNumbers: chunks
        .filter((chunk) => chunk.pageIndex > current.pageIndex)
        .map((chunk) => chunk.pageIndex + 1),
      continuationPages: chunks
        .filter((chunk) => chunk.pageIndex > current.pageIndex)
        .map((chunk) => ({
          ...chunk,
          nextPositionNumber:
            next?.pageIndex === chunk.pageIndex ? next.marker.positionNumber : null
        }))
    };
  });
}

function continuationEvidence(block: PositionTextBlock, pages: readonly ExtractedPdfPage[]) {
  return block.continuationPages.map((continuation) => {
    const page = pages[continuation.pageIndex];
    return {
      pageNumber: continuation.pageIndex + 1,
      sourceText: normalized(continuation.text),
      region:
        locatePdfContinuationRegion({
          items: page.items,
          pageWidth: page.width,
          pageHeight: page.height,
          viewportTransform: page.viewportTransform,
          continuationText: continuation.text,
          nextPositionNumber: continuation.nextPositionNumber
        }) ?? undefined
    };
  });
}

function continuationDescriptionAfterQuantity(
  block: PositionTextBlock,
  quantity: QuantityCandidate
): string {
  const chunks = [block.firstPageText, ...block.continuationPages.map((page) => page.text)];
  let offset = 0;
  let quantityChunkIndex = -1;
  for (const [index, chunk] of chunks.entries()) {
    const end = offset + chunk.length;
    if (quantity.index >= offset && quantity.index <= end) {
      quantityChunkIndex = index;
      break;
    }
    offset = end + 1;
  }
  if (quantityChunkIndex < 0 || quantityChunkIndex >= chunks.length - 1) return "";

  return normalized(
    chunks
      .slice(quantityChunkIndex + 1)
      .map((chunk) => {
        const laterQuantity = quantityCandidateIn(chunk);
        const priceColumn = chunk.search(
          /\b(?:EP|GP|E-Preis|Einzelpreis|Gesamtpreis|Kundenrabatt|Positionsnetto)\b/iu
        );
        const cutoffs = [laterQuantity?.index, priceColumn].filter(
          (value): value is number => value !== undefined && value >= 0
        );
        const cutoff = cutoffs.length ? Math.min(...cutoffs) : chunk.length;
        return chunk.slice(0, cutoff);
      })
      .join(" ")
  );
}

function trailingProductRow(
  text: string,
  quantity: QuantityCandidate
): { articleNumber: string | null; description: string } | null {
  const lineStart = text.lastIndexOf("\n", Math.max(0, quantity.index - 1)) + 1;
  const prefix = normalized(text.slice(lineStart, quantity.index));
  const tokens = prefix.split(" ").filter(Boolean);
  if (tokens.length < 3) return null;
  let cursor = 0;
  if (/^\d{1,3}(?:\.\d{3})*$/u.test(tokens[cursor] ?? "")) cursor += 1;
  if (
    cursor < tokens.length &&
    /^[\p{L}\d]{1,4}$/u.test(tokens[cursor] ?? "") &&
    !leadingArticleNumber(tokens[cursor] ?? "")
  ) {
    cursor += 1;
  }
  const articleNumber = leadingArticleNumber(tokens[cursor] ?? "");
  if (!articleNumber) return null;
  const description = normalized(tokens.slice(cursor + 1).join(" "));
  return description ? { articleNumber, description } : null;
}

function lineReviewReasons(
  block: PositionTextBlock,
  quantity: QuantityCandidate,
  pages: readonly ExtractedPdfPage[]
): BrowserLineReviewReason[] {
  const reasons = new Set<BrowserLineReviewReason>(block.marker.reviewReasons);
  if (quantity.reviewReason) reasons.add(quantity.reviewReason);
  if (block.continuationPageNumbers.length) {
    reasons.add("MULTI_PAGE_POSITION");
  }
  if (
    pages[block.pageIndex]?.extractionMethod === "OCR" ||
    block.continuationPages.some(
      (continuation) => pages[continuation.pageIndex]?.extractionMethod === "OCR"
    )
  ) {
    reasons.add("OCR_SOURCE");
  }
  return [...reasons];
}

function parseBasisDocument(
  document: BrowserWorkerDocument,
  pages: readonly ExtractedPdfPage[]
): ParsedBasisLine[] {
  const blocks = buildPositionBlocks(pages, (page) =>
    (page.items.length
      ? positionMarkersFromGeometry(page)
      : legacyBasisPositionMarkers(page.text)
    ).filter((marker) => marker.kind === "LV")
  );
  const result = blocks.flatMap((block, lineIndex): ParsedBasisLine[] => {
    const quantity = requiredQuantityCandidate(
      block.text,
      [block.pageIndex + 1, ...block.continuationPageNumbers].some(
        (number) => pages[number - 1]?.extractionMethod === "OCR"
      )
    );
    const continuationDescription = continuationDescriptionAfterQuantity(block, quantity);
    const completeDescription = normalized(
      `${block.text.slice(0, quantity.index)} ${continuationDescription}`
    );
    const description = completeDescription.slice(0, MAX_POSITION_DESCRIPTION_CHARACTERS);
    if (!description) return [];
    const page = pages[block.pageIndex];
    const region = locatePdfSourceRegion({
      items: page.items,
      pageWidth: page.width,
      pageHeight: page.height,
      viewportTransform: page.viewportTransform,
      positionNumber: block.marker.positionNumber,
      description: normalized(block.firstPageText)
    });
    const reviewReasons = lineReviewReasons(block, quantity, pages);
    if (completeDescription.length > MAX_POSITION_DESCRIPTION_CHARACTERS) {
      reviewReasons.push("DESCRIPTION_LIMIT_REACHED");
    }
    if (!region) reviewReasons.push("SOURCE_REGION_MISSING");
    return [
      {
        documentId: document.metadata.documentId,
        positionNumber: block.marker.positionNumber,
        description,
        quantity: quantity.quantity,
        unit: quantity.unit,
        rawQuantity: quantity.reviewReason ? quantity.rawQuantity : null,
        reviewReasons,
        continuationPageNumbers: block.continuationPageNumbers,
        continuationEvidence: continuationEvidence(block, pages),
        pageNumber: block.pageIndex + 1,
        lineIndex,
        region: region ?? undefined
      }
    ];
  });
  return [
    ...new Map(result.map((line) => [`${line.documentId}:${line.positionNumber}`, line])).values()
  ];
}

function parseSupplierDocument(
  document: BrowserWorkerDocument,
  pages: readonly ExtractedPdfPage[]
): ParsedSupplierLine[] {
  const blocks = buildPositionBlocks(pages, supplierPositionMarkers);
  const headerChunks: string[] = [];
  for (const page of pages) {
    const firstMarker = supplierPositionMarkers(page)[0];
    headerChunks.push(firstMarker ? page.text.slice(0, firstMarker.index) : page.text);
    if (firstMarker) break;
  }
  const documentPriceBasis = explicitPriceBasis(headerChunks.join("\n"));
  return blocks.flatMap((block, lineIndex): ParsedSupplierLine[] => {
    const quantity = requiredQuantityCandidate(
      block.text,
      [block.pageIndex + 1, ...block.continuationPageNumbers].some(
        (number) => pages[number - 1]?.extractionMethod === "OCR"
      )
    );
    const trailingRow =
      block.marker.placement === "TRAILING" ? trailingProductRow(block.text, quantity) : null;
    const remainder = normalized(block.text.slice(quantity.end));
    const prices = pricesIn(
      quantity.reviewReason === "QUANTITY_MISSING" || quantity.reviewReason === "QUANTITY_AMBIGUOUS"
        ? block.text
        : remainder
    );
    const linePriceBasis = explicitPriceBasis(block.text);
    const priceBasis =
      linePriceBasis !== undefined
        ? linePriceBasis
        : documentPriceBasis !== undefined
          ? documentPriceBasis
          : 1;
    const article = block.text.match(
      /\b(?:Art(?:ikel)?\.?|Materialnr\.?|Art\.-Nr\.)\s*[:.]?\s*([A-Z0-9._/-]{3,})/iu
    );
    const descriptionBeforeQuantity = normalized(block.text.slice(0, quantity.index));
    const unlabelledArticle = leadingArticleNumber(descriptionBeforeQuantity);
    const postPriceDescription = unlabelledArticle ? descriptionAfterPriceColumns(remainder) : "";
    const usePostPriceLayout = Boolean(
      unlabelledArticle && /[\p{L}]{3,}/u.test(postPriceDescription)
    );
    const primaryDescription = trailingRow
      ? trailingRow.description
      : usePostPriceLayout
        ? postPriceDescription
        : descriptionBeforeQuantity.replace(/^[.,;:]\s*/u, "");
    const continuationDescription = continuationDescriptionAfterQuantity(block, quantity);
    const completeDescription = normalized(
      continuationDescription && !primaryDescription.includes(continuationDescription)
        ? `${primaryDescription} ${continuationDescription}`
        : primaryDescription
    );
    const description = completeDescription.slice(0, MAX_POSITION_DESCRIPTION_CHARACTERS);
    if (!description) return [];
    const page = pages[block.pageIndex];
    const region = locatePdfSourceRegion({
      items: page.items,
      pageWidth: page.width,
      pageHeight: page.height,
      viewportTransform: page.viewportTransform,
      positionNumber: block.marker.positionNumber,
      supplierPositionNumber: block.marker.supplierPositionNumber,
      description: normalized(block.firstPageText)
    });
    const reviewReasons = lineReviewReasons(block, quantity, pages);
    if (priceBasis === null) reviewReasons.push("PRICE_BASIS_UNCLEAR");
    if (completeDescription.length > MAX_POSITION_DESCRIPTION_CHARACTERS) {
      reviewReasons.push("DESCRIPTION_LIMIT_REACHED");
    }
    if (!region) reviewReasons.push("SOURCE_REGION_MISSING");
    return [
      {
        documentId: document.metadata.documentId,
        positionNumber: block.marker.positionNumber,
        supplierPositionNumber: block.marker.supplierPositionNumber,
        description,
        quantity: quantity.quantity,
        unit: quantity.unit,
        rawQuantity: quantity.reviewReason ? quantity.rawQuantity : null,
        reviewReasons,
        continuationPageNumbers: block.continuationPageNumbers,
        continuationEvidence: continuationEvidence(block, pages),
        pageNumber: block.pageIndex + 1,
        lineIndex,
        region: region ?? undefined,
        supplier:
          document.metadata.supplierName ??
          document.metadata.originalFileName.replace(/\.pdf$/i, ""),
        articleNumber:
          trailingRow?.articleNumber ??
          article?.[1] ??
          (usePostPriceLayout ? unlabelledArticle : null),
        unitPrice: prices.unitPrice,
        priceBasis,
        totalPrice:
          prices.totalPrice ??
          (prices.unitPrice !== null && quantity.quantity !== null && priceBasis !== null
            ? Math.round(((prices.unitPrice * quantity.quantity) / priceBasis) * 100) / 100
            : null)
      }
    ];
  });
}

function parseLines(document: BrowserWorkerDocument, pages: readonly ExtractedPdfPage[]) {
  if (document.metadata.documentType === "BASIS_LV") {
    return { basis: parseBasisDocument(document, pages), supplier: [] };
  }
  if (
    document.metadata.documentType === "SUPPLIER_OFFER" ||
    document.metadata.documentType === "MANUFACTURER_OFFER"
  ) {
    return { basis: [], supplier: parseSupplierDocument(document, pages) };
  }
  return { basis: [], supplier: [] };
}

function countDocumentCandidates(
  document: BrowserWorkerDocument,
  pages: readonly ExtractedPdfPage[]
): number {
  if (document.metadata.documentType === "BASIS_LV") {
    const blocks = buildPositionBlocks(pages, (page) =>
      (page.items.length
        ? positionMarkersFromGeometry(page)
        : legacyBasisPositionMarkers(page.text)
      ).filter((marker) => marker.kind === "LV")
    );
    return new Set(blocks.map((block) => block.marker.positionNumber)).size;
  }
  if (
    document.metadata.documentType === "SUPPLIER_OFFER" ||
    document.metadata.documentType === "MANUFACTURER_OFFER"
  ) {
    return buildPositionBlocks(pages, supplierPositionMarkers).length;
  }
  return 0;
}

function finalizeDocumentDiagnostics(
  diagnostic: BrowserDocumentDiagnostics,
  lines: readonly (ParsedBasisLine | ParsedSupplierLine)[]
): BrowserDocumentDiagnostics {
  return {
    ...diagnostic,
    extractedPositions: lines.length,
    missingSourceRegions: lines.filter(
      (line) =>
        !line.region ||
        line.region.width <= 0 ||
        line.region.height <= 0 ||
        line.reviewReasons?.includes("SOURCE_REGION_MISSING")
    ).length,
    multiPagePositions: lines.filter(
      (line) =>
        (line.continuationPageNumbers?.length ?? 0) > 0 ||
        line.reviewReasons?.includes("MULTI_PAGE_POSITION")
    ).length
  };
}

async function extractDocumentPages(
  document: BrowserWorkerDocument,
  onPage: (page: number) => void
): Promise<ExtractedDocumentPages> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    configureBrowserPdfJs(pdfjs);
    const loadingTask = pdfjs.getDocument(browserPdfLoadingOptions(new Uint8Array(document.bytes)));
    const pdf = await loadingTask.promise;
    const pages: ExtractedPdfPage[] = [];
    const issues: BrowserProcessingIssue[] = [];
    let ocrProcessedPages = 0;
    let ocrFailedPages = 0;
    let ocrRequiredPages = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (cancelled) break;
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const nativeItems = content.items.flatMap((item): PdfTextGeometryItem[] =>
        "str" in item &&
        typeof item.str === "string" &&
        "width" in item &&
        typeof item.width === "number" &&
        "height" in item &&
        typeof item.height === "number" &&
        "transform" in item &&
        Array.isArray(item.transform)
          ? [
              {
                str: item.str,
                width: item.width,
                height: item.height,
                transform: item.transform
              }
            ]
          : []
      );
      const nativeText = pdfTextInVisualOrder({
        items: nativeItems,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        viewportTransform: viewport.transform
      });
      let items = nativeItems;
      let text = nativeText;
      let extractionMethod: ExtractedPdfPage["extractionMethod"] = "NATIVE";
      let rasterCoverage: number | null = null;
      if ("getOperatorList" in page) {
        try {
          const operatorList = await page.getOperatorList();
          const operators = (pdfjs as unknown as { OPS?: Record<string, number> }).OPS;
          rasterCoverage = estimateBrowserRasterCoverage({
            ...operatorList,
            operators: operators ?? {},
            viewport
          });
        } catch {
          rasterCoverage = null;
        }
      }
      if (
        rasterCoverage === null &&
        ["OCR_REQUIRED", "OCR_AVAILABLE"].includes(document.metadata.scanState)
      )
        rasterCoverage = 1;
      const hasRasterFallback =
        (rasterCoverage ?? 0) > 0 ||
        document.metadata.scanState === "OCR_REQUIRED" ||
        document.metadata.scanState === "OCR_AVAILABLE";
      if (hasRasterFallback && shouldRunBrowserOcr({ nativeText, rasterCoverage })) {
        try {
          const recognized = await recognizeBrowserPage({
            page: page as unknown as BrowserOcrRenderablePdfPage,
            baseViewport: viewport,
            onProgress(progress) {
              emit({
                type: "OCR_PROGRESS",
                documentId: document.metadata.documentId,
                page: pageNumber,
                status: progress.status,
                progress: progress.progress
              });
            }
          });
          const assessment = summarizeBrowserOcr({
            text: recognized.text,
            confidence: recognized.confidence,
            wordCount: recognized.words.length
          });
          const imageWidth =
            "imageWidth" in recognized && typeof recognized.imageWidth === "number"
              ? recognized.imageWidth
              : viewport.width * 2;
          const imageHeight =
            "imageHeight" in recognized && typeof recognized.imageHeight === "number"
              ? recognized.imageHeight
              : viewport.height * 2;
          const ocrItems = assessment.usable
            ? ocrWordsToPdfGeometry({
                words: recognized.words,
                imageWidth,
                imageHeight,
                pageWidth: viewport.width,
                pageHeight: viewport.height,
                viewportTransform: viewport.transform
              })
            : [];
          const nativeCharacters = nativeText.replace(/\s+/gu, "").length;
          if (assessment.usable && ocrItems.length > 0) {
            items = mergeBrowserOcrGeometry(nativeItems, ocrItems);
            text = pdfTextInVisualOrder({
              items,
              pageWidth: viewport.width,
              pageHeight: viewport.height,
              viewportTransform: viewport.transform
            });
            extractionMethod = "OCR";
            ocrProcessedPages += 1;
          } else if (nativeCharacters < 40 || !assessment.usable) {
            ocrRequiredPages += 1;
            ocrFailedPages += 1;
            issues.push({
              code: "OCR_FAILED",
              status: "REVIEW_REQUIRED",
              documentId: document.metadata.documentId,
              pageNumber,
              recoverable: true,
              message: `${document.metadata.originalFileName}, Seite ${pageNumber}: OCR lieferte keine sicher nutzbare Textgeometrie.`
            });
          }
        } catch {
          ocrRequiredPages += 1;
          ocrFailedPages += 1;
          issues.push({
            code: "OCR_FAILED",
            status: "REVIEW_REQUIRED",
            documentId: document.metadata.documentId,
            pageNumber,
            recoverable: true,
            message: `${document.metadata.originalFileName}, Seite ${pageNumber}: Lokales OCR konnte nicht ausgeführt werden.`
          });
        }
      }
      pages.push({
        text,
        items,
        width: viewport.width,
        height: viewport.height,
        viewportTransform: viewport.transform,
        extractionMethod
      });
      onPage(pageNumber);
    }
    await loadingTask.destroy();
    return {
      pages,
      issues,
      ocrProcessedPages,
      ocrFailedPages,
      ocrRequiredPages
    };
  } catch {
    return {
      pages: [],
      issues: [
        {
          code: "PDF_PARSE_FAILED",
          status: "REVIEW_REQUIRED",
          documentId: document.metadata.documentId,
          recoverable: true,
          message: "PDF konnte nicht sicher gelesen werden. Dokument prüfen oder erneut hochladen."
        }
      ],
      ocrProcessedPages: 0,
      ocrFailedPages: 0,
      ocrRequiredPages: 0
    };
  }
}

async function processDocuments(
  runId: string,
  documents: BrowserWorkerDocument[],
  incremental = false
) {
  cancelled = false;
  const totalPages = documents.reduce((sum, document) => sum + document.metadata.pageCount, 0);
  let processedPages = 0;
  let currentDocumentId: string | null = null;
  let currentPage: number | null = null;
  const completedStages: BrowserProcessingStage[] = [];
  const result: BrowserWorkerResult = {
    documentClassifications: [],
    basisLines: [],
    supplierLines: [],
    warnings: [],
    processingIssues: [],
    diagnostics: {
      pagesInspected: 0,
      pagesParsed: 0,
      ocrRequiredPages: 0,
      ocrProcessedPages: 0,
      ocrFailedPages: 0,
      matchingCandidates: 0,
      documents: []
    }
  };
  const extractedPages = new Map<string, ExtractedPdfPage[]>();

  for (const [stageIndex, stage] of stages.entries()) {
    if (cancelled) {
      emit({ type: "CANCELLED" });
      return;
    }
    emit({
      type: "PROGRESS",
      stage,
      completed: stageIndex,
      total: stages.length
    });
    if (stage === "CLASSIFY_DOCUMENTS") {
      for (const document of documents) {
        if (document.metadata.excludedFromProcessing) continue;
        currentDocumentId = document.metadata.documentId;
        emit({
          type: "DOCUMENT_PROGRESS",
          documentId: currentDocumentId,
          fileName: document.metadata.originalFileName
        });
        const extraction = await extractDocumentPages(document, (page) => {
          currentPage = page;
          processedPages += 1;
          emit({
            type: "PAGE_PROGRESS",
            documentId: currentDocumentId!,
            page,
            processedPages,
            totalPages
          });
        });
        const { pages, issues } = extraction;
        if (
          pages.length &&
          (["SCAN_OCR_REQUIRED", "UNKNOWN"].includes(document.metadata.documentType) ||
            extraction.ocrProcessedPages > 0)
        ) {
          const nativePages = pages.filter((page) => page.extractionMethod === "NATIVE");
          const nativeText = nativePages.map((page) => page.text).join("\n");
          const classification = classifyBrowserDocumentContent({
            fileName: document.metadata.originalFileName,
            inspection: {
              pageCount: pages.length,
              metadata: {},
              text: nativeText,
              textLayerCharacterCount: nativeText.replace(/\s+/gu, "").length,
              inspectedPageCount: pages.length,
              pagesWithText: nativePages.filter((page) => page.text.trim().length >= 20).length,
              ocrText: pages
                .filter((page) => page.extractionMethod === "OCR")
                .map((page) => page.text)
                .join("\n"),
              ocrPageCount: extraction.ocrProcessedPages
            }
          });
          result.documentClassifications?.push({
            documentId: document.metadata.documentId,
            classification
          });
          document.metadata = applyFullRunDocumentClassification(document.metadata, classification);
          if (["UNKNOWN", "SCAN_OCR_REQUIRED"].includes(document.metadata.documentType)) {
            const message = `${document.metadata.originalFileName}: Dokumentrolle nach Vollprüfung unklar. Rolle manuell zuweisen und erneut verarbeiten.`;
            result.warnings.push(message);
            emit({
              type: "WARNING",
              documentId: document.metadata.documentId,
              status: "REVIEW_REQUIRED",
              recoverable: true,
              message
            });
          }
        }
        for (const issue of issues) {
          result.processingIssues?.push(issue);
          result.warnings.push(issue.message);
          emit({ type: "WARNING", ...issue });
        }
        extractedPages.set(document.metadata.documentId, pages);
        result.diagnostics.pagesInspected += pages.length;
        result.diagnostics.pagesParsed += pages.filter(
          (page) => page.text.trim().length > 0
        ).length;
        result.diagnostics.ocrRequiredPages += extraction.ocrRequiredPages;
        result.diagnostics.ocrProcessedPages =
          (result.diagnostics.ocrProcessedPages ?? 0) + extraction.ocrProcessedPages;
        result.diagnostics.ocrFailedPages =
          (result.diagnostics.ocrFailedPages ?? 0) + extraction.ocrFailedPages;
        result.diagnostics.documents.push({
          documentId: document.metadata.documentId,
          pagesInspected: pages.length,
          candidatePositions: countDocumentCandidates(document, pages),
          extractedPositions: 0,
          missingSourceRegions: 0,
          ocrProcessedPages: extraction.ocrProcessedPages,
          ocrFailedPages: extraction.ocrFailedPages,
          ocrRequiredPages: extraction.ocrRequiredPages,
          multiPagePositions: 0
        });
      }
    }
    if (stage === "EXTRACT_BASIS") {
      for (const document of documents.filter(
        (candidate) => candidate.metadata.documentType === "BASIS_LV"
      )) {
        currentDocumentId = document.metadata.documentId;
        emit({
          type: "DOCUMENT_PROGRESS",
          documentId: currentDocumentId,
          fileName: document.metadata.originalFileName
        });
        result.basisLines.push(
          ...parseLines(document, extractedPages.get(document.metadata.documentId) ?? []).basis
        );
      }
      if (result.basisLines.length === 0 && !incremental) {
        const warning = "Keine deterministisch lesbaren Basis-Positionen gefunden.";
        result.warnings.push(warning);
        emit({ type: "WARNING", message: warning });
      }
    }
    if (stage === "EXTRACT_SUPPLIERS") {
      for (const document of documents.filter((candidate) =>
        ["SUPPLIER_OFFER", "MANUFACTURER_OFFER"].includes(candidate.metadata.documentType)
      )) {
        currentDocumentId = document.metadata.documentId;
        emit({
          type: "DOCUMENT_PROGRESS",
          documentId: currentDocumentId,
          fileName: document.metadata.originalFileName
        });
        result.supplierLines.push(
          ...parseLines(document, extractedPages.get(document.metadata.documentId) ?? []).supplier
        );
      }
      if (result.supplierLines.length === 0) {
        const warning = "Keine deterministisch lesbaren Angebotspositionen gefunden.";
        result.warnings.push(warning);
        emit({ type: "WARNING", message: warning });
      }
    }
    if (stage === "MATCH") {
      result.diagnostics.matchingCandidates = result.supplierLines.filter((supplierLine) =>
        result.basisLines.some(
          (basisLine) => basisLine.positionNumber === supplierLine.positionNumber
        )
      ).length;
    }
    completedStages.push(stage);
    const checkpoint: BrowserProcessingCheckpoint = {
      runId,
      stage,
      completedStages: [...completedStages],
      processedPages,
      totalPages,
      currentDocumentId,
      currentPage,
      interrupted: false,
      updatedAt: new Date().toISOString()
    };
    emit({ type: "CHECKPOINT", checkpoint });
  }
  result.diagnostics.documents = result.diagnostics.documents.map((diagnostic) =>
    finalizeDocumentDiagnostics(diagnostic, [
      ...result.basisLines.filter((line) => line.documentId === diagnostic.documentId),
      ...result.supplierLines.filter((line) => line.documentId === diagnostic.documentId)
    ])
  );
  emit({ type: "COMPLETE", result });
}

workerScope.onmessage = (event) => {
  if (event.data.type === "CANCEL") {
    cancelled = true;
    return;
  }
  void processDocuments(event.data.runId, event.data.documents, event.data.incremental).catch(
    (error) =>
      emit({
        type: "ERROR",
        message: error instanceof Error ? error.message : "PROCESSING_FAILED"
      })
  );
};
