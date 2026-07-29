import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DECISION_SESSION_COOKIE,
  DECISION_SESSION_MAX_AGE_SECONDS,
  authenticatedDecisionUser,
  createSessionToken,
  decisionSessionCookieOptions,
  hashSessionToken
} from "@/auth/decision-session";
import { CentralDatabaseUnavailableError } from "@/db/client";
import { DecisionDisplayNameSchema } from "@/domain/central-decision";
import { getDecisionUnitOfWork } from "@/repositories/decision-repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LoginInput = z.object({
  displayName: DecisionDisplayNameSchema
});

function sessionFailure(error: unknown): NextResponse {
  if (error instanceof Error && error.message === "USER_CREATE_FAILED") {
    return NextResponse.json(
      {
        error: "USER_SAVE_FAILED",
        message: "Benutzer konnte nicht gespeichert werden."
      },
      { status: 500 }
    );
  }
  if (error instanceof Error && error.message === "SESSION_CREATE_FAILED") {
    return NextResponse.json(
      {
        error: "SESSION_CREATE_FAILED",
        message: "Sitzung konnte nicht erstellt werden."
      },
      { status: 500 }
    );
  }
  return NextResponse.json(
    {
      error:
        error instanceof CentralDatabaseUnavailableError
          ? "CENTRAL_DATABASE_UNAVAILABLE"
          : "DATABASE_REQUEST_FAILED",
      message: "Verbindung zur Datenbank fehlgeschlagen."
    },
    { status: 503 }
  );
}

export async function GET(request: Request) {
  try {
    const unit = getDecisionUnitOfWork();
    const user = await authenticatedDecisionUser(
      request,
      unit.repositories.users
    );
    if (!user) {
      return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    }
    return NextResponse.json({ user });
  } catch (error) {
    return sessionFailure(error);
  }
}

export async function POST(request: Request) {
  const parsed = LoginInput.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_DISPLAY_NAME",
        message:
          "Bitte einen Anzeigenamen mit 2 bis 100 aussagekräftigen Zeichen eingeben."
      },
      { status: 400 }
    );
  }
  try {
    const unit = getDecisionUnitOfWork();
    const token = createSessionToken();
    const expiresAt = new Date(
      Date.now() + DECISION_SESSION_MAX_AGE_SECONDS * 1000
    ).toISOString();
    const { user, session } = await unit.transaction(async (repositories) => {
      const user = await repositories.users.create(parsed.data.displayName);
      const session = await repositories.users.createSession({
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt
      });
      return { user, session };
    });
    const response = NextResponse.json(
      { user: { ...user, sessionId: session.id } },
      { status: 201 }
    );
    response.cookies.set({
      name: DECISION_SESSION_COOKIE,
      value: token,
      ...decisionSessionCookieOptions({
        requestUrl: request.url,
        nodeEnv: process.env.NODE_ENV
      })
    });
    return response;
  } catch (error) {
    return sessionFailure(error);
  }
}
