export const BROWSER_PDFJS_WORKER_URL = "/pdfjs/pdf.worker.min.mjs";
export const BROWSER_PDFJS_WASM_URL = "/pdfjs/wasm/";

type BrowserPdfJsModule = {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
};

/**
 * Keep PDF.js decoding fully self-hosted. The worker and wasm directory must be
 * static public assets so Vercel/browser-local deploys do not depend on reading
 * node_modules at request time (that path breaks serverless uploads as INVALID_PDF).
 */
export function configureBrowserPdfJs(pdfjs: BrowserPdfJsModule): void {
  pdfjs.GlobalWorkerOptions.workerSrc = BROWSER_PDFJS_WORKER_URL;
}

export function browserPdfLoadingOptions<T extends ArrayBuffer | Uint8Array>(
  data: T
): {
  data: T;
  wasmUrl: typeof BROWSER_PDFJS_WASM_URL;
  isEvalSupported: false;
  useSystemFonts: true;
} {
  return {
    data,
    wasmUrl: BROWSER_PDFJS_WASM_URL,
    isEvalSupported: false,
    useSystemFonts: true
  };
}

/** Detached copy so PDF.js worker transfer cannot break parallel checksum reads. */
export function copyPdfBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
