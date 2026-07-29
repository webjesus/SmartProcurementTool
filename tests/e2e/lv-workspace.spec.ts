import { expect, test, type Page } from "@playwright/test";

const realPilot = process.env.SPT_REAL_PILOT === "true";

function runtimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      failures.push(`http ${response.status()}: ${response.url()}`);
    }
  });
  return failures;
}

async function openWorkspace(page: Page) {
  await page.goto("/lv-vergleich", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-real-lv-workspace]")).toBeVisible({
    timeout: 90_000
  });
}

async function renderedCanvas(page: Page) {
  const canvas = page.locator("[data-source-overlay] canvas");
  await expect(page.locator("[data-evidence-region]").first()).toBeVisible({
    timeout: 90_000
  });
  return canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const context = canvasElement.getContext("2d");
    if (!context) return { width: 0, height: 0, nonWhite: 0 };
    const pixels = context.getImageData(
      0,
      0,
      canvasElement.width,
      canvasElement.height
    ).data;
    let nonWhite = 0;
    for (let index = 0; index < pixels.length; index += 400) {
      if (
        pixels[index] < 246 ||
        pixels[index + 1] < 246 ||
        pixels[index + 2] < 246
      ) {
        nonWhite += 1;
      }
    }
    return {
      width: canvasElement.width,
      height: canvasElement.height,
      nonWhite
    };
  });
}

test.describe("componentized real LV workspace", () => {
  test.skip(!realPilot, "Requires LOCAL_CORPUS_ENABLED and persisted real data.");

  test("renders 188 compact rows without synthetic or internal UI", async ({
    page
  }, testInfo) => {
    const failures = runtimeFailures(page);
    await openWorkspace(page);
    await expect(
      page.getByRole("heading", { name: "Heizung LV-Vergleich" })
    ).toBeVisible();
    await expect(page.locator("[data-lv-position]")).toHaveCount(188);
    await expect(page.getByText("Projekt Nordtor")).toHaveCount(0);
    await expect(page.getByText(/Supplier Alpha|Supplier Beta|Supplier Gamma/)).toHaveCount(0);
    await expect(page.getByText("Unique lowest fully comparable")).toHaveCount(0);
    await expect(page.getByText("Technische Systemprüfung erforderlich")).toHaveCount(0);
    await expect(page.locator("[data-position-inspector]")).toHaveCount(0);
    await expect(page.locator(".lv-description-cell span").first()).toHaveCSS(
      "-webkit-line-clamp",
      "3"
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("lv-workspace-1920x1080.png"),
      fullPage: true
    });
    expect(failures).toEqual([]);
  });

  test("presents readable LV requirements without changing the raw extraction", async ({
    page
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openWorkspace(page);

    await page.locator('[data-lv-position="1.1.30."]').click();
    let inspector = page.locator("[data-position-inspector]");
    await expect(inspector).toBeVisible();
    const inspectorBox = await inspector.boundingBox();
    expect(inspectorBox?.width).toBeGreaterThanOrEqual(860);
    expect(inspectorBox?.width).toBeLessThanOrEqual(1040);
    await expect(inspector.getByRole("heading", { name: "Kurzbeschreibung" }))
      .toBeVisible();
    await expect(inspector.getByText("Montage- und Ausführungsanforderungen"))
      .toBeVisible();
    await expect(inspector.getByText(/Position \d+ von 122 offenen Entscheidungen/))
      .toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("position-inspector-1.1.30.png")
    });
    await inspector.getByRole("button", { name: "Inspector schließen" }).click();

    await page.locator('[data-lv-position="1.1.100."]').click();
    inspector = page.locator("[data-position-inspector]");
    await expect(inspector).toBeVisible();
    await expect(
      inspector.getByRole("rowheader", { name: "Nenninhalt gesamt gerundet" })
    ).toBeVisible();
    await expect(
      inspector.getByRole("rowheader", { name: "Inhalt Heizwasser" })
    ).toBeVisible();
    await expect(
      inspector.getByRole("rowheader", { name: "Speichervolumen" })
    ).toBeVisible();
    await expect(
      inspector.getByRole("rowheader", { name: "Max. Betriebstemperatur" })
    ).toBeVisible();
    await expect(
      inspector.getByRole("rowheader", { name: "- Max. Betriebstemperatur" })
    ).toHaveCount(0);
    await inspector.getByText("Originaltext anzeigen").click();
    await expect(inspector.locator("[data-raw-extraction-text]")).toContainText(
      "Energiespeicher Energiespeicher"
    );
    const title = inspector.locator("header h2");
    await expect(title).toHaveCSS("-webkit-line-clamp", "3");
    const expand = inspector.getByRole("button", {
      name: "Vollständigen Titel anzeigen"
    });
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(title).toHaveClass(/expanded/);
    await page.screenshot({
      path: testInfo.outputPath("position-inspector-1.1.100.png")
    });
  });

  test("keeps queue navigation, URL and selected table row synchronized", async ({
    page
  }) => {
    await openWorkspace(page);
    await page.locator('[data-lv-position="1.1.30."]').click();
    const inspector = page.locator("[data-position-inspector]");
    await expect(inspector).toBeVisible();
    await expect(page.locator('[data-lv-position="1.1.30."]')).toHaveClass(
      /active/
    );
    await expect(page).toHaveURL(/position=1\.1\.30/);
    await inspector.getByRole("tab", { name: "Entscheidung" }).click();
    const draftComment =
      "Lokaler Navigationsentwurf bleibt beim Wechsel der LV-Position erhalten.";
    await inspector.locator("textarea").fill(draftComment);
    await page.waitForTimeout(350);
    await inspector.getByRole("button", { name: "Nächste Position" }).click();
    const currentPosition = await inspector
      .locator("header > .lv-inspector-title > span")
      .textContent();
    expect(currentPosition).not.toBe("Position 1.1.30.");
    const currentNumber = currentPosition?.replace("Position ", "") ?? "";
    await expect(
      page.locator(`[data-lv-position="${currentNumber}"]`)
    ).toHaveClass(/active/);
    await expect(page).toHaveURL(
      new RegExp(`position=${currentNumber.replaceAll(".", "\\.")}`)
    );
    await inspector.getByRole("button", { name: "Vorherige Position" }).click();
    await inspector.getByRole("tab", { name: "Entscheidung" }).click();
    await expect(inspector.locator("textarea")).toHaveValue(draftComment);
  });

  test("opens the real POS 19000 supplier evidence in context and marking modes", async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openWorkspace(page);
    const row = page.locator('[data-lv-position="1.1.60."]');
    await row.getByRole("button", { name: "Gienger-Quelle öffnen" }).click();
    const overlay = page.locator("[data-source-overlay]");
    await expect(overlay).toHaveAttribute("data-source-fit-mode", "context");
    await renderedCanvas(page);
    await expect(overlay.getByText("Reflex Kappenventil SU R 3/4 x 3/4"))
      .toBeVisible();
    await expect(overlay.getByText("6 St")).toBeVisible();
    await expect(overlay.getByText("34,85 €")).toBeVisible();
    await expect(overlay.getByText("209,10 €")).toBeVisible();
    const contextSpace = await page.evaluate(() => {
      const stage = document.querySelector("[data-pdf-stage]");
      const evidence = document.querySelector("[data-evidence-region]");
      if (!(stage instanceof HTMLElement) || !(evidence instanceof HTMLElement)) {
        return { above: 0, below: 0, height: 0 };
      }
      const stageBox = stage.getBoundingClientRect();
      const evidenceBox = evidence.getBoundingClientRect();
      return {
        above: evidenceBox.top - stageBox.top,
        below: stageBox.bottom - evidenceBox.bottom,
        height: stageBox.height
      };
    });
    expect(contextSpace.above).toBeGreaterThan(contextSpace.height * 0.15);
    expect(contextSpace.below).toBeGreaterThan(contextSpace.height * 0.15);
    await page.screenshot({
      path: testInfo.outputPath("source-pos-19000-context.png")
    });

    await overlay.getByRole("button", { name: "Markierung", exact: true }).click();
    await expect(overlay).toHaveAttribute("data-source-fit-mode", "evidence");
    await renderedCanvas(page);
    await page.screenshot({
      path: testInfo.outputPath("source-pos-19000-marking.png")
    });
  });

  test("automatic override retains draft and dialog across real PDF source", async ({
    page
  }, testInfo) => {
    const failures = runtimeFailures(page);
    await openWorkspace(page);
    const decisionsBefore = (await (
      await page.request.get("/api/local/corpus?view=pilot")
    ).json()) as { supplierDecisions: unknown[] };
    const row = page.locator('[data-lv-position="1.1.490."]');
    await row.click();
    const inspector = page.locator("[data-position-inspector]");
    await expect(inspector).toBeVisible();
    await inspector.getByRole("tab", { name: "Entscheidung" }).click();
    await inspector
      .getByRole("button", { name: "Automatische Auswahl ändern" })
      .click();
    const override = page.locator(".automatic-override-dialog");
    await expect(override).toBeVisible();
    await override.locator("select").selectOption("OTHER_REQUIRES_COMMENT");
    const comment =
      "Die ausgewählte Variante wird nach Prüfung der Originalquellen für die weitere Bearbeitung bevorzugt.";
    await override.locator("textarea").fill(comment);
    await override.getByRole("button", { name: "Zur Basis-Quelle" }).click();
    await expect(page.locator("[data-source-overlay]")).toBeVisible();
    await expect(page).toHaveURL(/\/lv-vergleich\?.*position=1\.1\.490/);
    const canvas = await renderedCanvas(page);
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
    expect(canvas.nonWhite).toBeGreaterThan(20);
    await page.screenshot({
      path: testInfo.outputPath("source-over-automatic-override.png")
    });
    await page.getByRole("button", { name: "Zur Entscheidung zurück" }).click();
    await expect(page.locator("[data-source-overlay]")).toHaveCount(0);
    await expect(override).toBeVisible();
    await expect(override.locator("textarea")).toHaveValue(comment);
    await expect(override.locator("select")).toHaveValue(
      "OTHER_REQUIRES_COMMENT"
    );
    await expect(
      override.getByRole("button", { name: "Speichern und weiter" })
    ).toBeEnabled();
    const decisionsAfter = (await (
      await page.request.get("/api/local/corpus?view=pilot")
    ).json()) as { supplierDecisions: unknown[] };
    expect(decisionsAfter.supplierDecisions).toEqual(
      decisionsBefore.supplierDecisions
    );
    expect(failures).toEqual([]);
  });

  test("switches Basis and supplier sources, maps pages and Back closes first", async ({
    page
  }, testInfo) => {
    const failures = runtimeFailures(page);
    await openWorkspace(page);
    const row = page.locator('[data-lv-position="1.1.490."]');
    await row.getByRole("button", { name: /Basis-Quelle/ }).click();
    await renderedCanvas(page);
    const pageLabel = await page
      .locator(".source-overlay-header")
      .getByText(/Seite \d+ von \d+/)
      .textContent();
    expect(pageLabel).toMatch(/Seite \d+ von \d+/);
    const supplierTabs = page.locator(".source-tabs button").filter({
      hasNotText: "Basis"
    });
    expect(await supplierTabs.count()).toBeGreaterThan(0);
    await supplierTabs.first().click();
    const supplierCanvas = await renderedCanvas(page);
    expect(supplierCanvas.nonWhite).toBeGreaterThan(20);
    await expect(page.getByText(/SOURCE EVIDENCE|IMMUTABLE REVISION/)).toHaveCount(0);
    await expect(page.getByText(/Document revision|Evidence ID|Region/)).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("supplier-source.png")
    });
    await page.goBack();
    await expect(page.locator("[data-source-overlay]")).toHaveCount(0);
    await expect(page.locator("[data-position-inspector]")).toBeVisible();
    expect(failures).toEqual([]);
  });

  test("multi-line bundle sources and 1366 viewer remain usable", async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);
    const row = page.locator('[data-lv-position="2.1.820."]');
    await row.click();
    const inspector = page.locator("[data-position-inspector]");
    await inspector.getByRole("tab", { name: "Angebote" }).click();
    const sourceButtons = inspector.getByRole("button", { name: "Quelle" });
    expect(await sourceButtons.count()).toBeGreaterThan(1);
    const multiLineOption = inspector
      .locator(".lv-supplier-panel")
      .filter({ hasText: "P&M" });
    await expect(multiLineOption.locator(".lv-option-lines > div")).toHaveCount(3);
    await multiLineOption.getByRole("button", { name: "Quelle" }).first().click();
    const canvas = await renderedCanvas(page);
    expect(canvas.nonWhite).toBeGreaterThan(20);
    await expect(page.locator(".source-line-list button")).not.toHaveCount(0);
    const overlayBox = await page.locator("[data-source-overlay]").boundingBox();
    expect(overlayBox?.width).toBeLessThanOrEqual(1366);
    expect(overlayBox?.height).toBeLessThanOrEqual(768);
    await page.screenshot({
      path: testInfo.outputPath("source-1366x768.png")
    });
  });

  test("source load failure is explicit and retry renders the page", async ({
    page
  }) => {
    await openWorkspace(page);
    let failPdf = true;
    await page.route("**/api/local/corpus?*", async (route) => {
      const url = new URL(route.request().url());
      if (failPdf && url.searchParams.has("documentRevisionId")) {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    const row = page.locator('[data-lv-position="1.1.490."]');
    await row.getByRole("button", { name: /Basis-Quelle/ }).click();
    await expect(
      page.getByText("Dokumentseite konnte nicht angezeigt werden.")
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-evidence-region]")).toHaveCount(0);
    failPdf = false;
    await page.getByRole("button", { name: "Erneut laden" }).click();
    const canvas = await renderedCanvas(page);
    expect(canvas.nonWhite).toBeGreaterThan(20);
  });

  test("source viewer is full-screen on mobile", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWorkspace(page);
    const row = page.locator('[data-lv-position="1.1.490."]');
    await row.getByRole("button", { name: /Basis-Quelle/ }).click();
    await renderedCanvas(page);
    const box = await page.locator("[data-source-overlay]").boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(389);
    expect(box?.height).toBeGreaterThanOrEqual(843);
    await page.screenshot({
      path: testInfo.outputPath("source-mobile.png")
    });
  });

  test("captures the required decision control scenarios", async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);
    await page.screenshot({
      path: testInfo.outputPath("lv-workspace-1366x768.png")
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    const automaticRow = page.locator('[data-lv-position="1.1.490."]');
    await automaticRow.click();
    let inspector = page.locator("[data-position-inspector]");
    await expect(inspector).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("automatic-inspector-1.1.490.png")
    });
    await inspector.getByRole("tab", { name: "Entscheidung" }).click();
    await inspector
      .getByRole("button", { name: "Automatische Auswahl ändern" })
      .click();
    await expect(page.locator(".automatic-override-dialog")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("automatic-override-1.1.490.png")
    });
    await page
      .locator(".automatic-override-dialog")
      .getByRole("button", { name: "Dialog schließen" })
      .click();
    await inspector
      .getByRole("button", { name: "Inspector schließen" })
      .click();

    for (const [position, fileName] of [
      ["1.1.520.", "quantity-warning-1.1.520.png"],
      ["1.1.530.", "decision-required-1.1.530.png"],
      ["2.1.890.", "no-comparable-2.1.890.png"]
    ] as const) {
      await page.locator(`[data-lv-position="${position}"]`).click();
      inspector = page.locator("[data-position-inspector]");
      await expect(inspector).toBeVisible();
      await inspector.getByRole("tab", { name: "Angebote" }).click();
      await page.screenshot({ path: testInfo.outputPath(fileName) });
      await inspector
        .getByRole("button", { name: "Inspector schließen" })
        .click();
    }

    await page
      .getByRole("button", { name: "Entscheidungen und Begründungen" })
      .click();
    await expect(page.locator(".knowledge-drawer")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("entscheidungen-und-begruendungen.png")
    });
    await page
      .getByRole("button", { name: "Wissenssammlung schließen" })
      .click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-lv-position="1.1.530."]').click();
    await expect(page.locator("[data-position-inspector]")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("mobile-position-inspector.png")
    });
  });
});
