import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    return NextResponse.json(
      {
        error: "LOCAL_CORPUS_DISABLED",
        message: "Set LOCAL_CORPUS_ENABLED=true on localhost. Production storage is not configured."
      },
      { status: 503 }
    );
      }

  try {
    const manifest = JSON.parse(
      await readFile(
        path.resolve(
          /*turbopackIgnore: true*/ process.cwd(),
          ".data",
          "corpus-manifest.local.json"
        ),
        "utf8"
      )
    ) as { documents: unknown[]; generatedAt: string };
    return NextResponse.json({
      documents: manifest.documents,
      generatedAt: manifest.generatedAt,
      confidentiality: "LOCAL_ONLY"
    });
  } catch {
    return NextResponse.json(
      { error: "CORPUS_NOT_SCANNED", message: "Run npm run corpus:scan first." },
      { status: 404 }
    );
  }
}
