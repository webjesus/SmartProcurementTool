import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BROWSER_PDFJS_WASM_URL,
  BROWSER_PDFJS_WORKER_URL,
  browserPdfLoadingOptions,
  configureBrowserPdfJs
} from "@/pdf/browser-pdfjs-config";

describe("self-hosted browser PDF.js assets", () => {
  it("configures same-origin worker and wasm decoding for every document", () => {
    const pdfjs = { GlobalWorkerOptions: { workerSrc: "" } };
    configureBrowserPdfJs(pdfjs);

    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(BROWSER_PDFJS_WORKER_URL);
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe("/pdfjs/pdf.worker.min.mjs");
    expect(browserPdfLoadingOptions(new Uint8Array([1, 2, 3]))).toMatchObject({
      wasmUrl: BROWSER_PDFJS_WASM_URL,
      isEvalSupported: false,
      useSystemFonts: true
    });
    expect(BROWSER_PDFJS_WASM_URL).toBe("/pdfjs/wasm/");
    expect(BROWSER_PDFJS_WASM_URL).not.toMatch(/^https?:/u);
  });

  it("ships the JBIG2 decoder, worker, fallback, manifest and license locally", async () => {
    const root = path.resolve(process.cwd(), "public", "pdfjs");
    const requiredFiles = [
      "pdf.worker.min.mjs",
      "wasm/jbig2.wasm",
      "wasm/jbig2_nowasm_fallback.js",
      "wasm/LICENSE_JBIG2",
      "wasm/LICENSE_PDFJS_JBIG2",
      "licenses/APACHE-2.0.txt"
    ];
    for (const relativePath of requiredFiles) {
      expect((await stat(path.join(root, relativePath))).size).toBeGreaterThan(0);
    }

    const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as {
      packages: Record<string, { version: string; license: string }>;
      files: Array<{ path: string; bytes: number; sha256: string }>;
    };
    expect(manifest.packages["pdfjs-dist"]).toEqual({
      version: "6.3.289",
      license: "Apache-2.0"
    });
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "wasm/jbig2.wasm",
          bytes: expect.any(Number),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
        })
      ])
    );
  });
});
