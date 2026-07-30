import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const workerPath = path.resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.min.mjs"
  );
  const bytes = await readFile(workerPath);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff"
    }
  });
}
