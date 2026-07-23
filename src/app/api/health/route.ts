import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    product: "SmartProcurementTool",
    version: "0.1.0",
    mode: process.env.LOCAL_CORPUS_ENABLED === "true" ? "local-corpus" : "synthetic-demo",
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    timestamp: new Date().toISOString()
  });
}
