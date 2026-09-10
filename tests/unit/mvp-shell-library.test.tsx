import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductLibraryPage } from "@/components/library/product-library-page";
import { requiresDecisionIdentity } from "@/components/decision-identity";
import {
  createProjectProductSnapshot,
  filterConfirmedProducts,
  type CanonicalProduct
} from "@/library/product-library";
import { GLOBAL_NAVIGATION } from "@/navigation/global-navigation";
import {
  normalizeThemePreference,
  resolveTheme
} from "@/ui/theme";

const products: CanonicalProduct[] = [
  {
    id: "product-pump",
    version: 3,
    status: "CONFIRMED",
    productName: "Hocheffizienzpumpe",
    manufacturer: "Synthetic Werke",
    model: "HX 40",
    category: "Pumpen",
    application: "Heizung",
    technicalAttributes: [
      { name: "Nennweite", value: "DN 40" }
    ],
    supplierAliases: [],
    documentCount: 2,
    usageCount: 4,
    updatedAt: "2026-08-31T10:00:00.000Z"
  },
  {
    id: "product-valve",
    version: 1,
    status: "REVIEW_REQUIRED",
    productName: "Regelventil",
    manufacturer: "Synthetic Werke",
    model: "RV 20",
    category: "Armaturen",
    application: "Heizung",
    technicalAttributes: [],
    supplierAliases: [],
    documentCount: 1,
    usageCount: 0,
    updatedAt: "2026-08-31T11:00:00.000Z"
  }
];

describe("MVP shell contracts", () => {
  it("exposes the complete German global navigation with the library first", () => {
    expect(GLOBAL_NAVIGATION.map(({ href, label }) => [href, label])).toEqual([
      ["/", "Produktbibliothek"],
      ["/projects", "Projekte"],
      ["/projects/new", "Neues Projekt"],
      ["/pdf-erstellen", "PDF erstellen"],
      ["/email-assistent", "E-Mail-Assistent"],
      ["/revisionsunterlagen", "Revisionsunterlagen"],
      ["/eigenes-lv", "Eigenes LV"]
    ]);
  });

  it("normalizes invalid theme preferences and resolves system mode", () => {
    expect(normalizeThemePreference("dark")).toBe("dark");
    expect(normalizeThemePreference("unexpected")).toBe("system");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("does not block library and project navigation with decision identity", () => {
    expect(requiresDecisionIdentity("/")).toBe(false);
    expect(requiresDecisionIdentity("/projects")).toBe(false);
    expect(requiresDecisionIdentity("/projects/new")).toBe(false);
    expect(requiresDecisionIdentity("/lv-vergleich")).toBe(true);
    expect(
      requiresDecisionIdentity("/projects/project-1/lv-vergleich")
    ).toBe(true);
  });
});

describe("confirmed product library", () => {
  it("keeps review candidates out and searches canonical fields", () => {
    expect(
      filterConfirmedProducts(products, { query: "dn 40" }).map(
        (product) => product.id
      )
    ).toEqual(["product-pump"]);
    expect(
      filterConfirmedProducts(products, { query: "Regelventil" })
    ).toEqual([]);
  });

  it("creates an immutable project snapshot instead of a live product link", () => {
    const snapshot = createProjectProductSnapshot(
      products[0],
      "project-1",
      "2026-08-31T12:00:00.000Z"
    );
    products[0].productName = "Changed later";

    expect(snapshot).toMatchObject({
      projectId: "project-1",
      sourceProductId: "product-pump",
      sourceProductVersion: 3,
      productName: "Hocheffizienzpumpe"
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.technicalAttributes)).toBe(true);
  });

  it("renders an honest empty library with both distinct add actions", () => {
    const markup = renderToStaticMarkup(
      createElement(ProductLibraryPage, { initialProducts: [] })
    );
    expect(markup).toContain("Produktbibliothek");
    expect(markup).toContain("Noch keine bestätigten Produkte");
    expect(markup).toContain("Produkt hinzufügen");
    expect(markup).toContain("Zum Projekt hinzufügen");
    expect(markup).toContain("Suche, Filter und Detailansicht sind verfügbar");
    expect(markup).toContain("Noch nicht verfügbar");
    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(4);
    expect(markup).not.toContain("currentPrice");
  });
});
