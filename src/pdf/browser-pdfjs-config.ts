export const BROWSER_PDFJS_WORKER_URL = "/api/local/pdf-worker";
export const BROWSER_PDFJS_WASM_URL = "/pdfjs/wasm/";

type BrowserPdfJsModule = {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
};

/**
 * Keep PDF.js decoding fully self-hosted. The wasm directory is required for
 * JBIG2/OpenJPEG pages such as scanned supplier offers; without it PDF.js can
 * resolve the page while silently rendering an empty image for OCR.
 */
export function configureBrowserPdfJs(pdfjs: BrowserPdfJsModule): void {
  pdfjs.GlobalWorkerOptions.workerSrc = BROWSER_PDFJS_WORKER_URL;
}

export function browserPdfLoadingOptions<T extends ArrayBuffer | Uint8Array>(
  data: T
): {
  data: T;
  wasmUrl: typeof BROWSER_PDFJS_WASM_URL;
} {
  return {
    data,
    wasmUrl: BROWSER_PDFJS_WASM_URL
  };
}
