"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  RefreshCw
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserProjectService } from "@/browser-projects/project-service";
import type {
  BrowserAnalysisSnapshot,
  BrowserProjectRecord
} from "@/browser-projects/types";
import { AddFilesDialog } from "@/components/browser-projects/add-files-dialog";

export function ProcessingResultPage({ projectId }: { projectId: string }) {
  const service = useMemo(() => getBrowserProjectService(), []);
  const router = useRouter();
  const [project, setProject] = useState<BrowserProjectRecord | null>(null);
  const [analysis, setAnalysis] = useState<BrowserAnalysisSnapshot | null>(null);
  const [addFilesOpen, setAddFilesOpen] = useState(false);

  useEffect(() => {
    void Promise.all([
      service.getProject(projectId),
      service.latestAnalysis(projectId)
    ]).then(([storedProject, snapshot]) => {
      setProject(storedProject);
      setAnalysis(snapshot);
    });
  }, [projectId, service]);

  if (!project) {
    return <main className="browser-workflow-page">Projekt wird geladen …</main>;
  }
  if (
    project.processingFailureCode === "FAILED_NO_BASIS_POSITIONS" ||
    (!analysis && project.status === "FEHLER")
  ) {
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
              Das ausgewählte Basis-LV konnte nicht gelesen werden. Bitte
              prüfen Sie die Dokumentzuordnung oder wählen Sie ein anderes
              Basis-LV.
            </p>
          </div>
        </section>
        <section className="processing-result-actions">
          <Link href={`/projects/${projectId}/documents/review`}>
            <FileText size={17} /> Dokumente prüfen
          </Link>
          <Link href={`/projects/${projectId}/documents/review`}>
            Basis-LV ändern
          </Link>
          <Link href={`/projects/${projectId}/processing`}>
            <RefreshCw size={17} /> Neu verarbeiten
          </Link>
        </section>
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
            <strong>Vergleich ist bereit</strong>
            <span>Analyseversion {analysis.analysisVersionId.slice(0, 8)}</span>
          </div>
        </div>
        <dl>
          <div><dt>Basis-Positionen</dt><dd>{summary.basisPositions}</dd></div>
          <div><dt>Lieferantenangebote</dt><dd>{summary.supplierOffers}</dd></div>
          <div><dt>Mit Angebot</dt><dd>{summary.positionsWithOffers}</dd></div>
          <div><dt>Ohne Angebot</dt><dd>{noOffer}</dd></div>
        </dl>
      </section>

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
        <Link className="browser-primary-button" href={`/projects/${projectId}/lv-vergleich`}>
          LV-Vergleich öffnen <ArrowRight size={17} />
        </Link>
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
    </main>
  );
}
