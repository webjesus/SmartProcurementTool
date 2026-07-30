"use client";

import { ArrowLeft, FilePlus2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CentralSupplierDecision } from "@/domain/central-decision";
import type { ProjectWorkspaceState } from "@/domain/project-workspace";
import { LvComparisonPage } from "@/components/lv/lv-comparison-page";
import { getBrowserProjectService } from "@/browser-projects/project-service";
import {
  exportBrowserProjectExcel,
  exportBrowserProjectPdf
} from "@/browser-projects/browser-export";
import type {
  BrowserAnalysisSnapshot,
  BrowserProjectRecord,
  BrowserSelectionRecord
} from "@/browser-projects/types";
import { AddFilesDialog } from "@/components/browser-projects/add-files-dialog";

const BROWSER_OPERATOR_ID = "00000000-0000-4000-8000-000000000001";

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
  const [project, setProject] = useState<BrowserProjectRecord | null>(null);
  const [analysis, setAnalysis] = useState<BrowserAnalysisSnapshot | null>(null);
  const [selections, setSelections] = useState<BrowserSelectionRecord[]>([]);
  const [documentUrls, setDocumentUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [addFilesOpen, setAddFilesOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [latestWorkspace, setLatestWorkspace] =
    useState<ProjectWorkspaceState | null>(null);
  const documentUrlsRef = useRef<Record<string, string>>({});

  const reload = useCallback(async () => {
    const [storedProject, snapshot, storedSelections, documents] =
      await Promise.all([
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
      Object.values(documentUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url)
      );
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
    const state =
      (workspace?.state as ProjectWorkspaceState | undefined) ?? null;
    setLatestWorkspace(state);
    return state;
  }, [projectId, service]);

  const saveWorkspace = useCallback(
    async (state: ProjectWorkspaceState) => {
      setLatestWorkspace(state);
      await service.saveWorkspace({
        projectId,
        state,
        updatedAt: new Date().toISOString()
      });
    },
    [projectId, service]
  );

  const selectSupplierOption = useCallback(
    async (input: {
      positionId: string;
      optionId: string;
      lineIds: string[];
      comment: string;
    }) => {
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

  const leaveForProjects = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      if (latestWorkspace) {
        await saveWorkspace(latestWorkspace);
      }
      await service.updateProject(projectId, {
        lastRoute: "LV_COMPARISON",
        lastOpenedAt: new Date().toISOString()
      });
      router.push("/projects");
    } catch (navigationError) {
      setError(
        navigationError instanceof Error
          ? navigationError.message
          : "Der Arbeitsbereich konnte vor dem Verlassen nicht gespeichert werden."
      );
      setLeaving(false);
    }
  }, [latestWorkspace, leaving, projectId, router, saveWorkspace, service]);

  const adapter = useMemo(
    () =>
      analysis
        ? {
            decisions,
            documentUrls,
            loadWorkspace,
            saveWorkspace,
            selectSupplierOption,
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
      decisions,
      documentUrls,
      loadWorkspace,
      project?.name,
      saveWorkspace,
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
      <nav className="browser-project-context">
        <button
          type="button"
          data-back-to-projects
          disabled={leaving}
          onClick={() => void leaveForProjects()}
        >
          <ArrowLeft size={16} /> {leaving ? "Speichern …" : "Projekte"}
        </button>
        <strong>{project.name}</strong>
        <Link href={`/projects/${projectId}/documents/review`}>Dokumente</Link>
        <button onClick={() => setAddFilesOpen(true)}>
          <FilePlus2 size={16} /> Dokumente hinzufügen
        </button>
      </nav>
      <LvComparisonPage
        pilot={analysis.pilot}
        reload={reload}
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
