import path from "node:path";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDecisionDatabase } from "@/db/client";
import { projectWorkspaces } from "@/db/schema";
import { decisionProjectId } from "@/domain/decision-project";
import {
  centralDecisionApiContext,
  decisionApiError
} from "@/services/decision-api";
import { isVercelPreview } from "@/services/deployment-profile";
import { LocalPilotPersistence } from "@/storage/document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (isVercelPreview()) {
    return NextResponse.json({
      projects: [],
      deploymentMode: "VERCEL_PREVIEW",
      readOnly: true
    });
  }
  try {
    const { user } = await centralDecisionApiContext(request);
    const persistence = new LocalPilotPersistence(
      path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data"),
      true
    );
    const state = await persistence.read();
    if (!state.analysis) {
      return NextResponse.json({ projects: [] });
    }
    const projectId = decisionProjectId(state.analysis);
    const database = getDecisionDatabase();
    const [workspace] = await database
      .select()
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.projectId, projectId),
          eq(projectWorkspaces.userId, user.id)
        )
      )
      .limit(1);
    const generatedAt = state.analysis.generatedAt;
    const workspaceTimestamp = workspace?.updatedAt.toISOString() ?? generatedAt;
    return NextResponse.json({
      projects: [
        {
          id: projectId,
          name: "Heizung LV-Vergleich",
          projectNumber: `SPT-${projectId.slice(-8).toUpperCase()}`,
          disciplines: ["Heizung"],
          lastOpenedAt: workspaceTimestamp,
          lastEditedAt: workspaceTimestamp,
          basisPositionCount: state.analysis.basisPositions.filter(
            (position) => !position.heading
          ).length
        }
      ]
    });
  } catch (error) {
    const response = decisionApiError(error);
    if (response) return response;
    throw error;
  }
}
