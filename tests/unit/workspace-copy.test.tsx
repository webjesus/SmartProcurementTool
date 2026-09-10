import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ProductLibraryPage } from "@/components/library/product-library-page";
import { PlannedWorkspacePage } from "@/components/planned-workspace-page";

const files = [
  "src/components/library/product-library-page.tsx",
  "src/components/browser-projects/projects-page.tsx",
  "src/components/browser-projects/new-project-page.tsx",
  "src/components/planned-workspace-page.tsx",
  "src/components/processing-panel.tsx",
  "src/components/section-view.tsx",
  "src/app/email-assistent/page.tsx"
];

// Check rendered copy and user-facing JSX attributes, not APIs, CSS or type names.
function jsxCopy(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values: string[] = [];
  const insideCopy = (node: ts.Node): boolean => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isJsxAttribute(parent)) return ["title", "aria-label", "description", "boundary", "eyebrow", "placeholder"].includes(parent.name.getText(source));
      if (ts.isJsxExpression(parent)) return true;
      if (ts.isStatement(parent)) return false;
    }
    return false;
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) values.push(node.text);
    else if (ts.isStringLiteralLike(node) && insideCopy(node)) values.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

describe("workspace copy without maturity labels", () => {
  it.each(files)("uses task-oriented user-facing copy in %s", (file) => {
    const invalid = jsxCopy(file).filter((text) => /\b(?:MVP|Pilot[\p{L}-]*|Demo|Prototyp[\p{L}-]*|Testmodus)\b/iu.test(text));
    expect(invalid).toEqual([]);
  });

  it("keeps unavailable library and future actions explicitly unavailable", () => {
    const library = renderToStaticMarkup(createElement(ProductLibraryPage, { initialProducts: [] }));
    const planned = renderToStaticMarkup(createElement(PlannedWorkspacePage, { eyebrow: "DOKUMENT", title: "Vorlage", description: "Beschreibung", boundary: "Die Firmenvorlage fehlt." }));
    expect(library).toContain("Noch nicht verfügbar");
    expect(library.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(4);
    expect(planned).toContain("Noch nicht verfügbar");
    expect(planned).toContain("Die Firmenvorlage fehlt.");
    expect(planned).toContain("führt noch keine Aktion aus");
  });

  it("retains the browser storage and missing synchronization warning", () => {
    const projects = readFileSync(files[1], "utf8");
    const creation = readFileSync(files[2], "utf8");
    expect(projects).toContain("nicht zwischen");
    expect(projects).toContain("Arbeitsplätzen synchronisiert");
    expect(creation).toContain("Projekte und PDFs bleiben nur in");
  });
});
