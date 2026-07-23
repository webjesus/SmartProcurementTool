import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { validateOfferLine } from "@/domain/validation";
import { proposeMatches } from "@/domain/matching";
import { recommendationStatus } from "@/domain/recommendation";
import { GET as exportWorkbook } from "@/app/api/export/route";
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
        hasOffer: true
      })
    ).toBe("CLEAR_RECOMMENDATION");
  });

  it("exports a readable XLSX with status metadata", async () => {
    const response = await exportWorkbook(
      new Request("http://localhost/api/export?confirmedOnly=false&evidence=true")
    );
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.getWorksheet("LV-Vergleich")?.rowCount).toBeGreaterThan(2);
    expect(workbook.getWorksheet("Export-Metadaten")?.getCell("A1").value).toBe("Product");
  });
});
