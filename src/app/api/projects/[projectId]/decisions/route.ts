import { NextResponse } from "next/server";
import {
  centralDecisionApiContext,
  decisionApiError
} from "@/services/decision-api";
import {
  centralProjectDecisionData,
  currentDecisionProjectMetadata,
  DecisionInputError
} from "@/services/decision-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const metadata = await currentDecisionProjectMetadata();
    if (metadata.projectId !== projectId) {
      throw new DecisionInputError("PROJECT_NOT_FOUND", 404);
    }
    const { unit } = await centralDecisionApiContext(request);
    const data = await centralProjectDecisionData(
      unit.repositories,
      projectId
    );
    return NextResponse.json({
      ...data,
      analysisVersionId: metadata.analysisVersionId
    });
  } catch (error) {
    const response = decisionApiError(error);
    if (response) return response;
    throw error;
  }
}
