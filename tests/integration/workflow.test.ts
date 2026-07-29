import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { validateOfferLine } from "@/domain/validation";
import { proposeMatches } from "@/domain/matching";
import { recommendationStatus } from "@/domain/recommendation";
import {
  selectionPdf,
  selectionWorkbook,
  type SelectedPositionExportRow
} from "@/services/selection-export";
import { basisPosition, offerLine } from "../fixtures";

describe("synthetic procurement workflow", () => {
  it("validates, matches and recommends without rewriting extraction", () => {
    const original = structuredClone(offerLine);
    expect(validateOfferLine(offerLine)).toHaveLength(0);
    const matches = proposeMatches([basisPosition], [offerLine]);
    expect(matches[0].status).toBe("EXACT");
    expect(offerLine).toEqual(original);
    expect(
      recommendationStatus({
        matchingConfirmed: true,
        priceValidated: true,
        quantityCompatible: true,
        unitCompatible: true,
        requiredScopeEquivalent: true,
        mandatoryComponentsIncluded: true,
        technicalDeviation: false,
        optionalSeparated: true,
        evidenceSufficient: true,
        offerAvailability: "PRESENT"
      })
    ).toBe("CLEAR_RECOMMENDATION");
  });

  it("exports selected operator rows as readable XLSX and PDF", async () => {
    const selectedRows: SelectedPositionExportRow[] = [{
      position: basisPosition.positionNumber,
      basisDescription: basisPosition.description,
      quantity: basisPosition.quantity,
      unit: basisPosition.unit,
      supplier: "Supplier fixture",
      offerDescription: offerLine.description,
      manufacturer: offerLine.manufacturer,
      articleNumber: offerLine.articleNumber,
      unitPrice: offerLine.interpretedUnitPrice,
      totalPrice: offerLine.interpretedTotalPrice,
      priceProvenance: "SOURCE_GP",
      packageCompleteness: "COMPLETE",
      selectedLineIds: [offerLine.id],
      supplierBrandId: "unknown:supplier-fixture",
      manufacturerBrandId: null,
      readModelVersion: "operator-supplier-option-read-model-v1",
      document: "supplier-fixture.pdf",
      page: offerLine.evidence[0].pageNumber,
      internalNote: "Vom Operator ausgewählt"
    }];
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await selectionWorkbook(selectedRows));
    const sheet = workbook.getWorksheet("Ausgewählte Positionen");
    expect(sheet?.rowCount).toBe(2);
    expect(sheet?.getCell("A2").value).toBe(basisPosition.positionNumber);
    expect(sheet?.getCell("E2").value).toBe("Supplier fixture");
    expect(sheet?.getCell("S2").value).toBe("Vom Operator ausgewählt");

    const pdf = selectionPdf({
      rows: selectedRows,
      totalBasisPositions: 2
    });
    expect(pdf.subarray(0, 8).toString("ascii")).toBe("%PDF-1.4");
    expect(pdf.toString("latin1")).toContain("Nicht ausgew");
  });
});
