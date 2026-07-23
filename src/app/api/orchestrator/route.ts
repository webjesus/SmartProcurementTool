import { NextResponse } from "next/server";
import { z } from "zod";
import { LocalProjectRunService } from "@/orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ActionSchema = z.object({
  action: z.enum(["START", "RESUME", "PAUSE", "CANCEL"]),
  reason: z.string().max(500).optional()
});

function disabledResponse() {
  return NextResponse.json({
    mode: "VOLATILE_DEMO",
    available: false,
    message: "Durable ProjectRun ist nur im expliziten lokalen Corpus-Modus verfügbar."
  });
}

export async function GET() {
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") return disabledResponse();
  const service = new LocalProjectRunService();
  return NextResponse.json(
    { ...(await service.get()), available: true },
    { headers: { "cache-control": "private, no-store" } }
  );
}

export async function POST(request: Request) {
  if (process.env.LOCAL_CORPUS_ENABLED !== "true") {
    return NextResponse.json(
      { error: "LOCAL_ORCHESTRATOR_DISABLED" },
      { status: 409 }
    );
  }
  const parsed = ActionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_ORCHESTRATOR_ACTION", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const service = new LocalProjectRunService();
  try {
    const result =
      parsed.data.action === "START"
        ? await service.start()
        : parsed.data.action === "RESUME"
          ? await service.resume()
          : parsed.data.action === "PAUSE"
            ? await service.pause(parsed.data.reason)
            : await service.cancel();
    return NextResponse.json(
      { ...result, available: true },
      { headers: { "cache-control": "private, no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "ORCHESTRATOR_ACTION_FAILED"
      },
      { status: 409 }
    );
  }
}

