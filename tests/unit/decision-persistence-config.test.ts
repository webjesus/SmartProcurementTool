import { afterEach, describe, expect, it } from "vitest";
import {
  centralDecisionUiEnabled,
  decisionPersistenceMode
} from "@/services/decision-persistence-config";
import { deploymentMode } from "@/services/deployment-profile";

const originalMode = process.env.DECISION_PERSISTENCE_MODE;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDeploymentMode = process.env.SPT_DEPLOYMENT_MODE;
const originalVercel = process.env.VERCEL;

afterEach(() => {
  if (originalMode === undefined) delete process.env.DECISION_PERSISTENCE_MODE;
  else process.env.DECISION_PERSISTENCE_MODE = originalMode;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalDeploymentMode === undefined) delete process.env.SPT_DEPLOYMENT_MODE;
  else process.env.SPT_DEPLOYMENT_MODE = originalDeploymentMode;
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

describe("decision persistence configuration", () => {
  it("refuses implicit mode and central mode without PostgreSQL", () => {
    process.env.SPT_DEPLOYMENT_MODE = "LOCAL_ON_PREM";
    delete process.env.VERCEL;
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
    process.env.SPT_DEPLOYMENT_MODE = "LOCAL_ON_PREM";
    delete process.env.VERCEL;
    process.env.DECISION_PERSISTENCE_MODE = "LEGACY_LOCAL";
    delete process.env.DATABASE_URL;
    expect(decisionPersistenceMode()).toBe("LEGACY_LOCAL");

    process.env.DECISION_PERSISTENCE_MODE = "CENTRAL_SERVER";
    process.env.DATABASE_URL = "postgresql://test@127.0.0.1:55432/test";
    expect(decisionPersistenceMode()).toBe("CENTRAL_SERVER");
  });

  it("uses an explicit profile before Vercel auto-detection", () => {
    expect(
      deploymentMode({
        SPT_DEPLOYMENT_MODE: "LOCAL_ON_PREM",
        VERCEL: "true"
      })
    ).toBe("LOCAL_ON_PREM");
    expect(deploymentMode({ VERCEL: "1" })).toBe("VERCEL_PREVIEW");
    expect(deploymentMode({})).toBe("LOCAL_ON_PREM");
  });

  it("keeps preview builds independent from persistence secrets", () => {
    const environment = {
      SPT_DEPLOYMENT_MODE: "VERCEL_PREVIEW"
    };
    expect(decisionPersistenceMode(environment)).toBe("VERCEL_READ_ONLY");
    expect(centralDecisionUiEnabled(environment)).toBe(false);
  });

  it("does not silently disable an invalid local central configuration", () => {
    expect(
      centralDecisionUiEnabled({
        SPT_DEPLOYMENT_MODE: "LOCAL_ON_PREM"
      })
    ).toBe(true);
  });
});
