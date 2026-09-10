import { expect, test } from "@playwright/test";

test("library is the German landing workflow and theme persists", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Produktbibliothek", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" }))
    .toContainText("Projekte");
  await expect(page.getByRole("link", { name: "Neues Projekt" })).toBeVisible();

  await page.getByRole("button", { name: "Darstellung" }).click();
  await page.getByRole("menuitemradio", { name: "Dunkel" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("mobile library keeps the primary workflow reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Produktbibliothek" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Navigation öffnen" }).click();
  await expect(page.getByRole("link", { name: "Projekte" })).toBeVisible();
});

test("dark theme keeps project directory and creation form readable", async ({
  page
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Darstellung" }).click();
  await page.getByRole("menuitemradio", { name: "Dunkel" }).click();
  await page.goto("/projects");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "Projekte" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText(
    "Lokal gespeichert"
  );
  await page.locator(".projects-primary-action").click();
  await expect(
    page.getByRole("heading", { name: "Neues Projekt erstellen" })
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("z. B. Neubau Verwaltungsgebäude")
  ).toBeVisible();
});
