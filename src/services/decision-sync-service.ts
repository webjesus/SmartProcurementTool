import path from "node:path";
import type {
  CentralSupplierDecision,
  CreateCentralDecisionInput,
  DecisionDraftRecord,
  SaveDecisionDraftInput
} from "@/domain/central-decision";
import {
  buildDecisionEvidenceSnapshot,
  validateDecisionEvidence,
  validateDecisionReasons,
  validateManagerDecisionComment
} from "@/domain/decision";
import {
  decisionAnalysisVersionId,
  decisionProjectId
} from "@/domain/decision-project";
import type { SupplierOption } from "@/domain/contracts";
import type {
  DecisionRepositories,
  DecisionRepositoryUnitOfWork
} from "@/repositories/decision-repositories";
import { LocalPilotPersistence } from "@/storage/document-storage";

export class DecisionInputError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details?: unknown
  ) {
    super(code);
    this.name = "DecisionInputError";
  }
}

async function pilotContext(input: {
  projectId: string;
  positionId: string;
  analysisVersionId: string;
}) {
  const persistence = new LocalPilotPersistence(
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data"),
    true
  );
  const state = await persistence.read();
  const analysis = state.analysis;
  if (!analysis) {
    throw new DecisionInputError("PILOT_ANALYSIS_NOT_FOUND", 404);
  }
  const expectedProjectId = decisionProjectId(analysis);
  if (input.projectId !== expectedProjectId) {
    throw new DecisionInputError("PROJECT_NOT_FOUND", 404);
  }
  const expectedAnalysisVersion = decisionAnalysisVersionId(analysis);
  if (input.analysisVersionId !== expectedAnalysisVersion) {
    throw new DecisionInputError("ANALYSIS_VERSION_CONFLICT", 409, {
      expectedAnalysisVersion
    });
  }
  const basis = analysis.basisPositions.find(
    (position) => position.id === input.positionId
  );
  if (!basis) throw new DecisionInputError("POSITION_NOT_FOUND", 404);
  const options = analysis.supplierOptions.filter((option) =>
    option.basisPositionIds.includes(basis.id)
  );
  return {
    state,
    analysis,
    basis,
    options,
    projectId: expectedProjectId,
    analysisVersionId: expectedAnalysisVersion
  };
}

export async function currentDecisionProjectMetadata() {
  const persistence = new LocalPilotPersistence(
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data"),
    true
  );
  const state = await persistence.read();
  if (!state.analysis) {
    throw new DecisionInputError("PILOT_ANALYSIS_NOT_FOUND", 404);
  }
  return {
    projectId: decisionProjectId(state.analysis),
    analysisVersionId: decisionAnalysisVersionId(state.analysis)
  };
}

function validateSelection(input: {
  outcome: SaveDecisionDraftInput["outcome"];
  selectedSupplierOptionId: string | null;
  selectedBundleLineIds: string[];
  rejectedOptionIds: string[];
  options: SupplierOption[];
}) {
  const option = input.selectedSupplierOptionId
    ? (input.options.find(
        (candidate) => candidate.id === input.selectedSupplierOptionId
      ) ?? null)
    : null;
  if (input.selectedSupplierOptionId && !option) {
    throw new DecisionInputError("SUPPLIER_OPTION_NOT_FOUND", 404);
  }
  if (input.outcome === "SELECTED" && !option) {
    throw new DecisionInputError("SELECTED_OPTION_REQUIRED", 422);
  }
  if (
    option &&
    (input.selectedBundleLineIds.length === 0 ||
      input.selectedBundleLineIds.some(
        (lineId) => !option.matchedOfferLineIds.includes(lineId)
      ))
  ) {
    throw new DecisionInputError("SELECTED_BUNDLE_LINES_INVALID", 422);
  }
  const optionIds = new Set(input.options.map((candidate) => candidate.id));
  if (input.rejectedOptionIds.some((optionId) => !optionIds.has(optionId))) {
    throw new DecisionInputError("REJECTED_OPTION_INVALID", 422);
  }
  return option;
}

export class DecisionSyncService {
  constructor(private readonly unit: DecisionRepositoryUnitOfWork) {}

  async getDraft(
    projectId: string,
    positionId: string,
    analysisVersionId: string
  ) {
    await pilotContext({ projectId, positionId, analysisVersionId });
    return this.unit.repositories.drafts.get(projectId, positionId);
  }

  async saveDraft(input: {
    projectId: string;
    positionId: string;
    actorId: string;
    actorSessionId: string;
    draft: SaveDecisionDraftInput;
  }): Promise<DecisionDraftRecord> {
    const context = await pilotContext({
      projectId: input.projectId,
      positionId: input.positionId,
      analysisVersionId: input.draft.analysisVersionId
    });
    validateSelection({
      ...input.draft,
      options: context.options
    });
    return this.unit.transaction(async (repositories) => {
      const draft = await repositories.drafts.save({
        projectId: input.projectId,
        positionId: input.positionId,
        userId: input.actorId,
        selectedSupplierOptionId: input.draft.selectedSupplierOptionId,
        selectedBundleLineIds: input.draft.selectedBundleLineIds,
        rejectedOptionIds: input.draft.rejectedOptionIds,
        reasonCodes: input.draft.reasonCodes,
        outcome: input.draft.outcome,
        comment: input.draft.comment,
        analysisVersionId: input.draft.analysisVersionId,
        expectedVersion: input.draft.expectedVersion,
        updatedBy: input.actorId,
        deviceSessionId: input.draft.deviceSessionId || input.actorSessionId
      });
      await repositories.events.append({
        projectId: input.projectId,
        positionId: input.positionId,
        decisionId: null,
        draftId: draft.id,
        eventType: draft.version === 1 ? "DRAFT_CREATED" : "DRAFT_UPDATED",
        actorId: input.actorId,
        metadata: {
          version: draft.version,
          deviceSessionId: input.draft.deviceSessionId
        }
      });
      return draft;
    });
  }

  async deleteDraft(input: {
    projectId: string;
    positionId: string;
    analysisVersionId: string;
    expectedVersion?: number;
    actorId: string;
  }) {
    await pilotContext(input);
    return this.unit.transaction(async (repositories) => {
      const current = await repositories.drafts.get(
        input.projectId,
        input.positionId
      );
      const deleted = await repositories.drafts.delete(
        input.projectId,
        input.positionId,
        input.expectedVersion
      );
      if (deleted) {
        await repositories.events.append({
          projectId: input.projectId,
          positionId: input.positionId,
          decisionId: null,
          draftId: current?.id ?? null,
          eventType: "DRAFT_DELETED",
          actorId: input.actorId,
          metadata: { version: current?.version ?? null }
        });
      }
      return deleted;
    });
  }

  async listDecisions(projectId: string, positionId?: string) {
    if (positionId) {
      return this.unit.repositories.decisions.list(projectId, positionId);
    }
    return this.unit.repositories.decisions.listProject(projectId);
  }

  async createDecision(input: {
    projectId: string;
    positionId: string;
    actorId: string;
    decision: CreateCentralDecisionInput;
  }): Promise<CentralSupplierDecision> {
    const context = await pilotContext({
      projectId: input.projectId,
      positionId: input.positionId,
      analysisVersionId: input.decision.analysisVersionId
    });
    const option = validateSelection({
      ...input.decision,
      options: context.options
    });
    const commentValidation = validateManagerDecisionComment({
      status: input.decision.outcome,
      decisionType:
        input.decision.decisionType === "AUTOMATIC_OVERRIDE"
          ? "AUTOMATIC_OVERRIDE"
          : undefined,
      comment: input.decision.comment
    });
    if (!commentValidation.valid) {
      throw new DecisionInputError(
        "DECISION_COMMENT_INVALID",
        422,
        commentValidation.errors
      );
    }
    if (
      input.decision.outcome === "NONE_CORRECT" ||
      (input.decision.outcome === "SELECTED" &&
        input.decision.reasonCodes.length > 0)
    ) {
      const reasons = validateDecisionReasons(
        input.decision.reasonCodes,
        input.decision.comment
      );
      if (!reasons.valid) {
        throw new DecisionInputError(
          "DECISION_REASON_INVALID",
          422,
          reasons.errors
        );
      }
    }
    const capturedAt = new Date().toISOString();
    const evidenceSnapshot = buildDecisionEvidenceSnapshot({
      state: context.state,
      basis: context.basis,
      option,
      selectedLineIds: input.decision.selectedBundleLineIds,
      capturedAt
    });
    if (input.decision.outcome === "SELECTED") {
      const evidenceValidation = validateDecisionEvidence(evidenceSnapshot);
      if (!evidenceValidation.valid) {
        throw new DecisionInputError(
          "DECISION_EVIDENCE_INVALID",
          422,
          evidenceValidation.errors
        );
      }
    }
    const contextSnapshot = {
      capturedAt,
      analysisVersionId: context.analysisVersionId,
      basisPosition: {
        id: context.basis.id,
        positionNumber: context.basis.positionNumber,
        description: context.basis.description,
        quantity: context.basis.quantity,
        unit: context.basis.unit
      },
      supplierOptions: context.options.map((candidate) => ({
        id: candidate.id,
        supplierLabel: candidate.supplierLabel,
        comparableTotal: candidate.comparableTotal,
        status: candidate.status,
        matchedOfferLineIds: candidate.matchedOfferLineIds
      }))
    };

    return this.unit.transaction(async (repositories) => {
      const created = await repositories.decisions.create({
        projectId: input.projectId,
        positionId: input.positionId,
        selectedSupplierOptionId: input.decision.selectedSupplierOptionId,
        selectedBundleLineIds: input.decision.selectedBundleLineIds,
        rejectedOptionIds: input.decision.rejectedOptionIds,
        outcome: input.decision.outcome,
        reasonCodes: input.decision.reasonCodes,
        comment: input.decision.comment.trim(),
        decidedBy: input.actorId,
        analysisVersionId: input.decision.analysisVersionId,
        expectedDecisionVersion: input.decision.expectedDecisionVersion,
        decisionType: input.decision.decisionType,
        contextSnapshot,
        evidenceSnapshot,
        documentRevisionIds: evidenceSnapshot.documentRevisionIds
      });
      const draft = await repositories.drafts.get(
        input.projectId,
        input.positionId
      );
      if (draft) {
        await repositories.drafts.delete(
          input.projectId,
          input.positionId,
          draft.version
        );
      }
      await repositories.events.append({
        projectId: input.projectId,
        positionId: input.positionId,
        decisionId: created.id,
        draftId: draft?.id ?? null,
        eventType: "FINAL_DECISION_CREATED",
        actorId: input.actorId,
        metadata: {
          decisionVersion: created.decisionVersion,
          previousDecisionId: created.previousDecisionId,
          reviewAction: true
        }
      });
      await repositories.events.append({
        projectId: input.projectId,
        positionId: input.positionId,
        decisionId: created.id,
        draftId: null,
        eventType: "REVIEW_ACTION_CREATED",
        actorId: input.actorId,
        metadata: {
          outcome: created.outcome,
          decisionType: created.decisionType
        }
      });
      return created;
    });
  }
}

export function decisionServiceFor(
  repositories: DecisionRepositoryUnitOfWork
): DecisionSyncService {
  return new DecisionSyncService(repositories);
}

export async function centralProjectDecisionData(
  repositories: DecisionRepositories,
  projectId: string
) {
  const [drafts, decisions, events] = await Promise.all([
    repositories.drafts.list(projectId),
    repositories.decisions.listProject(projectId),
    repositories.events.list(projectId)
  ]);
  return { drafts, decisions, events };
}
