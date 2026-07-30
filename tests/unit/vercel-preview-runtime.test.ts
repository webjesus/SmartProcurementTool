import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalPilotPersistence } from "@/storage/document-storage";

const originalEnvironment = {
  deploymentMode: process.env.SPT_DEPLOYMENT_MODE,
  vercel: process.env.VERCEL,
  decisionMode: process.env.DECISION_PERSISTENCE_MODE,
  databaseUrl: process.env.DATABASE_URL,
  localCorpusEnabled: process.env.LOCAL_CORPUS_ENABLED
};

function restore(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("SPT_DEPLOYMENT_MODE", originalEnvironment.deploymentMode);
  restore("VERCEL", originalEnvironment.vercel);
  restore("DECISION_PERSISTENCE_MODE", originalEnvironment.decisionMode);
  restore("DATABASE_URL", originalEnvironment.databaseUrl);
  restore("LOCAL_CORPUS_ENABLED", originalEnvironment.localCorpusEnabled);
  vi.restoreAllMocks();
});

describe("Vercel preview runtime isolation", () => {
  it("imports the root layout without persistence configuration", async () => {
    process.env.SPT_DEPLOYMENT_MODE = "VERCEL_PREVIEW";
    delete process.env.DECISION_PERSISTENCE_MODE;
    delete process.env.DATABASE_URL;

    const layout = await import("@/app/layout");

    expect(layout.default).toBeTypeOf("function");
  });

  it("returns a safe empty project list without reading pilot data", async () => {
    process.env.SPT_DEPLOYMENT_MODE = "VERCEL_PREVIEW";
    process.env.LOCAL_CORPUS_ENABLED = "true";
    delete process.env.DATABASE_URL;
    const read = vi.spyOn(LocalPilotPersistence.prototype, "read");
    const { GET } = await import("@/app/api/projects/route");

    const response = await GET(new Request("https://preview.test/api/projects"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      projects: [],
      deploymentMode: "VERCEL_PREVIEW",
      readOnly: true
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("does not read .data or pdffirma in the preview corpus route", async () => {
    process.env.SPT_DEPLOYMENT_MODE = "VERCEL_PREVIEW";
    process.env.LOCAL_CORPUS_ENABLED = "true";
    const read = vi.spyOn(LocalPilotPersistence.prototype, "read");
    const { GET } = await import("@/app/api/local/corpus/route");

    const response = await GET(
      new Request(
        "https://preview.test/api/local/corpus?documentId=private&documentRevisionId=private"
      )
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "LOCAL_DATA_UNAVAILABLE",
      message: "Server-local corpus data is unavailable in browser-local mode."
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("does not initialize PostgreSQL and disables preview mutations", async () => {
    process.env.SPT_DEPLOYMENT_MODE = "VERCEL_PREVIEW";
    delete process.env.DECISION_PERSISTENCE_MODE;
    delete process.env.DATABASE_URL;
    const { POST } = await import("@/app/api/session/route");

    const response = await POST(
      new Request("https://preview.test/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Preview User" })
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "PERSISTENCE_UNAVAILABLE",
      message: "Server persistence is unavailable in browser-local mode."
    });
  });

  it("reports missing LOCAL_ON_PREM persistence mode at request time", async () => {
    process.env.SPT_DEPLOYMENT_MODE = "LOCAL_ON_PREM";
    delete process.env.VERCEL;
    delete process.env.DECISION_PERSISTENCE_MODE;
    delete process.env.DATABASE_URL;
    const { GET } = await import("@/app/api/session/route");

    const response = await GET(new Request("http://localhost/api/session"));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      error: "PERSISTENCE_CONFIGURATION_INVALID"
    });
    expect(payload.message).toContain(
      "DECISION_PERSISTENCE_MODE must be explicitly set"
    );
  });

  it("reports missing LOCAL_ON_PREM DATABASE_URL at request time", async () => {
    process.env.SPT_DEPLOYMENT_MODE = "LOCAL_ON_PREM";
    delete process.env.VERCEL;
    process.env.DECISION_PERSISTENCE_MODE = "CENTRAL_SERVER";
    delete process.env.DATABASE_URL;
    const { GET } = await import("@/app/api/session/route");

    const response = await GET(new Request("http://localhost/api/session"));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      error: "PERSISTENCE_CONFIGURATION_INVALID"
    });
    expect(payload.message).toContain("DATABASE_URL is required");
  });
});
