/**
 * Full product UI audit at 1920×1080 against a running next dev server.
 * Usage: node scripts/full-ui-audit-1920.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = join(process.cwd(), "tmp", "full-ui-audit-1920");
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  "/",
  "/projects",
  "/projects/new",
  "/pdf-erstellen",
  "/email-assistent",
  "/revisionsunterlagen",
  "/eigenes-lv",
  "/dokumente",
  "/gefundene-daten",
  "/pruefung",
  "/zuordnung",
  "/lv-vergleich",
  "/entscheidungen",
  "/export",
  "/evidence"
];

const NAV_LABELS = [
  "Produktbibliothek",
  "Projekte",
  "Neues Projekt",
  "PDF erstellen",
  "E-Mail-Assistent",
  "Revisionsunterlagen",
  "Eigenes LV"
];

/** @typedef {{ route: string, ok: boolean, status?: number, title?: string, errors: string[], warnings: string[], overflow: string[], screenshot?: string, finalUrl?: string }} AuditRow */

/** @type {AuditRow[]} */
const rows = [];
const consoleErrors = [];

function pushIssue(row, kind, message) {
  if (kind === "error") row.errors.push(message);
  else row.warnings.push(message);
}

async function measureOverflow(page) {
  return page.evaluate(() => {
    const issues = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 2) {
      issues.push(`horizontal-page-overflow:${doc.scrollWidth}x${window.innerWidth}`);
    }
    const shell = document.querySelector(".app-shell, [data-app-shell], main");
    if (shell && shell.scrollWidth > shell.clientWidth + 8) {
      issues.push(`shell-overflow:${shell.scrollWidth}>${shell.clientWidth}`);
    }
    for (const el of document.querySelectorAll("table, .lv-workspace, .document-review-table")) {
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth + 4) {
        issues.push(`element-clips-right:${el.className || el.tagName}`);
      }
    }
    return issues;
  });
}

async function auditRoute(page, route) {
  /** @type {AuditRow} */
  const row = { route, ok: true, errors: [], warnings: [], overflow: [] };
  const pageErrors = [];
  const onConsole = (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  };
  const onPageError = (err) => pageErrors.push(String(err));
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    const response = await page.goto(`${BASE}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });
    await page.waitForTimeout(900);
    row.status = response?.status();
    row.finalUrl = page.url();
    row.title = await page.title();
    if (!response || response.status() >= 400) {
      row.ok = false;
      pushIssue(row, "error", `HTTP ${response?.status() ?? "none"}`);
    }
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/Application error|Unhandled Runtime Error|This page could not be found|404/i.test(bodyText)) {
      // /evidence may legitimately 404 when corpus off
      if (route === "/evidence" && /404|could not be found/i.test(bodyText)) {
        pushIssue(row, "warning", "evidence unavailable (expected without corpus)");
      } else if (!/Noch nicht verfügbar|Kein LV-Projekt/i.test(bodyText)) {
        row.ok = false;
        pushIssue(row, "error", `error surface visible: ${bodyText.slice(0, 160)}`);
      }
    }
    row.overflow = await measureOverflow(page);
    if (row.overflow.length) {
      pushIssue(row, "warning", row.overflow.join("; "));
    }
    for (const err of pageErrors) {
      if (/favicon|Download the React DevTools|hydration/i.test(err)) {
        pushIssue(row, "warning", err.slice(0, 200));
      } else {
        row.ok = false;
        pushIssue(row, "error", err.slice(0, 300));
      }
    }
    const shot = join(OUT, `${route.replace(/\W+/g, "_") || "home"}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    row.screenshot = shot;
  } catch (error) {
    row.ok = false;
    pushIssue(row, "error", error instanceof Error ? error.message : String(error));
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
  rows.push(row);
  return row;
}

async function auditNavClicks(page) {
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  for (const label of NAV_LABELS) {
    const link = page.getByRole("navigation").getByRole("link", { name: label }).first();
    const row = {
      route: `nav:${label}`,
      ok: true,
      errors: [],
      warnings: [],
      overflow: []
    };
    try {
      if (!(await link.count())) {
        row.ok = false;
        pushIssue(row, "error", "nav link missing");
      } else {
        await link.click();
        await page.waitForTimeout(700);
        row.finalUrl = page.url();
        row.overflow = await measureOverflow(page);
        if (row.overflow.length) pushIssue(row, "warning", row.overflow.join("; "));
        const shot = join(OUT, `nav_${label.replace(/\W+/g, "_")}.png`);
        await page.screenshot({ path: shot, fullPage: false });
        row.screenshot = shot;
      }
    } catch (error) {
      row.ok = false;
      pushIssue(row, "error", error instanceof Error ? error.message : String(error));
    }
    rows.push(row);
  }
}

async function auditProjectWorkflow(page) {
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const projectLink = page.locator('a[href*="/projects/"]').filter({ hasNotText: /new|Neues/i }).first();
  const openBtn = page.getByRole("link", { name: /Öffnen|Entwurf fortsetzen|fortsetzen/i }).first();
  let href = null;
  if (await openBtn.count()) {
    href = await openBtn.getAttribute("href");
  } else if (await projectLink.count()) {
    href = await projectLink.getAttribute("href");
  }
  const row = {
    route: "workflow:open-existing",
    ok: true,
    errors: [],
    warnings: [],
    overflow: []
  };
  if (!href) {
    pushIssue(row, "warning", "no existing project to open");
    rows.push(row);
    return null;
  }
  await page.goto(new URL(href, BASE).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  row.finalUrl = page.url();
  row.overflow = await measureOverflow(page);
  const shot = join(OUT, "workflow_open.png");
  await page.screenshot({ path: shot, fullPage: false });
  row.screenshot = shot;
  if (row.overflow.length) pushIssue(row, "warning", row.overflow.join("; "));
  rows.push(row);

  // Follow deep links if we can extract projectId
  const match = row.finalUrl.match(/\/projects\/([^/?#]+)/);
  const projectId = match?.[1];
  if (!projectId || projectId === "new") return projectId;

  for (const suffix of [
    "/documents/review",
    "/processing",
    "/processing/result",
    "/lv-vergleich",
    "/documents"
  ]) {
    const deep = await auditRoute(page, `/projects/${projectId}${suffix}`);
    if (suffix === "/documents" && deep.status === 404) {
      deep.ok = false;
      pushIssue(deep, "error", "dead /documents route (should be /documents/review)");
    }
  }
  return projectId;
}

async function auditNewProjectForm(page) {
  const row = {
    route: "workflow:new-project-form",
    ok: true,
    errors: [],
    warnings: [],
    overflow: []
  };
  await page.goto(`${BASE}/projects/new`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const weiter = page.getByRole("button", { name: /Weiter:\s*Dateien prüfen/i });
  if (await weiter.count()) {
    const disabled = await weiter.isDisabled();
    if (!disabled) {
      pushIssue(row, "warning", "Weiter enabled with empty form");
    }
    const hint = await page.locator("text=/PDF|Datei|hochladen/i").count();
    if (disabled && !hint) {
      pushIssue(row, "warning", "Weiter disabled without visible upload hint");
    }
  } else {
    pushIssue(row, "error", "Weiter button missing");
    row.ok = false;
  }
  row.overflow = await measureOverflow(page);
  row.finalUrl = page.url();
  const shot = join(OUT, "workflow_new.png");
  await page.screenshot({ path: shot, fullPage: false });
  row.screenshot = shot;
  rows.push(row);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  for (const route of ROUTES) {
    await auditRoute(page, route);
  }
  await auditNavClicks(page);
  await auditNewProjectForm(page);
  await auditProjectWorkflow(page);

  // LV three-pane geometry if on LV page
  const lvRow = {
    route: "lv:three-pane-geometry",
    ok: true,
    errors: [],
    warnings: [],
    overflow: []
  };
  const lvLink = page.locator('a[href*="lv-vergleich"]').first();
  if (await lvLink.count()) {
    await lvLink.click().catch(() => undefined);
    await page.waitForTimeout(1500);
  }
  if (/lv-vergleich/.test(page.url())) {
    const geometry = await page.evaluate(() => {
      const root = document.querySelector(".lv-workspace, [data-lv-design]");
      if (!root) return { missing: true };
      const style = getComputedStyle(root);
      return {
        missing: false,
        display: style.display,
        columns: style.gridTemplateColumns,
        quiet: root.classList.contains("lv-workspace--quiet"),
        design: root.getAttribute("data-lv-design")
      };
    });
    lvRow.finalUrl = page.url();
    if (geometry.missing) {
      lvRow.ok = false;
      pushIssue(lvRow, "error", "LV workspace root missing");
    } else {
      if (!geometry.quiet && geometry.design !== "v2") {
        pushIssue(lvRow, "warning", `unexpected LV shell: ${JSON.stringify(geometry)}`);
      }
    }
    const shot = join(OUT, "lv_geometry.png");
    await page.screenshot({ path: shot, fullPage: false });
    lvRow.screenshot = shot;
  } else {
    pushIssue(lvRow, "warning", "LV page not reachable in this session");
  }
  rows.push(lvRow);

  await browser.close();

  const failed = rows.filter((r) => !r.ok || r.errors.length);
  const report = {
    base: BASE,
    viewport: "1920x1080",
    generatedAt: new Date().toISOString(),
    summary: {
      routes: rows.length,
      failed: failed.length,
      warnings: rows.reduce((n, r) => n + r.warnings.length, 0)
    },
    rows,
    consoleErrors: consoleErrors.slice(0, 50)
  };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(OUT, "report.md"),
    [
      `# Full UI audit 1920×1080`,
      ``,
      `- Base: ${BASE}`,
      `- Rows: ${rows.length}`,
      `- Failed: ${failed.length}`,
      ``,
      ...failed.map(
        (r) =>
          `## FAIL ${r.route}\n- url: ${r.finalUrl || ""}\n- errors: ${r.errors.join(" | ")}\n- warnings: ${r.warnings.join(" | ")}`
      ),
      ``,
      `## All rows`,
      ...rows.map(
        (r) =>
          `- ${r.ok ? "OK" : "FAIL"} \`${r.route}\` → ${r.finalUrl || ""} ${r.errors[0] || r.warnings[0] || ""}`
      )
    ].join("\n")
  );
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Report: ${join(OUT, "report.md")}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
