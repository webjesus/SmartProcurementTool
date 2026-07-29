import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BrandMark } from "@/components/lv/brand-mark";
import {
  SUPPLIER_BRANDS,
  resolveManufacturerBrand,
  resolveSupplierBrand
} from "@/domain/brand-registry";

describe("supplier and manufacturer brand registry", () => {
  it.each([
    ["Gienger", "gienger"],
    ["P&M", "pfeiffer-may"],
    ["Reisser", "reisser"],
    ["Weishaupt", "weishaupt"]
  ])("resolves %s to canonical supplier %s", (label, canonicalId) => {
    expect(resolveSupplierBrand(label).brand.canonicalId).toBe(canonicalId);
  });

  it.each(["P&M", "P & M", "P und M", "PUM", "Pfeiffer & May"])(
    "maps P&M alias %s to the same local asset",
    (alias) => {
      const resolution = resolveSupplierBrand(alias);
      expect(resolution.brand.canonicalId).toBe("pfeiffer-may");
      expect(resolution.brand.logoAsset).toBe("/brands/suppliers/pm.webp");
    }
  );

  it("uses an initials fallback with accessible text for an unknown supplier", () => {
    const resolution = resolveSupplierBrand("Anderer Anbieter GmbH");
    const markup = renderToStaticMarkup(
      createElement(BrandMark, {
        resolution,
        label: "Anderer Anbieter GmbH"
      })
    );
    expect(resolution.confidence).toBe("UNKNOWN");
    expect(markup).toContain("AA");
    expect(markup).toContain("Anderer Anbieter GmbH");
    expect(markup).not.toContain("<img");
  });

  it("keeps supplier and manufacturer identities separate", () => {
    expect(resolveSupplierBrand("P&M").brand.canonicalId).toBe(
      "pfeiffer-may"
    );
    expect(resolveManufacturerBrand("ESBE").brand.canonicalId).toBe("esbe");
    expect(resolveManufacturerBrand("P&M").confidence).toBe("UNKNOWN");
  });

  it("does not show a manufacturer logo for an unconfirmed name", () => {
    const resolution = resolveManufacturerBrand("ESB ähnlich");
    const markup = renderToStaticMarkup(
      createElement(BrandMark, {
        resolution,
        label: "ESB ähnlich",
        allowFallback: false
      })
    );
    expect(resolution.confidence).toBe("UNKNOWN");
    expect(markup).toContain("ESB ähnlich");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("brand-fallback");
  });

  it("keeps every configured supplier logo local and accessible", () => {
    for (const brand of SUPPLIER_BRANDS) {
      expect(brand.logoAsset).toMatch(/^\/brands\/suppliers\//);
      const markup = renderToStaticMarkup(
        createElement(BrandMark, {
          resolution: resolveSupplierBrand(brand.displayName),
          label: brand.displayName
        })
      );
      expect(markup).toContain(
        `alt="${brand.shortName.replaceAll("&", "&amp;")} Logo"`
      );
      expect(markup).not.toMatch(/src="https?:\/\//);
      const file = path.resolve("public", brand.logoAsset!.slice(1));
      expect(existsSync(file), file).toBe(true);
      if (file.endsWith(".svg")) {
        const svg = readFileSync(file, "utf8");
        expect(svg).not.toMatch(/<script|javascript:|href=["']https?:|data:/i);
      }
    }
  });

  it("uses confirmed local manufacturer assets without external references", () => {
    for (const name of ["ESBE", "Reflex"]) {
      const resolution = resolveManufacturerBrand(name);
      expect(resolution.confidence).not.toBe("UNKNOWN");
      expect(resolution.brand.logoAsset).toMatch(
        /^\/brands\/manufacturers\//
      );
      const file = path.resolve(
        "public",
        resolution.brand.logoAsset!.slice(1)
      );
      expect(existsSync(file), file).toBe(true);
      if (file.endsWith(".svg")) {
        const svg = readFileSync(file, "utf8");
        expect(svg).not.toMatch(/<script|javascript:|href=["']https?:|data:/i);
      }
    }
  });

  it("keeps table, Inspector and SourceOverlay on the shared BrandMark component", () => {
    for (const file of [
      "src/components/lv/lv-comparison-table.tsx",
      "src/components/lv/position-inspector.tsx",
      "src/components/lv/source-overlay.tsx"
    ]) {
      const source = readFileSync(path.resolve(file), "utf8");
      expect(source, file).toContain("BrandMark");
      expect(source, file).not.toMatch(/\/brands\/suppliers\/[^"'`]+/);
    }
  });
});
