import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MatchReviewActionSchema,
  SupplierDecisionSchema,
  type OfferLine
} from "@/domain/contracts";
import {
  composeMatchLink,
  refreshPilotAnalysisForPositions
} from "@/domain/matching";
import { applyOfferLineReview, type ReviewAction } from "@/domain/review";
import {
  LocalPilotPersistence,
  type PersistedPilotReviewAction
} from "@/storage/document-storage";

export const runtime = "nodejs";

const ReviewActionInput = z.object({
  runId: z.string().min(1).optional(),
  issueId: z.string().min(1),
  lineId: z.string().min(1).optional(),
  field: z.string().min(1).optional(),
  action: z.enum(["CONFIRM", "CORRECT", "SELECT_VALUE", "CHANGE_ROLE", "DEFER"]),
  previousValue: z.unknown().optional(),
  newValue: z.unknown(),
  operator: z.string().min(1),
  reason: z.string().min(1),
  comment: z.string().optional().default("")
});

const MatchActionInput = MatchReviewActionSchema.omit({
  id: true,
  timestamp: true
}).extend({ kind: z.literal("MATCH") });

const SupplierDecisionInput = SupplierDecisionSchema.omit({
  id: true,
  timestamp: true
}).extend({ kind: z.literal("DECISION") });

type StoredReviewAction = z.infer<typeof ReviewActionInput> & {
  id: string;
  timestamp: string;
};

const memory = globalThis as typeof globalThis & {
  __sptReviewActions?: StoredReviewAction[];
};

function findLine(
  runs: Awaited<ReturnType<LocalPilotPersistence["read"]>>["runs"],
  runId: string,
  lineId: string
): OfferLine | undefined {
  return runs
    .find((run) => run.id === runId)
    ?.result.envelope.extraction.offerGroups.flatMap((group) => group.lines)
    .find((line) => line.id === lineId);
}

function replayActions(
  line: OfferLine,
  actions: PersistedPilotReviewAction[]
): OfferLine {
  return actions.reduce((current, action) => {
    if (action.action === "DEFER") return current;
    return applyOfferLineReview(current, {
      id: action.id,
      issueId: action.issueId,
      entityId: action.lineId,
      field: action.field,
      action:
        action.action === "CONFIRM"
          ? "CONFIRM"
          : action.action === "CHANGE_ROLE"
            ? "CHANGE_ROLE"
            : "CORRECT",
      previousValue: action.previousValue,
      newValue: action.newValue,
      operator: action.operator,
      timestamp: action.timestamp,
      reason: action.reason,
      comment: action.comment ?? ""
    });
  }, line);
}

export async function POST(request: Request) {
  const body = await request.json();
  if (process.env.LOCAL_CORPUS_ENABLED === "true" && body?.kind === "MATCH") {
    const parsedMatch = MatchActionInput.safeParse(body);
    if (!parsedMatch.success) {
      return NextResponse.json(
        { error: "INVALID_MATCH_ACTION", details: parsedMatch.error.flatten() },
        { status: 400 }
      );
    }
    const persistence = new LocalPilotPersistence(
      path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data"),
      true
    );
    const state = await persistence.read();
    if (!state.analysis) {
      return NextResponse.json({ error: "PILOT_ANALYSIS_NOT_FOUND" }, { status: 404 });
    }
    const timestamp = new Date().toISOString();
    const action = MatchReviewActionSchema.parse({
      ...parsedMatch.data,
      id: crypto.randomUUID(),
      timestamp
    });
    let analysis = structuredClone(state.analysis);
    const related = analysis.matchLinks.filter(
      (link) =>
        link.basisPositionIds.some((id) => action.basisPositionIds.includes(id)) &&
        link.offerLineIds.some((id) => action.offerLineIds.includes(id))
    );
    if (
      ["CONFIRM_MATCH", "CHOOSE_BASIS", "COMBINE_LINES", "CONFIRM_REPLACEMENT"].includes(
        action.action
      )
    ) {
      if (related.length === 0) {
        analysis.matchLinks.push(
          composeMatchLink({
            basisPositionIds: action.basisPositionIds,
            offerLineIds: action.offerLineIds,
            status: action.action === "CONFIRM_REPLACEMENT" ? "REPLACEMENT" : "EXACT",
            score: 1,
            reasons: ["Operatorentscheidung"],
            confirmedByOperator: true
          })
        );
      } else {
        analysis.matchLinks = analysis.matchLinks.map((link) =>
          related.some((item) => item.id === link.id)
            ? {
                ...link,
                basisPositionIds:
                  action.action === "CHOOSE_BASIS"
                    ? action.basisPositionIds
                    : link.basisPositionIds,
                offerLineIds:
                  action.action === "COMBINE_LINES"
                    ? Array.from(new Set([...link.offerLineIds, ...action.offerLineIds]))
                    : link.offerLineIds,
                status:
                  action.action === "CONFIRM_REPLACEMENT" ? "REPLACEMENT" : link.status,
                confirmedByOperator: true,
                reasons: Array.from(new Set([...link.reasons, "Operator bestätigt"]))
              }
            : link
        );
      }
    }
    if (["INCLUDE_REQUIRED_COMPONENT", "INCLUDE_OPTIONAL"].includes(action.action)) {
      analysis.matchLinks = analysis.matchLinks.map((link) =>
        link.basisPositionIds.some((id) => action.basisPositionIds.includes(id))
          ? {
              ...link,
              offerLineIds: Array.from(new Set([...link.offerLineIds, ...action.offerLineIds])),
              confirmedByOperator: true,
              reasons: Array.from(new Set([...link.reasons, "Komponente operatorseitig einbezogen"]))
            }
          : link
      );
    }
    if (action.action === "EXCLUDE_OPTIONAL") {
      analysis.matchLinks = analysis.matchLinks.map((link) => ({
        ...link,
        offerLineIds: link.offerLineIds.filter(
          (id) => !action.offerLineIds.includes(id)
        )
      }));
    }
    analysis = refreshPilotAnalysisForPositions(
      analysis,
      action.basisPositionIds
    );
    const auditEvent = {
      id: action.id,
      issueId: `match:${action.basisPositionIds.join(",")}`,
      action: action.action,
      previousValue: related.map((link) => link.id),
      newValue: action.offerLineIds,
      operator: action.operator,
      timestamp,
      reason: "Manual matching control",
      comment: action.comment,
      entityType: "MatchLink",
      entityId: action.basisPositionIds[0] ?? analysis.id
    };
    await persistence.appendMatchReview(action, auditEvent, analysis);
    return NextResponse.json(
      { matchReviewAction: action, auditEvent, analysis, persistence: "LOCAL_DURABLE" },
      { status: 201, headers: { "x-spt-persistence": "local-durable" } }
    );
  }

  if (process.env.LOCAL_CORPUS_ENABLED === "true" && body?.kind === "DECISION") {
    const parsedDecision = SupplierDecisionInput.safeParse(body);
    if (!parsedDecision.success) {
      return NextResponse.json(
        { error: "INVALID_SUPPLIER_DECISION", details: parsedDecision.error.flatten() },
        { status: 400 }
      );
    }
    const persistence = new LocalPilotPersistence(
      path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data"),
      true
    );
    const state = await persistence.read();
    if (
      !state.analysis?.basisPositions.some(
        (position) => position.id === parsedDecision.data.basisPositionId
      )
    ) {
      return NextResponse.json({ error: "BASIS_POSITION_NOT_FOUND" }, { status: 404 });
    }
    const timestamp = new Date().toISOString();
    const decision = SupplierDecisionSchema.parse({
      ...parsedDecision.data,
      id: crypto.randomUUID(),
      timestamp
    });
    const auditEvent = {
      id: decision.id,
      issueId: `decision:${decision.basisPositionId}`,
      action: decision.status === "SELECTED" ? "DECIDE" : "DEFER",
      previousValue:
        state.supplierDecisions.find(
          (item) => item.basisPositionId === decision.basisPositionId
        ) ?? null,
      newValue: decision,
      operator: decision.operator,
      timestamp,
      reason: "Supplier decision",
      comment: decision.comment,
      entityType: "SupplierDecision",
      entityId: decision.basisPositionId
    };
    await persistence.appendSupplierDecision(decision, auditEvent);
    return NextResponse.json(
      { supplierDecision: decision, auditEvent, persistence: "LOCAL_DURABLE" },
      { status: 201, headers: { "x-spt-persistence": "local-durable" } }
    );
  }

  const parsed = ReviewActionInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_REVIEW_ACTION", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (process.env.LOCAL_CORPUS_ENABLED === "true") {
    if (!parsed.data.runId || !parsed.data.lineId || !parsed.data.field) {
      return NextResponse.json(
        { error: "PILOT_CONTEXT_REQUIRED", message: "runId, lineId and field are required." },
        { status: 400 }
      );
    }
    const persistence = new LocalPilotPersistence(
      path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data"),
      true
    );
    const state = await persistence.read();
    const immutableLine = findLine(state.runs, parsed.data.runId, parsed.data.lineId);
    if (!immutableLine) {
      return NextResponse.json({ error: "OFFER_LINE_NOT_FOUND" }, { status: 404 });
    }
    const priorActions = state.reviewActions.filter(
      (action) =>
        action.runId === parsed.data.runId && action.lineId === parsed.data.lineId
    );
    let reviewedLine = replayActions(structuredClone(immutableLine), priorActions);
    const previousValue = (reviewedLine as unknown as Record<string, unknown>)[parsed.data.field];
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    let verificationStatus = reviewedLine.verificationStatus;

    if (parsed.data.action !== "DEFER") {
      const domainAction: ReviewAction = {
        id,
        issueId: parsed.data.issueId,
        entityId: parsed.data.lineId,
        field: parsed.data.field,
        action:
          parsed.data.action === "CONFIRM"
            ? "CONFIRM"
            : parsed.data.action === "CHANGE_ROLE"
              ? "CHANGE_ROLE"
              : "CORRECT",
        previousValue,
        newValue: parsed.data.newValue,
        operator: parsed.data.operator,
        timestamp,
        reason: parsed.data.reason,
        comment: parsed.data.comment
      };
      try {
        reviewedLine = applyOfferLineReview(reviewedLine, domainAction);
        verificationStatus = reviewedLine.verificationStatus;
      } catch (error) {
        return NextResponse.json(
          {
            error: "HUMAN_FIELD_LOCKED",
            message: error instanceof Error ? error.message : "Review action rejected."
          },
          { status: 409 }
        );
      }
    }

    const action: PersistedPilotReviewAction = {
      id,
      runId: parsed.data.runId,
      issueId: parsed.data.issueId,
      lineId: parsed.data.lineId,
      field: parsed.data.field,
      action: parsed.data.action,
      previousValue,
      newValue: parsed.data.newValue,
      operator: parsed.data.operator,
      timestamp,
      reason: parsed.data.reason,
      comment: parsed.data.comment,
      verificationStatus
    };
    const auditEvent = {
      ...action,
      entityType: "OfferLine",
      entityId: parsed.data.lineId
    };
    await persistence.appendReview(action, auditEvent);
    return NextResponse.json(
      { reviewAction: action, auditEvent, reviewedLine, persistence: "LOCAL_DURABLE" },
      {
        status: 201,
        headers: { "x-spt-persistence": "local-durable" }
      }
    );
  }

  const action: StoredReviewAction = {
    ...parsed.data,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString()
  };
  memory.__sptReviewActions ??= [];
  memory.__sptReviewActions.push(action);

  return NextResponse.json(
    {
      reviewAction: action,
      auditEvent: {
        ...action,
        entityType: "ReviewIssue",
        entityId: action.issueId
      },
      persistence: "VOLATILE_DEMO"
    },
    {
      status: 201,
      headers: { "x-spt-persistence": "volatile-demo" }
    }
  );
}

export async function GET() {
  if (process.env.LOCAL_CORPUS_ENABLED === "true") {
    const persistence = new LocalPilotPersistence(
      path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data"),
      true
    );
    const state = await persistence.read();
    return NextResponse.json({
      actions: state.reviewActions,
      auditEvents: state.auditEvents,
      persistence: "LOCAL_DURABLE"
    });
  }
  return NextResponse.json({
    actions: memory.__sptReviewActions ?? [],
    persistence: "VOLATILE_DEMO"
  });
}
