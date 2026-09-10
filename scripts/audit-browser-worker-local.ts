/** Read-only real-PDF audit of the production browser worker. No cloud calls. */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import type { BrowserDocumentRecord, BrowserDocumentType } from "../src/browser-projects/types";
import type { BrowserWorkerResult } from "../src/browser-projects/processing-protocol";

async function main() {
  const root = process.cwd();
  const argumentsList = process.argv.slice(2);
  if (!argumentsList.length)
    throw new Error(
      "Usage: tsx scripts/audit-browser-worker-local.ts BASIS_LV=<absolute.pdf> SCAN_OCR_REQUIRED=<absolute.pdf>"
    );
  const allowedTypes = new Set([
    "BASIS_LV",
    "SUPPLIER_OFFER",
    "MANUFACTURER_OFFER",
    "SCAN_OCR_REQUIRED",
    "UNKNOWN"
  ]);
  const inputs = await Promise.all(
    argumentsList.map(async (argument, index) => {
      const separator = argument.indexOf("=");
      const documentType = argument.slice(0, separator);
      const file = path.resolve(argument.slice(separator + 1));
      if (
        separator < 0 ||
        !allowedTypes.has(documentType) ||
        path.extname(file).toLowerCase() !== ".pdf"
      )
        throw new Error("Invalid audit PDF argument");
      const bytes = await readFile(file);
      return {
        documentType: documentType as BrowserDocumentType,
        file,
        bytes,
        id: `audit-${index + 1}`,
        sha256: createHash("sha256").update(bytes).digest("hex")
      };
    })
  );
  const bundled = await build({
    entryPoints: [path.join(root, "src/workers/browser-processing.worker.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    tsconfig: path.join(root, "tsconfig.json"),
    logLevel: "silent"
  });
  const publicRoot = path.join(root, "public");
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end("<!doctype html><title>Local extraction audit</title>");
        return;
      }
      if (url.pathname === "/processing-worker.js") {
        response
          .writeHead(200, { "content-type": "text/javascript" })
          .end(bundled.outputFiles[0].contents);
        return;
      }
      const input = inputs.find((candidate) => url.pathname === `/input/${candidate.id}.pdf`);
      if (input) {
        response.writeHead(200, { "content-type": "application/pdf" }).end(input.bytes);
        return;
      }
      let file: string;
      if (url.pathname === "/api/local/pdf-worker")
        file = path.join(root, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs");
      else if (url.pathname.startsWith("/ocr/") || url.pathname.startsWith("/pdfjs/")) {
        file = path.resolve(publicRoot, `.${url.pathname}`);
        if (!file.startsWith(`${publicRoot}${path.sep}`)) throw new Error("Invalid static path");
      } else {
        response.writeHead(404).end();
        return;
      }
      const contentType = file.endsWith(".wasm")
        ? "application/wasm"
        : /\.m?js$/u.test(file)
          ? "text/javascript"
          : "application/octet-stream";
      response.writeHead(200, { "content-type": contentType }).end(await readFile(file));
    } catch {
      response.writeHead(500).end("Local audit resource unavailable");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("AUDIT_SERVER_FAILED");
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const blockedExternalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
      blockedExternalRequests.push(url.origin);
      await route.abort();
    } else await route.continue();
  });
  await page.exposeFunction("auditProgress", (documentId: string, pageNumber: number) =>
    console.log(`Progress ${documentId}: page ${pageNumber}`)
  );
  try {
    await page.goto(origin);
    const metadata = inputs.map(
      (input): BrowserDocumentRecord => ({
        projectId: "local-real-pdf-audit",
        documentId: input.id,
        originalFileName: path.basename(input.file),
        mimeType: "application/pdf",
        size: input.bytes.length,
        sha256: input.sha256,
        uploadedAt: new Date().toISOString(),
        pageCount: 0,
        detectedDocumentType: input.documentType,
        documentType: input.documentType,
        discipline: "UNKNOWN",
        supplierName: null,
        offerNumber: null,
        documentVersion: null,
        revision: null,
        revisionOfDocumentId: null,
        relationType: "UNKNOWN_RELATION",
        scanState: input.documentType === "SCAN_OCR_REQUIRED" ? "OCR_REQUIRED" : "TEXT_AVAILABLE",
        projectName: null,
        projectNumber: null,
        lvNumber: null,
        classificationDimensions: {
          documentRole: "LOW",
          supplier: "LOW",
          discipline: "LOW",
          projectIdentity: "LOW",
          offerNumber: "LOW",
          relation: "LOW",
          scanState: "LOW"
        },
        classificationSignals: [],
        textLayerCharacterCount: 0,
        preliminaryPositionCount: 0,
        activeBasis: input.documentType === "BASIS_LV",
        excludedFromProcessing: false,
        manualRoleOverride: false,
        manualBasisOverrideConfirmed: false,
        classificationConfidence: "LOW",
        classificationWarnings: [],
        processingStatus: "PRÜFUNG_ERFORDERLICH"
      })
    );
    const result = await page.evaluate(async (documents) => {
      const workerDocuments = await Promise.all(
        documents.map(async (metadata) => ({
          metadata,
          bytes: await (await fetch(`/input/${metadata.documentId}.pdf`)).arrayBuffer()
        }))
      );
      return await new Promise<BrowserWorkerResult>((resolve, reject) => {
        const worker = new Worker("/processing-worker.js", { type: "module" });
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error("REAL_PDF_AUDIT_TIMEOUT"));
        }, 20 * 60_000);
        worker.onerror = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(event.message));
        };
        worker.onmessage = (event) => {
          const message = event.data;
          if (message.type === "PAGE_PROGRESS")
            void (
              window as unknown as { auditProgress(id: string, page: number): Promise<void> }
            ).auditProgress(message.documentId, message.page);
          if (message.type === "ERROR") {
            clearTimeout(timeout);
            worker.terminate();
            reject(new Error(message.message));
          }
          if (message.type === "COMPLETE") {
            clearTimeout(timeout);
            worker.terminate();
            resolve(message.result);
          }
        };
        worker.postMessage({
          type: "LOAD_DOCUMENTS",
          runId: "real-pdf-audit",
          documents: workerDocuments,
          incremental: true
        });
      });
    }, metadata);
    const outputDirectory = path.join(root, "tmp", "real-worker-audit");
    await mkdir(outputDirectory, { recursive: true });
    const output = path.join(outputDirectory, `audit-${Date.now()}.json`);
    await writeFile(
      output,
      JSON.stringify(
        {
          inputs: inputs.map(({ id, file, sha256 }) => ({ id, file, sha256 })),
          blockedExternalRequests,
          result
        },
        null,
        2
      )
    );
    console.log(
      JSON.stringify(
        {
          output,
          blockedExternalRequests,
          basisPositions: result.basisLines.length,
          offerPositions: result.supplierLines.length,
          diagnostics: result.diagnostics.documents,
          warnings: result.warnings
        },
        null,
        2
      )
    );
    if (blockedExternalRequests.length) throw new Error("UNEXPECTED_EXTERNAL_REQUEST");
  } finally {
    await page.close();
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
