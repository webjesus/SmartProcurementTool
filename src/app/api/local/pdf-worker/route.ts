import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { previewLocalDataResponse } from "@/services/deployment-api";
import {
  isVercelPreview,
  localCorpusEnabled
} from "@/services/deployment-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (isVercelPreview()) return previewLocalDataResponse();
  if (!localCorpusEnabled()) {
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
