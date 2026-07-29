import { NextResponse } from "next/server";
import { authenticatedDecisionUser } from "@/auth/decision-session";
import { CentralDatabaseUnavailableError } from "@/db/client";
import { RepositoryConflictError } from "@/repositories/decision-repositories";
import { getDecisionUnitOfWork } from "@/repositories/decision-repository-factory";
import { DecisionInputError } from "@/services/decision-sync-service";

export async function centralDecisionApiContext(request: Request) {
  const unit = getDecisionUnitOfWork();
  const user = await authenticatedDecisionUser(
    request,
    unit.repositories.users
  );
  if (!user) {
    throw new DecisionInputError("AUTHENTICATION_REQUIRED", 401);
  }
  return { unit, user };
}

export function decisionApiError(error: unknown): NextResponse | null {
  if (error instanceof RepositoryConflictError) {
    return NextResponse.json(
      {
        error: "DECISION_CONFLICT",
        message: "Diese Position wurde auf einem anderen Gerät geändert.",
        currentVersion: error.currentVersion,
        currentRecord: error.currentRecord
      },
      { status: 409 }
    );
  }
  if (error instanceof DecisionInputError) {
    return NextResponse.json(
      {
        error: error.code,
        details: error.details
      },
      { status: error.status }
    );
  }
  if (error instanceof CentralDatabaseUnavailableError) {
    return NextResponse.json(
      {
        error: "CENTRAL_DATABASE_UNAVAILABLE",
        message: error.message
      },
      { status: 503 }
    );
  }
  return null;
}
