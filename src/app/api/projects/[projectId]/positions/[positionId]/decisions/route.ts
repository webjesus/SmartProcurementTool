import { NextResponse } from "next/server";
import { CreateCentralDecisionInputSchema } from "@/domain/central-decision";
import {
  centralDecisionApiContext,
  decisionApiError
} from "@/services/decision-api";
import {
  currentDecisionProjectMetadata,
  DecisionInputError,
  DecisionSyncService
} from "@/services/decision-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string; positionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { projectId, positionId } = await context.params;
    const metadata = await currentDecisionProjectMetadata();
    if (metadata.projectId !== projectId) {
      throw new DecisionInputError("PROJECT_NOT_FOUND", 404);
    }
    const { unit } = await centralDecisionApiContext(request);
    const decisions = await new DecisionSyncService(unit).listDecisions(
      projectId,
      positionId
    );
    return NextResponse.json({ decisions });
  } catch (error) {
    const response = decisionApiError(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId, positionId } = await context.params;
    const parsed = CreateCentralDecisionInputSchema.safeParse(
      await request.json()
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_SUPPLIER_DECISION", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { unit, user } = await centralDecisionApiContext(request);
    const decision = await new DecisionSyncService(unit).createDecision({
      projectId,
      positionId,
      actorId: user.id,
      decision: parsed.data
    });
    return NextResponse.json({ decision }, { status: 201 });
  } catch (error) {
    const response = decisionApiError(error);
    if (response) return response;
    throw error;
  }
}
