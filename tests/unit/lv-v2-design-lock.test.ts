import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync("src/app/globals.css", "utf8");
const v2Css = readFileSync("src/app/lv-workspace-v2.css", "utf8");
const comparisonPage = readFileSync("src/components/lv/lv-comparison-page.tsx", "utf8");
const sectionView = readFileSync("src/components/section-view.tsx", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");

describe("LV v2 design lock", () => {
  it("always mounts the quiet three-pane workspace with a durable marker", () => {
    expect(comparisonPage).toContain("lv-workspace--quiet");
    expect(comparisonPage).toContain('data-lv-design="v2"');
    expect(comparisonPage).toContain("lv-three-pane");
  });

  it("does not keep a runtime switch back to the legacy comparison UI", () => {
    expect(sectionView).not.toContain("NEXT_PUBLIC_LEGACY_LV_UI");
    expect(sectionView).not.toMatch(/pilot === null \?[\s\S]*<SyntheticComparison/);
    expect(sectionView).toContain("<LvComparisonPage");
  });

  it("loads v2 styles after globals so the approved layout can override leftovers", () => {
    expect(layout.indexOf('import "./globals.css"')).toBeGreaterThan(-1);
    expect(layout.indexOf('import "./lv-workspace-v2.css"')).toBeGreaterThan(
      layout.indexOf('import "./globals.css"')
    );
  });

  it("keeps legacy two-pane geometry off the three-pane workspace", () => {
    expect(globalsCss).toContain(".lv-two-pane:not(.lv-three-pane)");
    expect(globalsCss).toContain(".lv-two-pane.details-open:not(.lv-three-pane)");
    expect(globalsCss).toContain(
      '.wb-app-frame[data-lv-workspace="true"] .lv-workspace:not(.lv-workspace--quiet)'
    );
    expect(globalsCss).toContain(
      ".lv-workspace:not(.lv-workspace--quiet) .lv-toolbar"
    );
  });

  it("locks the three-column grid to the v2 marker instead of a hydratable shell flag", () => {
    expect(v2Css).toContain(
      'html body .lv-workspace[data-lv-design="v2"].lv-workspace--quiet .lv-three-pane.lv-two-pane'
    );
    expect(v2Css).toMatch(
      /html body \.lv-workspace\[data-lv-design="v2"\]\.lv-workspace--quiet \.lv-three-pane\.lv-two-pane[\s\S]*grid-template-columns:\s*228px/
    );
  });

  it("keeps dark theme tokens after the approved light three-pane overrides", () => {
    const approved = v2Css.indexOf("/* Approved working layout:");
    const darkAfter = v2Css.indexOf(
      "/* Dark must win over the approved light token block above. */"
    );
    expect(approved).toBeGreaterThan(-1);
    expect(darkAfter).toBeGreaterThan(approved);
    expect(v2Css).toContain(
      'html[data-theme="dark"] .lv-workspace--quiet .lv-three-pane .lv-offer-row'
    );
  });

  it("routes the global comparison URL away from the synthetic table", () => {
    const page = readFileSync("src/app/[section]/page.tsx", "utf8");
    expect(page).toContain("localCorpusEnabled()");
    expect(page).toContain('redirect("/projects")');
  });
});
