import { describe, expect, it } from "vitest";
import { CompanyRuleSchema } from "@/domain/contracts";
import { applyOfferLineReview, mayRunSemanticRecheck } from "@/domain/review";
import { createExtractionCacheKey } from "@/ai/openai-extraction-adapter";
import { offerLine } from "../fixtures";

describe("review safeguards", () => {
  it("allows exactly one semantic recheck", () => {
    expect(mayRunSemanticRecheck(0)).toBe(true);
    expect(mayRunSemanticRecheck(1)).toBe(false);
    expect(mayRunSemanticRecheck(2)).toBe(false);
  });

  it("locks human-confirmed fields", () => {
    const confirmed = applyOfferLineReview(offerLine, {
      id: "action-1",
      issueId: "issue-1",
      entityId: offerLine.id,
      field: "quantity",
      action: "CONFIRM",
      previousValue: 3,
      newValue: 3,
      operator: "tester",
      timestamp: new Date().toISOString(),
      reason: "source checked",
      comment: ""
    });
    expect(confirmed.lockedFields).toContain("quantity");
    expect(() =>
      applyOfferLineReview(confirmed, {
        id: "action-2",
        issueId: "issue-1",
        entityId: offerLine.id,
        field: "quantity",
        action: "CORRECT",
        previousValue: 3,
        newValue: 4,
        operator: "tester",
        timestamp: new Date().toISOString(),
        reason: "automatic overwrite",
        comment: ""
      })
    ).toThrow(/locked/);
  });
});

describe("versioned rules and cache", () => {
  it.each(["GLOBAL", "COMPANY", "SUPPLIER", "DOCUMENT_FAMILY", "PROJECT"])(
    "accepts %s rule scope",
    (scope) => {
      expect(
        CompanyRuleSchema.parse({
          id: "rule-1",
          version: 1,
          name: "Synthetic rule",
          type: "COMPARISON_RULE",
          scope,
          scopeId: scope === "GLOBAL" ? null : "scope-1",
          payload: {},
          approvedAt: new Date().toISOString(),
          supersedesRuleId: null
        }).scope
      ).toBe(scope);
    }
  );

  it("changes cache key when prompt, model or source changes", () => {
    const base = {
      promptVersion: "v1",
      schemaVersion: "v1",
      preprocessingVersion: "v1",
      model: "gpt-test",
      source: { page: 1 }
    };
    expect(createExtractionCacheKey(base)).toBe(createExtractionCacheKey(base));
    expect(createExtractionCacheKey(base)).not.toBe(
      createExtractionCacheKey({ ...base, source: { page: 2 } })
    );
  });
});
