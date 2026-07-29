import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test";
import ExcelJS from "exceljs";

const centralE2e = process.env.SPT_CENTRAL_E2E === "true";
const positionNumber = "1.1.530.";
const draftA =
  "Gerät A prüft die exakten Bundle-Zeilen und speichert diesen Server-Entwurf.";
const finalB =
  "Gerät B ergänzt die Begründung, prüft Option und Bundle und speichert die finale Entscheidung.";
const conflictA =
  "Gerät A speichert die neueste Fassung; diese Eingabe muss bei einem Konflikt erhalten bleiben.";
const conflictB =
  "Gerät B arbeitet gleichzeitig mit einer alten Version; diese Eingabe darf nicht still überschreiben.";

async function login(context: BrowserContext, name: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/lv-vergleich", { waitUntil: "domcontentloaded" });
  const login = page.locator(".decision-login");
  await expect(login).toBeVisible();
  await login.getByPlaceholder("Vor- und Nachname").fill(name);
  await login.getByRole("button", { name: "Weiter" }).click();
  await expect(page.locator("[data-real-lv-workspace]")).toBeVisible({
    timeout: 90_000
  });
  return page;
}

async function openDecision(page: Page) {
  await page.locator(`[data-lv-position="${positionNumber}"]`).click();
  const inspector = page.locator("[data-position-inspector]");
  await expect(inspector).toBeVisible();
  await inspector.getByRole("tab", { name: "Entscheidung" }).click();
  await expect(inspector.locator("[data-decision-form]")).toBeVisible();
  return inspector;
}

async function chooseFirstExactBundle(page: Page) {
  const inspector = page.locator("[data-position-inspector]");
  await inspector.getByRole("tab", { name: "Angebote" }).click();
  const option = inspector.locator(".lv-supplier-panel").filter({
    has: page.getByRole("button", { name: "Diese Option auswählen" })
  }).first();
  await option.getByRole("button", { name: "Diese Option auswählen" }).click();
  const selectedLines = option.locator('input[type="checkbox"]:checked');
  expect(await selectedLines.count()).toBeGreaterThan(0);
  await inspector.getByRole("tab", { name: "Entscheidung" }).click();
}

async function newContexts(browser: Browser) {
  return {
    contextA: await browser.newContext(),
    contextB: await browser.newContext()
  };
}

async function decisionMetadata(page: Page) {
  const response = await page.request.get("/api/local/corpus?view=pilot");
  expect(response.ok()).toBe(true);
  const pilot = await response.json();
  const position = pilot.projectReview.positions.find(
    (candidate: { basis: { positionNumber: string } }) =>
      candidate.basis.positionNumber === positionNumber
  );
  expect(position).toBeTruthy();
  return {
    projectId: pilot.projectReview.projectId as string,
    analysisVersionId: pilot.projectReview.analysisVersionId as string,
    positionId: position.basis.id as string
  };
}

async function waitForServerDraft(page: Page, expectedComment: string) {
  const metadata = await decisionMetadata(page);
  await expect
    .poll(async () => {
      const query = new URLSearchParams({
        analysisVersionId: metadata.analysisVersionId
      });
      const response = await page.request.get(
        `/api/projects/${encodeURIComponent(
          metadata.projectId
        )}/positions/${encodeURIComponent(
          metadata.positionId
        )}/draft?${query.toString()}`
      );
      if (!response.ok()) return null;
      const payload = await response.json();
      return payload.draft?.comment ?? null;
    }, { timeout: 30_000 })
    .toBe(expectedComment);
  const query = new URLSearchParams({
    analysisVersionId: metadata.analysisVersionId
  });
  const response = await page.request.get(
    `/api/projects/${encodeURIComponent(
      metadata.projectId
    )}/positions/${encodeURIComponent(
      metadata.positionId
    )}/draft?${query.toString()}`
  );
  return (await response.json()).draft as {
    version: number;
    updatedByDisplayName: string;
    updatedAt: string;
    selectedBundleLineIds: string[];
  };
}

test.describe.serial("central PostgreSQL decision synchronization", () => {
  test.skip(!centralE2e, "Requires a migrated real PostgreSQL test database.");

  test("synchronizes a draft across two contexts and finalizes it", async ({
    browser
  }, testInfo) => {
    test.setTimeout(180_000);
    const { contextA, contextB } = await newContexts(browser);
    try {
      const pageA = await login(contextA, "Central Gerät A");
      const inspectorA = await openDecision(pageA);
      await chooseFirstExactBundle(pageA);
      await inspectorA
        .locator("select")
        .selectOption("OTHER_REQUIRES_COMMENT");
      await inspectorA.locator("textarea").fill(draftA);
      const savedA = await waitForServerDraft(pageA, draftA);
      await expect(inspectorA.locator(".lv-draft-state")).toContainText(
        "Entwurf gespeichert",
        { timeout: 30_000 }
      );
      await expect(inspectorA.locator(".lv-draft-state")).toContainText(
        "Central Gerät A"
      );
      await expect(inspectorA.locator(".lv-draft-state")).toContainText(
        `Version ${savedA.version}`
      );
      expect(savedA.updatedByDisplayName).toBe("Central Gerät A");
      expect(savedA.selectedBundleLineIds.length).toBeGreaterThan(0);
      await inspectorA.locator(".lv-draft-state").scrollIntoViewIfNeeded();
      await pageA.screenshot({
        path: testInfo.outputPath("server-draft-context-a.png")
      });

      const pageB = await login(contextB, "Central Gerät B");
      const inspectorB = await openDecision(pageB);
      await expect(inspectorB.locator("textarea")).toHaveValue(draftA, {
        timeout: 30_000
      });
      await expect(inspectorB.locator(".lv-draft-state")).toContainText(
        "Central Gerät A"
      );
      await expect(inspectorB.locator(".lv-draft-state")).toContainText(
        "Zuletzt gespeichert"
      );
      await expect(inspectorB.locator(".lv-draft-state")).toContainText(
        `Version ${savedA.version}`
      );
      await inspectorB.locator(".lv-draft-state").scrollIntoViewIfNeeded();
      await pageB.screenshot({
        path: testInfo.outputPath("same-draft-context-b.png")
      });

      await inspectorB.locator("textarea").fill(finalB);
      const savedB = await waitForServerDraft(pageB, finalB);
      await expect(inspectorB.locator(".lv-draft-state")).toContainText(
        "Entwurf gespeichert",
        { timeout: 30_000 }
      );
      await expect(inspectorB.locator(".lv-draft-state")).toContainText(
        `Version ${savedB.version}`
      );
      expect(savedB.version).toBe(savedA.version + 1);
      expect(savedB.updatedByDisplayName).toBe("Central Gerät B");
      await inspectorB
        .getByRole("button", { name: "Speichern und weiter" })
        .click();
      await expect(inspectorB.locator(".action-error")).toHaveCount(0);

      await pageA.reload({ waitUntil: "domcontentloaded" });
      await expect(pageA.locator("[data-real-lv-workspace]")).toBeVisible();
      const rowA = pageA.locator(`[data-lv-position="${positionNumber}"]`);
      await expect(rowA).toContainText("Begründung vorhanden", {
        timeout: 30_000
      });
      await rowA.dispatchEvent("click");
      const reloadedInspectorA = pageA.locator("[data-position-inspector]");
      await reloadedInspectorA.getByRole("tab", { name: "Historie" }).click();
      await expect(reloadedInspectorA.locator("[data-decision-history]"))
        .toContainText(finalB);
      await expect(reloadedInspectorA.locator("[data-decision-history]"))
        .toContainText("Central Gerät B");
      await expect(reloadedInspectorA.locator("[data-decision-history]"))
        .toContainText("Version 1");
      await pageA.screenshot({
        path: testInfo.outputPath("final-decision-context-a-after-reload.png")
      });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("returns 409 and shows conflict UI without overwriting device A", async ({
    browser
  }, testInfo) => {
    test.setTimeout(180_000);
    const { contextA, contextB } = await newContexts(browser);
    try {
      const pageA = await login(contextA, "Conflict Gerät A");
      const pageB = await login(contextB, "Conflict Gerät B");
      const inspectorA = await openDecision(pageA);
      const inspectorB = await openDecision(pageB);

      let releaseB!: () => void;
      const allowB = new Promise<void>((resolve) => {
        releaseB = resolve;
      });
      let interceptedB!: () => void;
      const requestSeen = new Promise<void>((resolve) => {
        interceptedB = resolve;
      });
      await pageB.route("**/draft", async (route) => {
        if (route.request().method() !== "PUT") {
          await route.continue();
          return;
        }
        interceptedB();
        await allowB;
        await route.continue();
      });

      await inspectorB.locator("textarea").fill(conflictB);
      await requestSeen;
      await inspectorA.locator("textarea").fill(conflictA);
      const savedA = await waitForServerDraft(pageA, conflictA);
      await expect(inspectorA.locator(".lv-draft-state")).toContainText(
        "Entwurf gespeichert",
        { timeout: 30_000 }
      );
      expect(savedA.updatedByDisplayName).toBe("Conflict Gerät A");
      releaseB();

      const notice = inspectorB.locator(".lv-decision-sync-notice");
      await expect(notice).toContainText(
        "Diese Position wurde auf einem anderen Gerät geändert",
        { timeout: 30_000 }
      );
      await expect(
        notice.getByRole("button", { name: "Neueste Version laden" })
      ).toBeVisible();
      await expect(
        notice.getByRole("button", { name: "Meine Eingabe lokal behalten" })
      ).toBeVisible();
      await expect(
        notice.getByRole("button", { name: "Änderungen vergleichen" })
      ).toBeVisible();
      await pageB.screenshot({
        path: testInfo.outputPath("optimistic-conflict-context-b.png")
      });

      await notice
        .getByRole("button", { name: "Neueste Version laden" })
        .click();
      await expect(inspectorB.locator("textarea")).toHaveValue(conflictA);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("exports server decisions and drafts and imports duplicates safely", async ({
    request
  }) => {
    const json = await request.get("/api/review-package?format=json");
    expect(json.ok()).toBe(true);
    const reviewPackage = await json.json();
    expect(reviewPackage.centralServer.mode).toBe("CENTRAL_SERVER");
    expect(reviewPackage.centralServer.decisions.length).toBeGreaterThan(0);
    expect(reviewPackage.centralServer.drafts.length).toBeGreaterThan(0);
    expect(
      reviewPackage.centralServer.decisions.some(
        (decision: { comment: string; decidedByDisplayName: string }) =>
          decision.comment === finalB &&
          decision.decidedByDisplayName === "Central Gerät B"
      )
    ).toBe(true);
    expect(
      reviewPackage.centralServer.drafts.some(
        (draft: { comment: string; version: number }) =>
          draft.comment === conflictA && draft.version >= 1
      )
    ).toBe(true);

    const excel = await request.get("/api/review-package?format=xlsx");
    expect(excel.ok()).toBe(true);
    const excelBody = await excel.body();
    expect(excelBody.byteLength).toBeGreaterThan(10_000);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excelBody as unknown as ArrayBuffer);
    expect(workbook.getWorksheet("Entscheidungshistorie")?.rowCount)
      .toBeGreaterThan(1);
    expect(workbook.getWorksheet("Aktive Entwürfe")?.rowCount)
      .toBeGreaterThan(1);

    const imported = await request.post("/api/review-package", {
      data: reviewPackage
    });
    expect(imported.status()).toBe(201);
    const report = await imported.json();
    expect(report.merge.applied).toBe(true);
    expect(report.merge.inserted).toEqual({
      users: 0,
      drafts: 0,
      decisions: 0,
      events: 0
    });
    expect(report.merge.duplicates.length).toBeGreaterThan(0);

    const conflictingPackage = structuredClone(reviewPackage);
    conflictingPackage.centralServer.drafts[0].comment =
      "Konfliktierende portable Fassung darf den Server nicht überschreiben.";
    const conflict = await request.post("/api/review-package", {
      data: conflictingPackage
    });
    expect(conflict.status()).toBe(409);
    const conflictReport = await conflict.json();
    expect(conflictReport.merge.applied).toBe(false);
    expect(conflictReport.merge.conflicts).toContain(
      `draft:${reviewPackage.centralServer.drafts[0].positionId}:active-version`
    );

    const afterConflict = await (
      await request.get("/api/review-package?format=json")
    ).json();
    expect(afterConflict.centralServer.drafts[0].comment).toBe(
      reviewPackage.centralServer.drafts[0].comment
    );
  });
});

test.describe("central persistence after application restart", () => {
  test.skip(
    process.env.SPT_CENTRAL_RESTART_VERIFY !== "true",
    "Run after fully restarting the application."
  );

  test("retains final decision, active draft, author and history", async ({
    browser
  }, testInfo) => {
    const context = await browser.newContext();
    try {
      const page = await login(context, "Restart Prüfer");
      const row = page.locator(`[data-lv-position="${positionNumber}"]`);
      await expect(row).toContainText("Begründung vorhanden");
      await expect(row).toContainText("Entwurf vorhanden");
      await row.click();
      const inspector = page.locator("[data-position-inspector]");
      await inspector.getByRole("tab", { name: "Entscheidung" }).click();
      await expect(inspector.locator("textarea")).toHaveValue(conflictA);
      await expect(inspector.locator(".lv-draft-state")).toContainText(
        "Conflict Gerät A"
      );
      await inspector.getByRole("tab", { name: "Historie" }).click();
      await expect(inspector.locator("[data-decision-history]")).toContainText(
        finalB
      );
      await expect(inspector.locator("[data-decision-history]")).toContainText(
        "Central Gerät B"
      );
      await page.screenshot({
        path: testInfo.outputPath("decision-history-after-server-restart.png")
      });
    } finally {
      await context.close();
    }
  });
});
