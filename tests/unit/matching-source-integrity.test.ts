import { describe, expect, it } from "vitest";
import { basisPosition, offerLine } from "../fixtures";
import { buildSupplierOptions, composeMatchLink, matchConstraints, normalizeLvPositionReference, proposeMatches, refreshPilotAnalysisForPositions } from "@/domain/matching";
import type { PilotAnalysis } from "@/domain/contracts";

describe("matching source integrity", () => {
  it.each([
    ["01.002.003.004", "1.2.3.4"],
    ["01.020", "1.20"],
    ["1.2.10-1.2.30", "1.2.10-30"],
    ["1.2.10-2.3.30", null],
    ["Artikel 1.2.10", null]
  ])("normalizes an actual hierarchical reference %s", (input, expected) => {
    expect(normalizeLvPositionReference(input)).toBe(expected);
  });

  it("does not treat the supplier ordinal as a second explicit LV reference", () => {
    const links = proposeMatches([basisPosition], [{
      ...offerLine, sourcePositionNumber: "9.9.90", supplierPositionNumber: basisPosition.positionNumber
    }]);
    expect(links.every(link => !link.reasons.includes("Direkter LV-Positionsbezug"))).toBe(true);
  });

  it("keeps unnumbered unrelated rows out of a text-matched product", () => {
    const links = proposeMatches([basisPosition], [
      { ...offerLine, id: "pump", sourcePositionNumber: null, supplierPositionNumber: "501" },
      { ...offerLine, id: "unrelated", sourcePositionNumber: null, supplierPositionNumber: "502", description: "Handtuchhalter Edelstahl" }
    ]);
    expect(links[0].offerLineIds).toEqual(["pump"]);
  });

  it("retains an exact article candidate even when short supplier text differs", () => {
    const links = proposeMatches([{ ...basisPosition, description: "Regelgruppe mit Antrieb. Art.-Nr.: SYN-92847" }], [
      { ...offerLine, sourcePositionNumber: null, supplierPositionNumber: "501", description: "RG Spezialausführung", articleNumber: "SYN-92847" }
    ]);
    expect(links).toHaveLength(1);
    expect(links[0].reasons).toContain("Artikelnummer stimmt exakt überein");
    expect(links[0].confirmedByOperator).toBe(false);
  });

  it("missing supplier quantity and unit are not confirmed compatible", () => {
    const constraints = matchConstraints(basisPosition, [{ ...offerLine, quantity: null, unit: null }]);
    expect(constraints.quantityCompatible).toBe(false);
    expect(constraints.unitCompatible).toBe(false);
  });

  it("two primary products with one LV number are not a proven package", () => {
    const basis = { ...basisPosition, requiredScope: [] };
    const offers = [
      { ...offerLine, id: "size-small", verificationStatus: "MACHINE_VALIDATED" as const },
      { ...offerLine, id: "size-large", description: "Hocheffizienz Umwälzpumpe größere Ausführung", verificationStatus: "MACHINE_VALIDATED" as const }
    ];
    const links = proposeMatches([basis], offers);
    const [option] = buildSupplierOptions({ basisPositions: [basis], offers: offers.map(line => ({ documentId: "supplier", documentLabel: "Lieferant", line })), links });
    expect(option.matchedOfferLineIds).toHaveLength(2);
    expect(option.bundleCompatible).toBe(false);
    expect(option.comparableTotal).toBeNull();
  });

  it("missing manufacturer is unresolved rather than a proven deviation", () => {
    const constraints = matchConstraints({ ...basisPosition, manufacturerRequirements: ["Synthetic"] }, [{ ...offerLine, manufacturer: null }]);
    expect(constraints.technicalComparisonStatus).toBe("UNRESOLVED");
    expect(constraints.technicalDeviations).toEqual([]);
  });

  it.each(["OPTIONAL", "ALTERNATIVE"] as const)("does not use a %s line to prove the priced main product compatible", (role) => {
    const basis = { ...basisPosition, description: "Hocheffizienz Umwälzpumpe DN 25", requiredScope: [], technicalAttributes: [{ name: "Nennweite", value: "DN 25" }] };
    const main = { ...offerLine, id: "wrong-main", description: "Hocheffizienz Umwälzpumpe DN 32", interpretedTotalPrice: 100, verificationStatus: "MACHINE_VALIDATED" as const };
    const extra = { ...main, id: "matching-extra", role, description: "Hocheffizienz Umwälzpumpe DN 25", interpretedTotalPrice: 200 };
    const lines = [main, extra];
    const links = proposeMatches([basis], lines);
    const [option] = buildSupplierOptions({ basisPositions: [basis], offers: lines.map(line => ({ documentId: "supplier", documentLabel: "Lieferant", line })), links });
    expect(option.pricedTotal).toBe(100);
    expect(option.optionalPrices).toEqual([200]);
    expect(option.technicalComparisonStatus).toBe("CONFIRMED_DEVIATION");
    expect(option.comparableTotal).toBeNull();
  });

  it("does not use excluded optional materials to claim a complete priced package", () => {
    const basis = { ...basisPosition, requiredScope: ["Schrauben"] };
    const main = { ...offerLine, verificationStatus: "MACHINE_VALIDATED" as const };
    const optional = { ...main, id: "optional-screws", role: "OPTIONAL" as const, description: "Schrauben", interpretedTotalPrice: 30 };
    const lines = [main, optional];
    const [option] = buildSupplierOptions({ basisPositions: [basis], offers: lines.map(line => ({ documentId: "supplier", documentLabel: "Lieferant", line })), links: proposeMatches([basis], lines) });
    expect(option.pricedTotal).toBe(300);
    expect(option.optionalPrices).toEqual([30]);
    expect(option.missingComponents).toContain("Schrauben");
    expect(option.comparableTotal).toBeNull();
  });

  it("keeps a valid main offer comparable when an optional item uses another unit", () => {
    const basis = { ...basisPosition, requiredScope: [] };
    const main = { ...offerLine, verificationStatus: "MACHINE_VALIDATED" as const };
    const optional = { ...main, id: "optional-cable", role: "OPTIONAL" as const, description: "Kabel", quantity: 20, unit: "m", interpretedTotalPrice: 30 };
    const lines = [main, optional];
    const [option] = buildSupplierOptions({ basisPositions: [basis], offers: lines.map(line => ({ documentId: "supplier", documentLabel: "Lieferant", line })), links: proposeMatches([basis], lines) });
    expect(option.pricedTotal).toBe(300);
    expect(option.comparableTotal).toBe(300);
  });

  it("requires bundle review for an unreferenced primary after a directly matched product", () => {
    const basis = { ...basisPosition, requiredScope: [] };
    const main = { ...offerLine, id: "matched-pump", verificationStatus: "MACHINE_VALIDATED" as const };
    const unrelated = { ...main, id: "unrelated-holder", sourcePositionNumber: null, supplierPositionNumber: "502", description: "Handtuchhalter Edelstahl", interpretedTotalPrice: 50 };
    const lines = [main, unrelated];
    const [option] = buildSupplierOptions({ basisPositions: [basis], offers: lines.map(line => ({ documentId: "supplier", documentLabel: "Lieferant", line })), links: proposeMatches([basis], lines) });
    expect(option.matchedOfferLineIds).toEqual([main.id, unrelated.id]);
    expect(option.bundleCompatible).toBe(false);
    expect(option.comparableTotal).toBeNull();
  });

  it("an explicit rejection wins over a former direct reference", () => {
    const basis = { ...basisPosition, requiredScope: [] };
    const offer = { ...offerLine, verificationStatus: "MACHINE_VALIDATED" as const };
    const links = proposeMatches([basis], [offer]).map(link => ({ ...link, status: "UNMATCHED" as const, confirmedByOperator: false, reasons: [...link.reasons, "Zuordnung manuell abgelehnt"] }));
    const [option] = buildSupplierOptions({ basisPositions: [basis], offers: [{ documentId: "supplier", documentLabel: "Lieferant", line: offer }], links });
    expect(option.matchingReliable).toBe(false);
    expect(option.comparableTotal).toBeNull();
  });

  it("excludes a rejected row when another row of the supplier is confirmed", () => {
    const basis = { ...basisPosition, requiredScope: [] };
    const a = { ...offerLine, id: "accepted", verificationStatus: "MACHINE_VALIDATED" as const };
    const b = { ...a, id: "rejected", interpretedTotalPrice: 700 };
    const links = [
      composeMatchLink({ basisPositionIds: [basis.id], offerLineIds: [a.id], status: "EXACT", score: 1, reasons: [], confirmedByOperator: true }),
      composeMatchLink({ basisPositionIds: [basis.id], offerLineIds: [b.id], status: "UNMATCHED", score: 0, reasons: ["Zuordnung manuell abgelehnt"] })
    ];
    const [option] = buildSupplierOptions({ basisPositions: [basis], offers: [a,b].map(line => ({ documentId: "supplier", documentLabel: "Lieferant", line })), links });
    expect(option.matchedOfferLineIds).toEqual([a.id]);
    expect(option.pricedTotal).toBe(300);
    expect(option.comparableTotal).toBe(300);
  });

  it("invalidates stale comparable totals after a rejected link refresh", () => {
    const basis = { ...basisPosition, requiredScope: [] };
    const line = { ...offerLine, verificationStatus: "MACHINE_VALIDATED" as const };
    const links = proposeMatches([basis], [line]);
    const options = buildSupplierOptions({ basisPositions: [basis], offers: [{ documentId: "supplier", documentLabel: "Lieferant", line }], links });
    const analysis: PilotAnalysis = { id: "analysis", basisDocumentId: basis.documentId, basisDocumentLabel: "Basis", basisPages: [1], basisPositionFrom: basis.positionNumber, basisPositionTo: basis.positionNumber, supplierDocuments: [{ id: "supplier", label: "Lieferant", pages: [1] }], basisPositions: [basis], matchLinks: links.map(link => ({ ...link, status: "UNMATCHED", confirmedByOperator: false })), supplierOptions: options, recommendations: [], generatedAt: "2026-01-01" };
    const changed = refreshPilotAnalysisForPositions(analysis, [basis.id]);
    expect(changed.supplierOptions[0].comparableTotal).toBeNull();
    expect(changed.supplierOptions[0].matchingReliable).toBe(false);
  });
});
