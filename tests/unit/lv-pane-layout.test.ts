import { describe, expect, it } from "vitest";
import { decisionPaneWidth, previewOptionAfterSourceChange, evidenceFitScale } from "@/components/lv/workspace-layout";

describe("working pane navigation and geometry", () => {
  it("keeps both panes readable and rejects layouts without sufficient space", () => {
    expect(decisionPaneWidth(1000, .9)).toBe(640);
    expect(decisionPaneWidth(1000, .1)).toBe(360);
    expect(decisionPaneWidth(1000, .5)).toBe(500);
    expect(decisionPaneWidth(700, .5)).toBeNull();
    expect(decisionPaneWidth(1000, Number.NaN)).toBe(500);
  });
  it("updates the inspected offer for a supplier source and preserves it on Basis", () => {
    expect(previewOptionAfterSourceChange("a", { kind: "supplier", supplierOptionId: "b" })).toBe("b");
    expect(previewOptionAfterSourceChange("b", { kind: "basis" })).toBe("b");
    expect(previewOptionAfterSourceChange(null, { kind: "basis" })).toBeNull();
  });
  it("uses most of the pane for the position, not half-height contextual padding", () => {
    const scale = evidenceFitScale({ width: 600, height: 800 }, { width: 600, height: 850 }, { width: .8, height: .5 });
    expect(scale * 600 * .8).toBeCloseTo(564);
    expect(scale * 850 * .5).toBeGreaterThan(480);
    expect(scale * 850 * .5).toBeLessThanOrEqual(800 * .84);
  });
});
