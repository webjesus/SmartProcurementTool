import { describe, expect, it } from "vitest";
import {
  buildBrowserOcrCacheKey,
  localBrowserOcrAssets,
  estimateBrowserRasterCoverage,
  ocrWordsToPdfGeometry,
  shouldRunBrowserOcr,
  summarizeBrowserOcr
} from "@/browser-projects/ocr-fallback";

describe("browser-local OCR fallback", () => {
  it("runs only for pages whose native text layer is absent or suspiciously sparse", () => {
    expect(shouldRunBrowserOcr({ nativeText: "", rasterCoverage: 0.9 })).toBe(true);
    expect(
      shouldRunBrowserOcr({
        nativeText: "Kurzer gescannter Seitenkopf",
        rasterCoverage: 0.8
      })
    ).toBe(true);
    expect(
      shouldRunBrowserOcr({
        nativeText:
          "1.1.10 Vollständig digital lesbare LV-Position mit Beschreibung Menge Einheit und weiteren technischen Angaben",
        rasterCoverage: 0.1
      })
    ).toBe(false);
  });

  it("maps OCR word boxes back into PDF geometry without losing exact bounds", () => {
    const [item] = ocrWordsToPdfGeometry({
      words: [
        {
          text: "1.1.160",
          confidence: 96,
          bbox: { x0: 200, y0: 300, x1: 500, y1: 380 }
        }
      ],
      imageWidth: 2000,
      imageHeight: 3000,
      pageWidth: 600,
      pageHeight: 900,
      viewportTransform: [1, 0, 0, -1, 0, 900]
    });

    expect(item.str).toBe("1.1.160");
    expect(item.width).toBeCloseTo(90);
    expect(item.height).toBeCloseTo(24);
    expect(item.transform[4]).toBeCloseTo(60);
    expect(item.transform[5]).toBeCloseTo(786);
  });

  it("does not let a long digital letterhead hide a scanned body table", () => {
    expect(
      shouldRunBrowserOcr({
        nativeText: "Digitaler Briefkopf mit Kontaktangaben. ".repeat(12),
        rasterCoverage: 0.72
      })
    ).toBe(true);
    expect(
      shouldRunBrowserOcr({
        nativeText: "Digitaler Angebotstext. ".repeat(20),
        rasterCoverage: 0.04
      })
    ).toBe(false);
  });

  it("distinguishes a small logo from a scanned table using painted image bounds", () => {
    const operators = { save: 1, restore: 2, transform: 3, paintImageXObject: 4 };
    const viewport = { width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] };
    const logo = estimateBrowserRasterCoverage({
      fnArray: [1, 3, 4, 2],
      argsArray: [[], [40, 0, 0, 40, 40, 700], ["logo"], []],
      operators,
      viewport
    });
    const table = estimateBrowserRasterCoverage({
      fnArray: [1, 3, 4, 2],
      argsArray: [[], [500, 0, 0, 600, 50, 60], ["table"], []],
      operators,
      viewport
    });
    expect(logo).toBeCloseTo(1600 / 480000);
    expect(table).toBeCloseTo(300000 / 480000);
    expect(
      shouldRunBrowserOcr({ nativeText: "Native header ".repeat(40), rasterCoverage: table })
    ).toBe(true);
  });

  it("keeps OCR evidence review-only even with high recognition confidence", () => {
    expect(
      summarizeBrowserOcr({
        text: "1.1.160 Pumpengruppe 6 St",
        confidence: 97,
        wordCount: 4
      })
    ).toEqual({
      usable: true,
      requiresReview: true,
      reason: "OCR_SOURCE"
    });
    expect(summarizeBrowserOcr({ text: "", confidence: 0, wordCount: 0 })).toEqual({
      usable: false,
      requiresReview: true,
      reason: "OCR_FAILED"
    });
  });

  it("uses only same-origin assets and invalidates cache keys on OCR versions", () => {
    expect(Object.values(localBrowserOcrAssets).every((path) => path.startsWith("/ocr/"))).toBe(
      true
    );
    expect(Object.values(localBrowserOcrAssets).join(" ")).not.toMatch(/https?:\/\//u);
    const first = buildBrowserOcrCacheKey({
      documentSha256: "abc",
      pageNumber: 2,
      renderScale: 3,
      engineVersion: "7.0.0",
      modelVersion: "deu-fast-v1"
    });
    const changed = buildBrowserOcrCacheKey({
      documentSha256: "abc",
      pageNumber: 2,
      renderScale: 3,
      engineVersion: "7.0.1",
      modelVersion: "deu-fast-v1"
    });
    expect(first).not.toBe(changed);
    expect(first).toContain("abc:2:3:7.0.0:deu-fast-v1");
  });
});
