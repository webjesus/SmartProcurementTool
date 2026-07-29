import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    return NextResponse.json({ error: "LOCAL_CORPUS_DISABLED" }, { status: 503 });
  }
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
