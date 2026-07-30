import type {
  BrowserProcessingCommand,
  BrowserProcessingEvent,
  BrowserWorkerDocument,
  BrowserWorkerResult,
  ParsedBasisLine,
  ParsedSupplierLine
} from "@/browser-projects/processing-protocol";
import type {
  BrowserProcessingCheckpoint,
  BrowserProcessingStage
} from "@/browser-projects/types";

const workerScope = self as unknown as {
  postMessage(message: BrowserProcessingEvent): void;
  onmessage: ((event: MessageEvent<BrowserProcessingCommand>) => void) | null;
};

let cancelled = false;

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

function emit(message: BrowserProcessingEvent) {
  workerScope.postMessage(message);
}

function readableText(bytes: ArrayBuffer): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const pdfStrings = [...raw.matchAll(/\(([^()]*)\)\s*Tj/g)].map((match) =>
    match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
  );
  return pdfStrings.length ? pdfStrings.join("\n") : raw;
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

function quantityIn(value: string) {
  const match = value.match(
    /(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?)\s+(St|Stk|Stück|m|m2|m²|m3|m³|kg|Psch|Meter)\b/iu
  );
  return match
    ? {
        quantity: number(match[1]),
        unit: match[2],
        index: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length
      }
    : null;
}

function pricesIn(value: string): { unitPrice: number | null; totalPrice: number | null } {
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
  const candidates = [...value.matchAll(/\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/gu)]
    .map((match) => number(match[1]))
    .filter((candidate): candidate is number => candidate !== null);
  return {
    unitPrice: candidates.length >= 2 ? candidates.at(-2)! : null,
    totalPrice: candidates.length ? candidates.at(-1)! : null
  };
}

function parseBasisPage(
  document: BrowserWorkerDocument,
  text: string,
  pageNumber: number
): ParsedBasisLine[] {
  const matches = [
    ...text.matchAll(/\b(?:Position\s+)?(\d+(?:\.\d+){2,})\.?\s+/giu)
  ];
  const result: ParsedBasisLine[] = [];
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const block = normalized(text.slice(start, end));
    const quantity = quantityIn(block);
    if (!quantity) return;
    const description = normalized(block.slice(0, quantity.index)).slice(0, 800);
    if (!description) return;
    result.push({
      documentId: document.metadata.documentId,
      positionNumber: match[1],
      description,
      quantity: quantity.quantity,
      unit: quantity.unit,
      pageNumber,
      lineIndex: index
    });
  });
  return result;
}

function supplierPositionMarkers(text: string) {
  const markers: Array<{ positionNumber: string; index: number; end: number }> = [];
  for (const match of text.matchAll(
    /\bLVNR\s+(\d+)\s+(\d+)\s+(\d+)\b/giu
  )) {
    markers.push({
      positionNumber: `${match[1]}.${match[2]}.${match[3]}`,
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length
    });
  }
  for (const match of text.matchAll(
    /\b(\d+(?:\.\d+){2,})(?:-\d+)?\b/gu
  )) {
    markers.push({
      positionNumber: match[1],
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length
    });
  }
  if (!markers.length) {
    for (const match of text.matchAll(/\bAngebotsposition\s+(\d+)\b/giu)) {
      markers.push({
        positionNumber: match[1],
        index: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length
      });
    }
  }
  return markers.sort((left, right) => left.index - right.index);
}

function parseSupplierPage(
  document: BrowserWorkerDocument,
  text: string,
  pageNumber: number
): ParsedSupplierLine[] {
  const markers = supplierPositionMarkers(text);
  const result: ParsedSupplierLine[] = [];
  markers.forEach((marker, index) => {
    const nextIndex = markers[index + 1]?.index ?? text.length;
    const block = normalized(text.slice(marker.end, nextIndex));
    const quantity = quantityIn(block);
    if (!quantity) return;
    const prices = pricesIn(block.slice(quantity.end));
    const article = block.match(
      /\b(?:Art(?:ikel)?\.?|Materialnr\.?|Art\.-Nr\.)\s*[:.]?\s*([A-Z0-9._/-]{3,})/iu
    );
    result.push({
      documentId: document.metadata.documentId,
      positionNumber: marker.positionNumber,
      description: normalized(block.slice(0, quantity.index)).slice(0, 800),
      quantity: quantity.quantity,
      unit: quantity.unit,
      pageNumber,
      lineIndex: index,
      supplier:
        document.metadata.supplierName ??
        document.metadata.originalFileName.replace(/\.pdf$/i, ""),
      articleNumber: article?.[1] ?? null,
      unitPrice: prices.unitPrice,
      totalPrice:
        prices.totalPrice ??
        (prices.unitPrice !== null && quantity.quantity !== null
          ? Math.round(prices.unitPrice * quantity.quantity * 100) / 100
          : null)
    });
  });
  return result;
}

function parseLines(
  document: BrowserWorkerDocument,
  pages: readonly string[]
) {
  const basis: ParsedBasisLine[] = [];
  const supplier: ParsedSupplierLine[] = [];
  pages.forEach((pageText, pageIndex) => {
    if (document.metadata.documentType === "BASIS_LV") {
      basis.push(...parseBasisPage(document, pageText, pageIndex + 1));
      return;
    }
    if (
      document.metadata.documentType === "SUPPLIER_OFFER" ||
      document.metadata.documentType === "MANUFACTURER_OFFER"
    ) {
      supplier.push(...parseSupplierPage(document, pageText, pageIndex + 1));
    }
  });
  const uniqueBasis = new Map(
    basis.map((line) => [`${line.documentId}:${line.positionNumber}`, line])
  );
  const uniqueSupplier = new Map(
    supplier.map((line) => [
      `${line.documentId}:${line.positionNumber}:${line.pageNumber}`,
      line
    ])
  );
  return {
    basis: [...uniqueBasis.values()],
    supplier: [...uniqueSupplier.values()]
  };
}

async function extractDocumentPages(
  document: BrowserWorkerDocument,
  onPage: (page: number) => void
): Promise<string[]> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/api/local/pdf-worker";
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(document.bytes)
    });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (cancelled) break;
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      );
      onPage(pageNumber);
    }
    await loadingTask.destroy();
    return pages;
  } catch {
    const text = readableText(document.bytes);
    onPage(1);
    return [text];
  }
}

async function processDocuments(
  runId: string,
  documents: BrowserWorkerDocument[],
  incremental = false
) {
  cancelled = false;
  const totalPages = documents.reduce(
    (sum, document) => sum + document.metadata.pageCount,
    0
  );
  let processedPages = 0;
  let currentDocumentId: string | null = null;
  let currentPage: number | null = null;
  const completedStages: BrowserProcessingStage[] = [];
  const result: BrowserWorkerResult = {
    basisLines: [],
    supplierLines: [],
    warnings: [],
    diagnostics: {
      pagesInspected: 0,
      pagesParsed: 0,
      ocrRequiredPages: 0,
      matchingCandidates: 0
    }
  };
  const extractedPages = new Map<string, string[]>();

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
        const pages = await extractDocumentPages(document, (page) => {
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
        extractedPages.set(document.metadata.documentId, pages);
        result.diagnostics.pagesInspected += pages.length;
        result.diagnostics.pagesParsed += pages.filter(
          (text) => text.trim().length > 0
        ).length;
        result.diagnostics.ocrRequiredPages += pages.filter(
          (text) => text.trim().length === 0
        ).length;
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
          ...parseLines(
            document,
            extractedPages.get(document.metadata.documentId) ?? []
          ).basis
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
        ["SUPPLIER_OFFER", "MANUFACTURER_OFFER"].includes(
          candidate.metadata.documentType
        )
      )) {
        currentDocumentId = document.metadata.documentId;
        emit({
          type: "DOCUMENT_PROGRESS",
          documentId: currentDocumentId,
          fileName: document.metadata.originalFileName
        });
        result.supplierLines.push(
          ...parseLines(
            document,
            extractedPages.get(document.metadata.documentId) ?? []
          ).supplier
        );
      }
      if (result.supplierLines.length === 0) {
        const warning = "Keine deterministisch lesbaren Angebotspositionen gefunden.";
        result.warnings.push(warning);
        emit({ type: "WARNING", message: warning });
      }
    }
    if (stage === "MATCH") {
      result.diagnostics.matchingCandidates = result.supplierLines.filter(
        (supplierLine) =>
          result.basisLines.some(
            (basisLine) =>
              basisLine.positionNumber === supplierLine.positionNumber
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
  emit({ type: "COMPLETE", result });
}

workerScope.onmessage = (event) => {
  if (event.data.type === "CANCEL") {
    cancelled = true;
    return;
  }
  void processDocuments(
    event.data.runId,
    event.data.documents,
    event.data.incremental
  ).catch((error) =>
    emit({
      type: "ERROR",
      message: error instanceof Error ? error.message : "PROCESSING_FAILED"
    })
  );
};
