import { expect, test } from "@playwright/test";

const realPilot = process.env.SPT_REAL_PILOT === "true";

function watchRuntimeFailures(page: import("@playwright/test").Page) {
  const failures: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    // WebKit reports cancelled cross-navigation Next.js RSC prefetches as page
    // errors even though the response is not used and the destination renders.
    if (error.message.includes("due to access control checks")) return;
    failures.push(`pageerror: ${error.message}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      failures.push(`http ${response.status()}: ${response.url()}`);
    }
  });

  return failures;
}

test("synthetic operator flow from overview to export", async ({ page }, testInfo) => {
  test.skip(realPilot, "Synthetic flow is replaced by persisted pilot data in local-corpus mode.");
  const runtimeFailures = watchRuntimeFailures(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projekt Nordtor" })).toBeVisible();
  await expect(page.getByText("Smart Procurement", { exact: true })).toBeVisible();

  await page.locator('.main-nav a[href="/dokumente"]').click();
  await expect(page.getByRole("heading", { name: "Projektunterlagen" })).toBeVisible();
  await expect(page.getByText("Basis-LV Heizung.pdf")).toBeVisible();

  await page.locator('.main-nav a[href="/gefundene-daten"]').click();
  await expect(page.getByText("Blind extraction aktiv")).toBeVisible();

  await page.locator('.main-nav a[href="/pruefung"]').click();
  await expect(page.getByRole("heading", { name: "Quellenbasierte Prüfung" })).toBeVisible();
  await page.getByRole("button", { name: /Zur Quelle/ }).click();
  await expect(page.getByText(/Seite 12 \/ 31/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath(`review-${testInfo.project.name}.png`),
    fullPage: true
  });
  await page.getByRole("button", { name: "Bestätigen" }).click();

  await page.locator('.main-nav a[href="/zuordnung"]').click();
  await expect(page.getByRole("heading", { name: "Angebot mit Basis-LV verbinden" })).toBeVisible();
  await page.getByRole("button", { name: "Bestätigen" }).first().click();

  await page.locator('.main-nav a[href="/lv-vergleich"]').click();
  await expect(page.getByRole("heading", { name: "Belastbarer Angebotsvergleich" })).toBeVisible();
  await page.getByText("2.3.10", { exact: true }).first().click();

  await page.locator('.main-nav a[href="/entscheidungen"]').click();
  await page.getByRole("button", { name: /Lieferant Alpha 2.380,00/ }).click();

  await page.locator('.main-nav a[href="/export"]').click();
  await expect(page.getByRole("heading", { name: "Prüfergebnis exportieren" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /XLSX erstellen/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("SPT-LV-Vergleich.xlsx");
  expect(runtimeFailures).toEqual([]);
});

test("persisted real pilot review survives reload", async ({ page }, testInfo) => {
  test.skip(!realPilot, "Requires LOCAL_CORPUS_ENABLED and persisted pilot runs.");
  test.skip(testInfo.project.name !== "chromium", "One durable operator write is sufficient.");
  const runtimeFailures = watchRuntimeFailures(page);

  await page.goto("/gefundene-daten");
  const firstRealRow = page.locator("[data-pilot-line]").first();
  await expect(firstRealRow).toBeVisible();
  const firstLineId = await firstRealRow.getAttribute("data-pilot-line");
  const pilotBeforeReview = (await (
    await page.request.get("/api/local/corpus?view=pilot")
  ).json()) as {
    reviewActions: Array<{ lineId?: string }>;
  };
  const existingReview = pilotBeforeReview.reviewActions.some(
    (action) => action.lineId === firstLineId
  );
  await page.screenshot({
    path: testInfo.outputPath("real-gefundene-daten.png"),
    fullPage: true
  });

  await page.goto("/pruefung");
  await expect(page.locator("[data-pilot-review]")).toBeVisible();
  await expect(page.locator(".real-page-frame img")).toBeVisible();
  await expect(page.locator(".real-evidence-highlight")).toBeVisible();
  await page.getByRole("button", { name: /Zur Quelle/ }).click();
  await expect(page.getByText(/Seite 25 \/ 56/)).toBeVisible();

  const correction = page.getByLabel("Korrekturwert");
  let persistedValue = await correction.inputValue();
  if (!existingReview) {
    await correction.fill("Operator geprüft");
    await page.getByRole("button", { name: "Korrigieren" }).click();
    await expect(correction).toHaveValue("Operator geprüft");
    persistedValue = "Operator geprüft";
  }
  await page.reload();
  await expect(page.getByLabel("Korrekturwert")).toHaveValue(persistedValue);
  await expect(page.getByText(/HUMAN_CORRECTED|HUMAN_CONFIRMED/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("real-pruefung-corrected.png"),
    fullPage: true
  });

  await page.goto("/gefundene-daten");
  await expect(page.getByText("Operator geprüft")).toBeVisible();
  expect(runtimeFailures).toEqual([]);
});

test("real pilot matching and supplier decision survive reload", async ({ page }, testInfo) => {
  test.skip(!realPilot, "Requires LOCAL_CORPUS_ENABLED and persisted pilot analysis.");
  test.skip(testInfo.project.name !== "chromium", "One durable real-pilot flow is sufficient.");
  const runtimeFailures = watchRuntimeFailures(page);

  await page.goto("/zuordnung");
  await expect(page.locator("[data-real-matching]")).toBeVisible();
  await expect(page.locator("[data-matching-inspector]")).toBeVisible();
  const pilotBeforeMatching = (await (
    await page.request.get("/api/local/corpus?view=pilot")
  ).json()) as {
    matchReviewActions: unknown[];
    supplierDecisions: Array<{
      id: string;
      basisPositionId: string;
      supplierDocumentId: string | null;
      status: "SELECTED" | "DEFERRED";
      comment: string;
      operator: string;
      timestamp: string;
    }>;
    analysis: { basisPositions: Array<{ id: string }> };
  };
  const firstRow = page.locator("[data-real-matching] tbody tr").first();
  let reviewedRow = firstRow;
  if (pilotBeforeMatching.matchReviewActions.length > 0) {
    reviewedRow = page
      .locator("[data-real-matching] tbody tr")
      .filter({ hasText: "HUMAN CONFIRMED" })
      .first();
    await expect(reviewedRow).toBeVisible();
  } else {
    await reviewedRow.click();
    const confirm = reviewedRow.getByRole("button", { name: /Bestätigen/ });
    if (await confirm.isEnabled()) await confirm.click();
    await expect(
      reviewedRow.getByText(/HUMAN(?:_| )CONFIRMED|EXACT/).first()
    ).toBeVisible();
  }

  for (const sourceName of ["Zur Quelle Basis", "Zur Quelle Supplier"]) {
    const source = reviewedRow.getByRole("link", { name: sourceName });
    await expect(source).toHaveAttribute("href", /api\/local\/corpus\?asset=/);
    const [sourcePage] = await Promise.all([
      page.waitForEvent("popup"),
      source.click()
    ]);
    await expect(sourcePage.locator("body")).toBeVisible();
    await sourcePage.close();
  }
  await page.screenshot({
    path: testInfo.outputPath("real-zuordnung.png"),
    fullPage: true
  });

  await page.goto("/lv-vergleich");
  await expect(page.locator("[data-real-comparison]")).toBeVisible();
  await expect(page.locator("[data-comparison-inspector]")).toBeVisible();
  await page.getByRole("button", { name: "Nicht zugeordnet" }).click();
  await page.getByRole("button", { name: "Alle" }).click();
  const firstBasisPositionId = pilotBeforeMatching.analysis.basisPositions[0]?.id;
  const existingDecision = pilotBeforeMatching.supplierDecisions.find(
    (decision) => decision.basisPositionId === firstBasisPositionId
  );
  expect(existingDecision).toBeDefined();
  await page.reload();
  const pilotAfterReload = (await (
    await page.request.get("/api/local/corpus?view=pilot")
  ).json()) as {
    supplierDecisions: typeof pilotBeforeMatching.supplierDecisions;
  };
  expect(
    pilotAfterReload.supplierDecisions.find(
      (decision) => decision.basisPositionId === firstBasisPositionId
    )
  ).toEqual(existingDecision);
  await page.screenshot({
    path: testInfo.outputPath("real-lv-vergleich.png"),
    fullPage: true
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/lv-vergleich");
  await expect(page.locator("[data-comparison-inspector]")).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  await page.screenshot({
    path: testInfo.outputPath("real-lv-vergleich-mobile.png"),
    fullPage: true
  });
  expect(runtimeFailures).toEqual([]);
});

test("real ProjectRun checkpoints survive pause and resume", async ({ page }, testInfo) => {
  test.skip(!realPilot, "Requires LOCAL_CORPUS_ENABLED and persisted pilot runs.");
  test.skip(testInfo.project.name !== "chromium", "One durable orchestrator flow is sufficient.");
  const runtimeFailures = watchRuntimeFailures(page);

  await page.goto("/");
  const panel = page.locator("[data-processing-panel]");
  await expect(panel).toBeVisible();
  if ((await panel.getAttribute("data-run-status")) === "NOT_STARTED") {
    await panel.getByRole("button", { name: "Verarbeitung fortsetzen" }).click();
  }
  await expect(panel).toHaveAttribute("data-run-status", "WAITING_FOR_OPERATOR");
  await expect(panel.getByText("Wartet auf Entscheidung")).toBeVisible();
  await expect(panel.getByText(/AI requests\s*0/)).toBeVisible();

  const before = (await (
    await page.request.get("/api/orchestrator")
  ).json()) as {
    checkpoints: unknown[];
    toolCalls: Array<{ cost: { responseId: string | null } }>;
    projectRun: { aiRequests: number };
  };
  const pilotBefore = (await (
    await page.request.get("/api/local/corpus?view=pilot")
  ).json()) as {
    reviewActions: unknown[];
    matchReviewActions: unknown[];
    supplierDecisions: unknown[];
  };

  await panel.getByRole("button", { name: "Pausieren" }).click();
  await expect(panel).toHaveAttribute("data-run-status", "PAUSED");
  await page.reload();
  await expect(panel).toHaveAttribute("data-run-status", "PAUSED");
  await panel.getByRole("button", { name: "Verarbeitung fortsetzen" }).click();
  await expect(panel).toHaveAttribute("data-run-status", "WAITING_FOR_OPERATOR");

  const after = (await (
    await page.request.get("/api/orchestrator")
  ).json()) as typeof before;
  const pilotAfter = (await (
    await page.request.get("/api/local/corpus?view=pilot")
  ).json()) as typeof pilotBefore;
  expect(after.checkpoints).toHaveLength(before.checkpoints.length);
  expect(after.projectRun.aiRequests).toBe(0);
  expect(
    after.toolCalls.map((call) => call.cost.responseId).filter(Boolean)
  ).toEqual(before.toolCalls.map((call) => call.cost.responseId).filter(Boolean));
  expect(pilotAfter.reviewActions).toEqual(pilotBefore.reviewActions);
  expect(pilotAfter.matchReviewActions).toEqual(pilotBefore.matchReviewActions);
  expect(pilotAfter.supplierDecisions).toEqual(pilotBefore.supplierDecisions);
  await page.screenshot({
    path: testInfo.outputPath("real-verarbeitung.png"),
    fullPage: true
  });
  expect(runtimeFailures).toEqual([]);
});

test("all primary pages render at desktop and mobile widths", async ({ page }, testInfo) => {
  const runtimeFailures = watchRuntimeFailures(page);
  if (testInfo.project.name === "chromium") {
    for (const route of [
      "/",
      "/dokumente",
      "/gefundene-daten",
      "/pruefung",
      "/zuordnung",
      "/lv-vergleich",
      "/entscheidungen",
      "/export"
    ]) {
      await page.goto(route);
      await expect(page.locator("h1")).toBeVisible();
    }
  }
  await page.goto("/");
  await page.screenshot({
    path: testInfo.outputPath(`overview-${testInfo.project.name}.png`),
    fullPage: true
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projekt Nordtor" })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  await page.screenshot({
    path: testInfo.outputPath(`overview-mobile-${testInfo.project.name}.png`),
    fullPage: true
  });
  expect(runtimeFailures).toEqual([]);
});
