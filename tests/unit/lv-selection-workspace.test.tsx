import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CentralSupplierDecision } from "@/domain/central-decision";
import type { OfferLine, SupplierOption } from "@/domain/contracts";
import type { ProjectReviewPosition } from "@/domain/project-review";
import {
  ProjectWorkspaceStateSchema,
  WorkspaceSourceStateSchema
} from "@/domain/project-workspace";
import {
  cheapestFoundOption,
  operatorSelectedOption
} from "@/components/lv/lv-comparison-table";
import { LvPositionList } from "@/components/lv/lv-position-list";
import {
  WarningCenter,
  buildLvWarnings
} from "@/components/lv/warning-center";
import { LvToolbar } from "@/components/lv/lv-toolbar";
import { SourceOverlay } from "@/components/lv/source-overlay";
import type { SourceRecord } from "@/components/lv/types";
import {
  SUPPLIER_DISPLAY_ROLE_RULE_VERSION,
  supplierDisplayRole,
  supplierPriceDisplay
} from "@/domain/supplier-option-read-model";
import { basisPosition, evidence, offerLine } from "../fixtures";

function option(
  id: string,
  supplierLabel: string,
  price: number,
  overrides: Partial<SupplierOption> = {}
): SupplierOption {
  return {
    id,
    basisPositionIds: [basisPosition.id],
    supplierDocumentId: `document-${id}`,
    supplierLabel,
    matchedOfferLineIds: [`line-${id}`],
    matchLinkIds: [],
    primaryPrice: price,
    mandatoryComponentPrices: [],
    optionalPrices: [],
    pricedTotal: price,
    comparableTotal: price,
    quantity: basisPosition.quantity,
    unit: basisPosition.unit,
    scopeOfSupply: [],
    technicalDeviations: [],
    missingComponents: [],
    validationIssueIds: [],
    evidenceIds: [`evidence-${id}`],
    quantityCompatible: true,
    unitCompatible: true,
    technicalCompatible: true,
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
    status: "CLEAR_RECOMMENDATION",
    ...overrides
  };
}

function position(options: SupplierOption[]): ProjectReviewPosition {
  return {
    basis: basisPosition,
    options
  } as ProjectReviewPosition;
}

function decision(
  selectedSupplierOptionId: string
): CentralSupplierDecision {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "project-fixture",
    positionId: basisPosition.id,
    selectedSupplierOptionId,
    selectedBundleLineIds: [],
    rejectedOptionIds: [],
    outcome: "SELECTED",
    reasonCodes: [],
    comment: "",
    decidedBy: "22222222-2222-4222-8222-222222222222",
    decidedByDisplayName: "Operator Test",
    decidedAt: "2026-07-28T08:00:00.000Z",
    previousDecisionId: null,
    analysisVersionId: "analysis-fixture",
    decisionVersion: 1,
    decisionType: "MANUAL_SELECTION",
    contextSnapshot: {},
    evidenceSnapshot: {},
    documentRevisionIds: [],
    createdAt: "2026-07-28T08:00:00.000Z"
  };
}

function tableMarkup(
  options: SupplierOption[],
  decisions: CentralSupplierDecision[] = []
): string {
  const reviewed = position(options);
  const lines = new Map<string, OfferLine>(
    options.flatMap((candidate) =>
      candidate.matchedOfferLineIds.map((lineId) => [
        lineId,
        {
          ...offerLine,
          id: lineId,
          manufacturer: candidate.supplierLabel,
          interpretedUnitPrice: candidate.primaryPrice,
          interpretedTotalPrice: candidate.pricedTotal,
          evidence: [
            {
              ...evidence,
              id: `evidence-${lineId}`,
              documentId: candidate.supplierDocumentId
            }
          ]
        }
      ] as const)
    )
  );
  return renderToStaticMarkup(
    createElement(LvPositionList, {
      sections: [{ id: "section", title: "Section", positions: [reviewed] }],
      collapsed: new Set<string>(),
      expandedPositionIds: new Set([basisPosition.id]),
      offerLines: lines,
      activePositionId: null,
      drafts: [],
      decisions,
      pendingOptionId: null,
      scrollTop: 0,
      page: 1,
      pageSize: 20,
      total: 1,
      onScrollTop: () => undefined,
      onToggleSection: () => undefined,
      onTogglePosition: () => undefined,
      onInfo: () => undefined,
      onOpenBasisSource: () => undefined,
      onOpenSupplierSource: () => undefined,
      onSelectOption: () => undefined,
      onPage: () => undefined,
      onPageSize: () => undefined
    })
  );
}

describe("LV operator selection table", () => {
  it("keeps the cheapest recommendation separate from operator selection", () => {
    const reviewed = position([
      option("option-a", "Supplier A", 120),
      option("option-b", "Supplier B", 90)
    ]);
    expect(cheapestFoundOption(reviewed)?.id).toBe("option-b");
    expect(operatorSelectedOption(reviewed, undefined)).toBeUndefined();
    expect(tableMarkup(reviewed.options)).toContain("Nicht ausgewählt");
  });

  it("shows an operator selection even when another option is cheaper", () => {
    const reviewed = position([
      option("option-a", "Supplier A", 120),
      option("option-b", "Supplier B", 90)
    ]);
    const selected = decision("option-a");
    expect(operatorSelectedOption(reviewed, selected)?.id).toBe("option-a");
    const markup = tableMarkup(reviewed.options, [selected]);
    expect(markup).toContain("Supplier A");
    expect(markup).toContain("aria-pressed=\"true\"");
    expect(markup.indexOf('data-supplier-option="option-a"')).toBeLessThan(
      markup.indexOf('data-supplier-option="option-b"')
    );
    expect(markup).toContain("Günstigster Preis");
  });

  it.each([1, 4])("renders every supplier row for %i supplier options", (count) => {
    const options = Array.from({ length: count }, (_, index) =>
      option(`option-${index}`, `Supplier ${index + 1}`, 100 + index)
    );
    const markup = tableMarkup(options);
    expect((markup.match(/data-supplier-option=/g) ?? []).length).toBe(count);
    expect((markup.match(/aria-label="Quelle /g) ?? []).length).toBe(count);
    expect((markup.match(/aria-label="Info Supplier/g) ?? []).length).toBe(
      count
    );
  });

  it("hides unassigned supplier placeholders and uses one compact empty state", () => {
    const unavailable = option("option-missing", "Reisser", 0, {
      matchedOfferLineIds: [],
      pricedTotal: null,
      comparableTotal: null,
      primaryPrice: null,
      evidenceIds: [],
      offerAvailability: "COVERED_WITHOUT_OFFER",
      extractionValidated: false,
      matchingAccepted: false,
      status: "MATCHING_UNCLEAR"
    });
    const markup = tableMarkup([unavailable]);
    expect(markup).not.toContain("Nicht zugeordnete Lieferanten");
    expect(markup).not.toContain("Reisser");
    expect(markup).toContain("Keine Angebote gefunden");
    expect(markup).toContain("Hinweise anzeigen");
    expect(markup).not.toContain("data-supplier-option=");
    expect(markup).not.toContain("Auswählen");
    expect(markup).not.toContain("Zur Quelle");
  });

  it("keeps an explicit no-offer as a compact non-selectable row", () => {
    const explicitNoOffer = option("option-no-offer", "Reisser", 0, {
      pricedTotal: null,
      comparableTotal: null,
      primaryPrice: null,
      offerAvailability: "EXPLICIT_NO_OFFER",
      materialScopeStatus: "EXPLICIT_NO_OFFER",
      status: "NO_OFFER"
    });
    const markup = tableMarkup([explicitNoOffer]);
    expect(markup).toContain('data-option-validity="EXPLICIT_NO_OFFER"');
    expect(markup).toContain("Nicht angeboten");
    expect(markup).toContain("Reisser");
    expect(markup).not.toContain("Keine Angebote gefunden");
    expect(markup).not.toContain("data-supplier-option=");
  });

  it("renders one stable position container and one supplier grid", () => {
    const markup = tableMarkup([option("option-pm", "P&M", 300)]);
    expect(markup).toContain("class=\"lv-list-section-row\"");
    expect(markup).toContain("class=\"lv-position-card expanded");
    expect(markup).toContain("class=\"lv-offer-grid lv-offer-grid-header");
    expect(markup).toContain("class=\"lv-offer-grid lv-offer-row");
    expect(markup).not.toContain("<tbody");
    expect(markup).toContain("1 Angebot verfügbar");
    expect(markup).toContain('data-price-provenance="SOURCE_GP"');
    expect(markup).toContain("Gesamtpreis aus Angebot");
    expect(markup).toContain("Preis (EUR)");
  });

  it("uses source-confirmed GP and a display-only bundle role correction", () => {
    const gienger = option("gienger", "Gienger", 0, {
      primaryPrice: null,
      pricedTotal: null,
      comparableTotal: null,
      optionalPrices: [46_749.72]
    });
    const lines: OfferLine[] = [
      {
        ...offerLine,
        id: "line-gienger",
        sourcePositionNumber: "1.1.10",
        supplierPositionNumber: "3000",
        articleNumber: "NHE16",
        description: "Wärmepumpe L/W Helox 16 Außengerät",
        quantity: 6,
        unit: "St",
        interpretedUnitPrice: 7_791.62,
        interpretedTotalPrice: 46_749.72,
        role: "ALTERNATIVE"
      },
      {
        ...offerLine,
        id: "line-component",
        sourcePositionNumber: "1.1.10",
        supplierPositionNumber: "4000",
        articleNumber: "NHMHV9H",
        description: "Hydraulikmodul HV 9H",
        interpretedUnitPrice: 1_910.06,
        interpretedTotalPrice: 11_460.36,
        role: "ALTERNATIVE"
      }
    ];
    expect(supplierPriceDisplay(gienger, lines)).toMatchObject({
      total: 46_749.72,
      unitPrice: 7_791.62,
      state: "SOURCE_CONFIRMED_TOTAL",
      labelDe: "Gesamtpreis bestätigt"
    });
    expect(supplierDisplayRole(lines[0], lines)).toBe("PRIMARY");
    expect(supplierDisplayRole(lines[1], lines)).toBe("COMPONENT");
    expect(SUPPLIER_DISPLAY_ROLE_RULE_VERSION).toBe(
      "supplier-display-role-v1"
    );
    expect(lines.map((line) => line.role)).toEqual([
      "ALTERNATIVE",
      "ALTERNATIVE"
    ]);
  });
});

describe("LV warnings and workspace", () => {
  it("keeps warning navigation bound to the concrete supplier option", () => {
    const reviewed = position([
      option("option-warning", "Supplier warning", 100, {
        matchingReliable: false,
        evidenceIds: []
      })
    ]);
    expect(buildLvWarnings([reviewed])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          supplierOptionId: "option-warning",
          reason: "Mehrere mögliche Angebotszeilen"
        }),
        expect.objectContaining({
          supplierOptionId: "option-warning",
          reason: "Quelle nicht verfügbar"
        })
      ])
    );
  });

  it("groups warning count by affected positions and shows category/completeness", () => {
    const reviewed = position([
      option("option-warning", "P&M", 100, {
        matchingReliable: false,
        requiredScopeComplete: false,
        materialScopeStatus: "PARTIAL_MATERIAL_SCOPE",
        missingComponents: ["Regelung"]
      })
    ]);
    const lines = new Map<string, OfferLine>([
      [
        "line-option-warning",
        {
          ...offerLine,
          id: "line-option-warning",
          evidence: [
            {
              ...evidence,
              id: "evidence-line-option-warning",
              documentId: "document-option-warning"
            }
          ]
        }
      ]
    ]);
    const warnings = buildLvWarnings([reviewed], lines);
    const markup = renderToStaticMarkup(
      createElement(WarningCenter, {
        warnings,
        open: true,
        onToggle: () => undefined,
        onClose: () => undefined,
        onSelect: () => undefined
      })
    );
    expect(markup).toContain("1 betroffene Positionen");
    expect(markup).toContain("Zuordnung");
    expect(markup).toContain("Nur Hauptposition");
  });

  it("exposes only the working operator filters and the exact search placeholder", () => {
    const markup = renderToStaticMarkup(
      createElement(LvToolbar, {
        search: "",
        supplier: "ALL",
        suppliers: ["Gienger", "P&M"],
        positionFilter: "ALL",
        sort: "LV_ORDER",
        shown: 188,
        total: 188,
        onSearch: () => undefined,
        onSupplier: () => undefined,
        onPositionFilter: () => undefined,
        onSort: () => undefined,
        onExpandAll: () => undefined,
        onCollapseAll: () => undefined
      })
    );
    expect(markup).toContain(
      'placeholder="Position, Beschreibung oder Artikel suchen..."'
    );
    expect(markup).toContain("Alle Lieferanten");
    expect(markup).toContain("Ausgewählt");
    expect(markup).toContain("Nicht ausgewählt");
    expect(markup).toContain("Mit Hinweisen");
    expect(markup).not.toMatch(/Hersteller filtern|Kategorie filtern/);
  });

  it("round-trips the complete per-user project workspace", () => {
    const source = WorkspaceSourceStateSchema.parse({
      sourceKey: "supplier:option-1",
      documentRevisionId: "revision-1",
      page: 14,
      zoom: 1.25,
      fitMode: "CONTEXT"
    });
    const workspace = ProjectWorkspaceStateSchema.parse({
      discipline: "HEIZUNG",
      section: "lv-vergleich",
      search: "Ventil",
      supplierFilter: "ALL",
      summaryFilter: "OPEN",
      sort: "LV_ORDER",
      tableScroll: 640,
      page: 3,
      pageSize: 50,
      collapsedSectionIds: ["2.1"],
      expandedPositionIds: [basisPosition.id],
      selectedBasisPositionId: basisPosition.id,
      selectedSupplierOptionId: "option-1",
      inspectorOpen: true,
      inspectorSection: "information",
      detailsPaneTab: "ORIGINAL_DOCUMENT",
      sourceOverlay: source
    });
    expect(workspace).toEqual(
      expect.objectContaining({
        tableScroll: 640,
        page: 3,
        pageSize: 50,
        expandedPositionIds: [basisPosition.id],
        selectedSupplierOptionId: "option-1",
        detailsPaneTab: "ORIGINAL_DOCUMENT",
        sourceOverlay: source
      })
    );
  });
});

describe("supplier source sidebar", () => {
  it("shows actual supplier positions, articles, products and prices", () => {
    const sources: SourceRecord[] = [
      ["3000", "NHE16", "Wärmepumpe L/W Helox 16 Außengerät", 7_791.62, 46_749.72, "PRIMARY"],
      ["4000", "NHMHV9H", "Hydraulikmodul HV 9H", 1_910.06, 11_460.36, "COMPONENT"],
      ["5000", "NBKSL", "Bodenkonsole BKS-L", 218.89, 1_313.34, "COMPONENT"]
    ].map(([supplierPositionNumber, articleNumber, description, unitPrice, totalPrice, displayRole]) => ({
      key: `supplier:${supplierPositionNumber}`,
      kind: "supplier",
      tabLabel: "Gienger",
      documentId: "gienger-document",
      documentRevisionId: "gienger-revision",
      documentLabel: "supplier.pdf",
      pageNumber: 2,
      pageCount: 3,
      evidence: [evidence],
      positionNumber: "1.1.10",
      title: String(supplierPositionNumber),
      description: String(description),
      quantity: 6,
      unit: "St",
      supplier: "Gienger",
      lineId: `line-${supplierPositionNumber}`,
      lineRole: "ALTERNATIVE",
      displayRole: displayRole as SourceRecord["displayRole"],
      supplierPositionNumber: String(supplierPositionNumber),
      articleNumber: String(articleNumber),
      unitPrice: Number(unitPrice),
      totalPrice: Number(totalPrice),
      context: []
    }));
    const markup = renderToStaticMarkup(
      createElement(SourceOverlay, {
        sources,
        activeKey: sources[0].key,
        onSelect: () => undefined,
        onClose: () => undefined
      })
    );
    expect(markup).toContain("POS 3000 · Art. NHE16");
    expect(markup).toContain("POS 4000 · Art. NHMHV9H");
    expect(markup).toContain("POS 5000 · Art. NBKSL");
    expect(markup).toContain("46.749,72");
    expect(markup).not.toContain("1. Alternative");
  });
});
