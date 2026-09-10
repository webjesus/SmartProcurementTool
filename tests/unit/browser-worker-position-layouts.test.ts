import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserProcessingEvent,
  BrowserWorkerDocument,
  BrowserWorkerResult
} from "@/browser-projects/processing-protocol";

type FixtureItem = {
  str: string;
  width: number;
  height: number;
  transform: number[];
};

const pdfFixture = vi.hoisted(() => ({
  pages: [] as FixtureItem[][],
  failure: null as Error | null,
  viewport: {
    width: 600,
    height: 800,
    transform: [1, 0, 0, -1, 0, 800] as number[]
  }
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: pdfFixture.failure
      ? Promise.reject(pdfFixture.failure)
      : Promise.resolve({
          numPages: pdfFixture.pages.length,
          getPage: async (pageNumber: number) => ({
            getViewport: () => pdfFixture.viewport,
            getTextContent: async () => ({
              items: pdfFixture.pages[pageNumber - 1] ?? []
            })
          })
        }),
    destroy: async () => undefined
  })
}));

afterEach(() => {
  pdfFixture.pages = [];
  pdfFixture.failure = null;
  pdfFixture.viewport = {
    width: 600,
    height: 800,
    transform: [1, 0, 0, -1, 0, 800]
  };
  vi.unstubAllGlobals();
  vi.resetModules();
});

function item(str: string, x: number, y: number): FixtureItem {
  return {
    str,
    width: Math.max(4, str.length * 5),
    height: 10,
    transform: [1, 0, 0, 10, x, y]
  };
}

function row(parts: readonly string[], y: number, startX = 48): FixtureItem[] {
  let x = startX;
  return parts.map((part) => {
    const current = item(part, x, y);
    x += current.width + 4;
    return current;
  });
}

function shuffled(items: readonly FixtureItem[]): FixtureItem[] {
  return items
    .filter((_, index) => index % 2 === 1)
    .reverse()
    .concat(items.filter((_, index) => index % 2 === 0).reverse());
}

function viewportItem(
  str: string,
  left: number,
  top: number,
  width: number,
  height: number,
  viewportTransform: readonly number[]
): FixtureItem {
  const [a, b, c, d, e, f] = viewportTransform;
  const determinant = a * d - b * c;
  const inverseVector = (x: number, y: number): [number, number] => [
    (d * x - c * y) / determinant,
    (-b * x + a * y) / determinant
  ];
  const inversePoint = (x: number, y: number): [number, number] => {
    const [pointX, pointY] = inverseVector(x - e, y - f);
    return [pointX, pointY];
  };
  const [horizontalX, horizontalY] = inverseVector(1, 0);
  const [verticalX, verticalY] = inverseVector(0, -height);
  const [originX, originY] = inversePoint(left, top + height);
  return {
    str,
    width,
    height,
    transform: [horizontalX, horizontalY, verticalX, verticalY, originX, originY]
  };
}

async function processFixture(input: {
  documentType: "BASIS_LV" | "SUPPLIER_OFFER";
  items?: FixtureItem[];
  pages?: FixtureItem[][];
  bytes?: ArrayBuffer;
  failPdfJs?: Error;
  viewport?: { width: number; height: number; transform: number[] };
}): Promise<{
  result: BrowserWorkerResult;
  events: BrowserProcessingEvent[];
}> {
  pdfFixture.pages = input.pages ?? [input.items ?? []];
  pdfFixture.failure = input.failPdfJs ?? null;
  if (input.viewport) pdfFixture.viewport = input.viewport;
  let complete: ((result: BrowserWorkerResult) => void) | null = null;
  let fail: ((error: Error) => void) | null = null;
  const resultPromise = new Promise<BrowserWorkerResult>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  const events: BrowserProcessingEvent[] = [];
  const workerScope = {
    onmessage: null as ((event: MessageEvent<{ type: "LOAD_DOCUMENTS" }>) => void) | null,
    postMessage(message: BrowserProcessingEvent) {
      events.push(message);
      if (message.type === "COMPLETE") complete?.(message.result);
      if (message.type === "ERROR") fail?.(new Error(message.message));
    }
  };
  vi.stubGlobal("self", workerScope);
  await import("@/workers/browser-processing.worker");

  const document = {
    metadata: {
      documentId: "layout-fixture",
      originalFileName: "Neues-Dokument.pdf",
      documentType: input.documentType,
      supplierName: input.documentType === "SUPPLIER_OFFER" ? "Supplier Alpha" : null,
      pageCount: 1,
      excludedFromProcessing: false
    },
    bytes: input.bytes ?? new ArrayBuffer(0)
  } as BrowserWorkerDocument;
  workerScope.onmessage?.({
    data: {
      type: "LOAD_DOCUMENTS",
      runId: "position-layout-regression",
      documents: [document],
      incremental: true
    }
  } as unknown as MessageEvent<{ type: "LOAD_DOCUMENTS" }>);
  return { result: await resultPromise, events };
}

describe.sequential("browser worker position layouts", () => {
  it("reports full-document position and evidence diagnostics per document", async () => {
    const { result } = await processFixture({
      documentType: "BASIS_LV",
      pages: [
        [
          ...row(["Position", "1", ".", "1", ".", "10", "."], 750),
          ...row(["Vollständig", "erkannte", "Position"], 730, 80),
          ...row(["2", "St"], 710, 430)
        ],
        [
          ...row(["Position", "1", ".", "1", ".", "20", "."], 750),
          ...row(["Position", "ohne", "Menge"], 730, 80)
        ]
      ]
    });

    expect(result.diagnostics.documents).toEqual([
      expect.objectContaining({
        documentId: "layout-fixture",
        pagesInspected: 2,
        candidatePositions: 2,
        extractedPositions: 2,
        missingSourceRegions: 0,
        ocrProcessedPages: 0,
        ocrFailedPages: 0,
        ocrRequiredPages: 0,
        multiPagePositions: 0
      })
    ]);
  });

  it("uses the procurement quantity after technical weight, flow and pipe length", async () => {
    const { result } = await processFixture({
      documentType: "BASIS_LV",
      pages: [
        [
          ...row(["Position", "8.1.10"], 750),
          ...row(["Speichermodul", "mit", "Rohrleitung"], 730, 80),
          ...row(["Gewicht:", "70", "kg"], 710, 80),
          ...row(["Max.", "Volumenstrom:", "15,5", "m3/h"], 690, 80),
          ...row(["Rohrlänge:", "6", "m"], 670, 80)
        ],
        [
          ...row(["Technische", "Fortsetzung", "vollständig"], 750, 80),
          ...row(["6,000", "St"], 710, 430),
          ...row(["Position", "8.1.20"], 650),
          ...row(["Nachfolgende", "Position"], 630, 80),
          ...row(["12", "St"], 610, 430)
        ]
      ]
    });
    expect(result.basisLines[0]).toMatchObject({ quantity: 6, unit: "St" });
    expect(result.basisLines[0].description).toContain("Gewicht: 70 kg");
    expect(result.basisLines[0].description).toContain("15,5 m3/h");
    expect(result.basisLines[0].description).toContain("Rohrlänge: 6 m");
    expect(result.basisLines[0].description).toContain("Technische Fortsetzung vollständig");
    expect(result.basisLines[0].description).not.toContain("Nachfolgende Position");
  });

  it("retains unquantified and ambiguous positions for manual correction", async () => {
    const { result } = await processFixture({
      documentType: "BASIS_LV",
      items: [
        ...row(["Position", "8.2.10"], 750),
        ...row(["Leistung", "mit", "unlesbarer", "Mengenangabe"], 730, 80),
        ...row(["Position", "8.2.20"], 650),
        ...row(["Leistung", "mit", "widersprüchlichen", "Mengen"], 630, 80),
        ...row(["6", "St"], 610, 430),
        ...row(["12", "St"], 590, 430)
      ]
    });
    expect(result.basisLines).toHaveLength(2);
    expect(result.basisLines[0]).toMatchObject({
      quantity: null,
      unit: null,
      reviewReasons: expect.arrayContaining(["QUANTITY_MISSING"])
    });
    expect(result.basisLines[1]).toMatchObject({
      quantity: null,
      unit: null,
      reviewReasons: expect.arrayContaining(["QUANTITY_AMBIGUOUS"])
    });
  });

  it("prefers a following-page position net total over page-one gross price columns", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      pages: [
        [
          ...row(["zu", "LV-Pos.:", "8.3.10"], 170),
          ...row(["88000001999", "6", "ST", "EP", "100,00", "GP", "600,00"], 150, 80),
          ...row(["Speichermodul", "mit", "Zubehör"], 130, 80)
        ],
        [
          ...row(["Kundenrabatt", "-20,00", "%", "-120,00"], 750, 80),
          ...row(["Positionsnetto", "80,00", "480,00"], 730, 80),
          ...row(["zu", "LV-Pos.:", "8.3.20"], 650),
          ...row(["Anderes", "Produkt", "1", "ST", "20,00", "20,00"], 630, 80)
        ]
      ]
    });
    expect(result.supplierLines[0]).toMatchObject({
      quantity: 6,
      unitPrice: 80,
      totalPrice: 480,
      continuationPageNumbers: [2]
    });
    expect(result.supplierLines[0].description).toBe("Speichermodul mit Zubehör");
  });

  it("keeps explicit unit price bases independent from ordered quantities", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      items: [
        ...row(["zu", "LV-Pos.:", "8.4.10"], 750),
        ...row(["Rohrschelle", "verzinkt"], 730, 80),
        ...row(["Einzelpreis", "je", "100", "St"], 710, 80),
        ...row(["3", "St", "EP", "200,00"], 690, 330),
        ...row(["zu", "LV-Pos.:", "8.4.20"], 650),
        ...row(["Rohrschelle", "Sondermaß"], 630, 80),
        ...row(["Preis", "je", "???", "St"], 610, 80),
        ...row(["5", "St", "EP", "100,00"], 590, 330)
      ]
    });
    expect(result.supplierLines[0]).toMatchObject({
      quantity: 3,
      unitPrice: 200,
      totalPrice: 6,
      priceBasis: 100
    });
    expect(result.supplierLines[1]).toMatchObject({
      quantity: 5,
      unitPrice: 100,
      totalPrice: null,
      priceBasis: null,
      reviewReasons: expect.arrayContaining(["PRICE_BASIS_UNCLEAR"])
    });
  });

  it("reads compact price bases and procurement hours without treating time as technical prose", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      items: [
        ...row(["zu", "LV-Pos.:", "8.5.10"], 750),
        ...row(["Facharbeit", "EUR/100Std"], 730, 80),
        ...row(["8,000", "Std", "EP", "5.000,00"], 710, 330)
      ]
    });
    expect(result.supplierLines[0]).toMatchObject({
      quantity: 8,
      unit: "Std",
      priceBasis: 100,
      unitPrice: 5000,
      totalPrice: 400
    });
  });

  it("inherits an explicit document price basis from a cover page before the first position", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      pages: [
        row(["Preise", "je", "100", "St"], 730, 80),
        [
          ...row(["zu", "LV-Pos.:", "8.5.10"], 750),
          ...row(["Befestigungsset"], 730, 80),
          ...row(["200", "St", "EP", "3,00"], 710, 330)
        ]
      ]
    });
    expect(result.supplierLines[0]).toMatchObject({
      quantity: 200,
      priceBasis: 100,
      unitPrice: 3,
      totalPrice: 6
    });
  });

  it("extracts split Basis position tokens in visual order when the PDF content stream is shuffled", async () => {
    const visualItems = [
      ...row(["Position", "1", ".", "1", ".", "210"], 750),
      ...row(["Prüfbauteil", "Alpha", "Typ", "25"], 730, 80),
      ...row(["2", "St"], 710, 430),
      ...row(["Position", "1", ".", "1", ".", "220"], 670),
      ...row(["Prüfbauteil", "Beta", "Typ", "25"], 650, 80),
      ...row(["3", "St"], 630, 430)
    ];

    const { result } = await processFixture({
      documentType: "BASIS_LV",
      items: shuffled(visualItems)
    });

    expect(result.basisLines.map((line) => line.positionNumber)).toEqual(["1.1.210", "1.1.220"]);
    expect(result.basisLines.map((line) => line.description)).toEqual([
      "Prüfbauteil Alpha Typ 25",
      "Prüfbauteil Beta Typ 25"
    ]);
  });

  it("extracts LVNR, zu LV-Pos and Angebotsposition blocks on the same supplier page", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      items: [
        ...row(["LVNR", "2", "1", "10"], 750),
        ...row(["Angebotsbauteil", "Alpha"], 730, 80),
        ...row(["2", "St"], 710, 430),
        ...row(["EP", "10,00", "GP", "20,00"], 690, 330),
        ...row(["zu", "LV-Pos.:", "2", ".", "1", ".", "20", "."], 650),
        ...row(["Angebotsbauteil", "Beta", "Typ", "25"], 630, 80),
        ...row(["3", "St"], 610, 430),
        ...row(["EP", "11,00", "GP", "33,00"], 590, 330),
        ...row(["Angebotsposition", "300"], 550),
        ...row(["Angebotsbauteil", "Gamma"], 530, 80),
        ...row(["1", "St"], 510, 430),
        ...row(["EP", "40,00", "GP", "40,00"], 490, 330)
      ]
    });

    expect(result.supplierLines.map((line) => line.positionNumber)).toEqual([
      "2.1.10",
      "2.1.20",
      "300"
    ]);
  });

  it("does not turn dates or isolated dotted article numbers into supplier positions", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      items: [
        ...row(["Angebotsdatum", "01.02.2026"], 750),
        ...row(["123.45.6"], 710, 130),
        ...row(["6", "St"], 690, 430),
        ...row(["263,00", "1.578,00"], 670, 330),
        ...row(["Interne", "Artikelreferenz"], 650, 130),
        ...row(["zu", "LV-Pos.:", "3", ".", "2", ".", "120", "."], 610),
        ...row(["Bauteil", "Gamma", "mit", "Dichtung"], 590, 80),
        ...row(["2", "St"], 570, 430),
        ...row(["EP", "100,00", "GP", "200,00"], 550, 330)
      ]
    });

    expect(result.supplierLines.map((line) => line.positionNumber)).toEqual(["3.2.120"]);
  });

  it("accepts repeated bare LV rows in one aligned column but omits an unrelated dotted identifier", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      items: [
        ...row(["Dokument", "471.100.999"], 770, 260),
        ...row(["4.2.10"], 730),
        ...row(["Prüfmodul", "Delta"], 710, 80),
        ...row(["2", "St"], 690, 430),
        ...row(["EP", "15,00", "GP", "30,00"], 670, 330),
        ...row(["4.2.20"], 630),
        ...row(["Prüfmodul", "Epsilon", "Typ", "20"], 610, 80),
        ...row(["1", "St"], 590, 430),
        ...row(["EP", "25,00", "GP", "25,00"], 570, 330)
      ]
    });

    expect(result.supplierLines.map((line) => line.positionNumber)).toEqual(["4.2.10", "4.2.20"]);
  });

  it("associates a trailing LV marker with the priced product row immediately above it", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      items: [
        ...row(["Pos.", "Gr.", "Materialnr.", "Bezeichnung", "Menge", "EP", "GP"], 760),
        ...row(
          [
            "100",
            "ZX",
            "88000001011",
            "Prüfventil",
            "Alpha",
            "DN",
            "20",
            "4",
            "ST",
            "12,50",
            "50,00"
          ],
          720
        ),
        ...row(["Interne", "Referenz", "A-11"], 700, 80),
        ...row(["1.1.10.", "Stat.", "WarenNr.", "900100"], 680, 122),
        ...row(
          [
            "200",
            "ZY",
            "88000001012",
            "Prüfventil",
            "Beta",
            "DN",
            "25",
            "3",
            "ST",
            "21,00",
            "63,00"
          ],
          640
        ),
        ...row(["Interne", "Referenz", "B-12"], 620, 80),
        ...row(["1.1.20.", "Stat.", "WarenNr.", "900200"], 600, 122)
      ]
    });

    expect(result.supplierLines).toMatchObject([
      {
        positionNumber: "1.1.10",
        articleNumber: "88000001011",
        description: "Prüfventil Alpha DN 20",
        quantity: 4,
        unit: "ST",
        unitPrice: 12.5,
        totalPrice: 50
      },
      {
        positionNumber: "1.1.20",
        articleNumber: "88000001012",
        description: "Prüfventil Beta DN 25",
        quantity: 3,
        unit: "ST",
        unitPrice: 21,
        totalPrice: 63
      }
    ]);
  });

  it("preserves a structurally valid singleton bare LV row as review-required", async () => {
    const { result } = await processFixture({
      documentType: "BASIS_LV",
      items: [
        ...row(["5.4.30"], 730),
        ...row(["Prüfgruppe", "Zeta", "mit", "Anschluss"], 710, 80),
        ...row(["4", "St"], 690, 430)
      ]
    });

    expect(result.basisLines).toHaveLength(1);
    expect(result.basisLines[0]).toMatchObject({
      positionNumber: "5.4.30",
      description: "Prüfgruppe Zeta mit Anschluss",
      reviewReasons: ["BARE_POSITION_SINGLETON"]
    });
  });

  it("keeps a position with an unknown quantity unit as raw review data", async () => {
    const { result } = await processFixture({
      documentType: "BASIS_LV",
      items: [
        ...row(["Position", "5", ".", "4", ".", "40"], 730),
        ...row(["Prüfgruppe", "Eta", "vollständig"], 710, 80),
        ...row(["2", "VE"], 690, 430)
      ]
    });

    expect(result.basisLines).toHaveLength(1);
    expect(result.basisLines[0]).toMatchObject({
      positionNumber: "5.4.40",
      quantity: null,
      unit: null,
      rawQuantity: "2 VE",
      reviewReasons: ["UNKNOWN_UNIT"]
    });
  });

  it("keeps an unknown unit when unit and price columns share one visual row", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      items: [
        ...row(["zu", "LV-Pos.:", "5", ".", "4", ".", "50", "."], 730),
        ...row(["Angebotsbauteil", "Mu"], 710, 80),
        ...row(["2", "VE", "15,00", "30,00"], 690, 390)
      ]
    });

    expect(result.supplierLines).toHaveLength(1);
    expect(result.supplierLines[0]).toMatchObject({
      positionNumber: "5.4.50",
      quantity: null,
      unit: null,
      rawQuantity: "2 VE",
      unitPrice: 15,
      totalPrice: 30,
      reviewReasons: ["UNKNOWN_UNIT"]
    });
  });

  it("joins a Basis position whose description and quantity continue on the next page", async () => {
    const { result } = await processFixture({
      documentType: "BASIS_LV",
      pages: [
        [
          ...row(["Position", "6", ".", "1", ".", "10"], 120),
          ...row(["Prüfgruppe", "Theta"], 100, 80)
        ],
        [...row(["mit", "Fortsetzungszeile"], 750, 80), ...row(["3", "St"], 730, 430)]
      ]
    });

    expect(result.basisLines).toHaveLength(1);
    expect(result.basisLines[0]).toMatchObject({
      positionNumber: "6.1.10",
      description: "Prüfgruppe Theta mit Fortsetzungszeile",
      quantity: 3,
      pageNumber: 1,
      continuationPageNumbers: [2],
      reviewReasons: ["MULTI_PAGE_POSITION"]
    });
    expect(result.basisLines[0].continuationEvidence).toEqual([
      expect.objectContaining({
        pageNumber: 2,
        sourceText: expect.stringContaining("mit Fortsetzungszeile"),
        region: expect.objectContaining({ width: expect.any(Number) })
      })
    ]);
  });

  it("keeps Basis technical continuation after a page-one quantity until the next marker", async () => {
    const { result } = await processFixture({
      documentType: "BASIS_LV",
      pages: [
        [
          ...row(["Position", "6", ".", "1", ".", "15"], 120),
          ...row(["Langbeschreibung", "Pumpensystem"], 100, 80),
          ...row(["2", "St"], 80, 430)
        ],
        [
          ...row(["Technische", "Fortsetzung", "mit", "Regelungsdetails"], 750, 80),
          ...row(["Position", "6", ".", "1", ".", "16"], 650),
          ...row(["Nachfolgende", "Basisposition"], 630, 80),
          ...row(["1", "St"], 610, 430)
        ]
      ]
    });

    expect(result.basisLines[0]).toMatchObject({
      positionNumber: "6.1.15",
      continuationPageNumbers: [2]
    });
    expect(result.basisLines[0].description).toContain(
      "Technische Fortsetzung mit Regelungsdetails"
    );
    expect(result.basisLines[0].description).not.toContain("Nachfolgende Basisposition");
    expect(result.basisLines[0].continuationEvidence).toEqual([
      expect.objectContaining({
        pageNumber: 2,
        sourceText: expect.stringContaining("Technische Fortsetzung")
      })
    ]);
  });

  it("preserves a multi-page technical description beyond the former 800-character limit", async () => {
    const longContinuation = `${Array.from(
      { length: 140 },
      (_, index) => `Merkmal-${index + 1}`
    ).join(" ")} ENDMERKMAL`;
    const { result } = await processFixture({
      documentType: "BASIS_LV",
      pages: [
        [
          ...row(["Position", "6", ".", "1", ".", "17"], 120),
          ...row(["Mehrseitige", "Langbeschreibung"], 100, 80),
          ...row(["2", "St"], 80, 430)
        ],
        [
          item(longContinuation, 80, 750),
          ...row(["Position", "6", ".", "1", ".", "18"], 620),
          ...row(["Nachfolgende", "Basisposition"], 600, 80),
          ...row(["1", "St"], 580, 430)
        ]
      ]
    });

    expect(result.basisLines[0].description.length).toBeGreaterThan(800);
    expect(result.basisLines[0].description).toContain("ENDMERKMAL");
    expect(result.basisLines[0].description).not.toContain("Nachfolgende Basisposition");
  });

  it("joins a supplier position whose quantity and price continue on the next page", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      pages: [
        [
          ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "20", "."], 120),
          ...row(["Angebotsgruppe", "Iota"], 100, 80)
        ],
        [
          ...row(["mit", "Fortsetzungszeile"], 750, 80),
          ...row(["2", "St"], 730, 430),
          ...row(["EP", "35,00", "GP", "70,00"], 710, 330)
        ]
      ]
    });

    expect(result.supplierLines).toHaveLength(1);
    expect(result.supplierLines[0]).toMatchObject({
      positionNumber: "6.1.20",
      description: "Angebotsgruppe Iota mit Fortsetzungszeile",
      quantity: 2,
      unitPrice: 35,
      totalPrice: 70,
      continuationPageNumbers: [2],
      reviewReasons: ["MULTI_PAGE_POSITION"]
    });
    expect(result.supplierLines[0].continuationEvidence).toEqual([
      expect.objectContaining({
        pageNumber: 2,
        sourceText: expect.stringContaining("mit Fortsetzungszeile"),
        region: expect.objectContaining({ width: expect.any(Number) })
      })
    ]);
  });

  it("keeps supplier technical continuation after page-one quantity and prices until the next marker", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      pages: [
        [
          ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "30", "."], 120),
          ...row(["Langbeschreibung", "Angebotssystem"], 100, 80),
          ...row(["2", "St"], 80, 430),
          ...row(["EP", "35,00", "GP", "70,00"], 60, 330)
        ],
        [
          ...row(["Technische", "Fortsetzung", "mit", "Zubehörumfang"], 750, 80),
          ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "31", "."], 650),
          ...row(["Nachfolgende", "Angebotsposition"], 630, 80),
          ...row(["1", "St"], 610, 430),
          ...row(["EP", "40,00", "GP", "40,00"], 590, 330)
        ]
      ]
    });

    expect(result.supplierLines[0]).toMatchObject({
      positionNumber: "6.1.30",
      unitPrice: 35,
      totalPrice: 70,
      continuationPageNumbers: [2]
    });
    expect(result.supplierLines[0].description).toContain(
      "Technische Fortsetzung mit Zubehörumfang"
    );
    expect(result.supplierLines[0].description).not.toContain("Nachfolgende Angebotsposition");
    expect(result.supplierLines[0].continuationEvidence).toEqual([
      expect.objectContaining({
        pageNumber: 2,
        sourceText: expect.stringContaining("Technische Fortsetzung")
      })
    ]);
  });

  it("ends continuation evidence before the next Basis position", async () => {
    const { result } = await processFixture({
      documentType: "BASIS_LV",
      pages: [
        [
          ...row(["Position", "6", ".", "1", ".", "40"], 120),
          ...row(["Erste", "mehrseitige", "Position"], 100, 80)
        ],
        [
          ...row(["Fortsetzung", "nur", "für", "erste", "Position"], 750, 80),
          ...row(["2", "St"], 730, 430),
          ...row(["Position", "6", ".", "1", ".", "50"], 650),
          ...row(["Zweite", "Position"], 630, 80),
          ...row(["1", "St"], 610, 430)
        ]
      ]
    });

    expect(result.basisLines).toHaveLength(2);
    expect(result.basisLines[0].description).not.toContain("Zweite Position");
    expect(result.basisLines[0].continuationEvidence?.[0]).toMatchObject({
      pageNumber: 2,
      sourceText: expect.not.stringContaining("Zweite Position")
    });
    const continuationRegion = result.basisLines[0].continuationEvidence?.[0].region;
    expect(continuationRegion).toBeDefined();
    expect((continuationRegion?.y ?? 1) + (continuationRegion?.height ?? 1)).toBeLessThan(0.19);
  });

  it("keeps a three-page Basis continuation bounded before the next marker", async () => {
    const { result } = await processFixture({
      documentType: "BASIS_LV",
      pages: [
        [
          ...row(["Position", "7", ".", "1", ".", "10"], 120),
          ...row(["Dreiteilige", "Basisposition", "Anfang"], 100, 80)
        ],
        [
          ...row(["Fortsetzung", "auf", "Seite", "zwei"], 750, 80),
          ...row(["mit", "technischen", "Merkmalen"], 730, 80)
        ],
        [
          ...row(["Abschluss", "der", "ersten", "Position"], 750, 80),
          ...row(["4", "St"], 730, 430),
          ...row(["Position", "7", ".", "1", ".", "20"], 650),
          ...row(["Nachfolgende", "Position"], 630, 80),
          ...row(["1", "St"], 610, 430)
        ]
      ]
    });

    expect(result.basisLines).toHaveLength(2);
    expect(result.basisLines[0]).toMatchObject({
      positionNumber: "7.1.10",
      quantity: 4,
      continuationPageNumbers: [2, 3],
      reviewReasons: ["MULTI_PAGE_POSITION"]
    });
    expect(result.basisLines[0].description).toContain("Seite zwei");
    expect(result.basisLines[0].description).toContain("Abschluss der ersten Position");
    expect(result.basisLines[0].description).not.toContain("Nachfolgende Position");
    expect(result.basisLines[0].continuationEvidence).toEqual([
      expect.objectContaining({ pageNumber: 2 }),
      expect.objectContaining({
        pageNumber: 3,
        sourceText: expect.not.stringContaining("Nachfolgende Position")
      })
    ]);
    const finalRegion = result.basisLines[0].continuationEvidence?.[1].region;
    expect(finalRegion).toBeDefined();
    expect((finalRegion?.y ?? 1) + (finalRegion?.height ?? 1)).toBeLessThan(0.19);
  });

  it("ends continuation evidence before the next supplier position", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      pages: [
        [
          ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "60", "."], 120),
          ...row(["Erste", "mehrseitige", "Angebotsposition"], 100, 80)
        ],
        [
          ...row(["Fortsetzung", "des", "ersten", "Angebots"], 750, 80),
          ...row(["2", "St"], 730, 430),
          ...row(["EP", "35,00", "GP", "70,00"], 710, 330),
          ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "70", "."], 650),
          ...row(["Zweite", "Angebotsposition"], 630, 80),
          ...row(["1", "St"], 610, 430),
          ...row(["EP", "40,00", "GP", "40,00"], 590, 330)
        ]
      ]
    });

    expect(result.supplierLines).toHaveLength(2);
    expect(result.supplierLines[0]).toMatchObject({
      positionNumber: "6.1.60",
      unitPrice: 35,
      totalPrice: 70
    });
    expect(result.supplierLines[0].description).not.toContain("Zweite Angebotsposition");
    expect(result.supplierLines[0].continuationEvidence?.[0]).toMatchObject({
      pageNumber: 2,
      sourceText: expect.not.stringContaining("Zweite Angebotsposition")
    });
  });

  it("does not treat the next page header as continuation after a complete supplier row", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      pages: [
        [
          ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "25", "."], 120),
          ...row(["Angebotsbauteil", "Nu"], 100, 80),
          ...row(["1", "St"], 80, 430),
          ...row(["EP", "12,00", "GP", "12,00"], 60, 330)
        ],
        [
          ...row(["Supplier", "Alpha", "Angebotsübersicht"], 770, 80),
          ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "26", "."], 730),
          ...row(["Angebotsbauteil", "Xi"], 710, 80),
          ...row(["2", "St"], 690, 430),
          ...row(["EP", "13,00", "GP", "26,00"], 670, 330)
        ]
      ]
    });

    expect(result.supplierLines[0]).toMatchObject({
      positionNumber: "6.1.25",
      description: "Angebotsbauteil Nu",
      continuationPageNumbers: [],
      reviewReasons: []
    });
  });

  it("keeps genuine continuation even when the next marker is inside the former header threshold", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      pages: [
        [
          ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "27", "."], 120),
          ...row(["Angebotsbauteil", "Omikron"], 100, 80),
          ...row(["1", "St"], 80, 430),
          ...row(["EP", "12,00", "GP", "12,00"], 60, 330)
        ],
        [
          ...row(["Technische", "Fortsetzung", "oberhalb", "des", "Folgeeintrags"], 785, 80),
          ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "28", "."], 720),
          ...row(["Angebotsbauteil", "Pi"], 700, 80),
          ...row(["1", "St"], 680, 430),
          ...row(["EP", "13,00", "GP", "13,00"], 660, 330)
        ]
      ]
    });

    expect(result.supplierLines[0]).toMatchObject({
      positionNumber: "6.1.27",
      continuationPageNumbers: [2]
    });
    expect(result.supplierLines[0].description).toContain(
      "Technische Fortsetzung oberhalb des Folgeeintrags"
    );
  });

  it("removes a tall page header instead of absorbing it as continuation", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      pages: [
        [
          ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "29", "."], 120),
          ...row(["Angebotsbauteil", "Rho"], 100, 80),
          ...row(["1", "St"], 80, 430),
          ...row(["EP", "14,00", "GP", "14,00"], 60, 330)
        ],
        [
          ...row(["Supplier", "Alpha", "Angebotsübersicht"], 780, 80),
          ...row(["Projekt:", "Beispielprojekt"], 740, 80),
          ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "30", "."], 650),
          ...row(["Angebotsbauteil", "Sigma"], 630, 80),
          ...row(["1", "St"], 610, 430),
          ...row(["EP", "15,00", "GP", "15,00"], 590, 330)
        ]
      ]
    });

    expect(result.supplierLines[0]).toMatchObject({
      positionNumber: "6.1.29",
      description: "Angebotsbauteil Rho",
      continuationPageNumbers: [],
      reviewReasons: []
    });
  });

  it("associates a vertically stacked LV reference with its distinct supplier position", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      items: [
        ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "30", "."], 750),
        ...row(["Angebotsposition", "901"], 730, 48),
        ...row(["Angebotsmodul", "Kappa"], 710, 80),
        ...row(["1", "St"], 690, 430),
        ...row(["EP", "80,00", "GP", "80,00"], 670, 330)
      ]
    });

    expect(result.supplierLines).toHaveLength(1);
    expect(result.supplierLines[0]).toMatchObject({
      positionNumber: "6.1.30",
      supplierPositionNumber: "901",
      description: "Angebotsmodul Kappa"
    });
  });

  it("retains two supplier alternatives for the same LV position on one page", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      items: [
        ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "40", "."], 750),
        ...row(["Angebotsposition", "910"], 730, 48),
        ...row(["Angebotsmodul", "Lambda", "Standard"], 710, 80),
        ...row(["1", "St"], 690, 430),
        ...row(["EP", "20,00", "GP", "20,00"], 670, 330),
        ...row(["zu", "LV-Pos.:", "6", ".", "1", ".", "40", "."], 630),
        ...row(["Angebotsposition", "911"], 610, 48),
        ...row(["Angebotsmodul", "Lambda", "Premium"], 590, 80),
        ...row(["1", "St"], 570, 430),
        ...row(["EP", "28,00", "GP", "28,00"], 550, 330)
      ]
    });

    expect(
      result.supplierLines.map((line) => ({
        lv: line.positionNumber,
        supplier: line.supplierPositionNumber,
        description: line.description
      }))
    ).toEqual([
      {
        lv: "6.1.40",
        supplier: "910",
        description: "Angebotsmodul Lambda Standard"
      },
      {
        lv: "6.1.40",
        supplier: "911",
        description: "Angebotsmodul Lambda Premium"
      }
    ]);
  });

  it("marks emitted rows for review when repeated source geometry is ambiguous", async () => {
    const { result } = await processFixture({
      documentType: "SUPPLIER_OFFER",
      items: [
        ...row(["zu", "LV-Pos.:", "7", ".", "2", ".", "10", "."], 750),
        ...row(["Prüfmodul", "identisch"], 730, 80),
        ...row(["2", "St"], 710, 430),
        ...row(["EP", "15,00", "GP", "30,00"], 690, 330),
        ...row(["zu", "LV-Pos.:", "7", ".", "2", ".", "10", "."], 650),
        ...row(["Prüfmodul", "identisch"], 630, 80),
        ...row(["2", "St"], 610, 430),
        ...row(["EP", "15,00", "GP", "30,00"], 590, 330)
      ]
    });

    expect(result.supplierLines).toHaveLength(2);
    for (const line of result.supplierLines) {
      expect(line).toEqual(
        expect.objectContaining({
          positionNumber: "7.2.10",
          region: undefined,
          reviewReasons: expect.arrayContaining(["SOURCE_REGION_MISSING"])
        })
      );
    }
    expect(result.diagnostics.documents[0]).toMatchObject({
      candidatePositions: 2,
      extractedPositions: 2,
      missingSourceRegions: 2
    });
  });

  it("fails closed with a structured warning when PDF.js cannot parse the document", async () => {
    const rawFallbackTrap = new TextEncoder().encode("Position 9.9.9 Phantomposition 2 St").buffer;
    const { result, events } = await processFixture({
      documentType: "BASIS_LV",
      bytes: rawFallbackTrap,
      failPdfJs: new Error("synthetic corrupt PDF")
    });

    expect(result.basisLines).toEqual([]);
    expect(result.processingIssues).toEqual([
      expect.objectContaining({
        code: "PDF_PARSE_FAILED",
        documentId: "layout-fixture",
        recoverable: true
      })
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "WARNING",
        code: "PDF_PARSE_FAILED",
        documentId: "layout-fixture",
        recoverable: true
      })
    );
  });

  it("uses the PDF.js viewport transform for cropped and rotated pages", async () => {
    const viewport = {
      width: 800,
      height: 600,
      transform: [0, 1, 1, 0, -20, -10]
    };
    const makeItem = (str: string, left: number, top: number, width: number) =>
      viewportItem(str, left, top, width, 10, viewport.transform);
    const { result } = await processFixture({
      documentType: "BASIS_LV",
      viewport,
      items: [
        makeItem("Position 7.3.10", 50, 80, 95),
        makeItem("Prüfmodul Alpha", 160, 80, 130),
        makeItem("2 St", 650, 120, 30),
        makeItem("Position 7.3.20", 50, 240, 95),
        makeItem("Prüfmodul Beta", 160, 240, 125),
        makeItem("1 St", 650, 280, 30)
      ]
    });

    expect(result.basisLines.map((line) => line.positionNumber)).toEqual(["7.3.10", "7.3.20"]);
    expect(result.basisLines[0]?.region).toEqual(
      expect.objectContaining({
        x: expect.closeTo(50 / 800, 5),
        y: expect.closeTo(80 / 600, 5)
      })
    );
  });
});
