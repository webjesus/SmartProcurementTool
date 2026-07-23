import { expect, test } from "@playwright/test";

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

test("all primary pages render at desktop and mobile widths", async ({ page }, testInfo) => {
  const runtimeFailures = watchRuntimeFailures(page);
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
