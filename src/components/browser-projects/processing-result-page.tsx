"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, FileText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserProjectService } from "@/browser-projects/project-service";
import { buildDocumentQualityReport } from "@/browser-projects/document-quality";
import type {
  BrowserAnalysisSnapshot,
  BrowserDocumentRecord,
  BrowserProjectRecord
} from "@/browser-projects/types";
import { AddFilesDialog } from "@/components/browser-projects/add-files-dialog";
import { DocumentQualityPanel } from "@/components/browser-projects/document-quality-panel";
import {
  ManualPositionEditor,
  type ManualPositionEditorKind,
  type ManualPositionEditorValue
} from "@/components/lv/manual-position-editor";

export function ProcessingResultPage({ projectId }: { projectId: string }) {
  const service = useMemo(() => getBrowserProjectService(), []);
  const router = useRouter();
  const [project, setProject] = useState<BrowserProjectRecord | null>(null);
  const [analysis, setAnalysis] = useState<BrowserAnalysisSnapshot | null>(null);
  const [documents, setDocuments] = useState<BrowserDocumentRecord[]>([]);
  const [addFilesOpen, setAddFilesOpen] = useState(false);
  const [manualDocumentId, setManualDocumentId] = useState<string | null>(null);
  const [manualError, setManualError] = useState("");

  useEffect(() => {
    void Promise.all([
      service.getProject(projectId),
      service.latestAnalysis(projectId),
      service.listDocuments(projectId)
    ]).then(([storedProject, snapshot, storedDocuments]) => {
      setProject(storedProject);
      setAnalysis(snapshot);
      setDocuments(storedDocuments);
    });
  }, [projectId, service]);

  const qualityReport = useMemo(() => {
    if (!analysis) return null;
    const processedDocumentIds = new Set(analysis.pilot.runs.map((run) => run.document.id));
    const basisLines =
      analysis.pilot.analysis?.basisPositions.map((position) => ({
        documentId: position.documentId,
        positionNumber: position.positionNumber,
        evidenceStatus: position.evidence[0]?.status ?? ("MISSING" as const)
      })) ?? [];
    const supplierLines = analysis.pilot.runs.flatMap((run) =>
      run.result.envelope.extraction.offerGroups.flatMap((group) =>
        group.lines.map((line) => ({
          documentId: run.document.id,
          positionNumber: line.sourcePositionNumber ?? line.supplierPositionNumber ?? line.id,
          evidenceStatus: line.evidence[0]?.status ?? ("MISSING" as const)
        }))
      )
    );
    const fullDiagnostics = new Map(
      (analysis.summary.documentDiagnostics ?? []).map((diagnostic) => [
        diagnostic.documentId,
        diagnostic
      ])
    );
    return buildDocumentQualityReport({
      documents: documents.map((document) => ({
        documentId: document.documentId,
        label: document.originalFileName,
        documentType: document.documentType,
        pageCount: document.pageCount,
        scanState: document.scanState,
        classificationConfidence: document.classificationConfidence,
        preliminaryPositionCount: document.preliminaryPositionCount,
        activeBasis: document.activeBasis,
        excludedFromProcessing: document.excludedFromProcessing,
        inComparisonScope: processedDocumentIds.has(document.documentId),
        fullDocumentDiagnostics: fullDiagnostics.get(document.documentId)
      })),
      lines: [...basisLines, ...supplierLines]
    });
  }, [analysis, documents]);

  const manualDocument = documents.find((document) => document.documentId === manualDocumentId);
  const manualKind: ManualPositionEditorKind | null = manualDocument
    ? manualDocument.documentType === "BASIS_LV"
      ? "BASIS_POSITION"
      : ["SUPPLIER_OFFER", "MANUFACTURER_OFFER"].includes(manualDocument.documentType)
        ? "SUPPLIER_LINE"
        : null
    : null;
  const failedWithoutBasis =
    project?.processingFailureCode === "FAILED_NO_BASIS_POSITIONS" && project.status === "FEHLER";
  const activeBasisDocument = documents.find(
    (document) =>
      document.documentType === "BASIS_LV" &&
      document.activeBasis &&
      !document.excludedFromProcessing
  );

  async function saveManualPosition(value: ManualPositionEditorValue) {
    if (!manualDocument || !manualKind) {
      throw new Error("Dokumentrolle zuerst unter ‚Dokumente prüfen‘ festlegen.");
    }
    const source = { pageNumber: value.pageNumber, region: value.region };
    const command =
      manualKind === "BASIS_POSITION"
        ? {
            action: "ADD_BASIS_POSITION" as const,
            value: {
              documentId: manualDocument.documentId,
              positionNumber: value.positionNumber,
              shortLabel: value.shortDescription,
              description: value.description,
              quantity: value.quantity,
              unit: value.unit,
              source
            }
          }
        : {
            action: "ADD_SUPPLIER_LINE" as const,
            value: {
              documentId: manualDocument.documentId,
              positionNumber: value.positionNumber,
              supplierPositionNumber: null,
              shortLabel: value.shortDescription,
              description: value.description,
              articleNumber: value.articleNumber,
              quantity: value.quantity,
              unit: value.unit,
              unitPrice: value.unitPrice,
              totalPrice: value.totalPrice,
              source
            }
          };
    let updated: BrowserAnalysisSnapshot;
    if (failedWithoutBasis) {
      if (command.action !== "ADD_BASIS_POSITION") {
        throw new Error("Als erster Schritt muss eine Basis-LV-Position erfasst werden.");
      }
      updated = await service.bootstrapManualBasisPosition({
        projectId,
        command,
        operatorId: "local-user",
        operatorLabel: "Lokaler Benutzer",
        comment: "Erste Basis-Position nach fehlgeschlagener OCR-Erkennung manuell ergänzt"
      });
    } else {
      if (!analysis) throw new Error("ANALYSE_NICHT_GELADEN");
      updated = await service.applyManualCorrection({
        projectId,
        analysisVersionId: analysis.analysisVersionId,
        expectedRevision: analysis.manualCorrectionRevision ?? 0,
        command,
        operatorId: "local-user",
        operatorLabel: "Lokaler Benutzer",
        comment: "Vom Benutzer nach OCR-Prüfung manuell ergänzt"
      });
    }
    setAnalysis(updated);
    setProject(await service.getProject(projectId));
    setManualDocumentId(null);
    setManualError("");
  }

  if (!project) {
    return <main className="browser-workflow-page">Projekt wird geladen …</main>;
  }
  if (failedWithoutBasis || (!analysis && project.status === "FEHLER")) {
    return (
      <main
        className="browser-workflow-page processing-result-page"
        data-processing-result
        data-processing-failed="FAILED_NO_BASIS_POSITIONS"
      >
        <section className="processing-result-warning processing-failed-state">
          <AlertTriangle size={36} />
          <div>
            <h1>Verarbeitung fehlgeschlagen</h1>
            <strong>Keine Basis-Positionen erkannt.</strong>
            <p>
              Das ausgewählte Basis-LV konnte automatisch nicht gelesen werden. Sie können die
              Dokumentzuordnung prüfen oder die erste Position direkt aus dem Original-PDF manuell
              erfassen. Das PDF und das fehlgeschlagene OCR-Ergebnis bleiben dabei unverändert.
            </p>
          </div>
        </section>
        {manualError ? (
          <p className="browser-project-error" role="alert">
            {manualError}
          </p>
        ) : null}
        <section className="processing-result-actions">
          {activeBasisDocument ? (
            <button
              type="button"
              className="browser-primary-button"
              data-manual-bootstrap-basis={activeBasisDocument.documentId}
              onClick={() => {
                setManualError("");
                setManualDocumentId(activeBasisDocument.documentId);
              }}
            >
              Erste Basis-Position manuell erfassen
            </button>
          ) : null}
          <Link href={`/projects/${projectId}/documents/review`}>
            <FileText size={17} /> Dokumente prüfen
          </Link>
          <Link href={`/projects/${projectId}/documents/review`}>Basis-LV ändern</Link>
          <Link href={`/projects/${projectId}/processing`}>
            <RefreshCw size={17} /> Neu verarbeiten
          </Link>
        </section>
        {!activeBasisDocument ? (
          <p className="browser-project-error" role="alert">
            Kein aktives Basis-LV festgelegt. Bitte zuerst die Dokumentrolle unter „Dokumente
            prüfen“ bestätigen.
          </p>
        ) : null}
        {manualDocument && manualKind === "BASIS_POSITION" ? (
          <ManualPositionEditor
            mode="ADD"
            kind="BASIS_POSITION"
            initialValues={{ pageNumber: 1 }}
            onCancel={() => {
              setManualDocumentId(null);
              setManualError("");
            }}
            onSubmit={saveManualPosition}
          />
        ) : null}
      </main>
    );
  }
  if (!analysis) {
    return <main className="browser-workflow-page">Analyse wird geladen …</main>;
  }

  const { summary } = analysis;
  const noOffer = analysis.pilot.projectReview.positions.filter(
    (position) => position.options.length === 0
  ).length;

  return (
    <main className="browser-workflow-page processing-result-page" data-processing-result>
      <header className="browser-workflow-header">
        <div>
          <span>{project.name}</span>
          <h1>Verarbeitung abgeschlossen</h1>
          <p>Die lokale Analyse ist gespeichert und kann jetzt geprüft werden.</p>
        </div>
      </header>

      <section className="processing-result-summary">
        <div className="processing-result-state">
          <CheckCircle2 size={36} />
          <div>
            <strong>
              {qualityReport?.projectStatus === "READY"
                ? "Vergleich ist bereit"
                : qualityReport?.projectStatus === "BLOCKED"
                  ? "Vergleich ist blockiert"
                  : "Vergleich mit Prüfbedarf"}
            </strong>
            <span>Analyseversion {analysis.analysisVersionId.slice(0, 8)}</span>
          </div>
        </div>
        <dl>
          <div>
            <dt>Basis-Positionen</dt>
            <dd>{summary.basisPositions}</dd>
          </div>
          <div>
            <dt>Lieferantenangebote</dt>
            <dd>{summary.supplierOffers}</dd>
          </div>
          <div>
            <dt>Mit Angebot</dt>
            <dd>{summary.positionsWithOffers}</dd>
          </div>
          <div>
            <dt>Ohne Angebot</dt>
            <dd>{noOffer}</dd>
          </div>
          <div>
            <dt>Per OCR gelesene Seiten</dt>
            <dd>{summary.ocrProcessedPages ?? 0}</dd>
          </div>
          <div>
            <dt>OCR noch offen</dt>
            <dd>{summary.ocrRequiredPages}</dd>
          </div>
        </dl>
      </section>

      {qualityReport ? (
        <DocumentQualityPanel
          report={qualityReport}
          onManualAdd={(documentId) => {
            const document = documents.find((candidate) => candidate.documentId === documentId);
            if (
              !document ||
              !["BASIS_LV", "SUPPLIER_OFFER", "MANUFACTURER_OFFER"].includes(document.documentType)
            ) {
              setManualError(
                "Bitte zuerst unter ‚Dokumente prüfen‘ festlegen, ob die PDF ein Basis-LV oder ein Angebot ist."
              );
              return;
            }
            setManualError("");
            setManualDocumentId(documentId);
          }}
        />
      ) : null}

      {manualError ? (
        <p className="browser-project-error" role="alert">
          {manualError}
        </p>
      ) : null}

      {summary.warnings > 0 ? (
        <section className="processing-result-warning">
          <AlertTriangle size={20} />
          <div>
            <strong>{summary.warnings} Hinweise benötigen Aufmerksamkeit</strong>
            <p>Die Hinweise werden im LV-Vergleich an den betroffenen Positionen angezeigt.</p>
          </div>
        </section>
      ) : null}

      <section className="processing-result-actions">
        {qualityReport?.projectStatus !== "BLOCKED" ? (
          <Link className="browser-primary-button" href={`/projects/${projectId}/lv-vergleich`}>
            LV-Vergleich öffnen <ArrowRight size={17} />
          </Link>
        ) : null}
        <Link href={`/projects/${projectId}/documents/review`}>
          <FileText size={17} /> Dokumente prüfen
        </Link>
        <Link href={`/projects/${projectId}/processing`}>
          <RefreshCw size={17} /> Neu verarbeiten
        </Link>
        <button onClick={() => setAddFilesOpen(true)}>
          <FileText size={17} /> Dateien hinzufügen
        </button>
      </section>
      <AddFilesDialog
        projectId={projectId}
        open={addFilesOpen}
        onClose={() => setAddFilesOpen(false)}
        onReview={() => router.push(`/projects/${projectId}/documents/review`)}
      />
      {manualDocument && manualKind ? (
        <ManualPositionEditor
          mode="ADD"
          kind={manualKind}
          initialValues={{ pageNumber: 1 }}
          onCancel={() => setManualDocumentId(null)}
          onSubmit={saveManualPosition}
        />
      ) : null}
    </main>
  );
}
