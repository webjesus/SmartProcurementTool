import { describe, expect, it } from "vitest";
import { evaluateDemoReadiness, type DemoReadinessInput } from "@/browser-projects/demo-readiness";

function readyInput(): DemoReadinessInput {
  return {
    documents: {
      totalFiles: 6,
      controlledFiles: 6,
      supportedFiles: 4,
      reviewRequiredFiles: 1,
      unsupportedFiles: 1,
      crashedFiles: 0
    },
    observed: {
      supportedPositions: {
        truePositive: 100,
        falsePositive: 0,
        falseNegative: 0
      },
      exactEvidence: {
        exact: 98,
        total: 100,
        neighbourContamination: 0
      },
      automaticMatches: {
        correct: 100,
        total: 100,
        minimumSample: 20,
        wrongHighConfidence: 0
      },
      reviewRouting: {
        unqualified: 5,
        routedToManual: 5,
        manualReview: 8
      },
      persistencePassed: true,
      reviewedExportPassed: true
    }
  };
}

describe("generic demo readiness evaluator", () => {
  it("returns DEMO_READY with explicit counts and rates for a controlled safe corpus", () => {
    const result = evaluateDemoReadiness(readyInput());

    expect(result.status).toBe("DEMO_READY");
    expect(result.counts).toMatchObject({
      totalFiles: 6,
      controlledFiles: 6,
      supportedPositionTruePositive: 100,
      automaticMatchCorrect: 100,
      unqualifiedRoutedToManual: 5
    });
    expect(result.rates).toMatchObject({
      fileControlRate: 1,
      supportedPositionPrecision: 1,
      supportedPositionRecall: 1,
      exactEvidenceRate: 0.98,
      automaticMatchAccuracy: 1,
      manualRoutingRate: 1
    });
    expect(result.automaticMatchEvaluation).toBe("PASS");
    expect(result.reasons).toEqual([]);
  });

  it.each([
    ["crash", (input: DemoReadinessInput) => (input.documents.crashedFiles = 1), "DOCUMENT_CRASH"],
    [
      "uncontrolled file",
      (input: DemoReadinessInput) => (input.documents.controlledFiles = 5),
      "UNCONTROLLED_FILES"
    ],
    [
      "silent supported-position omission",
      (input: DemoReadinessInput) => (input.observed.supportedPositions.falseNegative = 1),
      "SILENT_POSITION_OMISSION"
    ],
    [
      "evidence neighbour contamination",
      (input: DemoReadinessInput) => (input.observed.exactEvidence.neighbourContamination = 1),
      "EVIDENCE_NEIGHBOUR_CONTAMINATION"
    ],
    [
      "wrong high-confidence match",
      (input: DemoReadinessInput) => (input.observed.automaticMatches.wrongHighConfidence = 1),
      "WRONG_HIGH_CONFIDENCE_MATCH"
    ],
    [
      "unrouted unqualified result",
      (input: DemoReadinessInput) => (input.observed.reviewRouting.routedToManual = 4),
      "UNROUTED_UNQUALIFIED_RESULT"
    ],
    [
      "failed persistence",
      (input: DemoReadinessInput) => (input.observed.persistencePassed = false),
      "PERSISTENCE_FAILED"
    ],
    [
      "failed reviewed export",
      (input: DemoReadinessInput) => (input.observed.reviewedExportPassed = false),
      "REVIEWED_EXPORT_FAILED"
    ]
  ])("returns NO_GO for %s", (_label, mutate, expectedReason) => {
    const input = readyInput();
    mutate(input);

    const result = evaluateDemoReadiness(input);

    expect(result.status).toBe("NO_GO");
    expect(result.reasons.map((reason) => reason.code)).toContain(expectedReason);
  });

  it("marks zero automatic matches as NOT_EVALUATED and permits review-only use", () => {
    const input = readyInput();
    input.observed.automaticMatches.correct = 0;
    input.observed.automaticMatches.total = 0;

    const result = evaluateDemoReadiness(input);

    expect(result.status).toBe("REVIEW_ONLY");
    expect(result.automaticMatchEvaluation).toBe("NOT_EVALUATED");
    expect(result.rates.automaticMatchAccuracy).toBeNull();
    expect(result.reasons.map((reason) => reason.code)).toContain("AUTOMATIC_MATCH_NOT_EVALUATED");
  });

  it("uses REVIEW_ONLY when the automatic sample is too small", () => {
    const input = readyInput();
    input.observed.automaticMatches.correct = 10;
    input.observed.automaticMatches.total = 10;
    input.observed.automaticMatches.minimumSample = 20;

    const result = evaluateDemoReadiness(input);

    expect(result.status).toBe("REVIEW_ONLY");
    expect(result.automaticMatchEvaluation).toBe("INSUFFICIENT_SAMPLE");
    expect(result.reasons.map((reason) => reason.code)).toContain(
      "AUTOMATIC_MATCH_SAMPLE_TOO_SMALL"
    );
  });

  it("uses REVIEW_ONLY for weak but safely routed automation", () => {
    const input = readyInput();
    input.observed.automaticMatches.correct = 97;

    const result = evaluateDemoReadiness(input);

    expect(result.status).toBe("REVIEW_ONLY");
    expect(result.automaticMatchEvaluation).toBe("FAIL");
    expect(result.rates.automaticMatchAccuracy).toBe(0.97);
    expect(result.reasons.map((reason) => reason.code)).toContain(
      "AUTOMATIC_MATCH_ACCURACY_TOO_LOW"
    );
  });

  it("uses REVIEW_ONLY when exact evidence or safe position precision is below target", () => {
    const input = readyInput();
    input.observed.exactEvidence.exact = 90;
    input.observed.supportedPositions.falsePositive = 2;

    const result = evaluateDemoReadiness(input);

    expect(result.status).toBe("REVIEW_ONLY");
    expect(result.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "EXACT_EVIDENCE_RATE_TOO_LOW",
        "SUPPORTED_POSITION_PRECISION_TOO_LOW"
      ])
    );
  });

  it("does not mutate its input", () => {
    const input = readyInput();
    const before = structuredClone(input);

    evaluateDemoReadiness(input);

    expect(input).toEqual(before);
  });

  it("fails closed for internally inconsistent aggregate metrics", () => {
    const input = readyInput();
    input.observed.exactEvidence.exact = 101;

    const result = evaluateDemoReadiness(input);

    expect(result.status).toBe("NO_GO");
    expect(result.reasons.map((reason) => reason.code)).toContain("INVALID_METRICS");
  });
});
