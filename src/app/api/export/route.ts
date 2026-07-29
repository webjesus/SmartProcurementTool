import path from "node:path";
import { NextResponse } from "next/server";
import {
  selectedPositionExportRows,
  selectionPdf,
  selectionWorkbook
} from "@/services/selection-export";
import {
  centralDecisionApiContext,
  decisionApiError
} from "@/services/decision-api";
import {
  currentDecisionProjectMetadata,
  DecisionSyncService
} from "@/services/decision-sync-service";
import { LocalPilotPersistence } from "@/storage/document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "xlsx";
    const { unit } = await centralDecisionApiContext(request);
    const metadata = await currentDecisionProjectMetadata();
    const decisions = await new DecisionSyncService(unit).listDecisions(
      metadata.projectId
    );
    const persistence = new LocalPilotPersistence(
      path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data"),
      true
    );
    const state = await persistence.read();
    const rows = selectedPositionExportRows(state, decisions);
    if (format === "pdf") {
      const body = selectionPdf({
        rows,
        totalBasisPositions:
          state.analysis?.basisPositions.filter((position) => !position.heading)
            .length ?? 0
      });
      return new Response(new Uint8Array(body), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition":
            'attachment; filename="SPT-Ausgewaehlte-Positionen.pdf"',
          "cache-control": "no-store"
        }
      });
    }
    if (format !== "xlsx") {
      return NextResponse.json(
        { error: "UNSUPPORTED_EXPORT_FORMAT" },
        { status: 400 }
      );
    }
    const workbook = await selectionWorkbook(rows);
    return new Response(workbook, {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition":
          'attachment; filename="SPT-Ausgewaehlte-Positionen.xlsx"',
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    const response = decisionApiError(error);
    if (response) return response;
    throw error;
  }
}
