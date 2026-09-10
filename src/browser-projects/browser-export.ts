import type { BrowserAnalysisSnapshot, BrowserSelectionRecord } from "./types";

type ReviewStatus =
  | "Ausgewählt"
  | "Zuordnung ungeklärt"
  | "Zuordnung abgelehnt"
  | "Nicht ausgewählt";

type ExportRow = {
  position: string;
  basisDescription: string;
  reviewStatus: ReviewStatus;
  supplier: string;
  article: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  totalPrice: number | null;
  priceProvenance: string;
  packageCompleteness: string;
  basisReference: string;
  supplierReference: string;
};

function referencesFor(
  evidence: ReadonlyArray<{ documentId: string; pageNumber: number }>
): string {
  return [
    ...new Set(
      evidence.map((reference) => `${reference.documentId}, Seite ${reference.pageNumber}`)
    )
  ].join("; ");
}

function reviewStatusFor(input: {
  analysis: BrowserAnalysisSnapshot;
  positionId: string;
  hasValidHumanSelection: boolean;
}): ReviewStatus {
  if (input.hasValidHumanSelection) return "Ausgewählt";
  if (
    input.analysis.matchReviews.some(
      (review) => review.positionId === input.positionId && review.decision === "REJECTED"
    )
  ) {
    return "Zuordnung abgelehnt";
  }
  const position = input.analysis.pilot.projectReview.positions.find(
    (candidate) => candidate.basis.id === input.positionId
  );
  if (position?.independent.status === "AUTO_SELECTED_LOWEST_PRICE") {
    return "Nicht ausgewählt";
  }
  const presentOptions =
    position?.options.filter((option) => option.offerAvailability === "PRESENT") ?? [];
  const hasReliableOption = presentOptions.some(
    (option) => option.matchingAccepted && option.matchingReliable
  );
  if (presentOptions.length > 0 && !hasReliableOption) {
    return "Zuordnung ungeklärt";
  }
  return "Nicht ausgewählt";
}

function rowsFor(
  analysis: BrowserAnalysisSnapshot,
  selections: readonly BrowserSelectionRecord[]
): ExportRow[] {
  const selectedByPosition = new Map(
    selections.map((selection) => [selection.positionId, selection])
  );
  const offerLines = new Map(
    analysis.pilot.runs.flatMap((run) =>
      run.result.envelope.extraction.offerGroups.flatMap((group) =>
        group.lines.map((line) => [line.id, line] as const)
      )
    )
  );
  return analysis.pilot.projectReview.positions.map((position) => {
    const selection = selectedByPosition.get(position.basis.id);
    const option = selection
      ? position.options.find((candidate) => candidate.id === selection.selectedSupplierOptionId)
      : undefined;
    const selectedLineIds = option
      ? selection?.selectedLineIds.length
        ? selection.selectedLineIds
        : option.matchedOfferLineIds
      : [];
    const lines = selectedLineIds.flatMap((lineId) => {
      const line = offerLines.get(lineId);
      return line ? [line] : [];
    });
    const line = lines[0];
    const reviewStatus = reviewStatusFor({
      analysis,
      positionId: position.basis.id,
      hasValidHumanSelection: Boolean(option)
    });
    const articles = [
      ...new Set(
        lines.flatMap((candidate) => (candidate.articleNumber ? [candidate.articleNumber] : []))
      )
    ].join(", ");
    return {
      position: position.basis.positionNumber,
      basisDescription: position.basis.description,
      reviewStatus,
      supplier: option?.supplierLabel ?? "",
      article: articles,
      quantity: position.basis.quantity,
      unit: position.basis.unit ?? "",
      unitPrice: line?.interpretedUnitPrice ?? null,
      totalPrice: option?.pricedTotal ?? null,
      priceProvenance: option
        ? lines.some((candidate) => candidate.interpretedTotalPrice !== null)
          ? "Gesamtpreis aus Angebot"
          : option.pricedTotal !== null
            ? "Berechnet"
            : "Preis fehlt"
        : "",
      packageCompleteness: option
        ? option.requiredScopeComplete
          ? "Vollständig"
          : "Unvollständig"
        : "",
      basisReference: referencesFor(position.basis.evidence),
      supplierReference: referencesFor(lines.flatMap((candidate) => candidate.evidence))
    };
  });
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeName(name: string) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 80);
}

export async function exportBrowserProjectExcel(input: {
  projectName: string;
  analysis: BrowserAnalysisSnapshot;
  selections: readonly BrowserSelectionRecord[];
}) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Smart Procurement Tool";
  const sheet = workbook.addWorksheet("LV-Vergleich");
  sheet.columns = [
    { header: "Basis-Position", key: "position", width: 18 },
    { header: "Beschreibung", key: "basisDescription", width: 48 },
    { header: "Prüfstatus", key: "reviewStatus", width: 24 },
    { header: "Lieferant", key: "supplier", width: 24 },
    { header: "Artikel / Typ", key: "article", width: 22 },
    { header: "Menge", key: "quantity", width: 12 },
    { header: "Einheit", key: "unit", width: 12 },
    { header: "EP", key: "unitPrice", width: 15 },
    { header: "GP", key: "totalPrice", width: 15 },
    { header: "Preisquelle", key: "priceProvenance", width: 26 },
    { header: "Paket", key: "packageCompleteness", width: 18 },
    { header: "Basis-Quelle", key: "basisReference", width: 32 },
    { header: "Angebotsquelle", key: "supplierReference", width: 32 }
  ];
  sheet.addRows(rowsFor(input.analysis, input.selections));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0A54E8" }
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "M1" };
  const bytes = await workbook.xlsx.writeBuffer();
  download(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }),
    `${safeName(input.projectName)}-LV-Vergleich.xlsx`
  );
}

function pdfSafeText(value: string): string {
  return value
    .replace(/[–—]/g, "-")
    .replace(/€/g, "EUR")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e\xA0-\xFF]/g, "?");
}

function pdfString(value: string): string {
  return pdfSafeText(value).replace(/[()\\]/g, (character) => `\\${character}`);
}

function latin1Bytes(value: string): Uint8Array {
  const safe = value
    .replace(/[–—]/g, "-")
    .replace(/€/g, "EUR")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7e\xA0-\xFF]/g, "?");
  const bytes = new Uint8Array(safe.length);
  for (let index = 0; index < safe.length; index += 1) {
    bytes[index] = safe.charCodeAt(index);
  }
  return bytes;
}

function wrapText(value: string, width = 96): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const originalWord of words) {
    let word = originalWord;
    while (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatMoney(value: number | null): string {
  return value === null ? "-" : value.toFixed(2).replace(".", ",");
}

function pdfBlockFor(row: ExportRow): string[] {
  return [
    `${row.position} | Status: ${row.reviewStatus}`,
    ...wrapText(row.basisDescription).map((line) => `LV: ${line}`),
    ...wrapText(
      row.supplier ? `Auswahl: ${row.supplier} | Art.: ${row.article || "-"}` : "Auswahl: -"
    ),
    `Menge: ${row.quantity ?? "-"} ${row.unit} | EP: ${formatMoney(row.unitPrice)} EUR | GP: ${formatMoney(row.totalPrice)} EUR`,
    row.packageCompleteness
      ? `Paket: ${row.packageCompleteness} | Preisquelle: ${row.priceProvenance}`
      : "Paket / Preis: -",
    `Basis-Quelle: ${row.basisReference || "-"}`,
    `Angebotsquelle: ${row.supplierReference || "-"}`,
    ""
  ];
}

function paginateRows(rows: readonly ExportRow[], maximumLines = 58): string[][] {
  const pages: string[][] = [];
  let current: string[] = [];
  for (const row of rows) {
    const block = pdfBlockFor(row);
    if (current.length > 0 && current.length + block.length > maximumLines) {
      pages.push(current);
      current = [];
    }
    if (block.length <= maximumLines) {
      current.push(...block);
      continue;
    }
    for (let index = 0; index < block.length; index += maximumLines) {
      const chunk = block.slice(index, index + maximumLines);
      if (current.length > 0) pages.push(current);
      current = chunk;
      if (current.length === maximumLines) {
        pages.push(current);
        current = [];
      }
    }
  }
  if (current.length > 0 || pages.length === 0) pages.push(current);
  return pages;
}

function pdfPageContent(input: {
  projectName: string;
  lines: readonly string[];
  pageNumber: number;
  pageCount: number;
}): string {
  const displayLines = [
    `Smart Procurement Tool - ${input.projectName}`,
    "LV-Vergleich - geprüfte Auswahl",
    `Seite ${input.pageNumber} von ${input.pageCount}`,
    "",
    ...input.lines
  ];
  const commands = ["BT", "/F1 8 Tf"];
  let y = 806;
  for (const line of displayLines) {
    commands.push(`1 0 0 1 42 ${y} Tm`, `(${pdfString(line)}) Tj`);
    y -= 11;
  }
  commands.push(
    `1 0 0 1 42 24 Tm`,
    `(Erstellt mit Smart Procurement Tool | ${input.pageNumber}/${input.pageCount}) Tj`,
    "ET"
  );
  return commands.join("\n");
}

function buildPdf(input: { projectName: string; rows: readonly ExportRow[] }): Uint8Array {
  const pages = paginateRows(input.rows);
  const firstPageObjectId = 4;
  const pageObjectIds = pages.map((_, index) => firstPageObjectId + index * 2);
  const objects = new Map<number, string>();
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`
  );
  objects.set(
    3,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
  );
  pages.forEach((lines, index) => {
    const pageObjectId = pageObjectIds[index];
    const contentObjectId = pageObjectId + 1;
    const content = pdfPageContent({
      projectName: input.projectName,
      lines,
      pageNumber: index + 1,
      pageCount: pages.length
    });
    objects.set(
      pageObjectId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`
    );
    objects.set(
      contentObjectId,
      `<< /Length ${latin1Bytes(content).length} >>\nstream\n${content}\nendstream`
    );
  });

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const objectCount = 3 + pages.length * 2;
  const offsets = new Array<number>(objectCount + 1).fill(0);
  for (let id = 1; id <= objectCount; id += 1) {
    const object = objects.get(id);
    if (!object) throw new Error(`PDF object ${id} is missing`);
    offsets[id] = latin1Bytes(pdf).length;
    pdf += `${id} 0 obj\n${object}\nendobj\n`;
  }
  const xref = latin1Bytes(pdf).length;
  pdf += `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return latin1Bytes(pdf);
}

export function exportBrowserProjectPdf(input: {
  projectName: string;
  analysis: BrowserAnalysisSnapshot;
  selections: readonly BrowserSelectionRecord[];
}) {
  const rows = rowsFor(input.analysis, input.selections);
  const pdf = buildPdf({ projectName: input.projectName, rows });
  download(
    new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" }),
    `${safeName(input.projectName)}-LV-Vergleich.pdf`
  );
}
