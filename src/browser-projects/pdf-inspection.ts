import type { BrowserPdfInspection } from "@/browser-projects/document-classification";
import {
  recognizeBrowserPage,
  type BrowserOcrProgress,
  type BrowserOcrRenderablePdfPage
} from "@/browser-projects/browser-ocr-engine";
import {
  estimateBrowserRasterCoverage,
  shouldRunBrowserOcr,
  summarizeBrowserOcr
} from "@/browser-projects/ocr-fallback";
import { browserPdfLoadingOptions, configureBrowserPdfJs } from "@/pdf/browser-pdfjs-config";

export type BrowserPdfInspectionOptions = {
  enableOcr?: boolean;
  maxOcrPages?: number;
  onOcrProgress?: (progress: BrowserOcrProgress & { pageNumber: number }) => void;
};

function rawPdfText(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  return [...raw.matchAll(/\(([^()]*)\)\s*Tj/g)]
    .map((match) => match[1].replace(/\\n/g, "\n").replace(/\\\(/g, "(").replace(/\\\)/g, ")"))
    .join("\n");
}

function sampledPages(pageCount: number): number[] {
  const pages = new Set<number>();
  for (let page = 1; page <= Math.min(5, pageCount); page += 1) pages.add(page);
  if (pageCount > 5) {
    pages.add(Math.ceil(pageCount / 3));
    pages.add(Math.ceil((pageCount * 2) / 3));
    pages.add(pageCount);
  }
  return [...pages].sort((left, right) => left - right);
}

export async function inspectBrowserPdf(
  bytes: Uint8Array,
  options: BrowserPdfInspectionOptions = {}
): Promise<BrowserPdfInspection> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (typeof window !== "undefined") configureBrowserPdfJs(pdfjs);
    const loadingTask = pdfjs.getDocument(browserPdfLoadingOptions(bytes.slice()));
    const pdf = await loadingTask.promise;
    const metadata = await pdf
      .getMetadata()
      .then((value) => value.info as Record<string, unknown>)
      .catch(() => ({}));
    const pages = sampledPages(pdf.numPages);
    const pageTexts: string[] = [];
    const ocrTexts: string[] = [];
    const ocrConfidences: number[] = [];
    let pagesWithText = 0;
    let ocrAttempts = 0;
    for (const pageNumber of pages) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length >= 20) pagesWithText += 1;
      pageTexts.push(text);
      let rasterCoverage: number | null = null;
      try {
        const operators = await page.getOperatorList();
        rasterCoverage = estimateBrowserRasterCoverage({
          ...operators,
          operators: pdfjs.OPS,
          viewport
        });
      } catch {
        // A sparse native layer still invokes OCR when image analysis is unavailable.
      }
      if (
        options.enableOcr &&
        ocrAttempts < Math.max(1, options.maxOcrPages ?? 3) &&
        shouldRunBrowserOcr({ nativeText: text, rasterCoverage })
      ) {
        ocrAttempts += 1;
        try {
          const recognized = await recognizeBrowserPage({
            page: page as unknown as BrowserOcrRenderablePdfPage,
            baseViewport: viewport,
            onProgress: options.onOcrProgress
              ? (progress) => options.onOcrProgress?.({ ...progress, pageNumber })
              : undefined
          });
          const assessment = summarizeBrowserOcr({
            text: recognized.text,
            confidence: recognized.confidence,
            wordCount: recognized.words.length
          });
          if (assessment.usable) {
            ocrTexts.push(recognized.text);
            ocrConfidences.push(recognized.confidence);
          }
        } catch {
          // Classification remains OCR_REQUIRED when no usable OCR sample exists.
        }
      }
    }
    await loadingTask.destroy();
    const extractedText = pageTexts.join("\n");
    const fallbackText = rawPdfText(bytes);
    const text =
      extractedText.replace(/\s+/g, "").length >= 40
        ? extractedText
        : fallbackText || extractedText;
    return {
      pageCount: pdf.numPages,
      metadata,
      text,
      textLayerCharacterCount: text.replace(/\s+/g, "").length,
      inspectedPageCount: pages.length,
      pagesWithText,
      ocrText: ocrTexts.join("\n"),
      ocrPageCount: ocrTexts.length,
      ocrMeanConfidence: ocrConfidences.length
        ? ocrConfidences.reduce((sum, value) => sum + value, 0) / ocrConfidences.length
        : null
    };
  } catch {
    throw new Error("INVALID_PDF");
  }
}
