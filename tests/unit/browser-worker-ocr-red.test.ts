import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBrowserAnalysis } from "@/browser-projects/browser-analysis";
import { sourceRecordsFor } from "@/components/lv/lv-comparison-page";
import type {
  BrowserProcessingEvent,
  BrowserWorkerDocument,
  BrowserWorkerResult
} from "@/browser-projects/processing-protocol";
import type { BrowserDocumentRecord } from "@/browser-projects/types";

const fixture = vi.hoisted(() => ({
  pages: [] as unknown[][],
  loadingOptions: null as null | Record<string, unknown>
}));
const engine = vi.hoisted(() => ({ recognize: vi.fn() }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (options: Record<string, unknown>) => {
    fixture.loadingOptions = options;
    return {
      promise: Promise.resolve({
        numPages: fixture.pages.length,
        getPage: async (page: number) => ({
          getViewport: ({ scale = 1 } = {}) => ({
            width: 600 * scale,
            height: 800 * scale,
            transform: [scale, 0, 0, -scale, 0, 800 * scale]
          }),
          getTextContent: async () => ({ items: fixture.pages[page - 1] ?? [] }),
          render: () => ({ promise: Promise.resolve(), cancel: () => undefined })
        })
      }),
      destroy: async () => undefined
    };
  }
}));
vi.mock("@/browser-projects/browser-ocr-engine", () => ({
  recognizeBrowserPage: engine.recognize
}));

function document(): BrowserDocumentRecord {
  return {
    projectId: "ocr-project",
    documentId: "ocr-basis",
    originalFileName: "scan.pdf",
    mimeType: "application/pdf",
    size: 1,
    sha256: "a".repeat(64),
    uploadedAt: "2026-09-08T00:00:00.000Z",
    pageCount: 2,
    detectedDocumentType: "BASIS_LV",
    documentType: "BASIS_LV",
    discipline: "HEIZUNG",
    supplierName: null,
    offerNumber: null,
    documentVersion: null,
    revision: 1,
    revisionOfDocumentId: null,
    relationType: "SEPARATE_OFFER",
    scanState: "OCR_REQUIRED",
    projectName: null,
    projectNumber: null,
    lvNumber: "LV-OCR",
    classificationDimensions: {
      documentRole: "HIGH",
      supplier: "LOW",
      discipline: "HIGH",
      projectIdentity: "LOW",
      offerNumber: "LOW",
      relation: "HIGH",
      scanState: "HIGH"
    },
    classificationSignals: [],
    textLayerCharacterCount: 0,
    preliminaryPositionCount: 2,
    activeBasis: true,
    excludedFromProcessing: false,
    manualRoleOverride: false,
    manualBasisOverrideConfirmed: false,
    classificationConfidence: "HIGH",
    classificationWarnings: [],
    processingStatus: "BEREIT"
  };
}

function word(text: string, x0: number, y0: number, x1: number, y1: number) {
  return { text, confidence: 96, bbox: { x0, y0, x1, y1 } };
}

async function run(
  results: unknown[],
  options: { metadata?: Partial<BrowserDocumentRecord>; nativePages?: unknown[][] } = {}
): Promise<BrowserWorkerResult> {
  fixture.pages = options.nativePages ?? results.map(() => []);
  engine.recognize.mockReset();
  results.forEach((result) =>
    result instanceof Error
      ? engine.recognize.mockRejectedValueOnce(result)
      : engine.recognize.mockResolvedValueOnce(result)
  );
  let done!: (value: BrowserWorkerResult) => void;
  const completed = new Promise<BrowserWorkerResult>((resolve) => {
    done = resolve;
  });
  const scope = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage(message: BrowserProcessingEvent) {
      if (message.type === "COMPLETE") done(message.result);
    }
  };
  vi.stubGlobal("self", scope);
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number
      ) {}
      getContext() {
        return {};
      }
    }
  );
  await import("@/workers/browser-processing.worker");
  scope.onmessage?.({
    data: {
      type: "LOAD_DOCUMENTS",
      runId: "ocr-red",
      documents: [
        {
          metadata: { ...document(), ...options.metadata },
          bytes: new ArrayBuffer(0)
        } as BrowserWorkerDocument
      ],
      incremental: true
    }
  } as MessageEvent);
  return completed;
}

afterEach(() => {
  fixture.pages = [];
  fixture.loadingOptions = null;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe.sequential("real browser-processing worker OCR boundary (RED)", () => {
  it("uses OCR geometry for a scanned page and keeps it review-only", async () => {
    const result = await run([
      {
        text: "1.1.10 OCR Pumpengruppe 2 St",
        confidence: 96,
        words: [
          word("1.1.10", 100, 200, 220, 230),
          word("OCR", 240, 200, 300, 230),
          word("Pumpengruppe", 320, 200, 540, 230),
          word("2", 900, 200, 920, 230),
          word("St", 940, 200, 980, 230)
        ]
      }
    ]);
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    expect(fixture.loadingOptions).toMatchObject({
      wasmUrl: "/pdfjs/wasm/"
    });
    expect(result.basisLines).toHaveLength(1);
    expect(result.basisLines[0]).toMatchObject({
      positionNumber: "1.1.10",
      region: expect.objectContaining({ width: expect.any(Number) }),
      reviewReasons: expect.arrayContaining(["OCR_SOURCE"])
    });
    const snapshot = buildBrowserAnalysis({
      projectId: "ocr-project",
      documents: [document()],
      result
    });
    expect(snapshot.pilot.projectReview.positions[0].basis.evidence[0]).toMatchObject({
      status: "VISUAL_ONLY_UNCONFIRMED",
      textItemIds: ["ocr-word:0", "review:BARE_POSITION_SINGLETON", "review:OCR_SOURCE"]
    });
  });

  it("maps OCR continuation pages separately and stops before the next marker", async () => {
    const result = await run([
      {
        text: "1.1.10 Mehrseitige OCR Position",
        confidence: 95,
        words: [
          word("1.1.10", 100, 1300, 220, 1330),
          word("Mehrseitige", 240, 1300, 430, 1330),
          word("OCR", 450, 1300, 510, 1330),
          word("Position", 530, 1300, 660, 1330)
        ]
      },
      {
        text: "Fortsetzung 2 St 1.1.20 Nächste Position 1 St",
        confidence: 94,
        words: [
          word("Fortsetzung", 100, 100, 300, 130),
          word("2", 900, 100, 920, 130),
          word("St", 940, 100, 980, 130),
          word("1.1.20", 100, 500, 220, 530),
          word("Nächste", 240, 500, 360, 530),
          word("Position", 380, 500, 510, 530),
          word("1", 900, 500, 920, 530),
          word("St", 940, 500, 980, 530)
        ]
      }
    ]);
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(result.basisLines).toHaveLength(2);
    expect(result.basisLines[0].description).not.toContain("Nächste Position");
    expect(result.basisLines[0].continuationEvidence).toEqual([
      expect.objectContaining({
        pageNumber: 2,
        sourceText: expect.not.stringContaining("Nächste Position")
      })
    ]);
    const snapshot = buildBrowserAnalysis({
      projectId: "ocr-project",
      documents: [document()],
      result
    });
    const records = sourceRecordsFor(
      snapshot.pilot,
      snapshot.pilot.projectReview.positions[0],
      new Map()
    );
    expect(records.map((record) => record.pageNumber)).toEqual([1, 2]);
    expect(
      records
        .flatMap((record) => record.evidence)
        .every((evidence) => evidence.status === "VISUAL_ONLY_UNCONFIRMED")
    ).toBe(true);
  });

  it("leaves the page unresolved when the OCR recognizer fails", async () => {
    const result = await run([new Error("engine unavailable")]);
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    expect(result.basisLines).toEqual([]);
    expect(result.supplierLines).toEqual([]);
    expect(result.processingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "OCR_FAILED",
          status: "REVIEW_REQUIRED",
          documentId: "ocr-basis",
          recoverable: true
        })
      ])
    );
    expect(result.diagnostics.ocrRequiredPages).toBe(1);
  });

  it("reclassifies a formerly unreadable scan before extracting its supplier positions", async () => {
    const recognized = {
      text: "Angebot Angebotsnummer 123456789 Einzelpreis Gesamtpreis Hawa Heizungsinstallation zu LV-Pos.: 2.1.10 Pumpengruppe 6 St 100,00 600,00",
      confidence: 86,
      words: [
        word(
          "Angebot Angebotsnummer 123456789 Einzelpreis Gesamtpreis Hawa Heizungsinstallation",
          100,
          60,
          1100,
          100
        ),
        word("zu LV-Pos.: 2.1.10", 100, 200, 400, 230),
        word("Pumpengruppe", 100, 250, 330, 280),
        word("6 St 100,00 600,00", 750, 290, 1120, 320)
      ]
    };
    const result = await run([recognized], {
      metadata: {
        documentType: "SCAN_OCR_REQUIRED",
        detectedDocumentType: "SCAN_OCR_REQUIRED",
        activeBasis: false
      }
    });
    expect(result.supplierLines).toHaveLength(1);
    expect(result.supplierLines[0]).toMatchObject({
      positionNumber: "2.1.10",
      quantity: 6,
      totalPrice: 600,
      reviewReasons: expect.arrayContaining(["OCR_SOURCE"])
    });
    expect(result.documentClassifications).toEqual([
      expect.objectContaining({
        documentId: "ocr-basis",
        classification: expect.objectContaining({
          documentType: "SUPPLIER_OFFER",
          scanState: "OCR_AVAILABLE"
        })
      })
    ]);
  });

  it("preserves a manually assigned role even when OCR resembles another document kind", async () => {
    const result = await run(
      [
        {
          text: "Angebot Angebotsnummer 123456789 Hawa Einzelpreis Gesamtpreis 1.1.10 Pumpengruppe 6 St",
          confidence: 88,
          words: [
            word(
              "Angebot Angebotsnummer 123456789 Hawa Einzelpreis Gesamtpreis",
              100,
              60,
              1100,
              100
            ),
            word("1.1.10 Pumpengruppe 6 St", 100, 200, 1000, 230)
          ]
        }
      ],
      {
        metadata: {
          documentType: "BASIS_LV",
          detectedDocumentType: "SCAN_OCR_REQUIRED",
          manualRoleOverride: true
        }
      }
    );
    expect(result.basisLines).toHaveLength(1);
    expect(result.supplierLines).toHaveLength(0);
  });

  it("retains a printed quantity when OCR adds unreadable handwriting in the adjacent price column", async () => {
    const result = await run(
      [
        {
          text: "Angebot Angebotsnummer 123456789 Einzelpreis Gesamtpreis 1.1.10 Kupfer Muffe 30,000 St DA ; BE arena",
          confidence: 86,
          words: [
            word("Angebot Angebotsnummer 123456789 Einzelpreis Gesamtpreis", 100, 60, 1100, 100),
            word("1.1.10 Kupfer Muffe", 100, 200, 800, 230),
            word("30,000 St", 700, 400, 850, 430),
            word("DA ; BE arena", 900, 400, 1150, 430)
          ]
        }
      ],
      { metadata: { documentType: "SUPPLIER_OFFER", activeBasis: false } }
    );
    expect(result.supplierLines[0]).toMatchObject({
      quantity: 30,
      unit: "St",
      unitPrice: null,
      totalPrice: null,
      reviewReasons: expect.arrayContaining(["OCR_SOURCE"])
    });
    expect(result.supplierLines[0].description).not.toContain("arena");
  });

  it("keeps native text and adds a scanned position even when OCR finds fewer characters than the native header", async () => {
    const result = await run(
      [
        {
          text: "1.1.20 Gescanntes Ventil 2 St",
          confidence: 90,
          words: [word("1.1.20 Gescanntes Ventil 2 St", 100, 800, 1080, 830)]
        }
      ],
      {
        nativePages: [
          [
            {
              str: "Langer digitaler Briefkopf und Kontaktinformationen ".repeat(12),
              width: 500,
              height: 12,
              transform: [12, 0, 0, 12, 50, 750]
            },
            {
              str: "1.1.10 Native Pumpe 1 St",
              width: 490,
              height: 12,
              transform: [12, 0, 0, 12, 50, 650]
            }
          ]
        ]
      }
    );
    expect(engine.recognize).toHaveBeenCalledTimes(1);
    expect(result.basisLines.map((line) => line.positionNumber)).toEqual(["1.1.10", "1.1.20"]);
    expect(result.basisLines[0].description).toContain("Native Pumpe");
    expect(result.basisLines[1].description).toContain("Gescanntes Ventil");
  });
});
