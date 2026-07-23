import { createHash } from "node:crypto";
import path from "node:path";
import { createCanvas } from "canvas";
import { getDocument, OPS, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentParser, ParsedPage } from "@/domain/repositories";

type PdfTextItem = {
  str: string;
  width: number;
  height: number;
  transform: number[];
};

function isTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    "transform" in item &&
    Array.isArray((item as PdfTextItem).transform)
  );
}

class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }

  reset(
    target: { canvas: ReturnType<typeof createCanvas> },
    width: number,
    height: number
  ) {
    target.canvas.width = width;
    target.canvas.height = height;
  }

  destroy(target: {
    canvas: ReturnType<typeof createCanvas> | null;
    context: ReturnType<ReturnType<typeof createCanvas>["getContext"]> | null;
  }) {
    if (target.canvas) {
      target.canvas.width = 0;
      target.canvas.height = 0;
    }
    target.canvas = null;
    target.context = null;
  }
}

export class PdfJsDocumentParser implements DocumentParser {
  async inspect(input: Uint8Array): Promise<{ pageCount: number }> {
    const pdf = await this.open(input);
    try {
      return { pageCount: pdf.numPages };
    } finally {
      await this.close(pdf);
    }
  }

  async extractPage(
    documentId: string,
    input: Uint8Array,
    pageNumber: number
  ): Promise<ParsedPage> {
    const pdf = await this.open(input);
    try {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const [textContent, operatorList] = await Promise.all([
        page.getTextContent(),
        page.getOperatorList()
      ]);

      const pdfTextItems = textContent.items.filter(isTextItem) as PdfTextItem[];
      const textItems = pdfTextItems.map((item, order) => {
        const x = Math.max(0, Math.min(1, item.transform[4] / viewport.width));
        const y = Math.max(
          0,
          Math.min(1, 1 - (item.transform[5] + Math.max(item.height, 1)) / viewport.height)
        );
        const width = Math.max(0, Math.min(1 - x, item.width / viewport.width));
        const height = Math.max(
          0,
          Math.min(1 - y, Math.max(item.height, Math.abs(item.transform[3]), 1) / viewport.height)
        );
        const normalizedText = item.str.normalize("NFKC").replace(/\s+/g, " ").trim();
        const id = `ti_${createHash("sha256")
          .update(
            `${documentId}:${pageNumber}:${order}:${item.str}:${x.toFixed(6)}:${y.toFixed(6)}`
          )
          .digest("hex")
          .slice(0, 20)}`;
        return {
          id,
          rawText: item.str,
          normalizedText,
          order,
          region: { x, y, width, height }
        };
      });

      const imageOperators = new Set<number>([
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintImageMaskXObject,
        OPS.paintSolidColorImageMask
      ]);
      const imageCount = operatorList.fnArray.filter((operator) => imageOperators.has(operator)).length;
      const characterCount = textItems.reduce((sum, item) => sum + item.normalizedText.length, 0);

      let mode: ParsedPage["mode"];
      if (characterCount >= 80 && imageCount >= 1) mode = "HYBRID";
      else if (characterCount >= 80) mode = "DIGITAL";
      else if (imageCount >= 1) mode = "SCAN";
      else mode = "UNREADABLE";

      return {
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        mode,
        textItems,
        imageCount
      };
    } finally {
      await this.close(pdf);
    }
  }

  async renderPage(input: Uint8Array, pageNumber: number, scale = 1.6): Promise<Uint8Array> {
    const pdf = await this.open(input);
    try {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      await page.render({
        canvasContext: context as never,
        viewport,
        canvas: canvas as never
      }).promise;
      return new Uint8Array(canvas.toBuffer("image/png"));
    } finally {
      await this.close(pdf);
    }
  }

  private async open(input: Uint8Array): Promise<PDFDocumentProxy> {
    return getDocument({
      data: input.slice(),
      useSystemFonts: true,
      wasmUrl: `${path.join(process.cwd(), "node_modules", "pdfjs-dist", "wasm").replaceAll("\\", "/")}/`,
      standardFontDataUrl: `${path
        .join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts")
        .replaceAll("\\", "/")}/`,
      cMapUrl: `${path.join(process.cwd(), "node_modules", "pdfjs-dist", "cmaps").replaceAll("\\", "/")}/`,
      cMapPacked: true,
      CanvasFactory: NodeCanvasFactory as never
    }).promise;
  }

  private async close(pdf: PDFDocumentProxy): Promise<void> {
    await pdf.cleanup();
    const loadingTask = (pdf as PDFDocumentProxy & { loadingTask?: { destroy(): Promise<void> } })
      .loadingTask;
    if (loadingTask) await loadingTask.destroy();
  }
}
