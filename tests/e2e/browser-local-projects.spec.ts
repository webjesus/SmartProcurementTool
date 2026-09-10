import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const screenshotDir = path.join(process.cwd(), "tmp", "browser-local-visual");

function syntheticPdf(lines: string[]): Buffer {
  const pages = Array.from({ length: Math.ceil(lines.length / 36) }, (_, pageIndex) =>
    lines.slice(pageIndex * 36, (pageIndex + 1) * 36)
  );
  const fontObjectId = 3 + pages.length * 2;
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(" ")}] /Count ${pages.length} >>`,
    ...pages.flatMap((pageLines, index) => {
      const stream = [
        "BT",
        "/F1 11 Tf",
        "46 790 Td",
        ...pageLines
          .map((line) => line.replace(/([()\\])/g, "\\$1"))
          .flatMap((line, lineIndex) =>
            lineIndex === 0 ? [`(${line}) Tj`] : ["0 -18 Td", `(${line}) Tj`]
          ),
        "ET"
      ].join("\n");
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${pageObjectIds[index] + 1} 0 R >>`,
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
      ];
    }),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let value = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(value));
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(value);
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    value += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(value, "ascii");
}

async function fillProjectMetadata(page: Page, name: string) {
  await page.getByPlaceholder("z. B. Neubau Verwaltungsgebäude").fill(name);
  await page
    .getByPlaceholder("Straße, Hausnummer, PLZ und Ort")
    .fill("Musterstraße 1, 70173 Stuttgart");
  await page.getByPlaceholder("Name des planenden Ingenieurbüros").fill("Ingenieurbüro Muster");
  await page.getByPlaceholder("Name des Architekturbüros").fill("Architekturbüro Muster");
}

async function expectWarningCenterAboveWorkspace(page: Page) {
  const trigger = page.locator(".lv-warning-trigger");
  await expect(trigger).toBeVisible();
  await trigger.click();
  const popover = page.locator("[data-warning-center]");
  await expect(popover).toBeAttached();

  const geometry = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".lv-page-header");
    const panel = document.querySelector<HTMLElement>("[data-warning-center]");
    if (!header || !panel) return null;
    const headerBox = header.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const testX = panelBox.left + panelBox.width / 2;
    const testY = Math.min(panelBox.bottom - 1, panelBox.top + 40);
    const hit = document.elementFromPoint(testX, testY);
    return {
      headerBottom: headerBox.bottom,
      panelTop: panelBox.top,
      panelRight: panelBox.right,
      panelBottom: panelBox.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      hitInsidePanel: Boolean(hit && panel.contains(hit))
    };
  });

  expect(geometry).not.toBeNull();
  expect(geometry?.panelTop ?? 0).toBeGreaterThanOrEqual((geometry?.headerBottom ?? 0) - 1);
  expect(geometry?.panelRight ?? Infinity).toBeLessThanOrEqual(geometry?.viewportWidth ?? 0);
  expect(geometry?.panelBottom ?? Infinity).toBeLessThanOrEqual(geometry?.viewportHeight ?? 0);
  expect(geometry?.hitInsidePanel).toBe(true);
  if (process.env.SPT_CAPTURE_STEP5_UI === "true") {
    const viewport = page.viewportSize();
    await page.screenshot({
      path: path.join(
        screenshotDir,
        `step-5-warning-${viewport?.width ?? "unknown"}x${viewport?.height ?? "unknown"}.png`
      ),
      fullPage: false
    });
  }

  await trigger.click();
  await expect(popover).toHaveCount(0);
}

async function expectReadableOriginalDocument(
  page: Page,
  viewport: { width: number; height: number },
  minimumCanvasWidth: number
) {
  await page.setViewportSize(viewport);
  const details = page.locator("[data-details-pane]");
  const inlineSource = page.locator("[data-inline-source]");
  const canvas = inlineSource.locator("canvas");
  await expect(details).toHaveAttribute("data-details-tab", "ORIGINAL_DOCUMENT");
  await expect(canvas).toBeVisible();
  await expect(page.getByText("Dokumentseite wird geladen...")).toBeHidden({
    timeout: 20_000
  });
  await expect
    .poll(() => canvas.evaluate((element) => element.getBoundingClientRect().width), {
      timeout: 20_000
    })
    .toBeGreaterThanOrEqual(minimumCanvasWidth);
  await expect(inlineSource.getByRole("button", { name: "Dokument Vollbild" })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight
      };
    };
    const fontSize = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0;
    };
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".lv-position-card"));
    return {
      workspace: box("[data-lv-two-pane]"),
      details: box("[data-details-pane]"),
      sourceHeader: box(".lv-inline-source > header"),
      sourceNavigation: box(".lv-inline-source > header nav"),
      sourceStage: box(".lv-inline-source-stage"),
      pdfStage: box(".lv-inline-source-stage .source-pdf-stage"),
      canvas: box(".lv-inline-source-stage canvas"),
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cardOverflow: Math.max(0, ...cards.map((card) => card.scrollWidth - card.clientWidth)),
      positionNumberFont: fontSize(".lv-position-number"),
      positionTitleFont: fontSize(".lv-position-title strong"),
      sourceTitleFont: fontSize(".lv-inline-source > header strong"),
      sourceMetaFont: fontSize(".lv-inline-source > header span")
    };
  });

  const paneRatio = (geometry.details?.width ?? 0) / (geometry.workspace?.width ?? 1);
  if (viewport.width >= 1600) {
    expect(paneRatio).toBeGreaterThanOrEqual(0.38);
    expect(paneRatio).toBeLessThanOrEqual(0.4);
  } else {
    expect(geometry.details?.width ?? 0).toBeGreaterThanOrEqual(598);
  }
  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
  expect(geometry.cardOverflow).toBeLessThanOrEqual(1);
  expect(
    (geometry.sourceHeader?.scrollWidth ?? Infinity) - (geometry.sourceHeader?.clientWidth ?? 0)
  ).toBeLessThanOrEqual(1);
  expect(
    (geometry.sourceNavigation?.scrollWidth ?? Infinity) -
      (geometry.sourceNavigation?.clientWidth ?? 0)
  ).toBeLessThanOrEqual(1);
  expect(geometry.pdfStage?.top ?? 0).toBeGreaterThanOrEqual(
    (geometry.sourceStage?.top ?? Infinity) - 1
  );
  expect(geometry.pdfStage?.bottom ?? Infinity).toBeLessThanOrEqual(
    (geometry.sourceStage?.bottom ?? 0) + 1
  );
  expect(geometry.canvas?.width ?? 0).toBeGreaterThanOrEqual(minimumCanvasWidth);
  expect(geometry.positionNumberFont).toBeGreaterThanOrEqual(12);
  expect(geometry.positionTitleFont).toBeGreaterThanOrEqual(13);
  expect(geometry.sourceTitleFont).toBeGreaterThanOrEqual(10.5);
  expect(geometry.sourceMetaFont).toBeGreaterThanOrEqual(10);
  if (process.env.SPT_CAPTURE_STEP5_UI === "true") {
    await page.screenshot({
      path: path.join(screenshotDir, `step-5-original-${viewport.width}x${viewport.height}.png`),
      fullPage: false
    });
  }
}

test.beforeAll(() => mkdirSync(screenshotDir, { recursive: true }));

test("classifies and processes the local mixed regression corpus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop corpus workflow");
  test.setTimeout(600_000);
  const corpusRoot = process.env.SPT_REGRESSION_CORPUS_DIR ?? "";
  const corpusFiles = [
    "HE LV Heizung D8 250813.pdf",
    "HE LV Sanitär 250918.pdf",
    "Gienger.PDF",
    "Gienger[1].PDF",
    "Reisser.PDF",
    "Reisser[1].PDF",
    "PuM_10_591528-1_2_1.pdf",
    "PuM_10_591528-2_2_1.pdf",
    "Weishaupt.PDF",
    "44281 GIS.pdf",
    "Hawa.pdf",
    "Hawa[1].pdf"
  ].map((name) => path.join(corpusRoot, name));
  test.skip(
    !corpusRoot || corpusFiles.some((file) => !existsSync(file)),
    "Local regression PDFs are not available"
  );

  await page.goto("/projects/new");
  await fillProjectMetadata(page, "Mixed Corpus Regression");
  await page.locator('input[type="file"][multiple]').setInputFiles(corpusFiles);
  await expect(page.locator("[data-document-id]")).toHaveCount(12, {
    timeout: 120_000
  });
  await expect(page.locator("[data-upload-summary]")).toContainText("12 Dateien ausgewählt");
  await expect(page.locator("[data-upload-summary]")).toContainText("2 OCR erforderlich");
  await page.getByRole("button", { name: /Weiter: Dateien prüfen/ }).click();

  const review = page.locator("[data-document-review]");
  await expect(review).toBeVisible();
  await expect(page.locator('[data-document-role="BASIS_LV"]')).toHaveCount(2);
  await expect(page.locator('[data-document-role="SUPPLIER_OFFER"]')).toHaveCount(7);
  await expect(page.locator('[data-document-role="TECHNICAL_CALCULATION"]')).toHaveCount(1);
  await expect(page.locator('[data-document-role="SCAN_OCR_REQUIRED"]')).toHaveCount(2);
  await expect(page.locator('[data-document-cluster="HEIZUNG"]')).toContainText("Angebote: 4");
  await expect(page.locator('[data-document-cluster="SANITAER"]')).toContainText("Angebote: 3");
  await page.screenshot({
    path: path.join(screenshotDir, "mixed-corpus-document-review.png"),
    fullPage: true
  });

  await page.getByRole("button", { name: "Entfernen Hawa[1].pdf" }).click();
  await page
    .getByRole("dialog", { name: "Dokument entfernen" })
    .getByRole("button", { name: "Dokument entfernen" })
    .click();
  await expect(page.locator("[data-review-document]")).toHaveCount(11);

  await page.getByRole("button", { name: "Dateien hinzufügen" }).click();
  const addDialog = page.getByRole("dialog", {
    name: "Weitere Dateien hinzufügen"
  });
  await addDialog.locator('input[type="file"]').setInputFiles(path.join(corpusRoot, "Gienger.PDF"));
  await expect(addDialog.locator('[data-upload-status="DUPLICATE"]')).toContainText(
    "Identische Datei erkannt"
  );
  await page.screenshot({
    path: path.join(screenshotDir, "mixed-corpus-duplicate-summary.png"),
    fullPage: true
  });
  await addDialog.getByRole("button", { name: "Schließen" }).click();

  await page.getByRole("tab", { name: "Sanitär" }).click();
  await expect(page.getByRole("tab", { name: "Sanitär" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /Verarbeitung starten/ }).click();
  await expect(page.locator("[data-processing-page]")).toBeVisible();
  await expect(page.getByText(/Verarbeitete Seiten/)).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "mixed-corpus-processing.png"),
    fullPage: true
  });
  await expect(page.locator("[data-processing-result]")).toBeVisible({
    timeout: 300_000
  });
  await expect(page.getByText("Vergleich mit Prüfbedarf")).toBeVisible();
  await expect(
    page.locator(".processing-result-summary dl div").first().locator("dd")
  ).not.toHaveText("0");

  const qualityDocuments = page.locator(".document-quality-list article");
  const activeComparisonDocuments = [
    "HE LV Sanitär 250918.pdf",
    "Gienger.PDF",
    "Reisser.PDF",
    "PuM_10_591528-2_2_1.pdf"
  ];
  for (const documentName of activeComparisonDocuments) {
    const document = qualityDocuments.filter({ hasText: documentName });
    await expect(document).toHaveCount(1);
    await expect(document).toHaveAttribute(
      "data-quality-status",
      /^(?:SUPPORTED|REVIEW_REQUIRED)$/u
    );
    await expect(document).toContainText(/[1-9]\d* extrahiert/u);
    await expect(document).not.toContainText("Keine Positionen extrahiert");
  }

  const inactiveHeatingDocuments = [
    "HE LV Heizung D8 250813.pdf",
    "Gienger[1].PDF",
    "Reisser[1].PDF",
    "PuM_10_591528-1_2_1.pdf",
    "Weishaupt.PDF"
  ];
  for (const documentName of inactiveHeatingDocuments) {
    const document = qualityDocuments.filter({ hasText: documentName });
    await expect(document).toHaveCount(1);
    await expect(document).toContainText("Nicht Teil des LV-Vergleichs");
  }

  const scannedDocument = qualityDocuments.filter({ hasText: "Hawa.pdf" });
  await expect(scannedDocument).toHaveCount(1);
  await expect(scannedDocument).toContainText("OCR erforderlich");
  await page.screenshot({
    path: path.join(screenshotDir, "mixed-corpus-processing-result.png"),
    fullPage: true
  });
});

test("browser-local project survives reload and reaches the shared LV", async ({
  page,
  request
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop workflow");
  test.setTimeout(180_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");
  await expect(page.locator("[data-library-page]")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("link", { name: "Projekte", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator("[data-browser-projects]")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-browser-projects]")).toBeVisible();

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    status: "ok",
    deploymentMode: "BROWSER_LOCAL",
    mode: "browser-local",
    decisionPersistenceMode: "BROWSER_LOCAL"
  });

  await page.locator(".projects-primary-action").click();
  await fillProjectMetadata(page, "Neubau Verwaltung Nord");
  await page.getByPlaceholder("z. B. Standort, Bauabschnitt, Notizen").fill("Bauabschnitt A");
  await page.locator('input[type="file"][multiple]').setInputFiles([
    {
      name: "basis-lv-test.pdf",
      mimeType: "application/pdf",
      buffer: syntheticPdf([
        "Angebotsaufforderung LV-Daten LV-Bezeichnung LV-Nummer 24-07 H",
        "Heizungsinstallation Inhaltsverzeichnis",
        "1.1.10. Umwaelzpumpe 2 St"
      ])
    },
    {
      name: "Gienger-Angebot.pdf",
      mimeType: "application/pdf",
      buffer: syntheticPdf([
        "Gienger Angebot Nr. 15875507-001 E-Preis Gesamtpreis",
        "Heizungsinstallation",
        "1.1.10 Umwaelzpumpe 2 St Art. GPX-2 EP 100,00 GP 200,00"
      ])
    }
  ]);
  await expect(page.locator("[data-document-id]")).toHaveCount(2, {
    timeout: 30_000
  });
  await page.screenshot({
    path: path.join(screenshotDir, "new-project-with-pdfs.png"),
    fullPage: true
  });

  await page.reload();
  await expect(page.locator('input[value="Neubau Verwaltung Nord"]')).toBeVisible();
  await expect(page.locator("[data-document-id]")).toHaveCount(2, {
    timeout: 30_000
  });
  await page.getByRole("button", { name: /Weiter: Dateien prüfen/ }).click();

  await expect(page.locator("[data-document-review]")).toBeVisible();
  await expect(page.locator("[data-review-document]")).toHaveCount(2);
  await page.screenshot({
    path: path.join(screenshotDir, "document-review.png"),
    fullPage: true
  });
  await page.getByRole("button", { name: /Verarbeitung starten/ }).click();
  await expect(page.locator("[data-processing-page]")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "processing.png"),
    fullPage: true
  });

  await expect(page.locator("[data-processing-result]")).toBeVisible({
    timeout: 20_000
  });
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "processing-result.png"),
    fullPage: true
  });
  await page.getByRole("link", { name: /LV-Vergleich öffnen/ }).click();

  await expect(page.locator("[data-browser-local-lv]")).toBeVisible();
  await expect(page.locator('[data-lv-position="1.1.10"]')).toBeVisible();
  await page.locator('[data-lv-position="1.1.10"]').click();
  const supplierOption = page.locator("[data-offer-comparison] [data-supplier-option]");
  await expect(supplierOption).toHaveCount(1);
  const supplierChoice = supplierOption.getByRole("button", { name: /auswählen$/u });
  const confirmMatch = page.getByRole("button", { name: "Zuordnung bestätigen", exact: true });
  if (await confirmMatch.isVisible()) await confirmMatch.click();
  await supplierChoice.click();
  await expect(supplierOption).toHaveAttribute("aria-selected", "true");
  await expect(supplierChoice).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-details-tab="ORIGINAL_DOCUMENT"]')).toBeVisible();
  await expect(page.locator(".lv-inline-source-stage canvas")).toBeVisible();
  await expect(page.getByText("Dokumentseite wird geladen...")).toBeHidden();
  await page.screenshot({
    path: path.join(screenshotDir, "lv-original-document.png"),
    fullPage: true
  });

  await page.reload();
  await expect(page.locator('[data-lv-position="1.1.10"]')).toBeVisible();
  await expect(page.locator("[data-supplier-option]")).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator("[data-supplier-option]").getByRole("button", { name: /auswählen$/u })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-details-tab="ORIGINAL_DOCUMENT"]')).toBeVisible();

  await page.getByRole("button", { name: "Dokumente hinzufügen" }).click();
  await expect(page.getByRole("dialog", { name: "Weitere Dateien hinzufügen" })).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "add-files-dialog.png"),
    fullPage: true
  });
  await page
    .getByRole("dialog", { name: "Weitere Dateien hinzufügen" })
    .locator('input[type="file"]')
    .setInputFiles({
      name: "P-und-M-Angebot.pdf",
      mimeType: "application/pdf",
      buffer: syntheticPdf([
        "Pfeiffer & May Angebot Nr. 591528-1 Version 2 E-Preis Gesamtpreis",
        "Heizungsinstallation",
        "1.1.10 Umwaelzpumpe 2 St Art. PM-2 EP 90,00 GP 180,00"
      ])
    });
  await page.getByRole("button", { name: "Dateien prüfen", exact: true }).click();
  await expect(page.locator("[data-document-review]")).toBeVisible();
  await expect(page.locator("[data-review-document]")).toHaveCount(3);
  await page.getByRole("button", { name: /Verarbeitung starten/ }).click();
  await expect(page.locator("[data-processing-result]")).toBeVisible({
    timeout: 20_000
  });
  await page.getByRole("link", { name: /LV-Vergleich öffnen/ }).click();
  await expect(page.locator("[data-supplier-option]")).toHaveCount(2);
  await expect(page.locator('[data-supplier-option][aria-selected="true"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Zurück zu Projekte", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  expect(runtimeErrors.filter((message) => message.includes("AbortError"))).toEqual([]);
  const projectA = page
    .locator(".browser-project-card")
    .filter({ hasText: "Neubau Verwaltung Nord" });
  await expect(projectA).toBeVisible();
  await page.getByRole("button", { name: "Aktionen für Neubau Verwaltung Nord" }).click();
  await page.getByRole("button", { name: "Umbenennen" }).click();
  const editDialog = page.getByRole("dialog", { name: "Projekt bearbeiten" });
  await expect(editDialog).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "project-edit-modal.png"),
    fullPage: true
  });
  await editDialog
    .getByRole("textbox", { name: "Projektname" })
    .fill("Neubau Verwaltung Nord aktualisiert");
  await editDialog.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(
    page.locator(".browser-project-card").filter({ hasText: "Neubau Verwaltung Nord aktualisiert" })
  ).toBeVisible();

  await page.locator(".projects-primary-action").click();
  await fillProjectMetadata(page, "Projekt B");
  await expect(page.getByText("Entwurf gespeichert")).toBeVisible();
  await page.getByRole("link", { name: "Zurück zu Projekten" }).click();
  await expect(page.locator(".browser-project-card")).toHaveCount(2);
  const projectB = page.locator(".browser-project-card").filter({ hasText: "Projekt B" });
  await expect(projectB).toContainText("Dokumente");
  await expect(projectB.locator(".project-metrics dd").nth(1)).toHaveText("0");

  await page
    .getByRole("button", {
      name: "Aktionen für Neubau Verwaltung Nord aktualisiert"
    })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Projekt sichern" }).click();
  const backup = await downloadPromise;
  const backupPath = await backup.path();
  expect(backupPath).toBeTruthy();

  await page
    .getByRole("button", {
      name: "Aktionen für Neubau Verwaltung Nord aktualisiert"
    })
    .click();
  await page.getByRole("button", { name: "Löschen" }).click();
  await page
    .getByRole("dialog", { name: "Projekt löschen" })
    .getByRole("button", { name: "Projekt löschen" })
    .click();
  await expect(
    page.locator(".browser-project-card").filter({ hasText: "Neubau Verwaltung Nord" })
  ).toHaveCount(0);

  await page.locator('input[accept*=".spt-project"]').setInputFiles(backupPath!);
  await expect(page.getByRole("dialog", { name: "Projekt wiederherstellen" })).toContainText(
    "Prüfsummen"
  );
  await page
    .getByRole("dialog", { name: "Projekt wiederherstellen" })
    .getByRole("button", { name: "Projekt wiederherstellen" })
    .click();
  const restored = page
    .locator(".browser-project-card")
    .filter({ hasText: "Neubau Verwaltung Nord aktualisiert" });
  await expect(restored).toBeVisible();
  await expect(restored.locator(".project-metrics dd").nth(1)).toHaveText("3");
  await restored.locator(".project-metrics").click();
  await expect(page.locator("[data-document-review]")).toBeVisible();
  await expect(page.locator("[data-review-document]")).toHaveCount(3);
  await page.getByRole("button", { name: /Verarbeitung starten/ }).click();
  await expect(page.locator("[data-processing-result]")).toBeVisible({
    timeout: 20_000
  });
  await page.getByRole("link", { name: /LV-Vergleich öffnen/ }).click();
  await expect(page.locator('[data-lv-position="1.1.10"]')).toBeVisible();
  await expect(page.locator('[data-supplier-option][aria-selected="true"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Zurück zu Projekte", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Aktionen für Neubau Verwaltung Nord aktualisiert"
    })
    .click();
  await page.getByRole("button", { name: "Duplizieren" }).click();
  const duplicateCard = page
    .locator(".browser-project-card")
    .filter({ hasText: "Kopie von Neubau Verwaltung Nord aktualisiert" });
  await expect(duplicateCard).toBeVisible();
  await expect(duplicateCard.locator(".project-metrics dd").nth(1)).toHaveText("3");
  await page.screenshot({
    path: path.join(screenshotDir, "duplicate-project-complete.png"),
    fullPage: true
  });
  await duplicateCard.locator(".project-metrics").click();
  await expect(page.locator("[data-browser-local-lv]")).toBeVisible();
  await expect(page.locator('[data-lv-position="1.1.10"]')).toBeVisible();
  await expect(page.locator('[data-supplier-option][aria-selected="true"]')).toHaveCount(0);
});

test("probable PDF match requires a separate human review before price baseline", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop match review workflow");
  await page.setViewportSize({ width: 1366, height: 900 });

  await page.goto("/projects/new");
  await fillProjectMetadata(page, "Matching Review Regression");
  await page.locator('input[type="file"][multiple]').setInputFiles([
    {
      name: "basis-lv-matching.pdf",
      mimeType: "application/pdf",
      buffer: syntheticPdf([
        "Angebotsaufforderung LV-Daten LV-Bezeichnung LV-Nummer 24-07 H",
        "Heizungsinstallation",
        "Position 1.1.10. Hocheffizienz Umwaelzpumpe Heizkreis DN 25 2 St",
        "Position 1.1.20. Absperrventil Heizkreis DN 25 1 St"
      ])
    },
    {
      name: "Lieferant-A-Angebot.pdf",
      mimeType: "application/pdf",
      buffer: syntheticPdf([
        "Lieferant A Angebot Nr. A-100 E-Preis Gesamtpreis",
        "Heizungsinstallation",
        "Angebotsposition 4711 Umwaelzpumpe Heizkreis DN 25 Hocheffizienz 2 St Art. P-25 EP 100,00 GP 200,00",
        "Angebotsposition 4720 Absperrventil Heizkreis DN 25 1 St Art. V-25 EP 20,00 GP 20,00"
      ])
    }
  ]);
  await expect(page.locator("[data-document-id]")).toHaveCount(2, {
    timeout: 30_000
  });
  await page.getByRole("button", { name: /Weiter: Dateien prüfen/ }).click();
  await page.getByRole("button", { name: /Verarbeitung starten/ }).click();
  await expect(page.locator("[data-processing-result]")).toBeVisible({
    timeout: 20_000
  });
  const qualityPanel = page.locator("[data-document-quality]");
  await expect(qualityPanel).toBeVisible();
  const qualityGeometry = await qualityPanel.evaluate((panel) => {
    const articles = Array.from(
      panel.querySelectorAll<HTMLElement>(".document-quality-list article")
    );
    return {
      panelOverflow: panel.scrollWidth - panel.clientWidth,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      articleCount: articles.length,
      articleOverflow: Math.max(
        0,
        ...articles.map((article) => article.scrollWidth - article.clientWidth)
      ),
      articleMarkers: articles.map((article) => ({
        status: article.dataset.qualityStatus,
        borderWidth: Number.parseFloat(getComputedStyle(article).borderLeftWidth),
        borderColor: getComputedStyle(article).borderLeftColor
      }))
    };
  });
  expect(qualityGeometry.panelOverflow).toBeLessThanOrEqual(1);
  expect(qualityGeometry.documentOverflow).toBeLessThanOrEqual(1);
  expect(qualityGeometry.articleCount).toBe(2);
  expect(qualityGeometry.articleOverflow).toBeLessThanOrEqual(1);
  for (const marker of qualityGeometry.articleMarkers) {
    expect(marker.status).toMatch(/^(SUPPORTED|REVIEW_REQUIRED|UNSUPPORTED)$/u);
    expect(marker.borderWidth).toBeGreaterThanOrEqual(3);
    expect(marker.borderColor).not.toBe("rgba(0, 0, 0, 0)");
  }
  if (process.env.SPT_CAPTURE_STEP5_UI === "true") {
    await page.screenshot({
      path: path.join(screenshotDir, "step-5-document-quality-1366x900.png"),
      fullPage: true
    });
  }
  await page.getByRole("link", { name: /LV-Vergleich öffnen/ }).click();

  await expect(page.locator(".wb-app-frame")).toHaveAttribute("data-workspace-nav", "compact");
  await expect(page.locator("[data-browser-local-lv]")).toBeVisible();
  await expect(page.locator(".browser-project-context")).toHaveCount(0);
  await expect(page.locator(".lv-page-header")).toHaveCount(1);
  const headerGeometry = await page.evaluate(() => {
    const topbar = document.querySelector<HTMLElement>(".wb-topbar");
    const lvHeader = document.querySelector<HTMLElement>(".lv-page-header");
    const lvHeaderRect = lvHeader?.getBoundingClientRect();
    return {
      topbarDisplay: topbar ? getComputedStyle(topbar).display : null,
      headerInsideViewport: Boolean(
        lvHeaderRect && lvHeaderRect.left >= 0 && lvHeaderRect.right <= window.innerWidth
      )
    };
  });
  expect(headerGeometry.topbarDisplay).toBe("none");
  expect(headerGeometry.headerInsideViewport).toBe(true);
  expect(
    await page
      .locator(".wb-sidebar")
      .evaluate((element) => Math.round(element.getBoundingClientRect().width))
  ).toBeLessThanOrEqual(84);
  await expect(page.locator('[data-lv-position="1.1.10"]')).toBeVisible();
  await page.locator('[data-lv-position="1.1.10"]').click();
  await expect(page.locator("[data-details-pane]")).toHaveAttribute(
    "data-details-tab",
    "ORIGINAL_DOCUMENT"
  );
  await expect(page.locator("[data-inline-source]")).toHaveAttribute("data-source-key", /^basis:/);
  await expect(page.locator("[data-inline-source]")).toHaveAttribute(
    "data-source-fit-mode",
    "width"
  );
  await expect(page.locator("[data-inline-source] [data-evidence-region]")).toBeVisible({
    timeout: 20_000
  });
  await expect(page.locator("[data-inline-source]")).toHaveAttribute(
    "data-evidence-presentation",
    "visible_verified"
  );
  await expect(page.locator("[data-inline-source] footer")).toContainText(
    "Fundstelle der gewählten Position"
  );
  await page.setViewportSize({ width: 1366, height: 768 });
  await expectReadableOriginalDocument(page, { width: 1366, height: 768 }, 520);
  await expectReadableOriginalDocument(page, { width: 1920, height: 1080 }, 555);
  await expectReadableOriginalDocument(page, { width: 2560, height: 1440 }, 680);
  await page.setViewportSize({ width: 1366, height: 768 });
  await expectWarningCenterAboveWorkspace(page);
  await page.getByRole("tab", { name: "Angebotsdaten", exact: true }).click();
  await expect(page.locator("[data-details-pane]")).toHaveAttribute(
    "data-details-tab",
    "OFFER_DATA"
  );
  const review = page.locator('[data-match-review="PENDING"]');
  const geometry = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".lv-position-card"));
    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cardOverflow: Math.max(0, ...cards.map((card) => card.scrollWidth - card.clientWidth))
    };
  });
  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
  expect(geometry.cardOverflow).toBeLessThanOrEqual(1);
  await expect(review).toContainText("Zuordnung prüfen");
  await expect(review).toContainText("Matching-Score");
  await expect(page.locator('[data-supplier-option][aria-pressed="true"]')).toHaveCount(0);

  await review.getByRole("button", { name: "Zuordnung bestätigen" }).click();
  await expect(page.locator('[data-match-review="CONFIRMED"]')).toContainText(
    "Zuordnung bestätigt"
  );
  await expect(page.locator('[data-supplier-option][aria-pressed="true"]')).toHaveCount(0);

  const supplierOption = page.locator("[data-supplier-option]");
  await expect(supplierOption).toBeVisible();
  const offerTypography = await supplierOption.evaluate((element) => {
    const title = element.querySelector<HTMLElement>(".lv-offer-product strong");
    const price = element.querySelector<HTMLElement>(".lv-offer-price strong");
    return {
      title: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
      price: price ? Number.parseFloat(getComputedStyle(price).fontSize) : 0
    };
  });
  expect(offerTypography.title).toBeGreaterThanOrEqual(13);
  expect(offerTypography.price).toBeGreaterThanOrEqual(14);

  await supplierOption.click();
  await expect(page.locator("[data-details-pane]")).toHaveAttribute(
    "data-details-tab",
    "OFFER_DATA"
  );
  await expect(page.locator("[data-inline-source]")).toHaveAttribute(
    "data-source-key",
    /^supplier:/
  );
  await expect(page.locator('[data-supplier-option].active')).toHaveCount(1);
  await expect(page.locator('[data-supplier-option][aria-selected="true"]')).toHaveCount(0);

  await page.locator('[data-lv-position="1.1.10"] > .lv-position-card-header').click();
  await expect(page.locator("[data-inline-source]")).toHaveAttribute("data-source-key", /^basis:/);

  const inlineCanvas = page.locator("[data-inline-source] canvas");
  const previousSourceKey = await page
    .locator("[data-inline-source]")
    .getAttribute("data-source-key");
  expect(previousSourceKey).toBeTruthy();
  await expect(inlineCanvas).toBeVisible();
  await inlineCanvas.evaluate((canvas) => {
    (window as typeof window & { __sptStableCanvas?: Element }).__sptStableCanvas = canvas;
  });
  await page.getByRole("button", { name: "Nächste Position" }).click();
  await expect(page.getByLabel("Details zur Position 1.1.20")).toBeVisible();
  await expect(page.locator("[data-inline-source]")).not.toHaveAttribute(
    "data-source-key",
    previousSourceKey ?? ""
  );
  await expect(
    page.locator("[data-inline-source]").getByText("Dokumentseite wird geladen...")
  ).toBeHidden({ timeout: 20_000 });
  await expect(inlineCanvas).toBeVisible();
  expect(
    await inlineCanvas.evaluate(
      (canvas) =>
        (window as typeof window & { __sptStableCanvas?: Element }).__sptStableCanvas === canvas
    )
  ).toBe(true);

  await page.getByRole("button", { name: "Darstellung" }).click();
  await page.getByRole("menuitemradio", { name: "Dunkel" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("[data-details-pane]")).toBeVisible();
  await expect(inlineCanvas).toBeVisible();
  const darkSplitViewGeometry = await page.evaluate(() => {
    const toolbarSelects = Array.from(
      document.querySelectorAll<HTMLSelectElement>(".lv-toolbar select")
    );
    const collapsedHeader = document.querySelector<HTMLElement>(
      '[data-lv-position="1.1.10"] > .lv-position-card-header'
    );
    const visibleCells = collapsedHeader
      ? Array.from(collapsedHeader.children)
          .filter((child): child is HTMLElement => child instanceof HTMLElement)
          .filter((child) => {
            const style = getComputedStyle(child);
            const rect = child.getBoundingClientRect();
            return style.display !== "none" && rect.width > 0 && rect.height > 0;
          })
          .map((child) => {
            const rect = child.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          })
          .sort((left, right) => left.left - right.left)
      : [];
    const overlaps = visibleCells
      .slice(1)
      .map((cell, index) => Math.max(0, visibleCells[index].right - cell.left));
    const titleWidth = collapsedHeader
      ?.querySelector<HTMLElement>(".lv-position-title")
      ?.getBoundingClientRect().width;
    const priceWidth = collapsedHeader
      ?.querySelector<HTMLElement>(".lv-position-summary-price")
      ?.getBoundingClientRect().width;
    return {
      selectCount: toolbarSelects.length,
      whiteSelects: toolbarSelects.filter(
        (select) => getComputedStyle(select).backgroundColor === "rgb(255, 255, 255)"
      ).length,
      maxCellOverlap: Math.max(0, ...overlaps),
      titleWidth: titleWidth ?? 0,
      priceWidth: priceWidth ?? 0
    };
  });
  expect(darkSplitViewGeometry.selectCount).toBe(3);
  expect(darkSplitViewGeometry.whiteSelects).toBe(0);
  expect(darkSplitViewGeometry.maxCellOverlap).toBeLessThanOrEqual(1);
  expect(darkSplitViewGeometry.titleWidth).toBeGreaterThanOrEqual(150);
  expect(darkSplitViewGeometry.priceWidth).toBeGreaterThanOrEqual(80);
  if (process.env.SPT_CAPTURE_STEP5_UI === "true") {
    await page.screenshot({
      path: path.join(screenshotDir, "step-5-lv-dark-1366x768.png"),
      fullPage: false
    });
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("collapse is applied to the continuous list and browser-local workspace is restored", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop regression workflow");
  test.setTimeout(60_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  const basisLines = [
    ...Array.from({ length: 54 }, (_, index) => `1.1.${index + 1}. Gruppe A Pumpe 1 St`),
    ...Array.from({ length: 46 }, (_, index) => `2.1.${index + 1}. Gruppe B Ventil 1 St`),
    ...Array.from({ length: 42 }, (_, index) => `3.1.${index + 1}. Gruppe C Speicher 1 St`)
  ];

  await page.goto("/projects/new");
  await fillProjectMetadata(page, "Pagination Regression");
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: "basis-lv-pagination.pdf",
    mimeType: "application/pdf",
    buffer: syntheticPdf([
      "Angebotsaufforderung LV-Daten LV-Bezeichnung LV-Nummer 24-07 H",
      "Heizungsinstallation Inhaltsverzeichnis",
      ...basisLines
    ])
  });
  await expect(page.locator("[data-document-id]")).toHaveCount(1);
  await page.getByRole("button", { name: /Weiter: Dateien/ }).click();
  await page.getByRole("button", { name: /Verarbeitung starten/ }).click();
  await expect(page.locator("[data-processing-result]")).toBeVisible({
    timeout: 30_000
  });
  await page.getByRole("link", { name: /LV-Vergleich/ }).click();
  await expect(page.locator("[data-browser-local-lv]")).toBeVisible();

  await expect(page.locator("[data-lv-position]")).toHaveCount(142);
  await expect(page.locator('[data-lv-section="1.1"]')).toBeVisible();
  await expect(page.locator('[data-lv-section="2.1"]')).toBeVisible();
  await expect(page.locator('[data-lv-section="3.1"]')).toBeVisible();
  await expect(page.locator(".lv-list-summary")).toContainText(
    "142 Positionen in der aktuellen Ansicht"
  );
  await page.screenshot({
    path: path.join(screenshotDir, "continuous-list-before-collapse.png"),
    fullPage: true
  });

  await page.locator('[data-lv-section="1.1"] .lv-list-section-row').click();
  await expect(page.locator('[data-lv-section="1.1"]')).toHaveAttribute("data-collapsed", "true");
  await expect(page.locator("[data-lv-position]")).toHaveCount(88);
  await expect(page.locator('[data-lv-section="3.1"]')).toBeVisible();
  await expect(page.locator(".lv-list-summary")).toContainText(
    "88 Positionen in der aktuellen Ansicht"
  );
  await page.screenshot({
    path: path.join(screenshotDir, "continuous-list-after-collapse.png"),
    fullPage: true
  });

  await page.getByRole("button", { name: "Zurück zu Projekte", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page
    .locator(".browser-project-card")
    .filter({ hasText: "Pagination Regression" })
    .locator(".project-card-open")
    .click();
  await expect(page.locator("[data-browser-local-lv]")).toBeVisible();
  await expect(page.locator('[data-lv-section="1.1"]')).toHaveAttribute("data-collapsed", "true");
  await expect(page.locator("[data-lv-position]")).toHaveCount(88);
  await expect(page.locator(".lv-list-summary")).toContainText(
    "88 Positionen in der aktuellen Ansicht"
  );
  expect(runtimeErrors.filter((message) => message.includes("AbortError"))).toEqual([]);
});

test("project cards use stable illustrations in grid and list at 1366 px", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop visual workflow");
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/projects");
  await page.locator(".projects-primary-action").click();
  await fillProjectMetadata(
    page,
    "Ein außergewöhnlich lang benanntes Verwaltungsgebäude mit Bauabschnitt West"
  );
  await expect(page.getByText("Entwurf gespeichert")).toBeVisible();
  await page.getByRole("link", { name: "Zurück zu Projekten" }).click();
  for (const name of [
    "Wohnanlage Am Park",
    "Schulzentrum West",
    "Bürogebäude Skyline",
    "Produktionshalle 3"
  ]) {
    await page.locator(".projects-primary-action").click();
    await fillProjectMetadata(page, name);
    await expect(page.getByText("Entwurf gespeichert")).toBeVisible();
    await page.getByRole("link", { name: "Zurück zu Projekten" }).click();
  }
  await expect(page.locator(".browser-project-card")).toHaveCount(5);
  await expect(page.locator(".project-illustration svg").first()).toBeVisible();
  const illustrationId = await page
    .locator(".browser-project-card")
    .first()
    .locator(".project-illustration")
    .getAttribute("data-project-illustration");
  await page.screenshot({
    path: path.join(screenshotDir, "projects-grid-1366.png"),
    fullPage: true
  });
  await page.getByRole("button", { name: "Listenansicht" }).click();
  await expect(page.locator('[data-project-view="list"]')).toBeVisible();
  await expect(
    page.locator(".browser-project-card").first().locator(".project-illustration")
  ).toHaveAttribute("data-project-illustration", illustrationId!);
  await page.screenshot({
    path: path.join(screenshotDir, "projects-list-1366.png"),
    fullPage: true
  });
  await page.evaluate(async () => {
    const request = indexedDB.open("smart-procurement-tool");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("projects", "readwrite");
    const store = transaction.objectStore("projects");
    const project = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const all = store.getAll();
      all.onsuccess = () => resolve(all.result[0] as Record<string, unknown>);
      all.onerror = () => reject(all.error);
    });
    store.put({ ...project, illustrationId: "missing-illustration" });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await page.getByRole("button", { name: "Rasteransicht" }).click();
  await expect(
    page.locator('[data-project-illustration="building-fallback"]').first()
  ).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "projects-fallback.png"),
    fullPage: true
  });
});

test("mobile project creation has no horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile visual workflow");
  await page.goto("/projects/new");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: path.join(screenshotDir, "new-project-mobile.png"),
    fullPage: true
  });
});
