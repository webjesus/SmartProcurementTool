import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PositionDetailsPane, isOfferPreviewKey, offerUnitPriceLabel } from "@/components/lv/position-details-pane";
import type { ProjectReviewPosition } from "@/domain/project-review";
import { basisPosition } from "../fixtures";
import { AppShell } from "@/components/app-shell";

vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<object>(),
  usePathname: () => "/projects/project-1/lv-vergleich"
}));

function details(tab: "OFFER_DATA" | "ORIGINAL_DOCUMENT") {
  return renderToStaticMarkup(createElement(PositionDetailsPane, {
    position: { basis: basisPosition, options: [] } as unknown as ProjectReviewPosition,
    offerLines: new Map(), tab, sources: [], activeSourceKey: null, sourceView: null,
    positionIndex: 0, positionTotal: 1, onTab: vi.fn(), onSourceSelect: vi.fn(),
    onSourceView: vi.fn(), onBasisSource: vi.fn(), onSupplierSource: vi.fn(),
    onFullscreen: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn(), onClose: vi.fn()
  }));
}

describe("approved three-pane LV workplace", () => {
  it("keeps navigation in real project workflows without a legacy comparison shortcut", () => {
    const html = renderToStaticMarkup(<AppShell devUiEnabled={false} browserLocal>LV</AppShell>);
    expect(html).not.toContain('href="/lv-vergleich"');
    expect(html).toContain('href="/projects"');
    expect(html).not.toMatch(/MVP-Arbeitsstand|Browser-Testmodus|Projekt-Prototyp/);
    expect(html).toContain("Lokal gespeichert");
    expect(html).toContain('data-lv-workspace="true"');
    expect(html).toContain('data-lv-design="v2"');
  });
  it("keeps the real source as a sibling of the decision pane on both tabs", () => {
    for (const tab of ["OFFER_DATA", "ORIGINAL_DOCUMENT"] as const) {
      const html = details(tab);
      expect(html).toContain("data-lv-decision-pane");
      expect(html).toMatch(/<\/aside><section[^>]+data-lv-source-pane/);
      expect(html).toContain('aria-label="Dokumentvorschau"');
    }
  });

  it("keeps description and offer data mounted while switching detail tabs", () => {
    const html = details("ORIGINAL_DOCUMENT");
    expect(html).toContain("data-offer-data");
    expect(html).toContain("data-basis-description");
    expect(html).toContain(basisPosition.description);
  });

  it("previews only a card's own Enter/Space, never bubbled selection-button keys", () => {
    expect(isOfferPreviewKey("Enter", true)).toBe(true);
    expect(isOfferPreviewKey(" ", true)).toBe(true);
    expect(isOfferPreviewKey("ArrowDown", true)).toBe(false);
    expect(isOfferPreviewKey("Enter", false)).toBe(false);
    expect(isOfferPreviewKey(" ", false)).toBe(false);
  });

  it("labels supplier EP per 100/1000 units instead of pretending it is per item", () => {
    expect(offerUnitPriceLabel(50, 100, "St")).toMatch(/EP.*50,00.*100 St/);
    expect(offerUnitPriceLabel(75, 1000, "m")).toMatch(/EP.*75,00.*1.000 m/);
    expect(offerUnitPriceLabel(50, 1, "St")).not.toContain(" / ");
    expect(offerUnitPriceLabel(null, 100, "St")).toBe("Preis prüfen");
  });
});
