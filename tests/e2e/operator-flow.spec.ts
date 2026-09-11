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

test.describe("synthetic operator flow", () => {
  test.skip(
    realPilot,
    "Synthetic flow is replaced by persisted pilot data in local-corpus mode."
  );

test("from overview to export", async ({ page }, testInfo) => {
  const runtimeFailures = watchRuntimeFailures(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Produktbibliothek" })).toBeVisible();

  await page.goto("/dokumente");
  await expect(page.getByRole("heading", { name: "Projektunterlagen" })).toBeVisible();
  await expect(page.getByText("Basis-LV Heizung.pdf")).toBeVisible();

  await page.goto("/gefundene-daten");
  await expect(page.getByText("Blind extraction aktiv")).toBeVisible();

  await page.goto("/pruefung");
  await expect(page.getByRole("heading", { name: "Quellenbasierte Prüfung" })).toBeVisible();
  await page.getByRole("button", { name: /Zur Quelle/ }).click();
  await expect(page.getByText(/Seite 12 \/ 31/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath(`review-${testInfo.project.name}.png`),
    fullPage: true
  });
  await expect(page.getByRole("button", { name: "Bestätigen" })).toBeVisible();

  await page.goto("/zuordnung");
  await expect(page.getByRole("heading", { name: "Angebot mit Basis-LV verbinden" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bestätigen" }).first()).toBeVisible();

  await page.goto("/lv-vergleich");
  await expect(page).toHaveURL(/\/projects(?:\/|$)/u);
  await expect(page.getByRole("heading", { name: "Projekte" })).toBeVisible();

  await page.goto("/entscheidungen");
  await expect(
    page.getByRole("button", { name: /Lieferant Alpha 2.380,00/ })
  ).toBeVisible();

  await page.goto("/export");
  await expect(page.getByRole("heading", { name: "Prüfergebnis exportieren" })).toBeVisible();
  const exportLink = page.getByRole("link", { name: /XLSX erstellen/ });
  const exportHref = await exportLink.getAttribute("href");
  expect(exportHref).toMatch(/^\/api\/export/u);
  const unavailableExport = await page.request.get(exportHref!);
  expect(unavailableExport.status()).toBe(503);
  await expect(unavailableExport.json()).resolves.toMatchObject({
    error: "LOCAL_DATA_UNAVAILABLE"
  });
  expect(runtimeFailures).toEqual([]);
});
});

test.describe.skip("legacy real pilot operator flow", () => {
  test.skip(
    !realPilot,
    "Requires LOCAL_CORPUS_ENABLED and persisted pilot data."
  );
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "One durable Chromium real-pilot flow is sufficient."
  );

test("persisted review survives reload", async ({ page }, testInfo) => {
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

test("matching and supplier decision survive reload", async ({ page }, testInfo) => {
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
      operator?: string;
      timestamp?: string;
      decidedBy?: string;
      decidedAt?: string;
    }>;
    analysis: {
      basisPositions: Array<{ id: string; positionNumber: string }>;
      supplierOptions: Array<{
        id: string;
        basisPositionIds: string[];
        matchedOfferLineIds: string[];
      }>;
    };
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

  for (const sourceName of ["Zur Basis-Quelle", "Zur Angebotsquelle"]) {
    const source = reviewedRow.getByRole("link", { name: sourceName });
    await expect(source).toHaveAttribute(
      "href",
      /\/evidence\?.*documentRevisionId=.*evidenceId=/
    );
    const [sourcePage] = await Promise.all([
      page.waitForEvent("popup"),
      source.click()
    ]);
    await expect(sourcePage.locator("[data-decision-evidence]")).toBeVisible();
    await expect(sourcePage.locator(".decision-evidence-highlight")).toBeVisible();
    await expect(sourcePage.getByText("Document revision")).toBeVisible();
    await expect(sourcePage.getByText("Region")).toBeVisible();
    await expect(
      sourcePage.getByRole("heading", { name: "Benachbarter Kontext" })
    ).toBeVisible();
    await sourcePage.close();
  }
  await page.screenshot({
    path: testInfo.outputPath("real-zuordnung.png"),
    fullPage: true
  });

  await page.goto("/lv-vergleich");
  await expect(page.locator("[data-real-comparison]")).toBeVisible();
  await expect(page.getByText("Historischer Material EK")).toHaveCount(0);
  await expect(page.locator("[data-comparison-inspector]")).toBeVisible();
  await page.getByRole("button", { name: "Alle" }).first().click();
  await expect(page.locator("[data-real-comparison] tbody tr")).toHaveCount(10);
  await expect(page.getByText(/Alpha|Beta|Gamma/)).toHaveCount(0);
  for (const position of ["2.1.760", "2.1.770", "2.1.780", "2.1.790"]) {
    await expect(
      page
        .locator("[data-real-comparison] tbody tr")
        .filter({ hasText: position })
    ).toContainText("Automatisch ausgewählt");
  }
  await expect(
    page
      .locator("[data-real-comparison] tbody tr")
      .filter({ hasText: "2.1.750" })
  ).toContainText("Technische Systemprüfung erforderlich");
  await page
    .locator("[data-real-comparison] tbody tr")
    .filter({ hasText: "2.1.760" })
    .click();
  await expect(
    page
      .locator("[data-comparison-inspector]")
      .getByText(/Fehlender Pflichtbestandteil: Wärmedämmschale/)
  ).toBeVisible();
  await expect(
    page
      .locator("[data-comparison-inspector]")
      .locator("strong")
      .filter({ hasText: "Preis gefunden: 928,37 €" })
  ).toBeVisible();
  const optionWithEvidence = pilotBeforeMatching.analysis.supplierOptions.find(
    (option) => option.matchedOfferLineIds.length > 0
  );
  const optionBasis = pilotBeforeMatching.analysis.basisPositions.find(
    (position) => optionWithEvidence?.basisPositionIds.includes(position.id)
  );
  expect(optionWithEvidence).toBeDefined();
  expect(optionBasis).toBeDefined();
  await page
    .locator("[data-real-comparison] tbody tr")
    .filter({ hasText: optionBasis?.positionNumber })
    .first()
    .click();
  const comparisonInspector = page.locator("[data-comparison-inspector]");
  await expect(
    comparisonInspector.getByRole("link", {
      name: /Zur Angebotsquelle/
    }).first()
  ).toHaveAttribute("href", /\/evidence\?.*documentRevisionId=.*evidenceId=/);
  const confirmDecision = comparisonInspector.getByRole("button", {
    name: "Supplier decision bestätigen"
  });
  await expect(confirmDecision).toBeDisabled();
  await comparisonInspector
    .locator(`[data-supplier-option-id="${optionWithEvidence?.id}"]`)
    .getByRole("button", { name: "Option zur Entscheidung auswählen" })
    .click();
  await comparisonInspector.locator("select").selectOption("OTHER_REQUIRES_COMMENT");
  await expect(
    comparisonInspector.getByText(/Placeholder/)
  ).toBeVisible();
  await expect(confirmDecision).toBeDisabled();
  await comparisonInspector.locator("textarea").fill("Evidence geprüft");
  await expect(confirmDecision).toBeEnabled();
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

test("manager queue keeps drafts and exports portable review packages", async ({
  page
}, testInfo) => {
  const runtimeFailures = watchRuntimeFailures(page);

  await page.goto("/entscheidungen");
  await expect(page).toHaveURL(/\/lv-vergleich#entscheidungspruefung$/);
  await expect(page.locator(".main-nav a")).toHaveCount(1);
  await expect(
    page.locator('.main-nav a[href="/lv-vergleich"]')
  ).toBeVisible();
  await expect(page.locator("[data-real-comparison]")).toBeVisible();
  const pilot = (await (
    await page.request.get("/api/local/corpus?view=pilot")
  ).json()) as {
    projectReview: { positions: unknown[] };
  };
  await expect(
    page.locator("[data-real-comparison] tbody tr")
  ).toHaveCount(pilot.projectReview.positions.length);
  const counters = page.locator("[data-lv-status-counters] > div strong");
  const counterValues = await counters.allTextContents();
  const total = Number(counterValues[0]);
  const classified = counterValues
    .slice(1)
    .reduce((sum, value) => sum + Number(value), 0);
  expect(classified).toBe(total);
  await expect(page.locator("[data-automatic-decisions]")).toBeVisible();
  const managerQueue = page.locator("[data-manager-queue]");
  await expect(managerQueue).toBeVisible();
  await expect(managerQueue.getByText(/Position \d+ von \d+/)).toBeVisible();
  await expect(
    managerQueue.getByRole("link", { name: "Zur Basis-Quelle" })
  ).toHaveAttribute("href", /\/evidence\?.*documentRevisionId=.*evidenceId=/);
  const comment = managerQueue.getByRole("textbox", {
    name: "Entscheidungsbegründung"
  });
  const draft = `Entwurf ${testInfo.project.name}`;
  await comment.fill(draft);
  await expect(comment).toHaveValue(draft);
  await page.reload();
  await expect(
    page.locator("[data-manager-queue]").getByRole("textbox", {
      name: "Entscheidungsbegründung"
    })
  ).toHaveValue(draft);

  await page.goto("/export");
  const jsonResponse = await page.request.get("/api/review-package?format=json");
  expect(jsonResponse.ok()).toBe(true);
  const reviewPackage = (await jsonResponse.json()) as {
    packageVersion: string;
    sourceDocuments: Array<{ documentRevisionIds: string[] }>;
  };
  expect(reviewPackage.packageVersion).toBe("spt-review-package-v1");
  expect(reviewPackage.sourceDocuments.length).toBeGreaterThan(0);
  expect(
    reviewPackage.sourceDocuments.every(
      (document) => document.documentRevisionIds.length > 0
    )
  ).toBe(true);
  const xlsxResponse = await page.request.get(
    "/api/review-package?format=xlsx"
  );
  expect(xlsxResponse.ok()).toBe(true);
  expect(xlsxResponse.headers()["content-type"]).toContain(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  await page.screenshot({
    path: testInfo.outputPath("real-manager-queue.png"),
    fullPage: true
  });
  expect(runtimeFailures).toEqual([]);
});

test("ProjectRun checkpoints survive pause and resume", async ({ page }, testInfo) => {
  const runtimeFailures = watchRuntimeFailures(page);

  let before = (await (
    await page.request.get("/api/orchestrator")
  ).json()) as {
    checkpoints: unknown[];
    toolCalls: Array<{ cost: { responseId: string | null } }>;
    projectRun: { aiRequests: number; status: string };
  };
  if (before.projectRun.status === "NOT_STARTED") {
    await page.request.post("/api/orchestrator", {
      data: { action: "START" }
    });
    before = (await (
      await page.request.get("/api/orchestrator")
    ).json()) as typeof before;
  }
  const pilotBefore = (await (
    await page.request.get("/api/local/corpus?view=pilot")
  ).json()) as {
    reviewActions: unknown[];
    matchReviewActions: unknown[];
    supplierDecisions: unknown[];
  };

  const paused = await page.request.post("/api/orchestrator", {
    data: { action: "PAUSE", reason: "E2E persistence check" }
  });
  expect(paused.ok()).toBe(true);
  expect(((await paused.json()) as { projectRun: { status: string } }).projectRun.status).toBe("PAUSED");
  const resumed = await page.request.post("/api/orchestrator", {
    data: { action: "RESUME" }
  });
  expect(resumed.ok()).toBe(true);

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
});

test("real pilot comparison uses deterministic supplier evidence", async ({
  page
}) => {
  test.skip(true, "Covered by the componentized LV workspace E2E suite.");
  test.skip(!realPilot, "Requires persisted real-pilot data.");
  const api = await page.request.get("/api/local/corpus?view=pilot");
  expect(api.ok()).toBe(true);
  const liveProject = (await api.json()) as {
    analysis: { basisPositions: Array<{ id: string }> };
    supplierDecisions: Array<{
      id: string;
      status: string;
      basisPositionId: string;
    }>;
    projectReview: {
      positions: Array<{
        basis: { positionNumber: string };
        liveStatus: string;
        reviewQueue?: string | null;
        independent: {
          selectedSupplierOptionId: string | null;
          comparableTotal: number | null;
        };
        options: Array<{
          id: string;
          supplierLabel: string;
          comparableTotal: number | null;
          materialScopeStatus: string;
        }>;
      }>;
      invariant: {
        valid: boolean;
        totalBasisLeafPositions: number;
        lvRows: number;
        statusCount: number;
        duplicatePositionIds: string[];
        orphanDecisionIds: string[];
        orphanSupplierOptionIds: string[];
      };
    };
  };
  expect(liveProject.analysis.basisPositions).toHaveLength(188);
  expect(liveProject.projectReview.positions).toHaveLength(188);
  expect(liveProject.projectReview.invariant).toMatchObject({
    valid: true,
    totalBasisLeafPositions: 188,
    lvRows: 188,
    statusCount: 188,
    duplicatePositionIds: [],
    orphanDecisionIds: [],
    orphanSupplierOptionIds: []
  });
  expect(liveProject.supplierDecisions).toEqual([
    expect.objectContaining({
      id: "069d77cf-3611-4f09-92d1-98fb0e6e4e90",
      status: "DEFERRED"
    })
  ]);
  for (const [positionNumber, expectedStatus, expectedSupplier] of [
    ["1.1.490.", "AUTO_SELECTED_LOWEST_PRICE", "P&M"],
    ["1.1.500.", "AUTO_SELECTED_LOWEST_PRICE", "P&M"],
    ["1.1.510.", "AUTO_SELECTED_LOWEST_PRICE", "P&M"],
    ["1.1.520.", "AUTO_SELECTED_LOWEST_PRICE", "P&M"],
    ["1.1.530.", "MANUAL_DECISION_REQUIRED", null],
    ["1.1.540.", "AUTO_SELECTED_LOWEST_PRICE", "P&M"]
  ] as const) {
    const position = liveProject.projectReview.positions.find(
      (candidate) => candidate.basis.positionNumber === positionNumber
    );
    expect(position?.liveStatus).toBe(expectedStatus);
    const selected = position?.options.find(
      (option) => option.id === position.independent.selectedSupplierOptionId
    );
    expect(selected?.supplierLabel ?? null).toBe(expectedSupplier);
  }
  const quantityCoverage = liveProject.projectReview.positions.find(
    (position) => position.basis.positionNumber === "1.1.520."
  );
  expect(
    quantityCoverage?.options.find(
      (option) => option.supplierLabel === "Reisser"
    )?.materialScopeStatus
  ).toBe("PARTIAL_MATERIAL_SCOPE");
  expect(
    liveProject.projectReview.positions.find(
      (position) => position.basis.positionNumber === "1.1.530."
    )?.reviewQueue
  ).toBe("SYSTEM_REVIEW");
  await page.goto("/lv-vergleich");
  await page.getByRole("button", { name: "Alle" }).first().click();
  await expect(page.getByText("188 von 188 Positionen")).toBeVisible();

  const search = page.getByRole("searchbox", { name: "LV durchsuchen" });
  await search.fill("2.1.820");
  await expect(page.getByText("1 von 188 Positionen")).toBeVisible();
  await expect(
    page.locator("[data-real-comparison] tbody tr")
  ).toHaveCount(1);
  await expect(
    page.locator("[data-real-comparison] tbody tr")
  ).toContainText("Nicht relevant");
  await search.clear();
  await expect(page.getByText("188 von 188 Positionen")).toBeVisible();

  for (const [position, total] of [
    ["2.1.800", "188,31 €"],
    ["2.1.810", "668,32 €"],
    ["2.1.820", "653,46 €"]
  ]) {
    const row = page
      .locator("[data-real-comparison] tbody tr")
      .filter({ hasText: position });
    await expect(row).toContainText("Automatisch ausgewählt");
    await expect(row).toContainText(total);
    await expect(row).toContainText("Quelle verfügbar");
  }
  await expect(
    page.getByText("Angebotsseite 15 noch nicht verarbeitet")
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("button", { name: "Entscheidung durch Leitung" })
      .first()
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Systemprüfung" }).first()
  ).toBeVisible();

  await page
    .locator("[data-real-comparison] tbody tr")
    .filter({ hasText: "2.1.820" })
    .click();
  const inspector = page.locator("[data-comparison-inspector]");
  await expect(inspector).toContainText("MANDATORY_COMPONENT");
  await expect(inspector).toContainText("OPTIONAL");
  await expect(inspector).toContainText("EAAL");
  await expect(inspector).toContainText("Vergleich 653,46 €");
  await expect(inspector).toContainText("Optional 14,63 €");
  const page15Links = inspector.getByRole("link", {
    name: "Zur Angebotsquelle · S. 15"
  });
  await expect(page15Links).toHaveCount(3);
  await expect(page15Links.first()).toBeVisible();
  await expect(
    inspector.getByRole("link", { name: "Zur Angebotsquelle · S. 12" })
  ).toBeVisible();
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
  await expect(
    page.getByRole("heading", {
      name: "Produktbibliothek"
    })
  ).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  await page.screenshot({
    path: testInfo.outputPath(`overview-mobile-${testInfo.project.name}.png`),
    fullPage: !realPilot && testInfo.project.name !== "mobile"
  });
  expect(runtimeFailures).toEqual([]);
});
