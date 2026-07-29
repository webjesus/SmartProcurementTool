import { describe, expect, it } from "vitest";
import {
  DECISION_SESSION_MAX_AGE_SECONDS,
  decisionSessionCookieOptions
} from "@/auth/decision-session";
import { DecisionDisplayNameSchema } from "@/domain/central-decision";

describe("decision session cookie", () => {
  it("uses the required persistent HTTP-only cookie attributes", () => {
    expect(
      decisionSessionCookieOptions({
        requestUrl: "https://procurement.example.test/lv-vergleich",
        nodeEnv: "production"
      })
    ).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: DECISION_SESSION_MAX_AGE_SECONDS
    });
  });

  it.each([
    "http://localhost:3000/lv-vergleich",
    "http://127.0.0.1:3000/lv-vergleich"
  ])("keeps the cookie usable on loopback HTTP: %s", (requestUrl) => {
    expect(
      decisionSessionCookieOptions({ requestUrl, nodeEnv: "production" }).secure
    ).toBe(false);
  });
});

describe("decision display name", () => {
  it.each(["Admin", "Jörg Müller", "Адміністратор", "Оператор Тест"])(
    "accepts Unicode display name %s",
    (name) => {
      expect(DecisionDisplayNameSchema.parse(`  ${name}  `)).toBe(name);
    }
  );

  it.each(["", " ", "A", "--", "🙂"])(
    "rejects a name without two meaningful characters: %s",
    (name) => {
      expect(DecisionDisplayNameSchema.safeParse(name).success).toBe(false);
    }
  );

  it("accepts 100 characters and rejects 101", () => {
    expect(DecisionDisplayNameSchema.safeParse("Ä".repeat(100)).success).toBe(
      true
    );
    expect(DecisionDisplayNameSchema.safeParse("Ä".repeat(101)).success).toBe(
      false
    );
  });
});
