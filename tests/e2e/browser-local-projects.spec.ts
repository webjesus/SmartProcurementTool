import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const screenshotDir = path.join(process.cwd(), "tmp", "browser-local-visual");

function syntheticPdf(lines: string[]): Buffer {
  const pages = Array.from(
    { length: Math.ceil(lines.length / 36) },
    (_, pageIndex) => lines.slice(pageIndex * 36, (pageIndex + 1) * 36)
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

test.beforeAll(() => mkdirSync(screenshotDir, { recursive: true }));

test("classifies and processes the local mixed regression corpus", async ({
  page
}, testInfo) => {
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
  await page
    .getByPlaceholder("z. B. Neubau Verwaltungsgebäude")
    .fill("Mixed Corpus Regression");
  await page.locator('input[type="file"][multiple]').setInputFiles(corpusFiles);
  await expect(page.locator("[data-document-id]")).toHaveCount(12, {
    timeout: 120_000
  });
  await expect(page.locator("[data-upload-summary]")).toContainText(
    "12 Dateien ausgewählt"
  );
  await expect(page.locator("[data-upload-summary]")).toContainText(
    "2 OCR erforderlich"
  );
  await page
    .getByRole("button", { name: /Weiter: Dateien prüfen/ })
    .click();

  const review = page.locator("[data-document-review]");
  await expect(review).toBeVisible();
  await expect(page.locator('[data-document-role="BASIS_LV"]')).toHaveCount(2);
  await expect(
    page.locator('[data-document-role="SUPPLIER_OFFER"]')
  ).toHaveCount(7);
  await expect(
    page.locator('[data-document-role="TECHNICAL_CALCULATION"]')
  ).toHaveCount(1);
  await expect(
    page.locator('[data-document-role="SCAN_OCR_REQUIRED"]')
  ).toHaveCount(2);
  await expect(
    page.locator('[data-document-cluster="HEIZUNG"]')
  ).toContainText("Angebote: 4");
  await expect(
    page.locator('[data-document-cluster="SANITAER"]')
  ).toContainText("Angebote: 3");
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
  await addDialog
    .locator('input[type="file"]')
    .setInputFiles(path.join(corpusRoot, "Gienger.PDF"));
  await expect(addDialog.locator('[data-upload-status="DUPLICATE"]')).toContainText(
    "Identische Datei erkannt"
  );
  await page.screenshot({
    path: path.join(screenshotDir, "mixed-corpus-duplicate-summary.png"),
    fullPage: true
  });
  await addDialog.getByRole("button", { name: "Schließen" }).click();

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
  await expect(page.getByText("Vergleich ist bereit")).toBeVisible();
  await expect(
    page.locator(".processing-result-summary dl div").first().locator("dd")
  ).not.toHaveText("0");
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
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator("[data-browser-projects]")).toBeVisible();
  const sidebarToggle = page.getByRole("button", {
    name: "Navigation erweitern"
  });
  await sidebarToggle.click();
  await expect(
    page.getByRole("button", { name: "Navigation reduzieren" })
  ).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Navigation reduzieren" })
  ).toHaveAttribute("aria-expanded", "true");

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    status: "ok",
    deploymentMode: "BROWSER_LOCAL",
    mode: "browser-local",
    decisionPersistenceMode: "BROWSER_LOCAL"
  });

  await page.getByRole("link", { name: "Neues Projekt", exact: true }).click();
  await page.getByPlaceholder("z. B. Neubau Verwaltungsgebäude").fill("Neubau Verwaltung Nord");
  await page
    .getByPlaceholder("z. B. Standort, Bauabschnitt, Notizen")
    .fill("Bauabschnitt A");
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
  await expect(page.locator("[data-document-id]")).toHaveCount(2);
  await page.screenshot({
    path: path.join(screenshotDir, "new-project-with-pdfs.png"),
    fullPage: true
  });

  await page.reload();
  await expect(page.locator('input[value="Neubau Verwaltung Nord"]')).toBeVisible();
  await expect(page.locator("[data-document-id]")).toHaveCount(2);
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
  await expect(page.locator("[data-supplier-option]")).toHaveCount(1);
  await page.locator("[data-supplier-option]").click();
  await expect(
    page.locator('[data-supplier-option][aria-pressed="true"]')
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Info Position 1.1.10", exact: true })
    .click();
  await page.getByRole("tab", { name: "Originaldokument" }).click();
  await expect(page.locator('[data-details-tab="ORIGINAL_DOCUMENT"]')).toBeVisible();
  await expect(page.locator(".lv-inline-source-stage canvas")).toBeVisible();
  await expect(page.getByText("Dokumentseite wird geladen...")).toBeHidden();
  await page.screenshot({
    path: path.join(screenshotDir, "lv-original-document.png"),
    fullPage: true
  });

  await page.reload();
  await expect(page.locator('[data-lv-position="1.1.10"]')).toBeVisible();
  await expect(page.locator("[data-supplier-option]")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
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
  await expect(page.locator('[data-supplier-option][aria-pressed="true"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Projekte", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  expect(runtimeErrors.filter((message) => message.includes("AbortError"))).toEqual(
    []
  );
  const projectA = page
    .locator(".browser-project-card")
    .filter({ hasText: "Neubau Verwaltung Nord" });
  await expect(projectA).toBeVisible();
  await page
    .getByRole("button", { name: "Aktionen für Neubau Verwaltung Nord" })
    .click();
  await page.getByRole("button", { name: "Umbenennen" }).click();
  const editDialog = page.getByRole("dialog", { name: "Projekt bearbeiten" });
  await expect(editDialog).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "project-edit-modal.png"),
    fullPage: true
  });
  await editDialog.locator("input").fill("Neubau Verwaltung Nord aktualisiert");
  await editDialog
    .getByRole("button", { name: "Änderungen speichern" })
    .click();
  await expect(
    page
      .locator(".browser-project-card")
      .filter({ hasText: "Neubau Verwaltung Nord aktualisiert" })
  ).toBeVisible();

  await page.getByRole("link", { name: "Neues Projekt", exact: true }).click();
  await page.getByPlaceholder("z. B. Neubau Verwaltungsgebäude").fill("Projekt B");
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
  await expect(
    page.getByRole("dialog", { name: "Projekt wiederherstellen" })
  ).toContainText("Prüfsummen");
  await page
    .getByRole("dialog", { name: "Projekt wiederherstellen" })
    .getByRole("button", { name: "Projekt wiederherstellen" })
    .click();
  const restored = page
    .locator(".browser-project-card")
    .filter({ hasText: "Neubau Verwaltung Nord aktualisiert" });
  await expect(restored).toBeVisible();
  await restored.locator(".project-metrics").click();
  await expect(page.locator('[data-lv-position="1.1.10"]')).toBeVisible();
  await expect(
    page.locator('[data-supplier-option][aria-pressed="true"]')
  ).toHaveCount(1);
  await expect(page.locator('[data-details-tab="ORIGINAL_DOCUMENT"]')).toBeVisible();

  await page.getByRole("button", { name: "Projekte", exact: true }).click();
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
  await expect(duplicateCard.locator(".project-metrics dd").nth(1)).toHaveText(
    "3"
  );
  await page.screenshot({
    path: path.join(screenshotDir, "duplicate-project-complete.png"),
    fullPage: true
  });
  await duplicateCard.locator(".project-metrics").click();
  await expect(page.locator("[data-browser-local-lv]")).toBeVisible();
  await expect(page.locator('[data-details-tab="ORIGINAL_DOCUMENT"]')).toBeVisible();
  await expect(page.locator(".lv-inline-source-stage canvas")).toBeVisible();
});

test("collapse is applied before pagination and browser-local workspace is restored", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop regression workflow");
  test.setTimeout(60_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  const basisLines = [
    ...Array.from(
      { length: 54 },
      (_, index) => `1.1.${index + 1}. Gruppe A Pumpe 1 St`
    ),
    ...Array.from(
      { length: 46 },
      (_, index) => `2.1.${index + 1}. Gruppe B Ventil 1 St`
    ),
    ...Array.from(
      { length: 42 },
      (_, index) => `3.1.${index + 1}. Gruppe C Speicher 1 St`
    )
  ];

  await page.goto("/projects/new");
  await page
    .locator('input[placeholder^="z. B. Neubau"]')
    .fill("Pagination Regression");
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

  await page
    .getByRole("combobox", { name: "Positionen pro Seite" })
    .selectOption("100");
  await expect(page.locator("[data-lv-position]")).toHaveCount(100);
  await expect(page.locator('[data-lv-section="1.1"]')).toBeVisible();
  await expect(page.locator('[data-lv-section="2.1"]')).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "pagination-before-collapse.png"),
    fullPage: true
  });

  await page.locator('[data-lv-section="1.1"] .lv-list-section-row').click();
  await expect(page.locator('[data-lv-section="1.1"]')).toHaveAttribute(
    "data-collapsed",
    "true"
  );
  await expect(page.locator("[data-lv-position]")).toHaveCount(88);
  await expect(page.locator('[data-lv-section="3.1"]')).toBeVisible();
  await expect(page.locator(".lv-pagination")).toContainText(
    "Zeige 1 bis 88 von 88 Positionen"
  );
  await page.screenshot({
    path: path.join(screenshotDir, "pagination-after-collapse.png"),
    fullPage: true
  });

  await page.locator('[data-lv-section="1.1"] .lv-list-section-row').click();
  await expect(page.locator("[data-lv-position]")).toHaveCount(100);
  await page.locator(".lv-pagination nav").getByRole("button", { name: "2" }).click();
  await expect(page.locator("[data-lv-position]")).toHaveCount(42);
  await page.screenshot({
    path: path.join(screenshotDir, "pagination-page-2.png"),
    fullPage: true
  });

  await page
    .getByRole("combobox", { name: "Positionen pro Seite" })
    .selectOption("50");
  await page.locator(".lv-pagination nav").getByRole("button", { name: "1" }).click();
  await page.locator('[data-lv-section="1.1"] .lv-list-section-row').click();
  await page.locator(".lv-pagination nav").getByRole("button", { name: "2" }).click();
  await expect(page.locator(".lv-pagination nav .active")).toHaveText("2");

  await page.getByRole("button", { name: "Projekte", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page
    .locator(".browser-project-card")
    .filter({ hasText: "Pagination Regression" })
    .locator(".project-card-open")
    .click();
  await expect(page.locator("[data-browser-local-lv]")).toBeVisible();
  await expect(page.locator(".lv-pagination nav .active")).toHaveText("2");
  await page.locator(".lv-pagination nav").getByRole("button", { name: "1" }).click();
  await expect(page.locator('[data-lv-section="1.1"]')).toHaveAttribute(
    "data-collapsed",
    "true"
  );
  expect(runtimeErrors.filter((message) => message.includes("AbortError"))).toEqual(
    []
  );
});

test("project cards use stable illustrations in grid and list at 1366 px", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop visual workflow");
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/projects");
  await page.getByRole("link", { name: "Neues Projekt", exact: true }).click();
  await page.getByPlaceholder("z. B. Neubau Verwaltungsgebäude").fill(
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
    await page.getByRole("link", { name: "Neues Projekt", exact: true }).click();
    await page.getByPlaceholder("z. B. Neubau Verwaltungsgebäude").fill(name);
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

test("mobile project creation has no horizontal overflow", async ({
  page
}, testInfo) => {
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
