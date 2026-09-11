import { chromium, expect } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";

const baseURL = process.env.SPT_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const pdfDir = path.join(process.cwd(), "tmp", "lv-design-audit");
const shotDir = path.join(pdfDir, "shots");
mkdirSync(shotDir, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${baseURL}/projects/new`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("z. B. Neubau Verwaltungsgebäude").fill("LV Design Audit");
  await page.getByPlaceholder("Straße, Hausnummer, PLZ und Ort").fill("Musterstraße 1, 70173 Stuttgart");
  await page.getByPlaceholder("Name des planenden Ingenieurbüros").fill("Ingenieurbüro Muster");
  await page.getByPlaceholder("Name des Architekturbüros").fill("Architekturbüro Muster");
  const fileInput = page.locator('input[type="file"][multiple]').first();
  await fileInput.setInputFiles([
    path.join(pdfDir, "basis-lv-redesign.pdf"),
    path.join(pdfDir, "Gienger-Angebot.pdf"),
    path.join(pdfDir, "P-und-M-Angebot.pdf")
  ]);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(shotDir, "after-upload.png"), fullPage: true });
  const uploadDebug = await page.evaluate(() => ({
    docs: document.querySelectorAll("[data-document-id]").length,
    summary: document.querySelector("[data-upload-summary]")?.textContent,
    body: document.body.innerText.slice(0, 800)
  }));
  console.log("UPLOAD_DEBUG", JSON.stringify(uploadDebug, null, 2));
  await expect(page.locator("[data-document-id]")).toHaveCount(3, { timeout: 60_000 });
  await page.getByRole("button", { name: /Weiter: Dateien prüfen/u }).click();
  await expect(page.locator("[data-document-review]")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Verarbeitung starten/u }).click();
  await expect(page.locator("[data-processing-result]")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: /LV-Vergleich öffnen/u }).click();
  await expect(page.locator('[data-lv-design="v2"][data-real-lv-workspace]')).toBeVisible({
    timeout: 60_000
  });
  await page.locator('[data-lv-position="1.1.10"]').click();
  await expect(page.locator("[data-persistent-inspector]")).toBeVisible();
  await expect(page.locator("[data-inline-source]")).toBeVisible({ timeout: 30_000 });

  await page.evaluate(() => {
    localStorage.setItem("spt.theme", "light");
    document.documentElement.setAttribute("data-theme", "light");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-lv-design="v2"][data-real-lv-workspace]')).toBeVisible({
    timeout: 60_000
  });
  await page.locator('[data-lv-position="1.1.10"]').click();
  await expect(page.locator("[data-inline-source]")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(shotDir, "light-1440.png"), fullPage: false });

  const lightAudit = await page.evaluate(() => {
    const workspace = document.querySelector("[data-real-lv-workspace]");
    const panes = {
      navigator: document.querySelector("[data-position-navigator]"),
      inspector: document.querySelector("[data-persistent-inspector]"),
      source: document.querySelector("[data-lv-source-pane]")
    };
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        left: Math.round(r.left),
        right: Math.round(r.right),
        top: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
        bg: cs.backgroundColor,
        color: cs.color,
        font: cs.fontFamily
      };
    };
    const texts = Array.from(
      document.querySelectorAll(
        "[data-real-lv-workspace] h1, [data-real-lv-workspace] strong, [data-lv-toolbar] button, [data-offer-comparison] span, [data-position-navigator] .lv-position-title"
      )
    )
      .slice(0, 40)
      .map((el) => ({
        text: (el.textContent || "").trim().slice(0, 80),
        overflow: el.scrollWidth - el.clientWidth > 2,
        clipped: el.getBoundingClientRect().right > window.innerWidth + 1
      }));
    return {
      theme: document.documentElement.getAttribute("data-theme"),
      design: workspace?.getAttribute("data-lv-design"),
      quiet: workspace?.classList.contains("lv-workspace--quiet"),
      panes: Object.fromEntries(Object.entries(panes).map(([k, v]) => [k, box(v)])),
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      whitePanels: Array.from(
        document.querySelectorAll(
          "[data-position-navigator], [data-offer-comparison], [data-persistent-inspector], [data-lv-toolbar], .lv-page-header"
        )
      ).map((el) => getComputedStyle(el).backgroundColor),
      texts
    };
  });
  console.log("LIGHT_AUDIT", JSON.stringify(lightAudit, null, 2));

  // Dark theme
  await page.evaluate(() => {
    localStorage.setItem("spt.theme", "dark");
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-lv-design="v2"][data-real-lv-workspace]')).toBeVisible({
    timeout: 60_000
  });
  await page.locator('[data-lv-position="1.1.10"]').click();
  await expect(page.locator("[data-inline-source]")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(shotDir, "dark-1440.png"), fullPage: false });

  const darkAudit = await page.evaluate(() => {
    const rgb = (value) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!match) return null;
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    };
    const isNearWhite = (value) => {
      const c = rgb(value);
      return Boolean(c && c[0] > 245 && c[1] > 245 && c[2] > 245);
    };
    const isNearBlackText = (value) => {
      const c = rgb(value);
      return Boolean(c && c[0] < 40 && c[1] < 40 && c[2] < 40);
    };
    const panels = Array.from(
      document.querySelectorAll(
        "[data-position-navigator], [data-offer-comparison], [data-persistent-inspector], [data-lv-toolbar], .lv-page-header, .lv-offer-row, .wb-sidebar"
      )
    ).map((el) => ({
      sel:
        el.getAttribute("data-position-navigator") != null
          ? "navigator"
          : el.getAttribute("data-offer-comparison") != null
            ? "offers"
            : el.getAttribute("data-persistent-inspector") != null
              ? "inspector"
              : el.classList.contains("lv-page-header")
                ? "header"
                : el.classList.contains("lv-toolbar")
                  ? "toolbar"
                  : el.classList.contains("lv-offer-row")
                    ? "offer-row"
                    : el.classList.contains("wb-sidebar")
                      ? "sidebar"
                      : "other",
      bg: getComputedStyle(el).backgroundColor,
      color: getComputedStyle(el).color,
      whiteBg: isNearWhite(getComputedStyle(el).backgroundColor),
      blackText: isNearBlackText(getComputedStyle(el).color)
    }));
    const nav = document.querySelector("[data-position-navigator]")?.getBoundingClientRect();
    const insp = document.querySelector("[data-persistent-inspector]")?.getBoundingClientRect();
    const source = document.querySelector("[data-lv-source-pane]")?.getBoundingClientRect();
    return {
      theme: document.documentElement.getAttribute("data-theme"),
      threePane:
        Boolean(nav && insp && source) &&
        nav.right <= insp.left + 2 &&
        insp.right <= source.left + 2,
      panels,
      whitePanelCount: panels.filter((p) => p.whiteBg).length,
      blackTextOnDark: panels.filter((p) => p.blackText && !p.whiteBg).length
    };
  });
  console.log("DARK_AUDIT", JSON.stringify(darkAudit, null, 2));
  console.log("SHOTS", shotDir);
  console.log("URL", page.url());
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
