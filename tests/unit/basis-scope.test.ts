import { describe, expect, it } from "vitest";
import { buildBasisScopeProfiles } from "@/domain/basis-scope";
import type {
  BasisPosition,
  EvidenceReference,
  ExtractedSection
} from "@/domain/contracts";

const evidence = (
  id: string,
  pageNumber: number,
  sourceText: string
): EvidenceReference => ({
  id,
  documentId: "basis",
  pageNumber,
  textItemIds: [`ti-${id}`],
  sourceText,
  region: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 },
  cropPath: null,
  status: "VERIFIED_NATIVE"
});
const position = (
  id: string,
  description: string,
  pageNumber: number,
  overrides: Partial<BasisPosition> = {}
): BasisPosition => ({
  id,
  documentId: "basis",
  parentId: null,
  positionNumber: id,
  description,
  quantity: 1,
  unit: "St",
  technicalAttributes: [],
  manufacturerRequirements: [],
  requiredScope: [],
  notes: [],
  optional: false,
  alternative: false,
  heading: false,
  evidence: [evidence(`e-${id}`, pageNumber, description)],
  ...overrides
});

describe("Basis execution and procurement scope", () => {
  it("keeps installation requirements outside procurement material scope", () => {
    const leaf = position("2.1.760.", "Kugelhahn DN 32", 62, {
      requiredScope: [
        "Komplett liefern und montieren",
        "Dichtungs- und Kleinmaterialien einkalkulieren"
      ]
    });
    const [profiled] = buildBasisScopeProfiles({
      positions: [leaf],
      pages: [{ pageNumber: 62, positions: [leaf], sections: [] }]
    });

    expect(
      profiled.scopeProfile?.procurementMaterialScope.map((item) => item.code)
    ).toEqual(["MAIN_PRODUCT"]);
    expect(
      profiled.scopeProfile?.fullLvExecutionScope.map((item) => item.label)
    ).toEqual([
      "Kugelhahn DN 32",
      "Komplett liefern und montieren",
      "Dichtungs- und Kleinmaterialien einkalkulieren"
    ]);
  });

  it("inherits a material requirement and its evidence from a shared description", () => {
    const heading = position(
      "heading-10",
      "Ausführungsbeschreibung 10 – Strangabsperrventil",
      62,
      {
        positionNumber: "",
        heading: true,
        notes: ["Fortsetzung auf der Folgeseite"]
      }
    );
    const continuationEvidence = evidence(
      "continuation-10",
      63,
      "Medium Wasser inklusive Wärmedämmschale"
    );
    const continuation: ExtractedSection = {
      id: "section-continuation",
      parentId: null,
      label: "Fortsetzung einer vorherigen Position",
      kind: "NOTE",
      evidence: [continuationEvidence]
    };
    const leaf = position("2.1.780.", "Strangabsperrventil DN 15", 63, {
      notes: ["Gemäß Ausführungsbeschreibung 10"]
    });
    const [profiled] = buildBasisScopeProfiles({
      positions: [leaf],
      pages: [
        { pageNumber: 62, positions: [heading], sections: [] },
        {
          pageNumber: 63,
          positions: [leaf],
          sections: [continuation]
        }
      ]
    });

    expect(profiled.scopeProfile?.referenceResolved).toBe(true);
    expect(
      profiled.scopeProfile?.inheritedMaterialRequirements
    ).toEqual([
      expect.objectContaining({
        code: "THERMAL_INSULATION",
        label: "Wärmedämmschale",
        evidence: [continuationEvidence]
      })
    ]);
  });
});
