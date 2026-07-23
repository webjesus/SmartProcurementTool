import { describe, expect, it } from "vitest";
import { matchConstraints, proposeMatches, scoreMatch } from "@/domain/matching";
import { basisPosition, offerLine } from "../fixtures";

describe("matching", () => {
  it("uses more than the same position number", () => {
    const unrelated = {
      ...offerLine,
      id: "other",
      description: "Unrelated product",
      quantity: 99,
      unit: "m"
    };
    expect(proposeMatches([basisPosition], [unrelated])).toHaveLength(0);
  });

  it("scores description, number, quantity and unit together", () => {
    const result = scoreMatch(basisPosition, offerLine);
    expect(result.score).toBeGreaterThan(0.8);
    expect(result.reasons).toContain("Menge ist kompatibel");
  });

  it("supports bundle composition constraints", () => {
    const component = {
      ...offerLine,
      id: "component",
      description: "Anschlussset",
      quantity: 1,
      role: "REQUIRED_COMPONENT" as const
    };
    const result = matchConstraints(basisPosition, [
      { ...offerLine, quantity: 2 },
      component
    ]);
    expect(result.quantityCompatible).toBe(true);
    expect(result.requiredScopeComplete).toBe(true);
  });

  it("detects incompatible units and quantities", () => {
    const result = matchConstraints(basisPosition, [{ ...offerLine, quantity: 5, unit: "m" }]);
    expect(result.quantityCompatible).toBe(false);
    expect(result.unitCompatible).toBe(false);
  });
});
