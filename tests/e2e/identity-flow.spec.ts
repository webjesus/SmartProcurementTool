import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";

const centralE2e = process.env.SPT_CENTRAL_E2E === "true";
const screenshotDirectory = path.resolve(
  process.cwd(),
  ".postgres-local",
  "screenshots"
);

function hostUrl(hostname: "127.0.0.1" | "localhost"): string {
  const configured = new URL(
    process.env.SPT_E2E_BASE_URL ?? "http://127.0.0.1:3000"
  );
  return `${configured.protocol}//${hostname}:${configured.port || "3000"}`;
}

async function expectIdentityModal(page: Page) {
  const modal = page.locator("[data-session-login]");
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("heading", {
      name: "Wer bearbeitet die Entscheidungen?"
    })
  ).toBeVisible();
  return modal;
}

async function submitIdentity(
  context: BrowserContext,
  page: Page,
  displayName: string
) {
  const modal = await expectIdentityModal(page);
  await modal.getByPlaceholder("Vor- und Nachname").fill(displayName);
  const postPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/session") &&
      response.request().method() === "POST"
  );
  const confirmationPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/session") &&
      response.request().method() === "GET" &&
      response.status() === 200
  );
  await modal.getByRole("button", { name: "Weiter" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  const post = await postPromise;
  const confirmation = await confirmationPromise;
  expect(post.status()).toBe(201);
  expect(confirmation.status()).toBe(200);
  const postPayload = (await post.json()) as {
    user: {
      id: string;
      displayName: string;
      sessionId: string;
    };
  };
  const getPayload = (await confirmation.json()) as typeof postPayload;
  expect(getPayload.user).toMatchObject({
    id: postPayload.user.id,
    displayName: postPayload.user.displayName,
    sessionId: postPayload.user.sessionId
  });
  expect(postPayload.user.displayName).toBe(displayName.trim());
  expect(postPayload.user).not.toHaveProperty("role");

  const headers = await post.allHeaders();
  expect(headers["set-cookie"]).toContain("spt_decision_session=");
  expect(headers["set-cookie"]).toContain("Path=/");
  expect(headers["set-cookie"]).toContain("HttpOnly");
  expect(headers["set-cookie"]?.toLowerCase()).toContain("samesite=lax");
  expect(headers["set-cookie"]).toContain("Max-Age=15552000");
  expect(headers["set-cookie"]).not.toMatch(/;\s*Secure/i);

  const cookies = await context.cookies(page.url());
  const cookie = cookies.find(
    (candidate) => candidate.name === "spt_decision_session"
  );
  expect(cookie).toMatchObject({
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
    path: "/"
  });
  expect(cookie?.expires ?? 0).toBeGreaterThan(Date.now() / 1000 + 60 * 60 * 24);
  return { postPayload, headers, cookie };
}

test.describe.serial("first-time decision identity", () => {
  test.skip(!centralE2e, "Requires a migrated real PostgreSQL test database.");

  test("creates and reloads one Admin identity on 127.0.0.1", async ({
    browser
  }) => {
    test.setTimeout(120_000);
    await mkdir(screenshotDirectory, { recursive: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${hostUrl("127.0.0.1")}/lv-vergleich`, {
        waitUntil: "domcontentloaded"
      });
      const result = await submitIdentity(context, page, "Admin");
      await expect(page.locator("[data-session-login]")).toHaveCount(0);
      await expect(page.locator("[data-real-lv-workspace]")).toBeVisible();
      await expect(page.getByText("Bearbeitet von:")).toContainText("Admin");
      await page.screenshot({
        path: path.join(screenshotDirectory, "identity-after-login.png"),
        fullPage: true
      });

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("[data-real-lv-workspace]")).toBeVisible();
      await expect(page.locator("[data-session-login]")).toHaveCount(0);
      await expect(page.getByText("Bearbeitet von:")).toContainText("Admin");
      const get = await page.request.get("/api/session");
      expect(get.status()).toBe(200);
      const getPayload = await get.json();
      expect(getPayload.user.id).toBe(result.postPayload.user.id);
      expect(getPayload.user.sessionId).toBe(
        result.postPayload.user.sessionId
      );
      await page.screenshot({
        path: path.join(
          screenshotDirectory,
          "identity-after-reload-without-modal.png"
        ),
        fullPage: true
      });

      const sql = postgres(process.env.DATABASE_URL!, {
        max: 1,
        prepare: false
      });
      try {
        const records = await sql<
          {
            user_id: string;
            display_name: string;
            session_id: string;
            user_created_at: Date;
            user_last_seen_at: Date;
            session_last_seen_at: Date;
            expires_at: Date;
          }[]
        >`
          select
            u.id as user_id,
            u.display_name,
            s.id as session_id,
            u.created_at as user_created_at,
            u.last_seen_at as user_last_seen_at,
            s.last_seen_at as session_last_seen_at,
            s.expires_at
          from users u
          join user_sessions s on s.user_id = u.id
          where u.id = ${result.postPayload.user.id}
            and s.id = ${result.postPayload.user.sessionId}
        `;
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          user_id: result.postPayload.user.id,
          display_name: "Admin",
          session_id: result.postPayload.user.sessionId
        });
        expect(records[0]!.user_last_seen_at.getTime()).toBeGreaterThanOrEqual(
          records[0]!.user_created_at.getTime()
        );
        expect(records[0]!.session_last_seen_at.getTime()).toBeGreaterThanOrEqual(
          records[0]!.user_created_at.getTime()
        );
      } finally {
        await sql.end();
      }

      const otherContext = await browser.newContext();
      try {
        const otherPage = await otherContext.newPage();
        await otherPage.goto(`${hostUrl("127.0.0.1")}/lv-vergleich`, {
          waitUntil: "domcontentloaded"
        });
        await expectIdentityModal(otherPage);
      } finally {
        await otherContext.close();
      }
    } finally {
      await context.close();
    }
  });

  test("creates a separate Unicode identity on localhost", async ({
    browser
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${hostUrl("localhost")}/lv-vergleich`, {
        waitUntil: "domcontentloaded"
      });
      const result = await submitIdentity(
        context,
        page,
        "Адміністратор Тест"
      );
      expect(result.postPayload.user.displayName).toBe("Адміністратор Тест");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("[data-session-login]")).toHaveCount(0);
      await expect(page.getByText("Bearbeitet von:")).toContainText(
        "Адміністратор Тест"
      );
    } finally {
      await context.close();
    }
  });

  test("shows actionable API errors and prevents duplicate submit", async ({
    browser
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let postCount = 0;
    let releasePost!: () => void;
    const postRelease = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    try {
      await page.route("**/api/session", async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ error: "AUTHENTICATION_REQUIRED" })
          });
          return;
        }
        postCount += 1;
        await postRelease;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "CENTRAL_DATABASE_UNAVAILABLE",
            message: "Verbindung zur Datenbank fehlgeschlagen."
          })
        });
      });
      await page.goto(`${hostUrl("127.0.0.1")}/lv-vergleich`, {
        waitUntil: "domcontentloaded"
      });
      const modal = await expectIdentityModal(page);
      const input = modal.getByPlaceholder("Vor- und Nachname");
      await input.fill("Fehler Prüfer");
      const button = modal.locator("button");
      await button.evaluate((element) => {
        (element as HTMLButtonElement).click();
        (element as HTMLButtonElement).click();
      });
      await expect(button).toBeDisabled();
      await expect(button).toHaveText("Speichern...");
      releasePost();
      await expect(modal.locator(".action-error")).toHaveText(
        "Verbindung zur Datenbank fehlgeschlagen."
      );
      await expect(input).toHaveValue("Fehler Prüfer");
      expect(postCount).toBe(1);
    } finally {
      releasePost();
      await context.close();
    }
  });

  test("does not show the name modal while startup GET is failing", async ({
    browser
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.route("**/api/session", async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "CENTRAL_DATABASE_UNAVAILABLE",
            message: "Verbindung zur Datenbank fehlgeschlagen."
          })
        });
      });
      await page.goto(`${hostUrl("127.0.0.1")}/lv-vergleich`, {
        waitUntil: "domcontentloaded"
      });
      await expect(page.locator("[data-session-login]")).toHaveCount(0);
      const error = page.locator("[data-session-error]");
      await expect(error).toBeVisible();
      await expect(error.locator(".action-error")).toHaveText(
        "Verbindung zur Datenbank fehlgeschlagen."
      );

      await page.unroute("**/api/session");
      await error.getByRole("button", { name: "Erneut versuchen" }).click();
      await expectIdentityModal(page);
    } finally {
      await context.close();
    }
  });
});
