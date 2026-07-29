import ExcelJS from "exceljs";
import type { CentralSupplierDecision } from "@/domain/central-decision";
import type { PilotState } from "@/storage/document-storage";
import {
  buildOperatorSupplierOptionReadModel
} from "@/domain/operator-supplier-option-read-model";

export type SelectedPositionExportRow = {
  position: string;
  basisDescription: string;
  quantity: number | null;
  unit: string | null;
  supplier: string;
  offerDescription: string;
  manufacturer: string | null;
  articleNumber: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  priceProvenance: string;
  packageCompleteness: string;
  selectedLineIds: string[];
  supplierBrandId: string;
  manufacturerBrandId: string | null;
  readModelVersion: string;
  document: string;
  page: number | null;
  internalNote: string;
};

function latestSelected(
  decisions: readonly CentralSupplierDecision[]
): CentralSupplierDecision[] {
  const byPosition = new Map<string, CentralSupplierDecision>();
  for (const decision of decisions) {
    const current = byPosition.get(decision.positionId);
    if (!current || current.decisionVersion < decision.decisionVersion) {
      byPosition.set(decision.positionId, decision);
    }
  }
  return [...byPosition.values()].filter(
    (decision) =>
      decision.outcome === "SELECTED" &&
      Boolean(decision.selectedSupplierOptionId)
  );
}

export function selectedPositionExportRows(
  state: PilotState,
  decisions: readonly CentralSupplierDecision[]
): SelectedPositionExportRow[] {
  if (!state.analysis) return [];
  const lines = new Map(
    state.runs.flatMap((run) =>
      run.result.envelope.extraction.offerGroups.flatMap((group) =>
        group.lines.map((line) => [line.id, line] as const)
      )
    )
  );
  const runs = new Map(
    state.runs.map((run) => [run.document.id, run.document] as const)
  );
  const basis = new Map(
    state.analysis.basisPositions.map((position) => [position.id, position])
  );
  const options = new Map(
    state.analysis.supplierOptions.map((option) => [option.id, option])
  );
  return latestSelected(decisions)
    .map((decision): SelectedPositionExportRow | null => {
      const position = basis.get(decision.positionId);
      const option = options.get(decision.selectedSupplierOptionId!);
      if (!position || !option) return null;
      const model = buildOperatorSupplierOptionReadModel({
        basis: position,
        option,
        offerLines: lines
      });
      const line = decision.selectedBundleLineIds
        .map((lineId) => lines.get(lineId))
        .find(Boolean) ??
        option.matchedOfferLineIds.map((lineId) => lines.get(lineId)).find(Boolean);
      const document = runs.get(option.supplierDocumentId);
      return {
        position: position.positionNumber,
        basisDescription: position.description,
        quantity: position.quantity,
        unit: position.unit,
        supplier: model.supplierDisplayName,
        offerDescription: model.title,
        manufacturer: model.manufacturerDisplayName,
        articleNumber: model.articleNumber,
        unitPrice: model.price.unitPrice,
        totalPrice: model.price.total,
        priceProvenance: model.priceProvenance,
        packageCompleteness: model.packageCompleteness,
        selectedLineIds: [...decision.selectedBundleLineIds],
        supplierBrandId: model.supplierBrandId,
        manufacturerBrandId: model.manufacturerBrandId,
        readModelVersion: model.version,
        document: document?.relativePath ?? option.supplierLabel,
        page: line?.evidence[0]?.pageNumber ?? null,
        internalNote: decision.comment
      };
    })
    .filter((row): row is SelectedPositionExportRow => Boolean(row))
    .sort((left, right) =>
      left.position.localeCompare(right.position, "de", { numeric: true })
    );
}

export async function selectionWorkbook(
  rows: readonly SelectedPositionExportRow[]
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SmartProcurementTool";
  workbook.created = new Date();
  workbook.subject = "Vom Operator ausgewählte LV-Positionen";
  const sheet = workbook.addWorksheet("Ausgewählte Positionen", {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  sheet.columns = [
    { header: "LV-Position", key: "position", width: 16 },
    { header: "Basis-Beschreibung", key: "basisDescription", width: 50 },
    { header: "Menge", key: "quantity", width: 12 },
    { header: "Einheit", key: "unit", width: 10 },
    { header: "Lieferant", key: "supplier", width: 22 },
    { header: "Angebotsbezeichnung", key: "offerDescription", width: 48 },
    { header: "Hersteller", key: "manufacturer", width: 20 },
    { header: "Artikelnummer", key: "articleNumber", width: 20 },
    { header: "Einzelpreis", key: "unitPrice", width: 15 },
    { header: "Gesamtpreis", key: "totalPrice", width: 15 },
    { header: "Preisnachweis", key: "priceProvenance", width: 24 },
    { header: "Lieferumfang", key: "packageCompleteness", width: 22 },
    { header: "Ausgewählte Zeilen", key: "selectedLineIds", width: 32 },
    { header: "Supplier Brand ID", key: "supplierBrandId", width: 20 },
    { header: "Manufacturer Brand ID", key: "manufacturerBrandId", width: 22 },
    { header: "Read Model", key: "readModelVersion", width: 32 },
    { header: "Dokument", key: "document", width: 34 },
    { header: "Seite", key: "page", width: 10 },
    { header: "Interne Notiz", key: "internalNote", width: 40 }
  ];
  rows.forEach((row) =>
    sheet.addRow({
      ...row,
      selectedLineIds: row.selectedLineIds.join(", ")
    })
  );
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF294A91" }
  };
  sheet.autoFilter = { from: "A1", to: "S1" };
  sheet.eachRow((row, rowNumber) => {
    row.height = rowNumber === 1 ? 30 : 42;
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFDCE3EC" } }
      };
    });
  });
  const total = workbook.addWorksheet("Zusammenfassung");
  total.addRows([
    ["Ausgewählte Positionen", rows.length],
    [
      "Gesamtsumme",
      rows.reduce((sum, row) => sum + (row.totalPrice ?? 0), 0)
    ]
  ]);
  total.getColumn(1).width = 28;
  total.getColumn(2).width = 20;
  total.getColumn(1).font = { bold: true };
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

function pdfText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("€", "EUR")
    .replace(/[^\x20-\xFF]/g, "?");
}

function wrap(value: string, width: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function contentPage(lines: readonly string[], page: number, pages: number): Buffer {
  const commands = [
    "BT",
    "/F1 15 Tf",
    "40 804 Td",
    `(${pdfText("SmartProcurementTool - Ausgewählte LV-Positionen")}) Tj`,
    "ET"
  ];
  let y = 780;
  for (const line of lines) {
    commands.push(
      "BT",
      "/F1 9 Tf",
      `40 ${y} Td`,
      `(${pdfText(line)}) Tj`,
      "ET"
    );
    y -= 13;
  }
  commands.push(
    "BT",
    "/F1 8 Tf",
    "40 24 Td",
    `(${pdfText(`Seite ${page} von ${pages}`)}) Tj`,
    "ET"
  );
  return Buffer.from(commands.join("\n"), "latin1");
}

export function selectionPdf(input: {
  rows: readonly SelectedPositionExportRow[];
  totalBasisPositions: number;
}): Buffer {
  const logicalLines: string[] = [];
  input.rows.forEach((row) => {
    logicalLines.push(`${row.position}  ${row.quantity ?? "-"} ${row.unit ?? ""}`);
    logicalLines.push(...wrap(`Basis: ${row.basisDescription}`, 92));
    logicalLines.push(
      ...wrap(
        `Auswahl: ${row.supplier} - ${row.offerDescription}`,
        92
      )
    );
    logicalLines.push(
      `Hersteller: ${row.manufacturer ?? "-"}  Artikel: ${
        row.articleNumber ?? "-"
      }`
    );
    logicalLines.push(
      `EP: ${row.unitPrice?.toFixed(2) ?? "-"} EUR  GP: ${
        row.totalPrice?.toFixed(2) ?? "-"
      } EUR`
    );
    logicalLines.push(
      `Preisnachweis: ${row.priceProvenance}  Lieferumfang: ${row.packageCompleteness}`
    );
    logicalLines.push(
      ...wrap(`Ausgewählte Angebotszeilen: ${row.selectedLineIds.join(", ") || "-"}`, 92)
    );
    logicalLines.push(
      ...wrap(`Quelle: ${row.document} - Seite ${row.page ?? "-"}`, 92)
    );
    if (row.internalNote) {
      logicalLines.push(...wrap(`Interne Notiz: ${row.internalNote}`, 92));
    }
    logicalLines.push("");
  });
  logicalLines.push(
    `Ausgewählte Positionen: ${input.rows.length}`,
    `Nicht ausgewählte Positionen: ${Math.max(
      0,
      input.totalBasisPositions - input.rows.length
    )}`,
    `Gesamtsumme: ${input.rows
      .reduce((sum, row) => sum + (row.totalPrice ?? 0), 0)
      .toFixed(2)} EUR`
  );
  const linesPerPage = 55;
  const pages = Array.from(
    { length: Math.max(1, Math.ceil(logicalLines.length / linesPerPage)) },
    (_, index) =>
      logicalLines.slice(index * linesPerPage, (index + 1) * linesPerPage)
  );
  const objects: Buffer[] = [];
  const pageReferences = pages.map((_, index) => 4 + index * 2);
  objects.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"));
  objects.push(
    Buffer.from(
      `<< /Type /Pages /Kids [${pageReferences
        .map((reference) => `${reference} 0 R`)
        .join(" ")}] /Count ${pages.length} >>`,
      "ascii"
    )
  );
  objects.push(
    Buffer.from(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "ascii"
    )
  );
  pages.forEach((lines, index) => {
    const pageObject = 4 + index * 2;
    const contentObject = pageObject + 1;
    const stream = contentPage(lines, index + 1, pages.length);
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
        "ascii"
      )
    );
    objects.push(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"),
        stream,
        Buffer.from("\nendstream", "ascii")
      ])
    );
  });
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
      object,
      Buffer.from("\nendobj\n", "ascii")
    );
  });
  const xrefOffset = Buffer.concat(chunks).length;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF"
  ].join("\n");
  chunks.push(Buffer.from(xref, "ascii"));
  return Buffer.concat(chunks);
}
