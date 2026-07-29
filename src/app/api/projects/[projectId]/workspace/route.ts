import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDecisionDatabase } from "@/db/client";
import { projectWorkspaces } from "@/db/schema";
import {
  ProjectWorkspaceStateSchema,
  SaveProjectWorkspaceInputSchema
} from "@/domain/project-workspace";
import {
  centralDecisionApiContext,
  decisionApiError
} from "@/services/decision-api";
import {
  currentDecisionProjectMetadata,
  DecisionInputError
} from "@/services/decision-sync-service";
import { previewPersistenceResponse } from "@/services/deployment-api";
import { isVercelPreview } from "@/services/deployment-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

function record(row: typeof projectWorkspaces.$inferSelect) {
  return {
    projectId: row.projectId,
    userId: row.userId,
    state: ProjectWorkspaceStateSchema.parse(row.state),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy
  };
}

async function validateProject(projectId: string) {
  const metadata = await currentDecisionProjectMetadata();
  if (metadata.projectId !== projectId) {
    throw new DecisionInputError("PROJECT_NOT_FOUND", 404);
  }
}

export async function GET(request: Request, context: RouteContext) {
  if (isVercelPreview()) {
    return NextResponse.json({
      workspace: null,
      deploymentMode: "VERCEL_PREVIEW",
      readOnly: true
    });
  }
  try {
    const { projectId } = await context.params;
    await validateProject(projectId);
    const { user } = await centralDecisionApiContext(request);
    const database = getDecisionDatabase();
    const [row] = await database
      .select()
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.projectId, projectId),
          eq(projectWorkspaces.userId, user.id)
        )
      )
      .limit(1);
    return NextResponse.json({ workspace: row ? record(row) : null });
  } catch (error) {
    const response = decisionApiError(error);
    if (response) return response;
    throw error;
  }
}

export async function PUT(request: Request, context: RouteContext) {
  if (isVercelPreview()) return previewPersistenceResponse();
  try {
    const { projectId } = await context.params;
    await validateProject(projectId);
    const parsed = SaveProjectWorkspaceInputSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_PROJECT_WORKSPACE", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { user } = await centralDecisionApiContext(request);
    const database = getDecisionDatabase();
    const [current] = await database
      .select()
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.projectId, projectId),
          eq(projectWorkspaces.userId, user.id)
        )
      )
      .limit(1);
    const expected = parsed.data.expectedVersion;
    if (
      (current && expected !== current.version) ||
      (!current && expected !== null && expected !== 0)
    ) {
      return NextResponse.json(
        {
          error: "WORKSPACE_CONFLICT",
          currentVersion: current?.version ?? 0,
          workspace: current ? record(current) : null
        },
        { status: 409 }
      );
    }
    if (!current) {
      const [created] = await database
        .insert(projectWorkspaces)
        .values({
          projectId,
          userId: user.id,
          state: parsed.data.state,
          updatedBy: user.id
        })
        .returning();
      return NextResponse.json({ workspace: record(created!) }, { status: 201 });
    }
    const [updated] = await database
      .update(projectWorkspaces)
      .set({
        state: parsed.data.state,
        version: sql`${projectWorkspaces.version} + 1`,
        updatedAt: new Date(),
        updatedBy: user.id
      })
      .where(
        and(
          eq(projectWorkspaces.projectId, projectId),
          eq(projectWorkspaces.userId, user.id),
          eq(projectWorkspaces.version, current.version)
        )
      )
      .returning();
    if (!updated) {
      return NextResponse.json(
        { error: "WORKSPACE_CONFLICT" },
        { status: 409 }
      );
    }
    return NextResponse.json({ workspace: record(updated) });
  } catch (error) {
    const response = decisionApiError(error);
    if (response) return response;
    throw error;
  }
}
