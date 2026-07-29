import { NextResponse } from "next/server";
import { decisionPersistenceMode } from "@/services/decision-persistence-config";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    product: "SmartProcurementTool",
    version: "0.1.0",
    mode: process.env.LOCAL_CORPUS_ENABLED === "true" ? "local-corpus" : "synthetic-demo",
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    decisionPersistenceMode: decisionPersistenceMode(),
    timestamp: new Date().toISOString()
  });
}
