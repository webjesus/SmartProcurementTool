import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildBrowserManualCorrectionInput } from "@/components/browser-projects/browser-lv-page";
import {
  buildBasisCorrectionEditorState,
  buildExistingManualCorrectionCommand,
  buildSupplierCorrectionEditorState
} from "@/components/lv/lv-comparison-page";
import { LvPositionList } from "@/components/lv/lv-position-list";
import { PositionDetailsPane } from "@/components/lv/position-details-pane";
import type { OfferLine, SupplierOption } from "@/domain/contracts";
import type { ProjectReviewPosition } from "@/domain/project-review";
import { basisPosition, evidence, offerLine } from "../fixtures";

const option: SupplierOption = {
  id: "option-1",
  basisPositionIds: [basisPosition.id],
  supplierDocumentId: "doc-offer",
  supplierLabel: "Lieferant A",
  matchedOfferLineIds: [offerLine.id],
  matchLinkIds: [],
  primaryPrice: 300,
  mandatoryComponentPrices: [],
  optionalPrices: [],
  pricedTotal: 300,
  comparableTotal: 300,
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
  matchingAccepted: true,
  matchingReliable: true,
  offerAvailability: "PRESENT",
  materialScopeStatus: "COMPLETE_MATERIAL_SCOPE",
  reasons: [],
  status: "CLEAR_RECOMMENDATION"
};

const position = {
  basis: basisPosition,
  options: [option],
  liveStatus: "MANUAL_DECISION_REQUIRED",
  independent: {
    selectedSupplierOptionId: null,
    reasons: []
  }
} as unknown as ProjectReviewPosition;

const manualLabels = {
  [`BASIS_POSITION:${basisPosition.id}`]: "Manuelle Basis-Kurzbezeichnung",
  [`SUPPLIER_LINE:${offerLine.id}`]: "Manuelle Angebots-Kurzbezeichnung"
};

describe("existing LV row manual correction UI", () => {
  it("prefills every available Basis and supplier field including exact PDF evidence", () => {
    const basisState = buildBasisCorrectionEditorState(basisPosition, manualLabels);
    const supplierState = buildSupplierCorrectionEditorState(
      offerLine,
      basisPosition.positionNumber,
      manualLabels
    );

    expect(basisState).toEqual({
      kind: "BASIS_POSITION",
      entityId: basisPosition.id,
      evidenceId: "e-basis",
      initialValues: {
        positionNumber: "2.3.10",
        shortDescription: "Manuelle Basis-Kurzbezeichnung",
        description: "Hocheffizienz-Umwälzpumpe",
        articleNumber: null,
        quantity: 3,
        unit: "Stk",
        unitPrice: null,
        totalPrice: null,
        pageNumber: 1,
        region: { x: 0.1, y: 0.2, width: 0.5, height: 0.05 }
      }
    });
    expect(supplierState).toEqual({
      kind: "SUPPLIER_LINE",
      entityId: offerLine.id,
      evidenceId: evidence.id,
      initialValues: {
        positionNumber: "2.3.10",
        shortDescription: "Manuelle Angebots-Kurzbezeichnung",
        description: "Hocheffizienz Umwälzpumpe",
        articleNumber: "SYN-001",
        quantity: 3,
        unit: "Stk",
        unitPrice: 100,
        totalPrice: 300,
        pageNumber: 1,
        region: { x: 0.1, y: 0.2, width: 0.5, height: 0.05 }
      }
    });
  });

  it("builds an audited field correction for the exact selected supplier line", () => {
    const state = buildSupplierCorrectionEditorState(
      offerLine,
      basisPosition.positionNumber,
      manualLabels
    );
    const command = buildExistingManualCorrectionCommand(state, {
      mode: "CORRECT",
      kind: "SUPPLIER_LINE",
      positionNumber: "2.3.20",
      shortDescription: "Korrigierte Pumpe",
      description: "Korrigierte vollständige Beschreibung",
      articleNumber: "SYN-002",
      quantity: 4,
      unit: "Stk",
      unitPrice: 95,
      totalPrice: 370,
      pageNumber: 2,
      region: { x: 0.2, y: 0.3, width: 0.4, height: 0.1 },
      provenance: {
        method: "MANUAL",
        action: "CORRECT",
        originalOcrPreserved: true
      }
    });

    expect(command).toEqual({
      action: "CORRECT_FIELDS",
      target: {
        kind: "SUPPLIER_LINE",
        entityId: offerLine.id,
        evidenceId: evidence.id
      },
      patch: {
        positionNumber: "2.3.20",
        shortLabel: "Korrigierte Pumpe",
        description: "Korrigierte vollständige Beschreibung",
        articleNumber: "SYN-002",
        quantity: 4,
        unit: "Stk",
        unitPrice: 95,
        totalPrice: 370,
        source: {
          pageNumber: 2,
          region: { x: 0.2, y: 0.3, width: 0.4, height: 0.1 }
        }
      }
    });

    expect(
      buildBrowserManualCorrectionInput({
        projectId: "project-1",
        analysisVersionId: "analysis-derived-2",
        manualCorrectionRevision: 7,
        command,
        operatorId: "operator-1",
        operatorLabel: "Test Benutzer"
      })
    ).toMatchObject({
      projectId: "project-1",
      analysisVersionId: "analysis-derived-2",
      expectedRevision: 7,
      command,
      operatorId: "operator-1",
      operatorLabel: "Test Benutzer"
    });
  });

  it("shows German correction actions and manual short labels while retaining full descriptions", () => {
    const correctedBasis = {
      ...basisPosition,
      verificationStatus: "HUMAN_CORRECTED" as const
    };
    const correctedOfferLine = {
      ...offerLine,
      verificationStatus: "HUMAN_CORRECTED" as const
    };
    const correctedPosition = {
      ...position,
      basis: correctedBasis
    };
    const correctedLines = new Map<string, OfferLine>([
      [correctedOfferLine.id, correctedOfferLine]
    ]);
    const details = renderToStaticMarkup(
      createElement(PositionDetailsPane, {
        position: correctedPosition,
        option,
        offerLines: correctedLines,
        basisDisplayLabel: manualLabels[`BASIS_POSITION:${basisPosition.id}`],
        supplierDisplayLabel: manualLabels[`SUPPLIER_LINE:${offerLine.id}`],
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
        onCorrectBasis: vi.fn(),
        onCorrectSupplier: vi.fn(),
        onFullscreen: vi.fn(),
        onPrevious: vi.fn(),
        onNext: vi.fn(),
        onClose: vi.fn()
      })
    );

    expect(details).toContain("Basisdaten korrigieren");
    expect(details).toContain("Angebotsdaten korrigieren");
    expect(details).toContain("Manuelle Basis-Kurzbezeichnung");
    expect(details).toContain("Manuelle Angebots-Kurzbezeichnung");
    expect(details).toContain(basisPosition.description);
    expect(details).toContain(offerLine.description);
    expect(details).toContain("Manuell korrigiert");

    const list = renderToStaticMarkup(
      createElement(LvPositionList, {
        sections: [
          {
            id: "2.3",
            title: "2.3 · LV-Positionen",
            positions: [correctedPosition]
          }
        ],
        collapsed: new Set<string>(),
        expandedPositionIds: new Set([basisPosition.id]),
        offerLines: correctedLines,
        manualDisplayLabels: manualLabels,
        activePositionId: basisPosition.id,
        drafts: [],
        decisions: [],
        pendingOptionId: null,
        scrollTop: 0,
        page: 1,
        pageSize: 20,
        total: 1,
        onScrollTop: vi.fn(),
        onToggleSection: vi.fn(),
        onTogglePosition: vi.fn(),
        onInfo: vi.fn(),
        onOpenBasisSource: vi.fn(),
        onOpenSupplierSource: vi.fn(),
        onSelectOption: vi.fn(),
        onShowWarnings: vi.fn(),
        onPage: vi.fn(),
        onPageSize: vi.fn()
      })
    );

    expect(list).toContain("Manuelle Basis-Kurzbezeichnung");
    expect(list).not.toContain("Manuelle Angebots-Kurzbezeichnung");
    expect(list).toContain("Manuell korrigiert");
  });
});
