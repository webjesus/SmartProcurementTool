import type {
  BrowserDocumentQualityReport,
  DocumentQualityReason
} from "@/browser-projects/document-quality";

const statusLabels = {
  SUPPORTED: "Unterstützt",
  REVIEW_REQUIRED: "Prüfung erforderlich",
  UNSUPPORTED: "Nicht unterstützt"
} as const;

const reasonLabels: Record<DocumentQualityReason, string> = {
  OCR_REQUIRED: "OCR erforderlich",
  PARTIAL_TEXT_LAYER: "Textschicht ist unvollständig",
  CLASSIFICATION_REVIEW_REQUIRED: "Dokumentzuordnung prüfen",
  EXCLUDED_FROM_PROCESSING: "Von der Verarbeitung ausgeschlossen",
  NO_POSITIONS_EXTRACTED: "Keine Positionen extrahiert",
  POSITION_COUNT_MISMATCH: "Vollscan-Markierungen nicht vollständig extrahiert",
  EVIDENCE_MISSING: "Fundstelle im Original fehlt",
  EVIDENCE_UNCONFIRMED: "Fundstelle vorhanden, aber noch nicht bestätigt",
  MULTI_PAGE_POSITION: "Mehrseitige Positionen manuell prüfen",
  OCR_SOURCE: "OCR-Quelle manuell prüfen",
  OCR_FAILED: "OCR-Verarbeitung fehlgeschlagen",
  FULL_DOCUMENT_SCAN_INCOMPLETE: "Nicht alle Dokumentseiten wurden geprüft",
  NOT_IN_COMPARISON_SCOPE: "Nicht Teil des LV-Vergleichs"
};

const MANUAL_CAPTURE_REASONS = new Set<DocumentQualityReason>([
  "OCR_REQUIRED",
  "OCR_FAILED",
  "NO_POSITIONS_EXTRACTED",
  "POSITION_COUNT_MISMATCH"
]);

export function DocumentQualityPanel({
  report,
  onManualAdd
}: {
  report: BrowserDocumentQualityReport;
  onManualAdd?: (documentId: string) => void;
}) {
  return (
    <section
      className={`document-quality-panel status-${report.projectStatus.toLowerCase()}`}
      data-document-quality={report.projectStatus}
    >
      <header>
        <div>
          <span>Prüfbericht</span>
          <h2>Dokumentenqualität</h2>
        </div>
        <dl>
          <div>
            <dt>Positionen</dt>
            <dd>
              {report.totals.extractedPositions} extrahiert · {report.totals.candidatePositions} im
              Vollscan erkannt
            </dd>
          </div>
          <div>
            <dt>Sicher belegt</dt>
            <dd>
              {report.totals.verifiedPositions} bestätigt · {report.totals.unconfirmedEvidence}{" "}
              unbestätigt
            </dd>
          </div>
          <div>
            <dt>Zu prüfen</dt>
            <dd>{report.totals.reviewRequiredDocuments}</dd>
          </div>
        </dl>
      </header>
      <div className="document-quality-list">
        {report.documents.map((document) => {
          const canCaptureManually = document.reasonCodes.some((reason) =>
            MANUAL_CAPTURE_REASONS.has(reason)
          );
          return (
          <article key={document.documentId} data-quality-status={document.status}>
            <div>
              <strong title={document.label}>{document.label}</strong>
              <span>
                {document.pages} {document.pages === 1 ? "Seite" : "Seiten"}
              </span>
            </div>
            <div>
              <strong>{statusLabels[document.status]}</strong>
              <span>
                {document.extractedPositions} extrahiert · {document.candidatePositions} im Vollscan
                erkannt
              </span>
              <span>
                {document.pagesInspected} von {document.pages}{" "}
                {document.pages === 1 ? "Seite" : "Seiten"} im Vollscan verarbeitet
              </span>
              {document.ocrProcessedPages > 0 ? (
                <span>
                  {document.ocrProcessedPages} OCR-
                  {document.ocrProcessedPages === 1 ? "Seite" : "Seiten"}
                </span>
              ) : null}
              {document.multiPagePositions > 0 ? (
                <span>
                  {document.multiPagePositions} mehrseitige{" "}
                  {document.multiPagePositions === 1 ? "Position" : "Positionen"}
                </span>
              ) : null}
              {document.missingEvidence > 0 ? (
                <span>{document.missingEvidence} ohne sichere Fundstelle</span>
              ) : null}
              {document.unconfirmedEvidence > 0 ? (
                <span>
                  {document.unconfirmedEvidence}{" "}
                  {document.unconfirmedEvidence === 1 ? "Fundstelle" : "Fundstellen"} noch
                  unbestätigt
                </span>
              ) : null}
            </div>
            {document.reasonCodes.length ? (
              <ul>
                {document.reasonCodes.map((reason) => (
                  <li key={reason}>{reasonLabels[reason]}</li>
                ))}
              </ul>
            ) : (
              <span className="document-quality-ok">Alle Prüfungen bestanden</span>
            )}
            {onManualAdd && canCaptureManually ? (
              <button
                type="button"
                className="document-quality-manual-add"
                data-manual-add-document={document.documentId}
                onClick={() => onManualAdd(document.documentId)}
              >
                Fehlende Position manuell erfassen
              </button>
            ) : null}
          </article>
          );
        })}
      </div>
    </section>
  );
}
