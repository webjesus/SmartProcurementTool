import { describe, expect, it } from "vitest";
import type { BasisPosition } from "@/domain/contracts";
import {
  displayInstallationRequirements,
  displayManufacturerAndType,
  displayTechnicalRequirements,
  normalizeDisplayText,
  uniqueDisplayTexts
} from "@/components/lv/display-normalization";

function basis(overrides: Partial<BasisPosition> = {}): BasisPosition {
  return {
    id: "basis-1",
    documentId: "document-1",
    parentId: null,
    positionNumber: "1.1.100.",
    description: "1.1.100. Energiespeicher Energiespeicher",
    quantity: 6,
    unit: "St",
    technicalAttributes: [],
    manufacturerRequirements: [],
    requiredScope: [],
    notes: [],
    optional: false,
    alternative: false,
    heading: false,
    evidence: [],
    ...overrides
  };
}

describe("LV display normalization", () => {
  it("cleans repeated display fragments without touching extracted numeric values", () => {
    expect(
      normalizeDisplayText(
        "1.1.100. 1.1.100. Energiespeicher Energiespeicher , 207,2 l",
        "1.1.100."
      )
    ).toBe("Energiespeicher, 207,2 l");
  });

  it("deduplicates only exact adjacent or list-level display values", () => {
    expect(
      uniqueDisplayTexts([
        "Komplett liefern und montieren.",
        "Komplett liefern und montieren.",
        "Kleinmaterial"
      ])
    ).toEqual(["Komplett liefern und montieren.", "Kleinmaterial"]);
  });

  it("cleans malformed labels but preserves distinct technical fields", () => {
    const result = displayTechnicalRequirements(
      basis({
        technicalAttributes: [
          { name: "- Max. Betriebstemperatur", value: "95 °C" },
          { name: "- Max. Betriebstemperatur", value: "95 °C" },
          { name: "Nenninhalt gesamt gerundet", value: "207 l" },
          { name: "Inhalt Heizwasser", value: "207,2 l" },
          { name: "Speichervolumen", value: "207 l" },
          { name: "Art.-Nr.", value: "47720101" }
        ]
      })
    );

    expect(result.technical).toEqual([
      { name: "Max. Betriebstemperatur", value: "95 °C" },
      { name: "Nenninhalt gesamt gerundet", value: "207 l" },
      { name: "Inhalt Heizwasser", value: "207,2 l" },
      { name: "Speichervolumen", value: "207 l" },
      { name: "Artikelnummer", value: "47720101" }
    ]);
  });

  it("keeps installation requirements separate and removes exact duplicates", () => {
    expect(
      displayInstallationRequirements(
        basis({
          requiredScope: [
            "Komplett liefern und montieren",
            "Kleinmaterial",
            "Kleinmaterial"
          ]
        })
      )
    ).toEqual(["Komplett liefern und montieren", "Kleinmaterial"]);
  });

  it("separates an explicit product type from following technical attributes", () => {
    expect(
      displayManufacturerAndType(
        basis({
          description:
            "Energiespeicher Typ WES 200 Eco/WP/B Nenninhalt gesamt: 207 l",
          manufacturerRequirements: ["Weishaupt"]
        })
      )
    ).toBe("Weishaupt · Typ WES 200 Eco/WP/B");
  });
});
