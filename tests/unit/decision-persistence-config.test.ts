import { afterEach, describe, expect, it } from "vitest";
import { decisionPersistenceMode } from "@/services/decision-persistence-config";

const originalMode = process.env.DECISION_PERSISTENCE_MODE;
const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalMode === undefined) delete process.env.DECISION_PERSISTENCE_MODE;
  else process.env.DECISION_PERSISTENCE_MODE = originalMode;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("decision persistence configuration", () => {
  it("refuses implicit mode and central mode without PostgreSQL", () => {
    delete process.env.DECISION_PERSISTENCE_MODE;
    delete process.env.DATABASE_URL;
    expect(() => decisionPersistenceMode()).toThrow(
      "DECISION_PERSISTENCE_MODE must be explicitly set"
    );

    process.env.DECISION_PERSISTENCE_MODE = "CENTRAL_SERVER";
    expect(() => decisionPersistenceMode()).toThrow(
      "DATABASE_URL is required"
    );
  });

  it("allows only explicit legacy mode or configured central mode", () => {
    process.env.DECISION_PERSISTENCE_MODE = "LEGACY_LOCAL";
    delete process.env.DATABASE_URL;
    expect(decisionPersistenceMode()).toBe("LEGACY_LOCAL");

    process.env.DECISION_PERSISTENCE_MODE = "CENTRAL_SERVER";
    process.env.DATABASE_URL = "postgresql://test@127.0.0.1:55432/test";
    expect(decisionPersistenceMode()).toBe("CENTRAL_SERVER");
  });
});
