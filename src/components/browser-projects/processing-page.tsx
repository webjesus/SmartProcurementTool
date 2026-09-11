"use client";

import { AlertTriangle, Check, Circle, LoaderCircle, RotateCcw, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  browserWorkerResultFromAnalysis,
  buildBrowserAnalysis
} from "@/browser-projects/browser-analysis";
import type {
  BrowserProcessingEvent,
  BrowserWorkerDocument
} from "@/browser-projects/processing-protocol";
import { getBrowserProjectService } from "@/browser-projects/project-service";
import type {
  BrowserAnalysisSnapshot,
  BrowserProcessingRun,
  BrowserProcessingStage,
  BrowserProjectRecord
} from "@/browser-projects/types";

const stageLabels: Record<BrowserProcessingStage, string> = {
  CLASSIFY_DOCUMENTS: "Dokumente prüfen",
  EXTRACT_BASIS: "Basis-LV lesen",
  EXTRACT_SUPPLIERS: "Lieferantenangebote lesen",
  NORMALIZE: "Positionen zuordnen",
  MATCH: "Positionen zuordnen",
  BUILD_OPTIONS: "Preise prüfen",
  VALIDATE: "Vergleich vorbereiten",
  FINALIZE: "Vergleich vorbereiten"
};

const stages = Object.keys(stageLabels) as BrowserProcessingStage[];
const visibleStages: BrowserProcessingStage[] = [
  "CLASSIFY_DOCUMENTS",
  "EXTRACT_BASIS",
  "EXTRACT_SUPPLIERS",
  "MATCH",
  "BUILD_OPTIONS",
  "FINALIZE"
];

export function ProcessingPage({ projectId }: { projectId: string }) {
  const service = useMemo(() => getBrowserProjectService(), []);
  const router = useRouter();
  const workerRef = useRef<Worker | null>(null);
  const runRef = useRef<BrowserProcessingRun | null>(null);
  const warningsRef = useRef<string[]>([]);
  const previousAnalysisRef = useRef<BrowserAnalysisSnapshot | null>(null);
  const incrementalRef = useRef(false);
  const reprocessingTokenRef = useRef<string | undefined>(undefined);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [project, setProject] = useState<BrowserProjectRecord | null>(null);
  const [activeStage, setActiveStage] = useState<BrowserProcessingStage>("CLASSIFY_DOCUMENTS");
  const [completedStages, setCompletedStages] = useState<BrowserProcessingStage[]>([]);
  const [currentDocument, setCurrentDocument] = useState("");
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [ocrProgress, setOcrProgress] = useState<{
    page: number;
    progress: number;
  } | null>(null);
  const [processedPages, setProcessedPages] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [interrupted, setInterrupted] = useState(false);
  const [starting, setStarting] = useState(true);
  const visibleActiveStage: BrowserProcessingStage =
    activeStage === "NORMALIZE" ? "MATCH" : activeStage === "VALIDATE" ? "FINALIZE" : activeStage;

  const persistRun = useCallback(
    async (run: BrowserProcessingRun) => {
      runRef.current = run;
      await service.saveProcessingRun(run);
      await service.updateProject(projectId, {
        processingCheckpoint: run.checkpoint,
        status:
          run.status === "ERROR"
            ? "FEHLER"
            : run.status === "COMPLETED"
              ? "BEREIT"
              : "IN_VERARBEITUNG"
      });
    },
    [projectId, service]
  );

  const start = useCallback(
    async (confirmedReprocessing = false) => {
      setStarting(true);
      setInterrupted(false);
      setError("");
      warningsRef.current = [];
      setWarnings([]);
      const [nextProject, documents, previousAnalysis] = await Promise.all([
        service.getProject(projectId),
        service.listDocuments(projectId),
        service.latestAnalysis(projectId)
      ]);
      if (!nextProject) throw new Error("PROJECT_NOT_FOUND");
      setProject(nextProject);
      const protection = await service.processingProtection(projectId);
      if (protection.requiresConfirmation && !confirmedReprocessing) {
        setConfirmationRequired(true);
        setStarting(false);
        return;
      }
      setConfirmationRequired(false);
      reprocessingTokenRef.current = confirmedReprocessing
        ? protection.confirmationToken
        : undefined;
      const activeDiscipline =
        nextProject.activeDiscipline ??
        documents.find((document) => document.documentType === "BASIS_LV" && document.activeBasis)
          ?.discipline ??
        "UNKNOWN";
      const preflight = await service.processingPreflight(projectId, activeDiscipline);
      if (!preflight.valid) {
        throw new Error(`PREFLIGHT_BLOCKED: ${preflight.blockingReasons.join(" ")}`);
      }
      const relevantDocuments = documents.filter(
        (document) =>
          !document.excludedFromProcessing &&
          (["SCAN_OCR_REQUIRED", "UNKNOWN"].includes(document.documentType) ||
            document.discipline === activeDiscipline ||
            document.discipline === "MULTI" ||
            (activeDiscipline === "SANITAER" && document.discipline === "INSTALLATIONSSYSTEME"))
      );
      const previouslyProcessed = new Set(
        previousAnalysis?.pilot.runs.map((run) => run.document.id) ?? []
      );
      const newDocuments = relevantDocuments.filter(
        (document) => !previouslyProcessed.has(document.documentId)
      );
      const incremental =
        Boolean(previousAnalysis) &&
        newDocuments.length > 0 &&
        !newDocuments.some((document) => document.documentType === "BASIS_LV");
      const documentsToProcess = incremental ? newDocuments : relevantDocuments;
      previousAnalysisRef.current = incremental ? previousAnalysis : null;
      incrementalRef.current = incremental;
      const workerDocuments: BrowserWorkerDocument[] = [];
      for (const metadata of documentsToProcess) {
        const blob = await service.getDocumentBlob(projectId, metadata.documentId);
        if (!blob) throw new Error("DOCUMENT_BLOB_MISSING");
        workerDocuments.push({ metadata, bytes: await blob.arrayBuffer() });
      }
      const runId = crypto.randomUUID();
      const now = new Date().toISOString();
      const run: BrowserProcessingRun = {
        projectId,
        runId,
        status: "RUNNING",
        checkpoint: {
          runId,
          stage: "CLASSIFY_DOCUMENTS",
          completedStages: [],
          processedPages: 0,
          totalPages: documentsToProcess.reduce((sum, document) => sum + document.pageCount, 0),
          currentDocumentId: null,
          currentPage: null,
          interrupted: false,
          updatedAt: now
        },
        warnings: [],
        failureCode: null,
        startedAt: now,
        updatedAt: now
      };
      await persistRun(run);
      const worker = new Worker(
        new URL("../../workers/browser-processing.worker.ts", import.meta.url)
      );
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<BrowserProcessingEvent>) => {
        const message = event.data;
        if (message.type === "PROGRESS") {
          setActiveStage(message.stage);
          return;
        }
        if (message.type === "DOCUMENT_PROGRESS") {
          setCurrentDocument(message.fileName);
          return;
        }
        if (message.type === "PAGE_PROGRESS") {
          setCurrentPage(message.page);
          setOcrProgress(null);
          setProcessedPages(message.processedPages);
          setTotalPages(message.totalPages);
          return;
        }
        if (message.type === "OCR_PROGRESS") {
          setCurrentPage(message.page);
          setOcrProgress({ page: message.page, progress: message.progress });
          return;
        }
        if (message.type === "WARNING") {
          warningsRef.current = [...warningsRef.current, message.message];
          setWarnings(warningsRef.current);
          return;
        }
        if (message.type === "CHECKPOINT") {
          setCompletedStages(message.checkpoint.completedStages);
          const current = runRef.current;
          if (current) {
            void persistRun({
              ...current,
              checkpoint: message.checkpoint,
              warnings: warningsRef.current,
              updatedAt: new Date().toISOString()
            });
          }
          return;
        }
        if (message.type === "COMPLETE") {
          void (async () => {
            const currentDocuments = await service.applyDocumentClassifications(
              projectId,
              message.result.documentClassifications ?? []
            );
            const workerResult =
              incrementalRef.current && previousAnalysisRef.current
                ? (() => {
                    const previous = browserWorkerResultFromAnalysis(
                      previousAnalysisRef.current!,
                      currentDocuments
                    );
                    return {
                      documentClassifications: message.result.documentClassifications,
                      processingIssues: [
                        ...(previous.processingIssues ?? []),
                        ...(message.result.processingIssues ?? [])
                      ],
                      basisLines: previous.basisLines,
                      supplierLines: [...previous.supplierLines, ...message.result.supplierLines],
                      warnings: message.result.warnings,
                      diagnostics: {
                        pagesInspected:
                          previous.diagnostics.pagesInspected +
                          message.result.diagnostics.pagesInspected,
                        pagesParsed:
                          previous.diagnostics.pagesParsed + message.result.diagnostics.pagesParsed,
                        ocrRequiredPages:
                          previous.diagnostics.ocrRequiredPages +
                          message.result.diagnostics.ocrRequiredPages,
                        ocrProcessedPages:
                          (previous.diagnostics.ocrProcessedPages ?? 0) +
                          (message.result.diagnostics.ocrProcessedPages ?? 0),
                        ocrFailedPages:
                          (previous.diagnostics.ocrFailedPages ?? 0) +
                          (message.result.diagnostics.ocrFailedPages ?? 0),
                        matchingCandidates:
                          previous.diagnostics.matchingCandidates +
                          message.result.diagnostics.matchingCandidates,
                        documents: [
                          ...previous.diagnostics.documents.filter(
                            (existing) =>
                              !message.result.diagnostics.documents.some(
                                (incoming) => incoming.documentId === existing.documentId
                              )
                          ),
                          ...message.result.diagnostics.documents
                        ]
                      }
                    };
                  })()
                : message.result;
            if (workerResult.basisLines.length === 0) {
              const current = runRef.current;
              if (current) {
                await persistRun({
                  ...current,
                  status: "ERROR",
                  failureCode: "FAILED_NO_BASIS_POSITIONS",
                  warnings: [...message.result.warnings, "Keine Basis-Positionen erkannt."],
                  updatedAt: new Date().toISOString()
                });
              }
              await service.updateProject(projectId, {
                activeAnalysisVersionId: null,
                basisPositionCount: 0,
                status: "FEHLER",
                processingFailureCode: "FAILED_NO_BASIS_POSITIONS",
                lastRoute: "PROCESSING_RESULT",
                processingCheckpoint: null
              });
              worker.terminate();
              workerRef.current = null;
              router.replace(`/projects/${projectId}/processing/result`);
              return;
            }
            const snapshot = buildBrowserAnalysis({
              projectId,
              documents: currentDocuments.filter((document) =>
                relevantDocuments.some((relevant) => relevant.documentId === document.documentId)
              ),
              result: workerResult
            });
            await service.saveProcessingAnalysis(snapshot, reprocessingTokenRef.current);
            const current = runRef.current;
            if (current) {
              await persistRun({
                ...current,
                status: "COMPLETED",
                failureCode: null,
                warnings: message.result.warnings,
                updatedAt: new Date().toISOString()
              });
            }
            await service.updateProject(projectId, {
              activeAnalysisVersionId: snapshot.analysisVersionId,
              basisPositionCount: snapshot.summary.basisPositions,
              supplierOfferCount: snapshot.summary.supplierOffers,
              status: "BEREIT",
              processingFailureCode: null,
              lastRoute: "PROCESSING_RESULT",
              processingCheckpoint: null
            });
            worker.terminate();
            workerRef.current = null;
            router.replace(`/projects/${projectId}/processing/result`);
          })().catch((completeError) => {
            setError(
              completeError instanceof Error
                ? completeError.message
                : "Verarbeitung konnte nicht abgeschlossen werden."
            );
          });
          return;
        }
        if (message.type === "CANCELLED") {
          const current = runRef.current;
          if (current) {
            void persistRun({
              ...current,
              status: "CANCELLED",
              updatedAt: new Date().toISOString()
            });
          }
          router.replace(`/projects/${projectId}/documents/review`);
          return;
        }
        if (message.type === "ERROR") {
          setError(message.message);
          const current = runRef.current;
          if (current) {
            void persistRun({
              ...current,
              status: "ERROR",
              failureCode: "PROCESSING_ERROR",
              warnings: warningsRef.current,
              updatedAt: new Date().toISOString()
            });
          }
        }
      };
      worker.onerror = () => {
        setError("Verarbeitung im Browser ist fehlgeschlagen.");
        const current = runRef.current;
        if (current) {
          void persistRun({
            ...current,
            status: "ERROR",
            failureCode: "PROCESSING_ERROR",
            warnings: warningsRef.current,
            updatedAt: new Date().toISOString()
          });
        }
      };
      worker.postMessage(
        {
          type: "LOAD_DOCUMENTS",
          runId,
          documents: workerDocuments,
          incremental
        },
        workerDocuments.map((document) => document.bytes)
      );
      setTotalPages(run.checkpoint.totalPages);
      setStarting(false);
    },
    [persistRun, projectId, router, service]
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([service.getProject(projectId), service.currentProcessingRun(projectId)]).then(
      ([storedProject, current]) => {
        if (cancelled) return;
        setProject(storedProject);
        if (current?.status === "RUNNING") {
          setInterrupted(true);
          setStarting(false);
          setActiveStage(current.checkpoint.stage);
          setCompletedStages(current.checkpoint.completedStages);
          setProcessedPages(current.checkpoint.processedPages);
          setTotalPages(current.checkpoint.totalPages);
          return;
        }
        void start().catch((startError) => {
          if (cancelled) return;
          setError(
            startError instanceof Error
              ? startError.message
              : "Verarbeitung konnte nicht gestartet werden."
          );
          setStarting(false);
        });
      }
    );
    return () => {
      cancelled = true;
      workerRef.current?.terminate();
    };
  }, [projectId, service, start]);

  function cancel() {
    workerRef.current?.postMessage({ type: "CANCEL" });
  }

  if (confirmationRequired) {
    return (
      <div className="browser-workflow-page processing-page" data-processing-confirmation>
        <section className="processing-interrupted">
          <AlertTriangle size={34} />
          <h1>Vorhandenen Arbeitsstand schützen</h1>
          <p>
            Es gibt manuelle Korrekturen, geprüfte Zuordnungen oder Lieferantenauswahlen. Eine neue
            Analyse übernimmt diese nicht automatisch, da sich Positionen und Fundstellen ändern
            können.
          </p>
          <p>
            Der bisherige Stand einschließlich seiner Auswahlen bleibt als ältere Analyse im Projekt
            und in der Projektsicherung erhalten. In der neuen Analyse müssen die Entscheidungen
            erneut geprüft werden.
          </p>
          <div>
            <Link href={`/projects/${projectId}/lv-vergleich`}>Bisherigen Vergleich öffnen</Link>
            <Link href={`/projects/${projectId}/documents/review`}>Zurück zu Dokumenten</Link>
            <button
              onClick={() =>
                void start(true).catch((error) => {
                  setError(error instanceof Error ? error.message : "Neustart fehlgeschlagen");
                  setStarting(false);
                })
              }
            >
              Neue Analyse ausdrücklich starten
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (interrupted) {
    return (
      <div className="browser-workflow-page processing-page" data-processing-interrupted>
        <section className="processing-interrupted">
          <AlertTriangle size={34} />
          <h1>Verarbeitung wurde unterbrochen.</h1>
          <p>Der letzte sichere Checkpoint ist gespeichert.</p>
          <div>
            <button onClick={() => void start()}>
              <RotateCcw size={17} /> Fortsetzen
            </button>
            <button onClick={() => void start()}>Neu starten</button>
            <Link href={`/projects/${projectId}/documents/review`}>Dokumente ändern</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="browser-workflow-page processing-page" data-processing-page>
      <header className="browser-workflow-header">
        <div>
          <span>{project?.name ?? "Projekt"}</span>
          <h1>Projekt wird verarbeitet</h1>
          <p>Die Verarbeitung findet ausschließlich in diesem Browser statt.</p>
        </div>
      </header>
      <div className="processing-layout">
        <section className="processing-stages">
          {visibleStages.map((stage) => {
            const completed = completedStages.includes(stage);
            const active = visibleActiveStage === stage && !completed;
            return (
              <div className={completed ? "completed" : active ? "active" : ""} key={stage}>
                <span>
                  {completed ? (
                    <Check size={17} />
                  ) : active ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Circle size={13} />
                  )}
                </span>
                <strong>{stageLabels[stage]}</strong>
              </div>
            );
          })}
        </section>
        <aside className="processing-detail">
          <span>Aktueller Schritt</span>
          <h2>{stageLabels[activeStage]}</h2>
          <dl>
            <div>
              <dt>Dokument</dt>
              <dd>{currentDocument || "Vorbereitung"}</dd>
            </div>
            <div>
              <dt>Seite</dt>
              <dd>
                {currentPage ?? "—"}
                {ocrProgress ? ` · OCR ${Math.round(ocrProgress.progress * 100)} %` : ""}
              </dd>
            </div>
            <div>
              <dt>Verarbeitete Seiten</dt>
              <dd>
                {processedPages} von {totalPages}
              </dd>
            </div>
            <div>
              <dt>Basis-Positionen</dt>
              <dd>{project?.basisPositionCount ?? 0}</dd>
            </div>
          </dl>
          {warnings.length ? (
            <ul>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </aside>
      </div>
      {error ? <p className="browser-project-error">{error}</p> : null}
      <footer className="browser-workflow-footer">
        <button className="workflow-cancel" onClick={cancel} disabled={starting}>
          <Square size={15} /> Abbrechen
        </button>
        <span>{Math.round((completedStages.length / stages.length) * 100)} %</span>
      </footer>
    </div>
  );
}
