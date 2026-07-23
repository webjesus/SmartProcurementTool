import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { LocalPilotPersistence } from "@/storage/document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    return NextResponse.json(
      {
        error: "LOCAL_CORPUS_DISABLED",
        message: "Set LOCAL_CORPUS_ENABLED=true on localhost. Production storage is not configured."
      },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  const asset = url.searchParams.get("asset");
  const persistence = new LocalPilotPersistence(
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data"),
    true
  );

  if (asset) {
    const state = await persistence.read();
    const allowedAssets = new Set(
      state.runs.flatMap((run) => [
        run.pageImageAsset,
        ...Object.values(run.cropAssets)
      ])
    );
    if (!allowedAssets.has(asset)) {
      return NextResponse.json({ error: "ASSET_NOT_FOUND" }, { status: 404 });
    }
    const bytes = await readFile(
      path.resolve(
        /*turbopackIgnore: true*/ process.cwd(),
        ".data",
        "pilot-assets",
        asset
      )
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store"
      }
    });
  }

  if (view === "pilot") {
    const state = await persistence.read();
    return NextResponse.json(
      { ...state, confidentiality: "LOCAL_ONLY" },
      { headers: { "cache-control": "private, no-store" } }
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
