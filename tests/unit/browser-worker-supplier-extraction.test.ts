import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserProcessingEvent,
  BrowserWorkerDocument,
  BrowserWorkerResult
} from "@/browser-projects/processing-protocol";

const pdfItems = vi.hoisted(() => {
  const strings = [
    "160",
    "zu LV-Pos.: 1.1.110.",
    "88000001001",
    "7 ST",
    "83,20",
    "582,40",
    "Bauteil Alpha Serie 100-3 #1",
    "mit Anzeige und automatischer Entlüftung.",
    "Mit Schutzventil 3 bar, DN20.",
    "Kundenrabatt",
    "-35,00 %",
    "-203,84",
    "Positionsnetto",
    "54,08",
    "378,56",
    "170",
    "zu LV-Pos.: 1.1.120.",
    "88000001002",
    "9 ST",
    "430,00",
    "3.870,00",
    "Bauteil Beta Serie 50-1-10 #1",
    "für bis zu 10,8 m3/h Volumenstrom",
    "Kundenrabatt",
    "-35,00 %",
    "-1.354,50",
    "Positionsnetto",
    "279,50",
    "2.515,50",
    "180",
    "zu LV-Pos.: 1.1.130.",
    "88000001003",
    "5 ST",
    "275,00",
    "1.375,00",
    "Bauteil Gamma G 1 1/4 Zoll mit Dichtung",
    "zum Einbau in Bauteil Beta",
    "50-1-10 #1, 300-18 #1, 620-vic, 800-vic, 2500-vic,",
    "Modulkombination Serie Delta 1200-",
    "m #1",
    "190",
    "zu LV-Pos.: 1.1.140.",
    "88000001004",
    "8 ST",
    "415,00",
    "3.320,00",
    "Bauteil Delta Wandhalter - komplett Modell 1200- m",
    "Druckstufe 11,50 bar",
    "200",
    "zu LV-Pos.: 1.1.150.",
    "Regelteil2",
    "4 ST",
    "11,00",
    "44,00"
  ];
  return strings.map((str, index) => ({
    str,
    width: Math.max(10, str.length * 5),
    height: 10,
    transform: [1, 0, 0, 10, index % 15 === 0 ? 60 : 102, 800 - index * 12]
  }));
});

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 595, height: 842 }),
        getTextContent: async () => ({ items: pdfItems })
      })
    }),
    destroy: async () => undefined
  })
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function processFixture(): Promise<BrowserWorkerResult> {
  let complete: ((result: BrowserWorkerResult) => void) | null = null;
  let fail: ((error: Error) => void) | null = null;
  const resultPromise = new Promise<BrowserWorkerResult>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  const workerScope = {
    onmessage: null as
      | ((event: MessageEvent<{ type: "LOAD_DOCUMENTS" }>) => void)
      | null,
    postMessage(message: BrowserProcessingEvent) {
      if (message.type === "COMPLETE") complete?.(message.result);
      if (message.type === "ERROR") fail?.(new Error(message.message));
    }
  };
  vi.stubGlobal("self", workerScope);
  await import("@/workers/browser-processing.worker");

  const basisDocument = {
    metadata: {
      documentId: "basis",
      originalFileName: "Basis-LV.pdf",
      documentType: "BASIS_LV",
      supplierName: null,
      pageCount: 1,
      excludedFromProcessing: false
    },
    bytes: new ArrayBuffer(0)
  } as BrowserWorkerDocument;
  const supplierDocument = {
    metadata: {
      documentId: "supplier-alpha",
      originalFileName: "Supplier-Alpha.pdf",
      documentType: "SUPPLIER_OFFER",
      supplierName: "Supplier Alpha",
      pageCount: 1,
      excludedFromProcessing: false
    },
    bytes: new ArrayBuffer(0)
  } as BrowserWorkerDocument;
  workerScope.onmessage?.({
    data: {
      type: "LOAD_DOCUMENTS",
      runId: "supplier-alpha-regression",
      documents: [basisDocument, supplierDocument],
      incremental: false
    }
  } as unknown as MessageEvent<{ type: "LOAD_DOCUMENTS" }>);
  return resultPromise;
}

describe.sequential("browser worker supplier extraction", () => {
  it("separates supplier article numbers from the following product descriptions", async () => {
    const result = await processFixture();
    const byPosition = (positionNumber: string) =>
      result.supplierLines.find(
        (line) => line.positionNumber === positionNumber
      );

    expect(byPosition("1.1.110")).toMatchObject({
      description:
        "Bauteil Alpha Serie 100-3 #1 mit Anzeige und automatischer Entlüftung. Mit Schutzventil 3 bar, DN20.",
      articleNumber: "88000001001",
      quantity: 7,
      unit: "ST",
      unitPrice: 54.08,
      totalPrice: 378.56
    });
    expect(byPosition("1.1.120")).toMatchObject({
      description:
        "Bauteil Beta Serie 50-1-10 #1 für bis zu 10,8 m3/h Volumenstrom",
      articleNumber: "88000001002",
      quantity: 9,
      unit: "ST",
      unitPrice: 279.5,
      totalPrice: 2515.5
    });
    expect(byPosition("1.1.130")).toMatchObject({
      description:
        "Bauteil Gamma G 1 1/4 Zoll mit Dichtung zum Einbau in Bauteil Beta 50-1-10 #1, 300-18 #1, 620-vic, 800-vic, 2500-vic, Modulkombination Serie Delta 1200-m #1",
      articleNumber: "88000001003",
      quantity: 5,
      unit: "ST",
      unitPrice: 275,
      totalPrice: 1375
    });
  });

  it("uses structural price columns instead of currency-like numbers in descriptions", async () => {
    const result = await processFixture();
    expect(
      result.supplierLines.find((line) => line.positionNumber === "1.1.140")
    ).toMatchObject({
      unitPrice: 415,
      totalPrice: 3320
    });
    expect(
      result.supplierLines.find((line) => line.positionNumber === "1.1.120")
    ).toMatchObject({
      unitPrice: 279.5,
      totalPrice: 2515.5
    });
  });

  it("keeps a digit-bearing single-token description when no post-price description exists", async () => {
    const result = await processFixture();
    expect(
      result.supplierLines.find((line) => line.positionNumber === "1.1.150")
    ).toMatchObject({
      description: "Regelteil2",
      articleNumber: null,
      quantity: 4,
      unitPrice: 11,
      totalPrice: 44
    });
  });

  it("joins only a line-break hyphen attached to the preceding token", async () => {
    const result = await processFixture();
    expect(
      result.supplierLines.find((line) => line.positionNumber === "1.1.140")
        ?.description
    ).toBe(
      "Bauteil Delta Wandhalter - komplett Modell 1200-m Druckstufe 11,50 bar"
    );
  });
});
