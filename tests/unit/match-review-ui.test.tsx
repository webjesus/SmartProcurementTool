import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PositionDetailsPane } from "@/components/lv/position-details-pane";
import type { MatchLink, OfferLine, SupplierOption } from "@/domain/contracts";
import type { ProjectReviewPosition } from "@/domain/project-review";
import { basisPosition, evidence, offerLine } from "../fixtures";

function probableOption(): SupplierOption {
  return {
    id: "option-probable",
    basisPositionIds: [basisPosition.id],
    supplierDocumentId: "doc-offer",
    supplierLabel: "Lieferant A",
    matchedOfferLineIds: [offerLine.id],
    matchLinkIds: ["match-probable"],
    primaryPrice: 300,
    mandatoryComponentPrices: [],
    optionalPrices: [],
    pricedTotal: 300,
    comparableTotal: null,
    quantity: 3,
    unit: "Stk",
    scopeOfSupply: [offerLine.description],
    technicalDeviations: [],
    missingComponents: [],
    validationIssueIds: [],
    evidenceIds: [evidence.id],
    quantityCompatible: true,
    unitCompatible: true,
    technicalCompatible: true,
    technicalComparisonStatus: "CONFIRMED_COMPATIBLE",
    unresolvedTechnicalAttributes: [],
    requiredScopeComplete: true,
    optionalSeparated: true,
    bundleCompatible: true,
    evidenceSufficient: true,
    extractionValidated: true,
    matchingAccepted: false,
    matchingReliable: false,
    offerAvailability: "PRESENT",
    materialScopeStatus: "UNKNOWN",
    reasons: ["Zuordnung nicht eindeutig bestätigt"],
    status: "MATCHING_UNCLEAR"
  };
}

function markup(input: { link: MatchLink; decision?: "CONFIRMED" | "REJECTED" }): string {
  const option = probableOption();
  const position = {
    basis: basisPosition,
    options: [option]
  } as ProjectReviewPosition;
  const lines = new Map<string, OfferLine>([[offerLine.id, offerLine]]);
  return renderToStaticMarkup(
    createElement(PositionDetailsPane, {
      position,
      option,
      offerLines: lines,
      matchLink: input.link,
      matchDecision: input.decision ?? null,
      matchReviewPending: false,
      tab: "OFFER_DATA",
      sources: [],
      activeSourceKey: null,
      sourceView: null,
      positionIndex: 0,
      positionTotal: 1,
      onTab: vi.fn(),
      onSourceSelect: vi.fn(),
      onSourceView: vi.fn(),
      onBasisSource: vi.fn(),
      onSupplierSource: vi.fn(),
      onFullscreen: vi.fn(),
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onClose: vi.fn(),
      onConfirmMatch: vi.fn(),
      onRejectMatch: vi.fn()
    })
  );
}

const link: MatchLink = {
  id: "match-probable",
  basisPositionIds: [basisPosition.id],
  offerLineIds: [offerLine.id],
  kind: "ONE_TO_ONE",
  status: "PROBABLE",
  score: 0.58,
  reasons: [
    "Beschreibung ist inhaltlich ähnlich",
    "Menge ist kompatibel",
    "Einheit stimmt überein"
  ],
  confirmedByOperator: false
};

describe("match review in the quick inspector", () => {
  it("shows score, reasons and explicit human actions for an uncertain candidate", () => {
    const html = markup({ link });
    expect(html).toContain("Zuordnung prüfen");
    expect(html).toContain("Matching-Score: 58 %");
    expect(html).toContain("Beschreibung ist inhaltlich ähnlich");
    expect(html).toContain("Zuordnung bestätigen");
    expect(html).toContain("Zuordnung ablehnen");
  });

  it("keeps an unconfirmed candidate visible for source review without allowing supplier selection", () => {
    const html = markup({ link });
    expect(html).toContain('data-supplier-option="option-probable"');
    expect(html).toContain('aria-label="Quelle Lieferant A"');
    expect(html).toContain('aria-label="Info Lieferant A"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Lieferant A auswählen"/);
    expect(html).toContain("Zuerst Zuordnung bestätigen");
    expect(html).toContain("Angebotsdetails");
  });

  it("shows the persisted review result without presenting it as a final supplier choice", () => {
    expect(
      markup({ link: { ...link, confirmedByOperator: true }, decision: "CONFIRMED" })
    ).toContain("Zuordnung bestätigt");
    expect(markup({ link: { ...link, status: "UNMATCHED" }, decision: "REJECTED" })).toContain(
      "Zuordnung abgelehnt"
    );
  });
});
