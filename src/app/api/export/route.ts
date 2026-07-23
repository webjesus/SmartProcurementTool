import ExcelJS from "exceljs";
import { comparisonRows } from "@/lib/demo-data";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const confirmedOnly = url.searchParams.get("confirmedOnly") !== "false";
  const includeEvidence = url.searchParams.get("evidence") !== "false";
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Smart Procurement Tool";
  workbook.created = new Date();
  workbook.subject = "Evidence-first procurement comparison";

  const sheet = workbook.addWorksheet("LV-Vergleich", {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  sheet.columns = [
    { header: "Basis position", key: "position", width: 16 },
    { header: "Description", key: "description", width: 42 },
    { header: "Quantity", key: "quantity", width: 14 },
    { header: "Supplier Alpha", key: "alpha", width: 19 },
    { header: "Supplier Beta", key: "beta", width: 19 },
    { header: "Supplier Gamma", key: "gamma", width: 19 },
    { header: "Comparable price", key: "comparablePrice", width: 20 },
    { header: "Recommendation", key: "recommendation", width: 23 },
    { header: "Selected supplier", key: "selectedSupplier", width: 20 },
    { header: "Status", key: "status", width: 32 },
    { header: "Issues", key: "issues", width: 32 },
    { header: "Comments", key: "comments", width: 32 },
    { header: "Evidence page reference", key: "evidence", width: 28 }
  ];

  const rows = confirmedOnly
    ? comparisonRows.filter((row) => row.status === "CLEAR_RECOMMENDATION")
    : comparisonRows;

  rows.forEach((row, index) => {
    const confirmed = row.status === "CLEAR_RECOMMENDATION";
    sheet.addRow({
      position: row.position,
      description: row.description,
      quantity: row.quantity,
      alpha: row.alpha,
      beta: row.beta,
      gamma: row.gamma,
      comparablePrice: confirmed ? [row.alpha, row.beta, row.gamma].join(" | ") : "UNCONFIRMED",
      recommendation: row.recommendation,
      selectedSupplier: "",
      status: row.status,
      issues: confirmed ? "" : row.status,
      comments: confirmed ? "Machine recommendation; operator decision pending" : "Requires review",
      evidence: includeEvidence ? `Synthetic fixture · page ${10 + index}` : ""
    });
  });

  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF294A91" }
  };
  sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
  sheet.autoFilter = { from: "A1", to: "M1" };
  sheet.eachRow((row, rowNumber) => {
    row.height = rowNumber === 1 ? 30 : 24;
    row.eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFDCE3EC" } }
      };
    });
  });

  const meta = workbook.addWorksheet("Export-Metadaten");
  meta.addRows([
    ["Product", "Smart Procurement Tool"],
    ["Generated", new Date().toISOString()],
    ["Confirmed only", confirmedOnly ? "yes" : "no"],
    ["Evidence references", includeEvidence ? "included" : "omitted"],
    [
      "Important",
      "CLEAR_RECOMMENDATION is not a final supplier decision. Unconfirmed values are explicitly marked."
    ]
  ]);
  meta.getColumn(1).width = 24;
  meta.getColumn(2).width = 90;
  meta.getColumn(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="SPT-LV-Vergleich.xlsx"',
      "cache-control": "no-store"
    }
  });
}
