import type { BrowserAnalysisSnapshot, BrowserSelectionRecord } from "./types";

type ExportRow = {
  position: string;
  basisDescription: string;
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
  return analysis.pilot.projectReview.positions.flatMap((position) => {
    const selection = selectedByPosition.get(position.basis.id);
    const optionId =
      selection?.selectedSupplierOptionId ??
      position.independent.selectedSupplierOptionId;
    const option = position.options.find((candidate) => candidate.id === optionId);
    if (!option) return [];
    const line = offerLines.get(
      selection?.selectedLineIds[0] ?? option.matchedOfferLineIds[0]
    );
    const basisEvidence = position.basis.evidence[0];
    const supplierEvidence = line?.evidence[0];
    return [
      {
        position: position.basis.positionNumber,
        basisDescription: position.basis.description,
        supplier: option.supplierLabel,
        article: line?.articleNumber ?? "",
        quantity: position.basis.quantity,
        unit: position.basis.unit ?? "",
        unitPrice: line?.interpretedUnitPrice ?? null,
        totalPrice: option.comparableTotal,
        priceProvenance:
          line?.interpretedTotalPrice !== null ? "Gesamtpreis aus Angebot" : "Berechnet",
        packageCompleteness: option.requiredScopeComplete
          ? "Vollständig"
          : "Unvollständig",
        basisReference: basisEvidence
          ? `${basisEvidence.documentId}, Seite ${basisEvidence.pageNumber}`
          : "",
        supplierReference: supplierEvidence
          ? `${supplierEvidence.documentId}, Seite ${supplierEvidence.pageNumber}`
          : ""
      }
    ];
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
  sheet.autoFilter = { from: "A1", to: "L1" };
  const bytes = await workbook.xlsx.writeBuffer();
  download(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }),
    `${safeName(input.projectName)}-LV-Vergleich.xlsx`
  );
}

function ascii(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[()\\]/g, (character) => `\\${character}`);
}

export function exportBrowserProjectPdf(input: {
  projectName: string;
  analysis: BrowserAnalysisSnapshot;
  selections: readonly BrowserSelectionRecord[];
}) {
  const rows = rowsFor(input.analysis, input.selections);
  const lines = [
    `Smart Procurement Tool - ${input.projectName}`,
    "LV-Vergleich",
    "",
    ...rows.flatMap((row) => [
      `${row.position} | ${row.supplier} | ${row.totalPrice ?? "-"} EUR`,
      `${row.basisDescription.slice(0, 92)}`,
      `Menge ${row.quantity ?? "-"} ${row.unit} | Art. ${row.article || "-"}`,
      ""
    ])
  ].slice(0, 52);
  const content = [
    "BT",
    "/F1 10 Tf",
    "46 800 Td",
    ...lines.flatMap((line, index) =>
      index === 0
        ? [`(${ascii(line)}) Tj`]
        : ["0 -14 Td", `(${ascii(line)}) Tj`]
    ),
    "ET"
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  download(
    new Blob([pdf], { type: "application/pdf" }),
    `${safeName(input.projectName)}-LV-Vergleich.pdf`
  );
}
