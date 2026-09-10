export type DemoReadinessStatus = "DEMO_READY" | "REVIEW_ONLY" | "NO_GO";

export type AutomaticMatchEvaluation = "PASS" | "FAIL" | "INSUFFICIENT_SAMPLE" | "NOT_EVALUATED";

export type DocumentQualityReport = {
  totalFiles: number;
  controlledFiles: number;
  supportedFiles: number;
  reviewRequiredFiles: number;
  unsupportedFiles: number;
  crashedFiles: number;
};

export type GroundTruthMetrics = {
  supportedPositions: {
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
  };
  exactEvidence: {
    exact: number;
    total: number;
    neighbourContamination: number;
  };
  automaticMatches: {
    correct: number;
    total: number;
    minimumSample: number;
    wrongHighConfidence: number;
  };
  reviewRouting: {
    unqualified: number;
    routedToManual: number;
    manualReview: number;
  };
  persistencePassed: boolean;
  reviewedExportPassed: boolean;
};

export type DemoReadinessInput = {
  documents: DocumentQualityReport;
  observed: GroundTruthMetrics;
};

export type DemoReadinessReasonCode =
  | "INVALID_METRICS"
  | "DOCUMENT_CRASH"
  | "UNCONTROLLED_FILES"
  | "SILENT_POSITION_OMISSION"
  | "EVIDENCE_NEIGHBOUR_CONTAMINATION"
  | "WRONG_HIGH_CONFIDENCE_MATCH"
  | "UNROUTED_UNQUALIFIED_RESULT"
  | "PERSISTENCE_FAILED"
  | "REVIEWED_EXPORT_FAILED"
  | "SUPPORTED_POSITION_NOT_EVALUATED"
  | "SUPPORTED_POSITION_PRECISION_TOO_LOW"
  | "EXACT_EVIDENCE_NOT_EVALUATED"
  | "EXACT_EVIDENCE_RATE_TOO_LOW"
  | "AUTOMATIC_MATCH_NOT_EVALUATED"
  | "AUTOMATIC_MATCH_SAMPLE_TOO_SMALL"
  | "AUTOMATIC_MATCH_ACCURACY_TOO_LOW";

export type DemoReadinessReason = {
  code: DemoReadinessReasonCode;
  severity: "BLOCKER" | "REVIEW";
  message: string;
};

export type DemoReadinessCounts = {
  totalFiles: number;
  controlledFiles: number;
  supportedFiles: number;
  reviewRequiredFiles: number;
  unsupportedFiles: number;
  crashedFiles: number;
  supportedPositionTruePositive: number;
  supportedPositionFalsePositive: number;
  supportedPositionFalseNegative: number;
  exactEvidenceNumerator: number;
  exactEvidenceDenominator: number;
  evidenceNeighbourContamination: number;
  automaticMatchCorrect: number;
  automaticMatchTotal: number;
  automaticMatchMinimumSample: number;
  wrongHighConfidence: number;
  unqualified: number;
  unqualifiedRoutedToManual: number;
  manualReview: number;
};

export type DemoReadinessRates = {
  fileControlRate: number | null;
  supportedPositionPrecision: number | null;
  supportedPositionRecall: number | null;
  exactEvidenceRate: number | null;
  automaticMatchAccuracy: number | null;
  manualRoutingRate: number | null;
};

export type DemoReadinessResult = {
  status: DemoReadinessStatus;
  automaticMatchEvaluation: AutomaticMatchEvaluation;
  counts: DemoReadinessCounts;
  rates: DemoReadinessRates;
  reasons: DemoReadinessReason[];
};

const MIN_SUPPORTED_POSITION_PRECISION = 0.99;
const MIN_EXACT_EVIDENCE_RATE = 0.95;
const MIN_AUTOMATIC_MATCH_ACCURACY = 0.99;

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function metricsAreValid(input: DemoReadinessInput): boolean {
  const { documents, observed } = input;
  const counters = [
    documents.totalFiles,
    documents.controlledFiles,
    documents.supportedFiles,
    documents.reviewRequiredFiles,
    documents.unsupportedFiles,
    documents.crashedFiles,
    observed.supportedPositions.truePositive,
    observed.supportedPositions.falsePositive,
    observed.supportedPositions.falseNegative,
    observed.exactEvidence.exact,
    observed.exactEvidence.total,
    observed.exactEvidence.neighbourContamination,
    observed.automaticMatches.correct,
    observed.automaticMatches.total,
    observed.automaticMatches.minimumSample,
    observed.automaticMatches.wrongHighConfidence,
    observed.reviewRouting.unqualified,
    observed.reviewRouting.routedToManual,
    observed.reviewRouting.manualReview
  ];

  if (!counters.every(isCount)) return false;
  if (documents.totalFiles === 0) return false;
  if (documents.controlledFiles > documents.totalFiles) return false;
  if (documents.crashedFiles > documents.totalFiles) return false;
  if (
    documents.supportedFiles + documents.reviewRequiredFiles + documents.unsupportedFiles !==
    documents.controlledFiles
  ) {
    return false;
  }
  if (observed.exactEvidence.exact > observed.exactEvidence.total) return false;
  if (observed.exactEvidence.neighbourContamination > observed.exactEvidence.total) {
    return false;
  }
  if (
    observed.automaticMatches.correct > observed.automaticMatches.total ||
    observed.automaticMatches.wrongHighConfidence > observed.automaticMatches.total
  ) {
    return false;
  }
  if (observed.automaticMatches.minimumSample === 0) return false;
  if (
    observed.reviewRouting.routedToManual > observed.reviewRouting.unqualified ||
    observed.reviewRouting.routedToManual > observed.reviewRouting.manualReview
  ) {
    return false;
  }
  return true;
}

function addReason(
  reasons: DemoReadinessReason[],
  code: DemoReadinessReasonCode,
  severity: DemoReadinessReason["severity"],
  message: string
): void {
  reasons.push({ code, severity, message });
}

export function evaluateDemoReadiness(input: DemoReadinessInput): DemoReadinessResult {
  const { documents, observed } = input;
  const counts: DemoReadinessCounts = {
    totalFiles: documents.totalFiles,
    controlledFiles: documents.controlledFiles,
    supportedFiles: documents.supportedFiles,
    reviewRequiredFiles: documents.reviewRequiredFiles,
    unsupportedFiles: documents.unsupportedFiles,
    crashedFiles: documents.crashedFiles,
    supportedPositionTruePositive: observed.supportedPositions.truePositive,
    supportedPositionFalsePositive: observed.supportedPositions.falsePositive,
    supportedPositionFalseNegative: observed.supportedPositions.falseNegative,
    exactEvidenceNumerator: observed.exactEvidence.exact,
    exactEvidenceDenominator: observed.exactEvidence.total,
    evidenceNeighbourContamination: observed.exactEvidence.neighbourContamination,
    automaticMatchCorrect: observed.automaticMatches.correct,
    automaticMatchTotal: observed.automaticMatches.total,
    automaticMatchMinimumSample: observed.automaticMatches.minimumSample,
    wrongHighConfidence: observed.automaticMatches.wrongHighConfidence,
    unqualified: observed.reviewRouting.unqualified,
    unqualifiedRoutedToManual: observed.reviewRouting.routedToManual,
    manualReview: observed.reviewRouting.manualReview
  };
  const positionPrecision = rate(
    observed.supportedPositions.truePositive,
    observed.supportedPositions.truePositive + observed.supportedPositions.falsePositive
  );
  const positionRecall = rate(
    observed.supportedPositions.truePositive,
    observed.supportedPositions.truePositive + observed.supportedPositions.falseNegative
  );
  const automaticMatchAccuracy = rate(
    observed.automaticMatches.correct,
    observed.automaticMatches.total
  );
  const rates: DemoReadinessRates = {
    fileControlRate: rate(documents.controlledFiles, documents.totalFiles),
    supportedPositionPrecision: positionPrecision,
    supportedPositionRecall: positionRecall,
    exactEvidenceRate: rate(observed.exactEvidence.exact, observed.exactEvidence.total),
    automaticMatchAccuracy,
    manualRoutingRate: rate(
      observed.reviewRouting.routedToManual,
      observed.reviewRouting.unqualified
    )
  };
  const reasons: DemoReadinessReason[] = [];

  if (!metricsAreValid(input)) {
    addReason(
      reasons,
      "INVALID_METRICS",
      "BLOCKER",
      "Aggregate readiness metrics are internally inconsistent."
    );
  }
  if (documents.crashedFiles > 0) {
    addReason(
      reasons,
      "DOCUMENT_CRASH",
      "BLOCKER",
      "At least one document caused a processing crash."
    );
  }
  if (documents.controlledFiles < documents.totalFiles) {
    addReason(
      reasons,
      "UNCONTROLLED_FILES",
      "BLOCKER",
      "Not every file has an explicit supported, review-required, or unsupported outcome."
    );
  }
  if (observed.supportedPositions.falseNegative > 0) {
    addReason(
      reasons,
      "SILENT_POSITION_OMISSION",
      "BLOCKER",
      "At least one ground-truth position was silently omitted."
    );
  }
  if (observed.exactEvidence.neighbourContamination > 0) {
    addReason(
      reasons,
      "EVIDENCE_NEIGHBOUR_CONTAMINATION",
      "BLOCKER",
      "At least one evidence region includes a neighbouring position."
    );
  }
  if (observed.automaticMatches.wrongHighConfidence > 0) {
    addReason(
      reasons,
      "WRONG_HIGH_CONFIDENCE_MATCH",
      "BLOCKER",
      "At least one incorrect automatic match was presented with high confidence."
    );
  }
  if (observed.reviewRouting.routedToManual < observed.reviewRouting.unqualified) {
    addReason(
      reasons,
      "UNROUTED_UNQUALIFIED_RESULT",
      "BLOCKER",
      "At least one unqualified result was not routed to manual review."
    );
  }
  if (!observed.persistencePassed) {
    addReason(
      reasons,
      "PERSISTENCE_FAILED",
      "BLOCKER",
      "The reviewed state did not survive the persistence check."
    );
  }
  if (!observed.reviewedExportPassed) {
    addReason(
      reasons,
      "REVIEWED_EXPORT_FAILED",
      "BLOCKER",
      "The reviewed export did not pass its acceptance check."
    );
  }

  if (positionPrecision === null) {
    addReason(
      reasons,
      "SUPPORTED_POSITION_NOT_EVALUATED",
      "REVIEW",
      "Supported-position precision has no ground-truth sample."
    );
  } else if (positionPrecision < MIN_SUPPORTED_POSITION_PRECISION) {
    addReason(
      reasons,
      "SUPPORTED_POSITION_PRECISION_TOO_LOW",
      "REVIEW",
      "Supported-position precision is below the demo-ready target."
    );
  }

  if (rates.exactEvidenceRate === null) {
    addReason(
      reasons,
      "EXACT_EVIDENCE_NOT_EVALUATED",
      "REVIEW",
      "Exact source evidence has no ground-truth sample."
    );
  } else if (rates.exactEvidenceRate < MIN_EXACT_EVIDENCE_RATE) {
    addReason(
      reasons,
      "EXACT_EVIDENCE_RATE_TOO_LOW",
      "REVIEW",
      "Exact source-evidence coverage is below the demo-ready target."
    );
  }

  let automaticMatchEvaluation: AutomaticMatchEvaluation;
  if (observed.automaticMatches.total === 0) {
    automaticMatchEvaluation = "NOT_EVALUATED";
    addReason(
      reasons,
      "AUTOMATIC_MATCH_NOT_EVALUATED",
      "REVIEW",
      "Automatic matching has no observed ground-truth sample."
    );
  } else if (observed.automaticMatches.total < observed.automaticMatches.minimumSample) {
    automaticMatchEvaluation = "INSUFFICIENT_SAMPLE";
    addReason(
      reasons,
      "AUTOMATIC_MATCH_SAMPLE_TOO_SMALL",
      "REVIEW",
      "The automatic-match sample is smaller than the declared minimum."
    );
  } else if (
    automaticMatchAccuracy !== null &&
    automaticMatchAccuracy < MIN_AUTOMATIC_MATCH_ACCURACY
  ) {
    automaticMatchEvaluation = "FAIL";
    addReason(
      reasons,
      "AUTOMATIC_MATCH_ACCURACY_TOO_LOW",
      "REVIEW",
      "Automatic-match accuracy is below the demo-ready target."
    );
  } else {
    automaticMatchEvaluation = "PASS";
  }

  const status: DemoReadinessStatus = reasons.some((reason) => reason.severity === "BLOCKER")
    ? "NO_GO"
    : reasons.length > 0
      ? "REVIEW_ONLY"
      : "DEMO_READY";

  return {
    status,
    automaticMatchEvaluation,
    counts,
    rates,
    reasons
  };
}
