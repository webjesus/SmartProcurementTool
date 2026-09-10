import { createCanvas } from "canvas";
import { expect, test, type Page } from "@playwright/test";

function imageOnlyLvPdf(options: { includePosition?: boolean } = {}): Buffer {
  const canvas = createCanvas(1_190, 1_684);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#111111";
  context.font = "bold 44px Arial";
  const lines = [
    "Angebotsaufforderung",
    "LV-Daten",
    "LV-Bezeichnung Heizungsinstallation",
    "LV-Nummer: 24-07-H",
    ...(options.includePosition === false
      ? ["Leistungsverzeichnis ohne automatisch erkennbare Positionsnummer"]
      : [
          "Position 1.1.10.",
          "OCR Pumpengruppe fuer Heizungsanlage",
          "2 St"
        ])
  ];
  lines.forEach((line, index) => context.fillText(line, 100, 170 + index * 150));
  const jpeg = canvas.toBuffer("image/jpeg", { quality: 0.96 });
  const content = Buffer.from("q\n595 0 0 842 0 0 cm\n/Scan Do\nQ\n", "ascii");
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "ascii"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>",
      "ascii"
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "ascii"),
      content,
      Buffer.from("endstream", "ascii")
    ]),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
        "ascii"
      ),
      jpeg,
      Buffer.from("\nendstream", "ascii")
    ])
  ];
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const wrapped = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
      object,
      Buffer.from("\nendobj\n", "ascii")
    ]);
    chunks.push(wrapped);
    length += wrapped.length;
  });
  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  ].join("");
  chunks.push(Buffer.from(xref, "ascii"));
  return Buffer.concat(chunks);
}

async function fillProject(page: Page) {
  await page.getByPlaceholder("z. B. Neubau Verwaltungsgebäude").fill("OCR Regression");
  await page
    .getByPlaceholder("Straße, Hausnummer, PLZ und Ort")
    .fill("Musterstraße 1, 70173 Stuttgart");
  await page.getByPlaceholder("Name des planenden Ingenieurbüros").fill("Ingenieurbüro Muster");
  await page.getByPlaceholder("Name des Architekturbüros").fill("Architekturbüro Muster");
}

test("uses self-hosted OCR for an image-only LV and keeps its source review-only", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop OCR workflow");
  test.setTimeout(180_000);
  const applicationOrigin = new URL(String(testInfo.project.use.baseURL ?? "http://127.0.0.1:3000"))
    .origin;
  const requestedOcrAssets: string[] = [];
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["http:", "https:"].includes(url.protocol)) return;
    if (url.pathname.startsWith("/ocr/")) requestedOcrAssets.push(url.pathname);
    if (url.origin !== applicationOrigin) externalRequests.push(url.href);
  });

  await page.goto("/projects/new");
  await fillProject(page);
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: "image-only-heizung-lv.pdf",
    mimeType: "application/pdf",
    buffer: imageOnlyLvPdf()
  });
  await expect(page.locator("[data-document-id]")).toHaveCount(1, {
    timeout: 30_000
  });
  await page.getByRole("button", { name: /Weiter: Dateien prüfen/ }).click();

  const documentRow = page.locator("[data-review-document]").first();
  await expect(documentRow).toHaveAttribute("data-scan-state", "OCR_AVAILABLE", {
    timeout: 120_000
  });
  await expect(
    documentRow.getByRole("button", { name: "OCR lokal starten" })
  ).toHaveCount(0);
  await expect(documentRow).toHaveAttribute("data-document-role", "BASIS_LV");
  await expect(documentRow).toContainText("Lokal per OCR gelesen");
  await expect(documentRow).toContainText("Prüfung erforderlich");
  expect(externalRequests).toEqual([]);
  expect(requestedOcrAssets).toEqual(
    expect.arrayContaining(["/ocr/worker/worker.min.js", "/ocr/lang/deu.traineddata.gz"])
  );
  expect(requestedOcrAssets.some((asset) => asset.endsWith(".wasm.js"))).toBe(true);

  await page.getByRole("button", { name: /Verarbeitung starten/ }).click();
  await expect(page.locator("[data-processing-result]")).toBeVisible({
    timeout: 120_000
  });
  const quality = page.locator("[data-document-quality]");
  await expect(quality).toHaveAttribute("data-document-quality", "REVIEW_REQUIRED");
  await expect(quality).toContainText("1 extrahiert · 1 im Vollscan erkannt");
  await expect(quality).toContainText("1 von 1 Seite im Vollscan verarbeitet");
  await expect(quality).toContainText("OCR-Quelle manuell prüfen");
  await expect(quality).toContainText("1 Fundstelle noch unbestätigt");
  await expect(quality).not.toContainText("ohne sichere Fundstelle");
  await expect(page.getByText("Per OCR gelesene Seiten")).toBeVisible();
  await expect(page.getByText("Per OCR gelesene Seiten").locator("..").locator("dd")).toHaveText(
    "1"
  );
  await page.getByRole("link", { name: /LV-Vergleich öffnen/ }).click();
  const position = page.locator(".lv-position-card", { hasText: "1.1.10" });
  await expect(position).toHaveCount(1);
  await position.getByRole("button", { name: "Basis-Quelle 1.1.10", exact: true }).click();
  const source = page.locator("[data-inline-source]");
  await expect(source).toHaveAttribute("data-extraction-source", "ocr");
  await expect(source.locator("[data-ocr-source]")).toHaveText(
    "OCR · manuell prüfen"
  );
  await expect(source.locator("[data-evidence-region]")).toHaveCount(1, {
    timeout: 30_000
  });
  await expect(source.locator("footer")).toHaveAttribute(
    "data-evidence-presentation",
    "visible_unconfirmed"
  );
  await expect(source.locator("footer")).toContainText(
    "Per OCR gelesen; Text, Fundstelle und Zuordnung manuell prüfen."
  );
  expect(externalRequests).toEqual([]);
});

test("recovers an OCR-readable LV with no detected position through audited manual capture", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop OCR recovery workflow");
  test.setTimeout(180_000);

  await page.goto("/projects/new");
  await fillProject(page);
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: "image-only-lv-ohne-position.pdf",
    mimeType: "application/pdf",
    buffer: imageOnlyLvPdf({ includePosition: false })
  });
  await expect(page.locator("[data-document-id]")).toHaveCount(1, {
    timeout: 30_000
  });
  await page.getByRole("button", { name: /Weiter: Dateien prüfen/ }).click();

  const documentRow = page.locator("[data-review-document]").first();
  await expect(documentRow).toHaveAttribute("data-scan-state", "OCR_AVAILABLE", {
    timeout: 120_000
  });
  await expect(documentRow).toHaveAttribute("data-document-role", "BASIS_LV");
  await page.getByRole("button", { name: /Verarbeitung starten/ }).click();

  const failed = page.locator(
    '[data-processing-result][data-processing-failed="FAILED_NO_BASIS_POSITIONS"]'
  );
  await expect(failed).toBeVisible({ timeout: 120_000 });
  await failed.locator("[data-manual-bootstrap-basis]").click();

  const editor = page.getByRole("dialog", { name: "Position manuell hinzufügen" });
  await expect(editor).toBeVisible();
  await editor.locator('[name="positionNumber"]').fill("1.1.10");
  await editor.locator('[name="shortDescription"]').fill("Manuell erfasste Pumpe");
  await editor
    .locator('[name="description"]')
    .fill("Vollständige Beschreibung aus dem Original-PDF manuell übertragen");
  await editor.locator('[name="quantity"]').fill("2");
  await editor.locator('[name="unit"]').fill("St");
  await editor.getByRole("button", { name: "Position hinzufügen" }).click();

  await expect(editor).toHaveCount(0);
  await expect(page.locator("[data-processing-result]")).not.toHaveAttribute(
    "data-processing-failed",
    "FAILED_NO_BASIS_POSITIONS"
  );
  await expect(page.locator("[data-document-quality]")).toContainText("1 extrahiert");
  await page.getByRole("link", { name: /LV-Vergleich öffnen/ }).click();
  await expect(page.locator('[data-lv-position="1.1.10"]')).toContainText(
    "Manuell erfasste Pumpe"
  );
});
