import { expect, test, type Locator, type Page } from "@playwright/test";

const realPilot = process.env.SPT_REAL_PILOT === "true";

async function authenticateAndOpen(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector(".decision-login") ||
          document.querySelector("[data-session-login]") ||
          document.querySelector(".project-card")
      )
  );
  const login = page.locator(".decision-login, [data-session-login]").first();
  if (await login.isVisible()) {
    await login.getByLabel("Anzeigename").fill("LV Reference Audit");
    await login.getByRole("button", { name: "Weiter" }).click();
  }
  await expect(page.locator(".project-card").first()).toBeVisible({
    timeout: 30_000
  });
  await page
    .locator(".project-card")
    .first()
    .getByRole("link", { name: "Öffnen" })
    .click();
  await expect(page.locator("[data-real-lv-workspace]")).toBeVisible({
    timeout: 90_000
  });
}

async function openCard(card: Locator) {
  if ((await card.getAttribute("data-expanded")) !== "true") {
    await card.locator(".lv-position-card-header").click();
  }
  await expect(card).toHaveAttribute("data-expanded", "true");
}

async function columnLefts(grid: Locator) {
  return grid.locator(":scope > *").evaluateAll((cells) =>
    cells.map((cell) => Math.round(cell.getBoundingClientRect().left * 10) / 10)
  );
}

async function expectAligned(reference: Locator, candidate: Locator) {
  const [referenceLefts, candidateLefts] = await Promise.all([
    columnLefts(reference),
    columnLefts(candidate)
  ]);
  expect(candidateLefts).toHaveLength(referenceLefts.length);
  for (let index = 0; index < referenceLefts.length; index += 1) {
    expect(
      Math.abs(referenceLefts[index] - candidateLefts[index]),
      `column ${index + 1}`
    ).toBeLessThanOrEqual(2);
  }
}

async function findCardWithOffers(page: Page, minimum: number) {
  const cards = page.locator(".lv-position-card");
  for (let index = 0; index < (await cards.count()); index += 1) {
    const card = cards.nth(index);
    await card.scrollIntoViewIfNeeded();
    await openCard(card);
    if ((await card.locator("[data-supplier-option]").count()) >= minimum) {
      return card;
    }
    await card.locator(".lv-position-card-header").click();
  }
  throw new Error(`No visible Basis position has ${minimum} real offers.`);
}

test.describe("approved two-pane LV reference audit", () => {
  test.skip(!realPilot, "Requires the persisted real corpus.");

  test("matches the approved hierarchy, details pane and source behavior", async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop audit only.");
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await authenticateAndOpen(page);

    const activeCard = await findCardWithOffers(page, 3);
    await activeCard.scrollIntoViewIfNeeded();
    const activePosition = await activeCard.getAttribute("data-lv-position");
    const offerHeader = activeCard.locator(".lv-offer-grid-header");
    const offerRows = activeCard.locator(".lv-offer-row[data-supplier-option]");
    await expect(offerRows).toHaveCount(3);
    await expect(activeCard).toHaveCSS("overflow", "hidden");
    const activeBorder = await activeCard.evaluate(
      (element) => getComputedStyle(element).borderTopWidth
    );
    expect(Number.parseFloat(activeBorder)).toBeGreaterThanOrEqual(1);
    expect(Number.parseFloat(activeBorder)).toBeLessThanOrEqual(1.5);

    for (let index = 0; index < (await offerRows.count()); index += 1) {
      const row = offerRows.nth(index);
      const box = await row.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(70);
      expect(box?.height ?? 0).toBeLessThanOrEqual(86);
      await expectAligned(offerHeader, row);
    }
    const rowBoxes = await activeCard
      .locator(".lv-offer-grid-header, .lv-offer-row")
      .evaluateAll((rows) =>
        rows.map((row) => {
          const rect = row.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        })
      );
    for (let index = 1; index < rowBoxes.length; index += 1) {
      expect(rowBoxes[index].top - rowBoxes[index - 1].bottom).toBeLessThanOrEqual(
        16
      );
    }
    await page.screenshot({
      path: testInfo.outputPath("01-active-position-all-real-suppliers.png")
    });

    if (
      (await activeCard
        .locator('.lv-offer-row[aria-pressed="true"]')
        .count()) === 0
    ) {
      await offerRows.first().click();
    }
    await expect(
      activeCard.locator('.lv-offer-row[aria-pressed="true"]').first()
    ).toBeVisible({ timeout: 20_000 });
    const firstRow = activeCard.locator(".lv-offer-row[data-supplier-option]").first();
    await expect(firstRow).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({
      path: testInfo.outputPath("02-selected-supplier-first.png")
    });

    const logoSlots = activeCard.locator(
      ".lv-offer-supplier .supplier-brand-mark > img, .lv-offer-supplier .supplier-brand-mark > .brand-fallback"
    );
    for (let index = 0; index < (await logoSlots.count()); index += 1) {
      const box = await logoSlots.nth(index).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(78);
      expect(box?.width ?? 0).toBeLessThanOrEqual(96);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(28);
      expect(box?.height ?? 0).toBeLessThanOrEqual(34);
    }
    await page.screenshot({
      path: testInfo.outputPath("03-supplier-logos-aligned.png")
    });

    await firstRow.getByRole("button", { name: /^Info / }).click();
    const pane = page.locator("[data-details-pane]");
    await expect(pane).toBeVisible();
    await expect(pane).toHaveAttribute("data-details-tab", "OFFER_DATA");
    await expect(pane.getByRole("tab")).toHaveCount(2);
    await expect(pane.locator("[data-offer-data]")).toBeVisible();
    const [listBox, paneBox] = await Promise.all([
      page.locator("[data-lv-list-pane]").boundingBox(),
      pane.boundingBox()
    ]);
    expect((paneBox?.x ?? 0) - ((listBox?.x ?? 0) + (listBox?.width ?? 0)))
      .toBeGreaterThanOrEqual(12);
    expect((paneBox?.x ?? 0) - ((listBox?.x ?? 0) + (listBox?.width ?? 0)))
      .toBeLessThanOrEqual(16);
    const paneRatio = (paneBox?.width ?? 0) / 1920;
    expect(paneRatio).toBeGreaterThanOrEqual(0.22);
    expect(paneRatio).toBeLessThanOrEqual(0.33);
    await page.screenshot({
      path: testInfo.outputPath("04-information-tab.png")
    });

    await pane.getByRole("tab", { name: "Originaldokument" }).click();
    await expect(pane).toHaveAttribute(
      "data-details-tab",
      "ORIGINAL_DOCUMENT"
    );
    const inlineSource = pane.locator("[data-inline-source]");
    await expect(inlineSource).toBeVisible();
    await expect(inlineSource.locator("canvas")).toBeVisible({
      timeout: 90_000
    });
    await expect(inlineSource.locator("[data-evidence-region]").first()).toBeVisible({
      timeout: 90_000
    });
    const sourceBeforeSupplierSwitch =
      await inlineSource.getAttribute("data-source-key");
    await page.screenshot({
      path: testInfo.outputPath("05-original-document-tab.png")
    });
    await page.screenshot({
      path: testInfo.outputPath("06-highlighted-pdf-source.png")
    });

    const otherSupplier = activeCard
      .locator('.lv-offer-row[data-supplier-option]:not([aria-pressed="true"])')
      .first();
    await otherSupplier.click();
    await expect(pane).toHaveAttribute(
      "data-details-tab",
      "ORIGINAL_DOCUMENT"
    );
    await expect(inlineSource).not.toHaveAttribute(
      "data-source-key",
      sourceBeforeSupplierSwitch ?? ""
    );
    await page.screenshot({
      path: testInfo.outputPath("07-supplier-switch-original-persists.png")
    });

    const nextCard = page
      .locator(
        `.lv-position-card:not([data-lv-position="${activePosition}"])`
      )
      .first();
    await nextCard.locator(".lv-position-card-header").click();
    await expect(pane).toHaveAttribute(
      "data-details-tab",
      "ORIGINAL_DOCUMENT"
    );
    await expect(pane).toContainText("Details zur Position");
    await page.screenshot({
      path: testInfo.outputPath("08-position-switch-original-persists.png")
    });

    await inlineSource.getByRole("button", { name: "Dokument Vollbild" }).click();
    const fullscreen = page.locator("[data-source-overlay]");
    await expect(fullscreen).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("09-fullscreen-pdf.png")
    });
    await fullscreen.getByLabel("Quelle schließen").click();
    await expect(fullscreen).toHaveCount(0);
    await expect(pane).toBeVisible();
    await expect(pane).toHaveAttribute(
      "data-details-tab",
      "ORIGINAL_DOCUMENT"
    );

    const collapsedCards = page.locator(
      '.lv-position-card[data-expanded="false"]'
    );
    expect(await collapsedCards.count()).toBeGreaterThanOrEqual(3);
    for (let index = 0; index < Math.min(3, await collapsedCards.count()); index += 1) {
      const box = await collapsedCards.nth(index).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
      expect(box?.height ?? 0).toBeLessThanOrEqual(72);
    }
    await page.screenshot({
      path: testInfo.outputPath("10-collapsed-rows-below-active.png")
    });

    await page.waitForTimeout(900);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-real-lv-workspace]")).toBeVisible({
      timeout: 90_000
    });
    await expect(page.locator("[data-details-pane]")).toHaveAttribute(
      "data-details-tab",
      "ORIGINAL_DOCUMENT"
    );

    const noOfferCard = page.locator('[data-lv-position="1.1.20."]');
    if (await noOfferCard.count()) {
      await openCard(noOfferCard);
      await expect(noOfferCard.locator(".lv-position-no-offers")).toHaveCount(1);
      await expect(noOfferCard).not.toContainText("Nicht zugeordnete Lieferanten");
      await page.screenshot({
        path: testInfo.outputPath("12-position-without-offers.png")
      });
    }
    const explicitCard = page.locator('[data-lv-position="1.1.120."]');
    if (await explicitCard.count()) {
      await openCard(explicitCard);
      await expect(
        explicitCard.locator('[data-option-validity="EXPLICIT_NO_OFFER"]')
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("13-explicit-no-offer.png")
      });
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page.locator("[data-details-pane]")).toBeVisible();
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - window.innerWidth,
      list:
        document.querySelector<HTMLElement>("[data-lv-list-pane]")!.scrollWidth -
        document.querySelector<HTMLElement>("[data-lv-list-pane]")!.clientWidth
    }));
    expect(overflow.document).toBeLessThanOrEqual(1);
    expect(overflow.list).toBeLessThanOrEqual(1);
    const [smallListBox, smallPaneBox] = await Promise.all([
      page.locator("[data-lv-list-pane]").boundingBox(),
      page.locator("[data-details-pane]").boundingBox()
    ]);
    expect((smallPaneBox?.x ?? 0)).toBeGreaterThanOrEqual(
      (smallListBox?.x ?? 0) + (smallListBox?.width ?? 0)
    );
    await page.screenshot({
      path: testInfo.outputPath("11-1366x768.png")
    });

    await expect(page.getByText("Nicht zugeordnete Lieferanten")).toHaveCount(0);
    for (const brandId of ["gienger", "pfeiffer-may", "reisser", "weishaupt"]) {
      await expect(page.locator(`[data-brand-id="${brandId}"]`).first()).toBeVisible();
    }
  });
});
