import { NextResponse } from "next/server";
import { SaveDecisionDraftInputSchema } from "@/domain/central-decision";
import {
  centralDecisionApiContext,
  decisionApiError
} from "@/services/decision-api";
import { DecisionInputError, DecisionSyncService } from "@/services/decision-sync-service";
import { previewPersistenceResponse } from "@/services/deployment-api";
import { isVercelPreview } from "@/services/deployment-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string; positionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  if (isVercelPreview()) {
    return NextResponse.json({
      draft: null,
      deploymentMode: "VERCEL_PREVIEW",
      readOnly: true
    });
  }
  try {
    const { projectId, positionId } = await context.params;
    const analysisVersionId = new URL(request.url).searchParams.get(
      "analysisVersionId"
    );
    if (!analysisVersionId) {
      throw new DecisionInputError("ANALYSIS_VERSION_REQUIRED", 400);
    }
    const { unit } = await centralDecisionApiContext(request);
    const draft = await new DecisionSyncService(unit).getDraft(
      projectId,
      positionId,
      analysisVersionId
    );
    return NextResponse.json({ draft });
  } catch (error) {
    const response = decisionApiError(error);
    if (response) return response;
    throw error;
  }
}

export async function PUT(request: Request, context: RouteContext) {
  if (isVercelPreview()) return previewPersistenceResponse();
  try {
    const { projectId, positionId } = await context.params;
    const parsed = SaveDecisionDraftInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_DECISION_DRAFT", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { unit, user } = await centralDecisionApiContext(request);
    const draft = await new DecisionSyncService(unit).saveDraft({
      projectId,
      positionId,
      actorId: user.id,
      actorSessionId: user.sessionId,
      draft: parsed.data
    });
    return NextResponse.json({ draft });
  } catch (error) {
    const response = decisionApiError(error);
    if (response) return response;
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (isVercelPreview()) return previewPersistenceResponse();
  try {
    const { projectId, positionId } = await context.params;
    const query = new URL(request.url).searchParams;
    const analysisVersionId = query.get("analysisVersionId");
    if (!analysisVersionId) {
      throw new DecisionInputError("ANALYSIS_VERSION_REQUIRED", 400);
    }
    const expectedVersionRaw = query.get("expectedVersion");
    const expectedVersion =
      expectedVersionRaw === null ? undefined : Number(expectedVersionRaw);
    if (
      expectedVersion !== undefined &&
      (!Number.isInteger(expectedVersion) || expectedVersion < 0)
    ) {
      throw new DecisionInputError("EXPECTED_VERSION_INVALID", 400);
    }
    const { unit, user } = await centralDecisionApiContext(request);
    const deleted = await new DecisionSyncService(unit).deleteDraft({
      projectId,
      positionId,
      analysisVersionId,
      expectedVersion,
      actorId: user.id
    });
    return NextResponse.json({ deleted });
  } catch (error) {
    const response = decisionApiError(error);
    if (response) return response;
    throw error;
  }
}
