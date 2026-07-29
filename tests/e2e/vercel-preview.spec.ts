import { expect, test } from "@playwright/test";

test("renders a safe read-only preview without local infrastructure", async ({
  page,
  request
}) => {
  await page.goto("/");

  await expect(page.locator("[data-vercel-preview]")).toContainText(
    "Lokale Projekte und Schreibvorgänge sind deaktiviert"
  );
  await expect(page.locator(".project-card")).toHaveCount(0);

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    status: "ok",
    deploymentMode: "VERCEL_PREVIEW",
    mode: "vercel-preview",
    databaseConfigured: false,
    decisionPersistenceMode: "VERCEL_READ_ONLY"
  });

  const mutation = await request.post("/api/session", {
    data: { displayName: "Preview User" }
  });
  expect(mutation.status()).toBe(503);
  expect(await mutation.json()).toEqual({
    error: "PERSISTENCE_UNAVAILABLE",
    message: "Server persistence is unavailable in preview mode."
  });

  const corpus = await request.get("/api/local/corpus?view=pilot");
  expect(corpus.status()).toBe(503);
  expect(await corpus.json()).toEqual({
    error: "LOCAL_DATA_UNAVAILABLE",
    message: "Local corpus data is unavailable in preview mode."
  });
});
