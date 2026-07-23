import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { OfferLine } from "@/domain/contracts";
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
  const parsed = ReviewActionInput.safeParse(await request.json());
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
