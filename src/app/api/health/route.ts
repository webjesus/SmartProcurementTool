import { NextResponse } from "next/server";
import { decisionPersistenceMode } from "@/services/decision-persistence-config";
import {
  deploymentMode,
  localCorpusEnabled
} from "@/services/deployment-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = deploymentMode();
  let persistenceMode;
  try {
    persistenceMode = decisionPersistenceMode();
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        product: "SmartProcurementTool",
        deploymentMode: profile,
        error: "PERSISTENCE_CONFIGURATION_INVALID",
        message: error instanceof Error ? error.message : "Invalid configuration"
      },
      { status: 503 }
    );
  }
  return NextResponse.json({
    status: "ok",
    product: "SmartProcurementTool",
    version: "0.1.0",
    deploymentMode: profile,
    mode: localCorpusEnabled()
      ? "local-corpus"
      : profile === "VERCEL_PREVIEW"
        ? "vercel-preview"
        : "synthetic-demo",
    openAiConfigured:
      profile === "LOCAL_ON_PREM" && Boolean(process.env.OPENAI_API_KEY),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    decisionPersistenceMode: persistenceMode,
    timestamp: new Date().toISOString()
  });
}
