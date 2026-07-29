import crypto from "node:crypto";
import type { AuthenticatedDecisionUser } from "@/domain/central-decision";
import type { UserRepository } from "@/repositories/decision-repositories";

export const DECISION_SESSION_COOKIE = "spt_decision_session";
export const DECISION_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export function decisionSessionCookieOptions(input: {
  requestUrl: string;
  nodeEnv: string | undefined;
}) {
  const url = new URL(input.requestUrl);
  const loopbackHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: input.nodeEnv === "production" && !loopbackHttp,
    path: "/",
    maxAge: DECISION_SESSION_MAX_AGE_SECONDS
  };
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return null;
}

export async function authenticatedDecisionUser(
  request: Request,
  users: UserRepository
): Promise<AuthenticatedDecisionUser | null> {
  const token = cookieValue(request, DECISION_SESSION_COOKIE);
  if (!token) return null;
  const user = await users.findBySessionTokenHash(hashSessionToken(token));
  if (!user) return null;
  const timestamp = new Date().toISOString();
  await users.touch(user.id, user.sessionId, timestamp);
  return { ...user, lastSeenAt: timestamp };
}
