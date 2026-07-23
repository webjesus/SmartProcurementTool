import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const ReviewActionInput = z.object({
  issueId: z.string().min(1),
  action: z.string().min(1),
  previousValue: z.unknown(),
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

export async function POST(request: Request) {
  const parsed = ReviewActionInput.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_REVIEW_ACTION", details: parsed.error.flatten() },
      { status: 400 }
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
      persistence: process.env.DATABASE_URL ? "DATABASE_ADAPTER_REQUIRED" : "VOLATILE_DEMO"
    },
    {
      status: 201,
      headers: { "x-spt-persistence": "volatile-demo" }
    }
  );
}

export async function GET() {
  return NextResponse.json({
    actions: memory.__sptReviewActions ?? [],
    persistence: "VOLATILE_DEMO"
  });
}
