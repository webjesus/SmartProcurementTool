"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CentralSupplierDecision } from "@/domain/central-decision";
import {
  ProjectWorkspaceStateSchema,
  type ProjectWorkspaceState
} from "@/domain/project-workspace";
import { LvComparisonPage } from "@/components/lv/lv-comparison-page";
import {
  getBrowserProjectService,
  type BrowserManualCorrectionInput
} from "@/browser-projects/project-service";
import {
  exportBrowserProjectExcel,
  exportBrowserProjectPdf
} from "@/browser-projects/browser-export";
import type {
  BrowserAnalysisSnapshot,
  BrowserProjectRecord,
  BrowserSelectionRecord
} from "@/browser-projects/types";
import type { BrowserManualCorrectionCommand } from "@/browser-projects/manual-corrections";
import { AddFilesDialog } from "@/components/browser-projects/add-files-dialog";
import { useDecisionIdentity } from "@/components/decision-identity";
import { ThemeControl } from "@/components/theme-control";

const BROWSER_OPERATOR_ID = "00000000-0000-4000-8000-000000000001";

export function normalizeBrowserWorkspaceState(value: unknown): ProjectWorkspaceState {
  return ProjectWorkspaceStateSchema.parse(value);
}

export function stageBrowserWorkspace(
  ref: { current: ProjectWorkspaceState | null },
  state: ProjectWorkspaceState
): void {
  ref.current = state;
}

export async function persistLatestWorkspaceBeforeNavigation(
  ref: { current: ProjectWorkspaceState | null },
  save: (state: ProjectWorkspaceState) => Promise<void>
): Promise<void> {
  if (ref.current) await save(ref.current);
}

export function buildBrowserManualCorrectionInput(input: {
  projectId: string;
  analysisVersionId: string;
  manualCorrectionRevision?: number;
  command: BrowserManualCorrectionCommand;
  operatorId: string;
  operatorLabel: string;
}): BrowserManualCorrectionInput {
  return {
    projectId: input.projectId,
    analysisVersionId: input.analysisVersionId,
    expectedRevision: input.manualCorrectionRevision ?? 0,
    command: input.command,
    operatorId: input.operatorId,
    operatorLabel: input.operatorLabel,
    comment: "Manuelle Korrektur im LV-Inspector"
  };
}

function asCentralDecision(
  projectId: string,
  analysisVersionId: string,
  selection: BrowserSelectionRecord
): CentralSupplierDecision {
  return {
    id: `browser-${selection.positionId}`,
    projectId,
    positionId: selection.positionId,
    selectedSupplierOptionId: selection.selectedSupplierOptionId,
    selectedBundleLineIds: selection.selectedLineIds,
    rejectedOptionIds: [],
    outcome: "SELECTED",
    reasonCodes: [],
    comment: selection.comment,
    decidedBy: BROWSER_OPERATOR_ID,
    decidedByDisplayName: "Lokaler Benutzer",
    decidedAt: selection.updatedAt,
    previousDecisionId: null,
    analysisVersionId,
    decisionVersion: 1,
    decisionType: "MANUAL_SELECTION",
    contextSnapshot: { storage: "INDEXED_DB" },
    evidenceSnapshot: null,
    documentRevisionIds: [],
    createdAt: selection.updatedAt
  };
}

export function BrowserLvPage({ projectId }: { projectId: string }) {
  const service = useMemo(() => getBrowserProjectService(), []);
  const router = useRouter();
  const identity = useDecisionIdentity();
  const [project, setProject] = useState<BrowserProjectRecord | null>(null);
  const [analysis, setAnalysis] = useState<BrowserAnalysisSnapshot | null>(null);
  const [selections, setSelections] = useState<BrowserSelectionRecord[]>([]);
  const [documentUrls, setDocumentUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [addFilesOpen, setAddFilesOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [latestWorkspaceBuffer] = useState<{
    current: ProjectWorkspaceState | null;
  }>(() => ({ current: null }));
  const documentUrlsRef = useRef<Record<string, string>>({});
  const initials =
    identity.user?.displayName
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("de"))
      .join("") || "WB";

  const reload = useCallback(async () => {
    const [storedProject, snapshot, storedSelections, documents] = await Promise.all([
      service.getProject(projectId),
      service.latestAnalysis(projectId),
      service.listSelections(projectId),
      service.listDocuments(projectId)
    ]);
    setProject(storedProject);
    setAnalysis(snapshot);
    setSelections(storedSelections);

    const previousUrls = documentUrlsRef.current;
    const urls: Record<string, string> = {};
    for (const document of documents) {
      if (previousUrls[document.documentId]) {
        urls[document.documentId] = previousUrls[document.documentId];
        continue;
      }
      const blob = await service.getDocumentBlob(projectId, document.documentId);
      if (blob) urls[document.documentId] = URL.createObjectURL(blob);
    }
    for (const [documentId, url] of Object.entries(previousUrls)) {
      if (!urls[documentId]) URL.revokeObjectURL(url);
    }
    documentUrlsRef.current = urls;
    setDocumentUrls(urls);
  }, [projectId, service]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void reload().catch((loadError) => {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Das Projekt konnte nicht geladen werden."
        );
      });
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      Object.values(documentUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      documentUrlsRef.current = {};
    };
  }, [reload]);

  useEffect(() => {
    if (!project) return;
    void service.updateProject(projectId, {
      lastRoute: "LV_COMPARISON",
      lastOpenedAt: new Date().toISOString()
    });
  }, [project, projectId, service]);

  const decisions = useMemo(
    () =>
      analysis
        ? selections.map((selection) =>
            asCentralDecision(projectId, analysis.analysisVersionId, selection)
          )
        : [],
    [analysis, projectId, selections]
  );

  const loadWorkspace = useCallback(async () => {
    const workspace = await service.getWorkspace(projectId);
    const state = workspace ? normalizeBrowserWorkspaceState(workspace.state) : null;
    if (state) stageBrowserWorkspace(latestWorkspaceBuffer, state);
    return state;
  }, [latestWorkspaceBuffer, projectId, service]);

  const stageWorkspace = useCallback(
    (state: ProjectWorkspaceState) => {
      stageBrowserWorkspace(latestWorkspaceBuffer, state);
    },
    [latestWorkspaceBuffer]
  );

  const saveWorkspace = useCallback(
    async (state: ProjectWorkspaceState) => {
      stageBrowserWorkspace(latestWorkspaceBuffer, state);
      await service.saveWorkspace({
        projectId,
        state,
        updatedAt: new Date().toISOString()
      });
    },
    [latestWorkspaceBuffer, projectId, service]
  );

  const selectSupplierOption = useCallback(
    async (input: { positionId: string; optionId: string; lineIds: string[]; comment: string }) => {
      await service.saveSelection({
        projectId,
        positionId: input.positionId,
        selectedSupplierOptionId: input.optionId,
        selectedLineIds: input.lineIds,
        comment: input.comment,
        updatedAt: new Date().toISOString()
      });
      setSelections(await service.listSelections(projectId));
    },
    [projectId, service]
  );

  const reviewMatch = useCallback(
    async (input: {
      positionId: string;
      matchLinkId: string;
      decision: "CONFIRMED" | "REJECTED";
    }) => {
      if (!analysis) throw new Error("MATCH_REVIEW_ANALYSIS_REQUIRED");
      await service.reviewMatch({
        projectId,
        analysisVersionId: analysis.analysisVersionId,
        matchLinkId: input.matchLinkId,
        positionId: input.positionId,
        decision: input.decision,
        operator: "Lokaler Benutzer",
        comment:
          input.decision === "CONFIRMED"
            ? "Zuordnung im LV-Inspector bestätigt"
            : "Zuordnung im LV-Inspector abgelehnt",
        updatedAt: new Date().toISOString()
      });
    },
    [analysis, projectId, service]
  );

  const applyManualCorrection = useCallback(
    async (command: BrowserManualCorrectionCommand) => {
      if (!analysis) {
        throw new Error("Für die Korrektur ist eine aktuelle Analyse erforderlich.");
      }
      try {
        const updated = await service.applyManualCorrection(
          buildBrowserManualCorrectionInput({
            projectId,
            analysisVersionId: analysis.analysisVersionId,
            manualCorrectionRevision: analysis.manualCorrectionRevision,
            command,
            operatorId: identity.user?.id ?? BROWSER_OPERATOR_ID,
            operatorLabel: identity.user?.displayName ?? "Lokaler Benutzer"
          })
        );
        setAnalysis(updated);
        setSelections([]);
      } catch (correctionError) {
        const code = correctionError instanceof Error ? correctionError.message : "";
        if (
          code === "MANUAL_CORRECTION_STALE_ANALYSIS" ||
          code === "MANUAL_CORRECTION_REVISION_CONFLICT"
        ) {
          throw new Error(
            "Die Analyse wurde zwischenzeitlich geändert. Bitte die Seite neu laden und die Korrektur erneut prüfen."
          );
        }
        if (code === "MANUAL_CORRECTION_SOURCE_INVALID") {
          throw new Error(
            "Die angegebene Seite oder Markierung liegt außerhalb des Quelldokuments."
          );
        }
        throw new Error(
          code && !code.startsWith("MANUAL_CORRECTION_")
            ? code
            : "Die manuelle Korrektur konnte nicht gespeichert werden."
        );
      }
    },
    [analysis, identity.user, projectId, service]
  );

  const leaveForRoute = useCallback(
    async (destination: string) => {
      if (leaving) return;
      setLeaving(true);
      try {
        await persistLatestWorkspaceBeforeNavigation(latestWorkspaceBuffer, saveWorkspace);
        await service.updateProject(projectId, {
          lastRoute: "LV_COMPARISON",
          lastOpenedAt: new Date().toISOString()
        });
        router.push(destination);
      } catch (navigationError) {
        setError(
          navigationError instanceof Error
            ? navigationError.message
            : "Der Arbeitsbereich konnte vor dem Verlassen nicht gespeichert werden."
        );
        setLeaving(false);
      }
    },
    [latestWorkspaceBuffer, leaving, projectId, router, saveWorkspace, service]
  );

  const adapter = useMemo(
    () =>
      analysis
        ? {
            decisions,
            documentUrls,
            manualDisplayLabels: analysis.manualDisplayLabels,
            loadWorkspace,
            stageWorkspace,
            saveWorkspace,
            selectSupplierOption,
            matchReviews: analysis.matchReviews ?? [],
            reviewMatch,
            applyManualCorrection,
            exportExcel: () => {
              void exportBrowserProjectExcel({
                projectName: project?.name ?? "Projekt",
                analysis,
                selections
              });
            },
            exportPdf: () =>
              exportBrowserProjectPdf({
                projectName: project?.name ?? "Projekt",
                analysis,
                selections
              })
          }
        : null,
    [
      analysis,
      applyManualCorrection,
      decisions,
      documentUrls,
      loadWorkspace,
      project?.name,
      saveWorkspace,
      stageWorkspace,
      reviewMatch,
      selectSupplierOption,
      selections
    ]
  );

  if (error) {
    return <main className="browser-workflow-page browser-project-error">{error}</main>;
  }
  if (!project || !analysis || !adapter) {
    return <main className="browser-workflow-page">LV-Vergleich wird geladen …</main>;
  }

  return (
    <main className="browser-lv-project" data-browser-local-lv>
      <LvComparisonPage
        pilot={analysis.pilot}
        reload={reload}
        headerContext={{
          name: project.name,
          leaving,
          onBack: () => void leaveForRoute("/projects"),
          onDocuments: () => void leaveForRoute(`/projects/${projectId}/documents/review`),
          onAddDocuments: () => setAddFilesOpen(true),
          utilityActions: (
            <>
              <ThemeControl />
              <button
                type="button"
                className="wb-avatar"
                aria-label="Operatorprofil"
                title={identity.user?.displayName ?? "Operatorprofil"}
              >
                {initials}
              </button>
            </>
          )
        }}
        browserLocal={adapter}
      />
      <AddFilesDialog
        projectId={projectId}
        open={addFilesOpen}
        onClose={() => setAddFilesOpen(false)}
        onReview={() => router.push(`/projects/${projectId}/documents/review`)}
      />
    </main>
  );
}
