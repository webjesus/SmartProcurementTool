import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Compatibility alias for older clients. Prefer the static public worker at
 * /pdfjs/pdf.worker.min.mjs — that path survives Vercel serverless deploys.
 */
export async function GET() {
  const candidates = [
    path.resolve(
      /*turbopackIgnore: true*/ process.cwd(),
      "public",
      "pdfjs",
      "pdf.worker.min.mjs"
    ),
    path.resolve(
      /*turbopackIgnore: true*/ process.cwd(),
      "node_modules",
      "pdfjs-dist",
      "legacy",
      "build",
      "pdf.worker.min.mjs"
    )
  ];

  for (const workerPath of candidates) {
    try {
      const bytes = await readFile(workerPath);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "public, max-age=86400, immutable",
          "x-content-type-options": "nosniff"
        }
      });
    } catch {
      // try next candidate
    }
  }

  return new Response("PDF worker unavailable", { status: 404 });
}
