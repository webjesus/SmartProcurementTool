import {
  BROWSER_OCR_ENGINE_VERSION,
  BROWSER_OCR_LANGUAGE,
  BROWSER_OCR_MODEL_VERSION,
  localBrowserOcrAssets,
  type BrowserOcrPageResult,
  type BrowserOcrWord
} from "@/browser-projects/ocr-fallback";

export type BrowserOcrProgress = {
  status: string;
  progress: number;
};

type OcrImage = HTMLCanvasElement | OffscreenCanvas;

type PdfViewportForOcr = {
  width: number;
  height: number;
  transform: readonly number[];
};

export type BrowserOcrRenderablePdfPage = {
  getViewport(input: { scale: number }): PdfViewportForOcr;
  render(input: {
    canvas: OcrImage;
    canvasContext:
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D;
    viewport: PdfViewportForOcr;
  }): { promise: Promise<unknown> };
};

export type RenderedBrowserOcrResult = BrowserOcrPageResult & {
  imageWidth: number;
  imageHeight: number;
  renderScale: number;
};

const TARGET_RENDER_SCALE = 300 / 72;
const MIN_RENDER_SCALE = 1.5;
const MAX_RENDER_DIMENSION = 3_508;
const MAX_RENDER_PIXELS = 12_000_000;
const OCR_TIMEOUT_MS = 120_000;

type TesseractWorker = Awaited<
  ReturnType<(typeof import("tesseract.js"))["createWorker"]>
>;

let workerPromise: Promise<TesseractWorker> | null = null;
let queue: Promise<void> = Promise.resolve();
let activeProgress: ((value: BrowserOcrProgress) => void) | undefined;

function normalizedProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

async function createLocalWorker(): Promise<TesseractWorker> {
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const worker = await createWorker(BROWSER_OCR_LANGUAGE, OEM.LSTM_ONLY, {
    ...localBrowserOcrAssets,
    workerBlobURL: false,
    gzip: true,
    logger(message) {
      activeProgress?.({
        status: message.status,
        progress: normalizedProgress(message.progress)
      });
    }
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: "1",
    user_defined_dpi: "300"
  });
  return worker;
}

async function localWorker(): Promise<TesseractWorker> {
  workerPromise ??= createLocalWorker().catch((error) => {
    workerPromise = null;
    throw error;
  });
  return workerPromise;
}

function wordsFromBlocks(
  blocks: Tesseract.Block[] | null | undefined
): BrowserOcrWord[] {
  return (blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.flatMap((line) =>
        line.words.flatMap((word): BrowserOcrWord[] => {
          const text = word.text.normalize("NFKC").replace(/\s+/gu, " ").trim();
          const { x0, y0, x1, y1 } = word.bbox;
          if (
            !text ||
            ![x0, y0, x1, y1, word.confidence].every(Number.isFinite) ||
            x1 <= x0 ||
            y1 <= y0
          ) {
            return [];
          }
          return [
            {
              text,
              confidence: word.confidence,
              bbox: { x0, y0, x1, y1 }
            }
          ];
        })
      )
    )
  );
}

async function resetWorker(): Promise<void> {
  const current = workerPromise;
  workerPromise = null;
  if (!current) return;
  try {
    await (await current).terminate();
  } catch {
    // The worker is already unusable. A later request creates a clean instance.
  }
}

async function recognizeNow(
  image: OcrImage,
  onProgress?: (value: BrowserOcrProgress) => void
): Promise<BrowserOcrPageResult> {
  const worker = await localWorker();
  activeProgress = onProgress;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("BROWSER_OCR_TIMEOUT")),
        OCR_TIMEOUT_MS
      );
    });
    const result = await Promise.race([
      worker.recognize(image, { rotateAuto: true }, { text: true, blocks: true }),
      timeoutPromise
    ]);
    const words = wordsFromBlocks(result.data.blocks);
    return {
      text: result.data.text.normalize("NFKC").trim(),
      confidence: Number.isFinite(result.data.confidence)
        ? result.data.confidence
        : 0,
      words,
      engineVersion: BROWSER_OCR_ENGINE_VERSION,
      modelVersion: BROWSER_OCR_MODEL_VERSION
    };
  } catch (error) {
    await resetWorker();
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    activeProgress = undefined;
  }
}

/**
 * OCR jobs are deliberately serialized. One warm Tesseract worker avoids the
 * large language-model startup cost without allowing concurrent pages to
 * exhaust a normal office workstation's memory.
 */
export function recognizeBrowserOcrImage(
  image: OcrImage,
  onProgress?: (value: BrowserOcrProgress) => void
): Promise<BrowserOcrPageResult> {
  const result = queue.then(() => recognizeNow(image, onProgress));
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function browserOcrRenderScale(input: {
  width: number;
  height: number;
}): number {
  if (input.width <= 0 || input.height <= 0) {
    throw new Error("BROWSER_OCR_INVALID_PAGE_SIZE");
  }
  const dimensionScale =
    MAX_RENDER_DIMENSION / Math.max(input.width, input.height);
  const pixelScale = Math.sqrt(
    MAX_RENDER_PIXELS / (input.width * input.height)
  );
  return Math.max(
    MIN_RENDER_SCALE,
    Math.min(TARGET_RENDER_SCALE, dimensionScale, pixelScale)
  );
}

function createOcrCanvas(width: number, height: number): OcrImage {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("BROWSER_OCR_CANVAS_UNAVAILABLE");
}

export async function recognizeBrowserPage(input: {
  page: BrowserOcrRenderablePdfPage;
  baseViewport: PdfViewportForOcr;
  onProgress?: (value: BrowserOcrProgress) => void;
}): Promise<RenderedBrowserOcrResult> {
  const renderScale = browserOcrRenderScale({
    width: input.baseViewport.width,
    height: input.baseViewport.height
  });
  const viewport = input.page.getViewport({ scale: renderScale });
  const imageWidth = Math.max(1, Math.ceil(viewport.width));
  const imageHeight = Math.max(1, Math.ceil(viewport.height));
  const canvas = createOcrCanvas(imageWidth, imageHeight);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context || !("fillRect" in context)) throw new Error("BROWSER_OCR_CANVAS_UNAVAILABLE");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, imageWidth, imageHeight);
  await input.page.render({
    canvas,
    canvasContext: context,
    viewport
  }).promise;
  const recognized = await recognizeBrowserOcrImage(canvas, input.onProgress);
  return {
    ...recognized,
    imageWidth,
    imageHeight,
    renderScale
  };
}

export const recognizeBrowserPdfPage = recognizeBrowserPage;

export function terminateBrowserOcrWorker(): Promise<void> {
  return queue.then(resetWorker, resetWorker);
}
