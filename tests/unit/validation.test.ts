import { describe, expect, it } from "vitest";
import {
  canMachineValidate,
  parseGermanNumber,
  pricesApproximatelyEqual,
  validateEvidence,
  validateOfferLine
} from "@/domain/validation";
import { evidence, offerLine } from "../fixtures";

describe("German numbers", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["12,50 €", 12.5],
    ["1 234,50", 1234.5],
    ["-2.000,00", -2000],
    ["1000", 1000]
  ])("parses %s", (input, expected) => {
    expect(parseGermanNumber(input)).toBe(expected);
  });

  it("does not invent a number", () => {
    expect(parseGermanNumber("Preis auf Anfrage")).toBeNull();
  });
});

describe("price and evidence validation", () => {
  it("validates quantity × EP ≈ GP including price basis", () => {
    expect(pricesApproximatelyEqual(3, 100, 300, 1)).toBe(true);
    expect(pricesApproximatelyEqual(300, 248, 744, 100)).toBe(true);
    expect(pricesApproximatelyEqual(3, 100, 250, 1)).toBe(false);
  });

  it("detects evidence ownership conflicts", () => {
    expect(validateEvidence([evidence], "doc-offer", 1, new Set(["ti-1"]))).toHaveLength(0);
    expect(validateEvidence([evidence], "other", 1, new Set(["ti-1"]))[0].code).toBe(
      "EVIDENCE_CONFLICTING"
    );
  });

  it("blocks lines without evidence", () => {
    const line = { ...offerLine, evidence: [] };
    const issues = validateOfferLine(line);
    expect(issues.map((issue) => issue.code)).toContain("EVIDENCE_MISSING");
    expect(canMachineValidate(line, issues)).toBe(false);
  });

  it("flags optional items without a group", () => {
    const issues = validateOfferLine({ ...offerLine, role: "OPTIONAL", groupId: null });
    expect(issues.map((issue) => issue.code)).toContain("OPTIONAL_PRIMARY_AMBIGUOUS");
  });

  it("keeps alternative role distinct", () => {
    const alternative = { ...offerLine, role: "ALTERNATIVE" as const };
    expect(alternative.role).toBe("ALTERNATIVE");
    expect(validateOfferLine(alternative)).toHaveLength(0);
  });
});
