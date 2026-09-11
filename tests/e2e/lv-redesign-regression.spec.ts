import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const screenshotDir = path.join(process.cwd(), "tmp", "lv-redesign-v2");

function syntheticPdf(lines: string[]): Buffer {
  const pages = Array.from({ length: Math.ceil(lines.length / 36) }, (_, pageIndex) =>
    lines.slice(pageIndex * 36, (pageIndex + 1) * 36)
  );
  const fontObjectId = 3 + pages.length * 2;
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
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

async function createLvFixture(page: Page) {
  await page.goto("/projects/new");
  await page.getByPlaceholder("z. B. Neubau Verwaltungsgebäude").fill("LV Redesign Regression");
  await page
    .getByPlaceholder("Straße, Hausnummer, PLZ und Ort")
    .fill("Musterstraße 1, 70173 Stuttgart");
  await page.getByPlaceholder("Name des planenden Ingenieurbüros").fill("Ingenieurbüro Muster");
  await page.getByPlaceholder("Name des Architekturbüros").fill("Architekturbüro Muster");
  await page.locator('input[type="file"][multiple]').setInputFiles([
    {
      name: "basis-lv-redesign.pdf",
      mimeType: "application/pdf",
      buffer: syntheticPdf([
        "Angebotsaufforderung LV-Daten LV-Bezeichnung LV-Nummer 24-07 H",
        "Heizungsinstallation Inhaltsverzeichnis",
        "1.1.10. Hocheffizienz Umwaelzpumpe Heizkreis DN 25 2 St",
        "1.1.20. Absperrventil Heizkreis DN 25 1 St",
        ...Array.from({ length: 18 }, (_, index) =>
          `1.1.${(index + 3) * 10}. Zusaetzliche Armatur Heizkreis DN 25 1 St`
        )
      ])
    },
    {
      name: "Gienger-Angebot.pdf",
      mimeType: "application/pdf",
      buffer: syntheticPdf([
        "Gienger Angebot Nr. 15875507-001 E-Preis Gesamtpreis",
        "Heizungsinstallation",
        "1.1.10 Umwaelzpumpe Heizkreis DN 25 2 St Art. GPX-2 EP 100,00 GP 200,00",
        "1.1.20 Absperrventil Heizkreis DN 25 1 St Art. GV-1 EP 28,00 GP 28,00"
      ])
    },
    {
      name: "P-und-M-Angebot.pdf",
      mimeType: "application/pdf",
      buffer: syntheticPdf([
        "Pfeiffer & May Angebot Nr. 591528-1 Version 2 E-Preis Gesamtpreis",
        "Heizungsinstallation",
        "1.1.10 Umwaelzpumpe Heizkreis DN 25 2 St Art. PM-2 EP 90,00 GP 180,00",
        "1.1.20 Absperrventil Heizkreis DN 25 1 St Art. PMV-1 EP 30,00 GP 30,00"
      ])
    }
  ]);
  await expect(page.locator("[data-document-id]")).toHaveCount(3, { timeout: 30_000 });
  await page.getByRole("button", { name: /Weiter: Dateien prüfen/u }).click();
  await expect(page.locator("[data-document-review]")).toBeVisible();
  await page.getByRole("button", { name: /Verarbeitung starten/u }).click();
  await expect(page.locator("[data-processing-result]")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: /LV-Vergleich öffnen/u }).click();
  await expect(page.locator("[data-real-lv-workspace]")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-lv-design="v2"][data-real-lv-workspace]')).toBeVisible();
  await expect(page.locator(".wb-app-frame")).toHaveAttribute("data-lv-design", "v2");
  await expect(page.locator("[data-real-lv-workspace]")).toHaveClass(/lv-workspace--quiet/);
  await expect(page.locator('[data-lv-position="1.1.10"]')).toBeVisible();
  await page.locator('[data-lv-position="1.1.10"]').click();
  await expect(page.locator("[data-persistent-inspector]")).toBeVisible();
  await expect(page.locator("[data-inline-source]")).toBeVisible({ timeout: 20_000 });
}

async function expectQuietToolbar(page: Page) {
  const toolbar = page.locator("[data-lv-toolbar]");
  await expect(toolbar.getByRole("searchbox", { name: "LV durchsuchen" })).toBeVisible();
  for (const label of ["Alle", "Offen", "Hinweise"] as const) {
    await expect(toolbar.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(toolbar.locator("summary").filter({ hasText: "Filter" })).toBeVisible();
  await expect(toolbar.locator("select:visible")).toHaveCount(0);
  const visibleControls = await toolbar
    .locator("input:visible, button:visible, select:visible, summary:visible")
    .count();
  expect(visibleControls).toBeLessThanOrEqual(5);
}

async function expectAccessibleOfferCards(comparison: Locator) {
  const cards = comparison.getByRole("table", { name: "Angebotsvergleich" }).locator("[data-supplier-option]");
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    await expect(card).toHaveAttribute("role", "row");
    await expect(card).toHaveAttribute("tabindex", "0");
    await expect(card.getByRole("cell")).toHaveCount(5);
    await expect(card.getByRole("button", { name: /auswählen$/u })).toBeVisible();
    await expect(card.locator(".lv-offer-product strong")).toHaveText(/Umwaelzpumpe/u);
    await expect(card.locator(".lv-offer-price strong")).toHaveText(/(?:180|200),00/u);
  }
}

async function expectDesktopGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        overflow: element.scrollWidth - element.clientWidth
      };
    };
    return {
      navigator: box("[data-position-navigator]"),
      inspector: box("[data-persistent-inspector]"),
      source: box("[data-lv-source-pane]"),
      pdf: box("[data-pdf-stage]"),
      toolbar: box("[data-lv-toolbar]"),
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sourceIsSibling: document.querySelector("[data-persistent-inspector]")?.nextElementSibling?.matches("[data-lv-source-pane]")
    };
  });
  expect(geometry.navigator).not.toBeNull();
  expect(geometry.inspector).not.toBeNull();
  expect(geometry.source).not.toBeNull();
  expect(geometry.navigator!.right).toBeLessThanOrEqual(geometry.inspector!.left + 1);
  expect(geometry.inspector!.right).toBeLessThanOrEqual(geometry.source!.left + 1);
  expect(Math.abs(geometry.navigator!.top - geometry.source!.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.inspector!.bottom - geometry.source!.bottom)).toBeLessThanOrEqual(1);
  expect(geometry.navigator!.width).toBeGreaterThanOrEqual(190);
  expect(geometry.inspector!.width).toBeGreaterThanOrEqual(370);
  expect(geometry.source!.width).toBeGreaterThanOrEqual(440);
  expect(geometry.pdf!.height).toBeGreaterThanOrEqual(400);
  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
  expect(geometry.toolbar!.overflow).toBeLessThanOrEqual(1);
  expect(geometry.inspector!.overflow).toBeLessThanOrEqual(1);
  expect(geometry.sourceIsSibling).toBe(true);
}

async function expectRowsStayInsideTheirGrid(page: Page) {
  const layout = await page.evaluate(() => {
    const bounds = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const master = document.querySelector<HTMLElement>(
      "[data-lv-position] .lv-position-card-header"
    );
    const offer = document.querySelector<HTMLElement>("[data-supplier-option]");
    const visible = (element: Element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    const masterCells = master
      ? Array.from(master.children)
          .filter((element) => !element.classList.contains("lv-position-open-target") && visible(element))
          .map(bounds)
      : [];
    const offerCells = offer ? Array.from(offer.children).filter(visible).map(bounds) : [];
    return {
      master: master ? bounds(master) : null,
      offer: offer ? bounds(offer) : null,
      supplier: offer ? bounds(offer.querySelector(".lv-offer-supplier")!) : null,
      supplierChildren: offer ? Array.from(offer.querySelector(".lv-offer-supplier")!.children).filter(visible).map(bounds) : [],
      masterCells,
      offerCells
    };
  });
  expect(layout.master).not.toBeNull();
  expect(layout.offer).not.toBeNull();
  expect(layout.offer!.bottom - layout.offer!.top).toBeLessThanOrEqual(260);
  for (const [parent, cells] of [[layout.master!, layout.masterCells], [layout.offer!, layout.offerCells], [layout.supplier!, layout.supplierChildren]] as const) {
    for (const cell of cells) {
      expect(cell.left).toBeGreaterThanOrEqual(parent.left - 1);
      expect(cell.right).toBeLessThanOrEqual(parent.right + 1);
      expect(cell.top).toBeGreaterThanOrEqual(parent.top - 1);
      expect(cell.bottom).toBeLessThanOrEqual(parent.bottom + 1);
    }
    for (let first = 0; first < cells.length; first += 1) {
      for (let second = first + 1; second < cells.length; second += 1) {
        const a = cells[first]!;
        const b = cells[second]!;
        const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        expect(overlapWidth <= 1 || overlapHeight <= 1).toBe(true);
      }
    }
  }
}

async function expectFullWidthPdf(source: Locator) {
  await expect(source).toHaveAttribute("data-source-fit-mode", "width");
  await expect(source.locator("canvas")).toBeVisible();
  await expect.poll(() => source.evaluate((element) => {
    const stage = element.querySelector<HTMLElement>("[data-pdf-stage]")!;
    const canvas = element.querySelector("canvas")!;
    return Math.abs(stage.clientWidth - canvas.getBoundingClientRect().width);
  })).toBeLessThanOrEqual(24);
}

async function expectEvidenceInVisiblePdfViewport(source: Locator) {
  const stage = source.locator("[data-pdf-stage]");
  const evidence = source.locator("[data-evidence-region]").first();
  await expect(stage).toBeVisible({ timeout: 20_000 });
  await expect(evidence).toBeVisible({ timeout: 20_000 });

  const visibleRatio = await source.evaluate((element) => {
    const stageElement = element.querySelector<HTMLElement>("[data-pdf-stage]");
    const evidenceElement = element.querySelector<HTMLElement>("[data-evidence-region]");
    if (!stageElement || !evidenceElement) return 0;
    const stageBox = stageElement.getBoundingClientRect();
    const evidenceBox = evidenceElement.getBoundingClientRect();
    const visibleStage = {
      left: Math.max(0, stageBox.left),
      top: Math.max(0, stageBox.top),
      right: Math.min(window.innerWidth, stageBox.right),
      bottom: Math.min(window.innerHeight, stageBox.bottom)
    };
    const intersectionWidth = Math.max(
      0,
      Math.min(evidenceBox.right, visibleStage.right) -
        Math.max(evidenceBox.left, visibleStage.left)
    );
    const intersectionHeight = Math.max(
      0,
      Math.min(evidenceBox.bottom, visibleStage.bottom) -
        Math.max(evidenceBox.top, visibleStage.top)
    );
    const evidenceArea = evidenceBox.width * evidenceBox.height;
    return evidenceArea > 0 ? (intersectionWidth * intersectionHeight) / evidenceArea : 0;
  });
  expect(visibleRatio).toBeGreaterThanOrEqual(0.8);
}

test.beforeAll(() => mkdirSync(screenshotDir, { recursive: true }));

test("LV v2 keeps comparison and evidence readable on standard screens", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop master-detail audit");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await createLvFixture(page);
  await expectQuietToolbar(page);

  const comparison = page.locator("[data-offer-comparison]");
  const source = page.locator("[data-inline-source]");
  await expectAccessibleOfferCards(comparison);
  await expectDesktopGeometry(page);
  await expectRowsStayInsideTheirGrid(page);
  await expectFullWidthPdf(source);
  const basisSourceKey = await source.getAttribute("data-source-key");
  expect(basisSourceKey).toMatch(/^basis:/u);

  const cheapestRow = comparison.locator('[data-cheapest="true"]');
  const otherRow = comparison.locator('[data-cheapest="false"]');
  const selection = cheapestRow.getByRole("button", { name: /auswählen$/u });
  await expect(selection).toHaveAttribute("aria-pressed", "false");
  await cheapestRow.click();
  await expect(source).toHaveAttribute("data-source-key", /^supplier:/u);
  const selectedSourceKey = await source.getAttribute("data-source-key");
  await expect(selection).toHaveAttribute("aria-pressed", "false");
  await expectFullWidthPdf(source);
  await expectEvidenceInVisiblePdfViewport(source);
  await selection.click();
  await expect(selection).toHaveAttribute("aria-pressed", "true");
  await expect(source).not.toHaveAttribute("data-source-key", basisSourceKey ?? "");
  await otherRow.click();
  await expect(source).not.toHaveAttribute("data-source-key", selectedSourceKey ?? "");
  await expect(selection).toHaveAttribute("aria-pressed", "true");
  await expect(otherRow.getByRole("button", { name: /auswählen$/u })).toHaveAttribute("aria-pressed", "false");
  await cheapestRow.focus();
  await cheapestRow.press("Enter");
  await expect(source).toHaveAttribute("data-source-key", selectedSourceKey ?? "");

  const pane = page.locator("[data-lv-decision-pane]");
  const sourceHeight = await source.evaluate((element) => element.getBoundingClientRect().height);
  await pane.getByRole("tab", { name: "Beschreibung", exact: true }).click();
  await expect(pane.locator("[data-basis-description]")).toBeVisible();
  await expect(pane.locator("[data-offer-data]")).toBeHidden();
  await pane.evaluate((element) => { element.scrollTop = 100; });
  await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBe(100);
  await pane.getByRole("tab", { name: "Angebotsdaten", exact: true }).click();
  await expect(pane.locator("[data-offer-data]")).toBeVisible();
  await expect(source).toHaveAttribute("data-source-key", selectedSourceKey ?? "");
  expect(await source.evaluate((element) => element.getBoundingClientRect().height)).toBe(sourceHeight);
  await pane.getByRole("tab", { name: "Beschreibung", exact: true }).click();
  await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBe(100);
  await source.getByRole("button", { name: "Position", exact: true }).click();
  await expect(source).toHaveAttribute("data-source-fit-mode", "evidence");
  await expectEvidenceInVisiblePdfViewport(source);
  await source.getByRole("button", { name: "Dokument an Breite anpassen" }).click();
  await expectFullWidthPdf(source);

  const font = await page
    .locator("[data-real-lv-workspace]")
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(font).toMatch(/^(?:"Inter Variable"|Inter)/u);
  const navigatorList = page.locator("[data-position-navigator] .lv-position-list");
  await navigatorList.evaluate((element) => { element.scrollTop = 240; });
  await expect.poll(() => navigatorList.evaluate((element) => element.scrollTop)).toBe(240);
  await page.reload();
  await expect(page.locator('[data-lv-design="v2"][data-real-lv-workspace]')).toBeVisible();
  await expect(page.locator(".wb-app-frame")).toHaveAttribute("data-lv-design", "v2");
  await expect(page.locator("[data-real-lv-workspace]")).toHaveClass(/lv-workspace--quiet/);
  await expectDesktopGeometry(page);
  await expect(selection).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await expect(source).toHaveAttribute("data-source-key", selectedSourceKey ?? "");
  await expect.poll(() => navigatorList.evaluate((element) => element.scrollTop)).toBe(240);
  await expect(pane.getByRole("tab", { name: "Beschreibung", exact: true })).toHaveAttribute("aria-selected", "true");
  await expectFullWidthPdf(source);
  await navigatorList.evaluate((element) => { element.scrollTop = 0; });
  await pane.evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(screenshotDir, "lv-v2-1920x1080.png") });

  await page.setViewportSize({ width: 1366, height: 768 });
  await expectDesktopGeometry(page);
  await expectRowsStayInsideTheirGrid(page);
  await expectFullWidthPdf(source);
  await expectEvidenceInVisiblePdfViewport(source);
  await cheapestRow.getByRole("button", { name: /^Info /u }).click();
  await expect(page.locator("[data-offer-data]")).toBeVisible();
  const sourceHeightWithDetails = await source.evaluate(
    (element) => element.getBoundingClientRect().height
  );
  expect(sourceHeightWithDetails).toBeGreaterThanOrEqual(550);
  await page.getByRole("button", { name: "Angebotsdaten schließen" }).click();
  await page.screenshot({ path: path.join(screenshotDir, "lv-v2-1366x768.png") });

  await page.getByRole("button", { name: "Darstellung" }).click();
  await page.getByRole("menuitemradio", { name: "Dunkel" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const whitePanels = await page
    .locator("[data-position-navigator], [data-offer-comparison], [data-persistent-inspector]")
    .evaluateAll(
      (elements) =>
        elements.filter(
          (element) => getComputedStyle(element).backgroundColor === "rgb(255, 255, 255)"
        ).length
    );
  expect(whitePanels).toBe(0);
  await page.screenshot({ path: path.join(screenshotDir, "lv-v2-dark-1366x768.png") });
});
