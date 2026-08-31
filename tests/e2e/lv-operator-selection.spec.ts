import { expect, test, type Page } from "@playwright/test";

const realPilot = process.env.SPT_REAL_PILOT === "true";

async function openProject(page: Page) {
  await page.goto("/lv-vergleich", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-real-lv-workspace]")).toBeVisible({
    timeout: 90_000
  });
}

test.describe("operator-driven LV two-pane workspace", () => {
  test.skip(!realPilot, "Requires the persisted real pilot dataset.");
  test("selects by row click and restores selection, pane tab and pagination", async ({
    page
  }, testInfo) => {
    test.setTimeout(210_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openProject(page);

    await expect(page.getByText(/Supplier Alpha|Supplier Beta|Supplier Gamma/))
      .toHaveCount(0);
    await expect(page.getByText("Nicht zugeordnete Lieferanten")).toHaveCount(0);
    await expect(page.locator(".lv-position-card")).toHaveCount(20);

    const parent = page.locator('[data-lv-position="1.1.10."]');
    await parent.locator(".lv-position-card-header").click();
    await expect(parent).toHaveAttribute("data-expanded", "true");
    const supplierRows = parent.locator(
      ".lv-offer-row[data-supplier-option]"
    );
    expect(await supplierRows.count()).toBeGreaterThanOrEqual(2);
    await expect(
      supplierRows.getByRole("button", { name: /^Quelle / })
    ).toHaveCount(await supplierRows.count());
    await expect(
      supplierRows.getByRole("button", { name: /^Info / })
    ).toHaveCount(await supplierRows.count());

    const target = supplierRows.nth(1);
    const targetId = await target.getAttribute("data-supplier-option");
    await target.click();
    await expect(
      parent.locator(".lv-offer-row[data-supplier-option]").first()
    ).toHaveAttribute("data-supplier-option", targetId ?? "", {
      timeout: 20_000
    });
    await expect(
      parent.locator(".lv-offer-row[data-supplier-option]").first()
    ).toHaveAttribute("aria-pressed", "true");

    await parent
      .locator(".lv-offer-row[data-supplier-option]")
      .first()
      .getByRole("button", { name: /^Info / })
      .click();
    const pane = page.locator("[data-details-pane]");
    await expect(pane).toBeVisible();
    await expect(pane.getByRole("tab")).toHaveCount(2);
    await pane.getByRole("tab", { name: "Originaldokument" }).click();
    await expect(pane).toHaveAttribute(
      "data-details-tab",
      "ORIGINAL_DOCUMENT"
    );
    await page.screenshot({
      path: testInfo.outputPath("01-selected-two-pane.png")
    });

    const pageTwo = page.locator(".lv-pagination nav button").filter({
      hasText: "2"
    });
    await pageTwo.click();
    await expect(page.locator(".lv-pagination button.active")).toHaveText("2");
    await page.waitForTimeout(1_000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-real-lv-workspace]")).toBeVisible({
      timeout: 90_000
    });
    await expect(page.locator(".lv-pagination button.active")).toHaveText("2");
    await expect(page.locator("[data-details-pane]")).toHaveAttribute(
      "data-details-tab",
      "ORIGINAL_DOCUMENT"
    );
  });

  test("opens inline exact source and keeps fullscreen optional", async ({
    page
  }, testInfo) => {
    test.setTimeout(210_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await openProject(page);
    const parent = page.locator('[data-lv-position="1.1.10."]');
    if (await parent.count()) {
      if ((await parent.getAttribute("data-expanded")) !== "true") {
        await parent.locator(".lv-position-card-header").click();
      }
      const row = parent
        .locator('.lv-offer-row[data-supplier-label="Gienger"]')
        .first();
      await row.getByRole("button", { name: /^Quelle / }).click();
      const pane = page.locator("[data-details-pane]");
      await expect(pane).toHaveAttribute(
        "data-details-tab",
        "ORIGINAL_DOCUMENT"
      );
      const inline = pane.locator("[data-inline-source]");
      await expect(inline.locator("canvas")).toBeVisible({ timeout: 90_000 });
      await expect(inline.locator("[data-evidence-region]").first()).toBeVisible({
        timeout: 90_000
      });
      await expect(page.locator("[data-source-overlay]")).toHaveCount(0);
      await inline.getByRole("button", { name: "Dokument Vollbild" }).click();
      const fullscreen = page.locator("[data-source-overlay]");
      await expect(fullscreen).toBeVisible();
      await fullscreen.getByLabel("Quelle schließen").click();
      await expect(fullscreen).toHaveCount(0);
      await expect(pane).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("02-inline-source-1366.png")
      });
    }

    const warningTrigger = page.locator(".lv-warning-trigger");
    await warningTrigger.click();
    await expect(page.locator("[data-warning-center]")).toBeVisible();

    const excel = page.waitForEvent("download");
    await page.getByRole("link", { name: /Excel/ }).click();
    expect((await excel).suggestedFilename()).toMatch(/\.xlsx$/);
    const pdf = page.waitForEvent("download");
    await page.getByRole("link", { name: /PDF/ }).click();
    expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);
  });
});
