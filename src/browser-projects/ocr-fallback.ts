import type { PdfTextGeometryItem } from "@/pdf/source-region";

export const BROWSER_OCR_ENGINE_VERSION = "7.0.0";
export const BROWSER_OCR_MODEL_VERSION = "deu-fast-v1";
export const BROWSER_OCR_LANGUAGE = "deu";

export const localBrowserOcrAssets = {
  workerPath: "/ocr/worker/worker.min.js",
  corePath: "/ocr/core/",
  langPath: "/ocr/lang/"
} as const;

export type BrowserOcrWord = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export type BrowserOcrPageResult = {
  text: string;
  confidence: number;
  words: BrowserOcrWord[];
  engineVersion: string;
  modelVersion: string;
};

export function shouldRunBrowserOcr(input: {
  nativeText: string;
  rasterCoverage?: number | null;
}): boolean {
  const characters = input.nativeText.replace(/\s+/gu, "").length;
  if (characters < 40) return true;
  return (input.rasterCoverage ?? 0) >= 0.35;
}

/** Painted image area, not merely the presence of a logo in an otherwise native PDF. */
export function estimateBrowserRasterCoverage(input: {
  fnArray: readonly number[];
  argsArray: readonly unknown[];
  operators: Record<string, number>;
  viewport: { width: number; height: number; transform?: readonly number[] };
}): number {
  const identity = [1, 0, 0, 1, 0, 0];
  const multiply = (a: readonly number[], b: readonly number[]) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
  let matrix = identity;
  const stack: number[][] = [];
  let area = 0;
  const imageOps = new Set(
    [
      "paintImageXObject",
      "paintInlineImageXObject",
      "paintImageMaskXObject",
      "paintSolidColorImageMask"
    ]
      .map((name) => input.operators[name])
      .filter((code) => typeof code === "number")
  );
  for (const [index, operation] of input.fnArray.entries()) {
    if (operation === input.operators.save) stack.push([...matrix]);
    else if (operation === input.operators.restore) matrix = stack.pop() ?? identity;
    else if (operation === input.operators.transform) {
      const args = input.argsArray[index];
      if (Array.isArray(args) && args.length >= 6 && args.slice(0, 6).every(Number.isFinite))
        matrix = multiply(matrix, args);
    } else if (imageOps.has(operation)) {
      const painted = multiply(input.viewport.transform ?? identity, matrix);
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1]
      ].map(([x, y]) => [
        painted[0] * x + painted[2] * y + painted[4],
        painted[1] * x + painted[3] * y + painted[5]
      ]);
      const left = Math.max(0, Math.min(...corners.map((point) => point[0])));
      const right = Math.min(input.viewport.width, Math.max(...corners.map((point) => point[0])));
      const top = Math.max(0, Math.min(...corners.map((point) => point[1])));
      const bottom = Math.min(input.viewport.height, Math.max(...corners.map((point) => point[1])));
      area += Math.max(0, right - left) * Math.max(0, bottom - top);
    }
  }
  return Math.min(1, area / Math.max(1, input.viewport.width * input.viewport.height));
}

export function summarizeBrowserOcr(input: {
  text: string;
  confidence: number;
  wordCount: number;
}): {
  usable: boolean;
  requiresReview: true;
  reason: "OCR_SOURCE" | "OCR_FAILED";
} {
  const usable =
    input.wordCount > 0 && input.text.replace(/\s+/gu, "").length >= 8 && input.confidence > 0;
  return {
    usable,
    requiresReview: true,
    reason: usable ? "OCR_SOURCE" : "OCR_FAILED"
  };
}

/** Keep the native layer authoritative and supplement only non-overlapping OCR words. */
export function mergeBrowserOcrGeometry(
  nativeItems: readonly PdfTextGeometryItem[],
  ocrItems: readonly PdfTextGeometryItem[]
): PdfTextGeometryItem[] {
  const bounds = (item: PdfTextGeometryItem) => {
    const [a, b, c, d, x, y] = item.transform;
    const baseline = Math.hypot(a, b) || 1;
    const ascent = Math.hypot(c, d) || 1;
    const height = Math.max(item.height, ascent);
    const dx = (a / baseline) * item.width;
    const dy = (b / baseline) * item.width;
    const hx = (c / ascent) * height;
    const hy = (d / ascent) * height;
    const xs = [x, x + dx, x + hx, x + dx + hx];
    const ys = [y, y + dy, y + hy, y + dy + hy];
    return {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys)
    };
  };
  const nativeBounds = nativeItems.filter((item) => item.str.trim()).map(bounds);
  return [
    ...nativeItems,
    ...ocrItems.filter((item) => {
      const box = bounds(item);
      const area = Math.max(1, (box.right - box.left) * (box.bottom - box.top));
      return !nativeBounds.some((native) => {
        const overlap =
          Math.max(0, Math.min(box.right, native.right) - Math.max(box.left, native.left)) *
          Math.max(0, Math.min(box.bottom, native.bottom) - Math.max(box.top, native.top));
        return overlap / area >= 0.35;
      });
    })
  ];
}

export function buildBrowserOcrCacheKey(input: {
  documentSha256: string;
  pageNumber: number;
  renderScale: number;
  engineVersion?: string;
  modelVersion?: string;
}): string {
  return [
    input.documentSha256,
    input.pageNumber,
    input.renderScale,
    input.engineVersion ?? BROWSER_OCR_ENGINE_VERSION,
    input.modelVersion ?? BROWSER_OCR_MODEL_VERSION
  ].join(":");
}

function invertAffine(transform: readonly number[]) {
  const [a, b, c, d, e, f] = transform;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) {
    return null;
  }
  const vector = (x: number, y: number): [number, number] => [
    (d * x - c * y) / determinant,
    (-b * x + a * y) / determinant
  ];
  return {
    vector,
    point(x: number, y: number): [number, number] {
      return vector(x - e, y - f);
    }
  };
}

export function ocrWordsToPdfGeometry(input: {
  words: readonly BrowserOcrWord[];
  imageWidth: number;
  imageHeight: number;
  pageWidth: number;
  pageHeight: number;
  viewportTransform: readonly number[];
}): PdfTextGeometryItem[] {
  if (
    input.imageWidth <= 0 ||
    input.imageHeight <= 0 ||
    input.pageWidth <= 0 ||
    input.pageHeight <= 0
  ) {
    return [];
  }
  const inverse = invertAffine(input.viewportTransform);
  if (!inverse) return [];
  const scaleX = input.pageWidth / input.imageWidth;
  const scaleY = input.pageHeight / input.imageHeight;
  return input.words.flatMap((word): PdfTextGeometryItem[] => {
    const str = word.text.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const left = Math.min(word.bbox.x0, word.bbox.x1) * scaleX;
    const right = Math.max(word.bbox.x0, word.bbox.x1) * scaleX;
    const top = Math.min(word.bbox.y0, word.bbox.y1) * scaleY;
    const bottom = Math.max(word.bbox.y0, word.bbox.y1) * scaleY;
    const width = right - left;
    const height = bottom - top;
    if (!str || width <= 0 || height <= 0) return [];
    const [horizontalX, horizontalY] = inverse.vector(1, 0);
    const [verticalX, verticalY] = inverse.vector(0, -height);
    const [originX, originY] = inverse.point(left, bottom);
    return [
      {
        str,
        width,
        height,
        transform: [horizontalX, horizontalY, verticalX, verticalY, originX, originY]
      }
    ];
  });
}
