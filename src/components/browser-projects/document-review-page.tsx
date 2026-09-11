"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  FilePlus2,
  FileText,
  RefreshCw,
  ScanText,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  buildDocumentClusters,
  invalidManualBasisWarning
} from "@/browser-projects/document-classification";
import { getBrowserProjectService } from "@/browser-projects/project-service";
import type {
  BrowserDiscipline,
  BrowserDocumentRecord,
  BrowserDocumentType,
  BrowserProjectRecord
} from "@/browser-projects/types";
import { AddFilesDialog } from "@/components/browser-projects/add-files-dialog";
import {
  SafePdfPreview,
  type SafePdfPreviewValue
} from "@/components/browser-projects/safe-pdf-preview";

const documentTypes: Array<{ value: BrowserDocumentType; label: string }> = [
  { value: "BASIS_LV", label: "Basis-LV" },
  { value: "SUPPLIER_OFFER", label: "Lieferantenangebot" },
  { value: "MANUFACTURER_OFFER", label: "Herstellerangebot" },
  { value: "TECHNICAL_CALCULATION", label: "Technische Kalkulation" },
  { value: "TECHNICAL_DOCUMENT", label: "Technische Unterlage" },
  { value: "COVER_LETTER", label: "Begleitschreiben" },
  { value: "OFFER_ATTACHMENT", label: "Angebotsanlage" },
  { value: "EXPLICIT_NO_BID", label: "Explizite Nichtabgabe" },
  { value: "SCAN_OCR_REQUIRED", label: "Scan - OCR erforderlich" },
  { value: "OTHER", label: "Sonstiges" },
  { value: "UNKNOWN", label: "Unbekannt" }
];

const disciplineLabels: Record<BrowserDiscipline, string> = {
  HEIZUNG: "Heizung",
  SANITAER: "Sanitär",
  INSTALLATIONSSYSTEME: "Installationssysteme",
  MULTI: "Heizung / Sanitär",
  UNKNOWN: "Nicht erkannt"
};

function roleLabel(role: BrowserDocumentType): string {
  return documentTypes.find((item) => item.value === role)?.label ?? role;
}

function Modal({
  title,
  children,
  onClose
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="browser-modal-backdrop" role="presentation">
      <section
        className="browser-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Schließen">
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function DocumentReviewPage({ projectId }: { projectId: string }) {
  const service = useMemo(() => getBrowserProjectService(), []);
  const router = useRouter();
  const [project, setProject] = useState<BrowserProjectRecord | null>(null);
  const [documents, setDocuments] = useState<BrowserDocumentRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [addFilesOpen, setAddFilesOpen] = useState(false);
  const [selectedDiscipline, setSelectedDiscipline] =
    useState<BrowserDiscipline>("HEIZUNG");
  const [preflightReasons, setPreflightReasons] = useState<string[]>([]);
  const [preflightWarnings, setPreflightWarnings] = useState<string[]>([]);
  const [missingBlobIds, setMissingBlobIds] = useState<Set<string>>(
    () => new Set()
  );
  const [removeCandidate, setRemoveCandidate] =
    useState<BrowserDocumentRecord | null>(null);
  const [manualBasisCandidate, setManualBasisCandidate] =
    useState<BrowserDocumentRecord | null>(null);
  const [replacementCandidate, setReplacementCandidate] = useState<{
    document: BrowserDocumentRecord;
    file: File;
  } | null>(null);
  const [previewValue, setPreviewValue] =
    useState<SafePdfPreviewValue | null>(null);
  const replacementId = useRef<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    await service.repairMissingDocumentBlobs(projectId);
    const [nextProject, nextDocuments] = await Promise.all([
      service.getProject(projectId),
      service.listDocuments(projectId)
    ]);
    setProject(nextProject);
    setDocuments(nextDocuments);
    const missing = new Set<string>();
    await Promise.all(
      nextDocuments.map(async (document) => {
        const blob = await service.getDocumentBlob(projectId, document.documentId);
        if (!blob) missing.add(document.documentId);
      })
    );
    setMissingBlobIds(missing);
    if (nextProject?.activeDiscipline) {
      setSelectedDiscipline(nextProject.activeDiscipline);
    } else {
      const firstBasis = nextDocuments.find(
        (document) =>
          document.documentType === "BASIS_LV" && document.activeBasis
      );
      if (firstBasis) setSelectedDiscipline(firstBasis.discipline);
    }
    setLoading(false);
  }, [projectId, service]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timeout);
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    void service
      .processingPreflight(projectId, selectedDiscipline)
      .then((preflight) => {
        if (cancelled) return;
        setPreflightReasons(preflight.blockingReasons);
        setPreflightWarnings(preflight.warnings);
      })
      .catch((preflightError) => {
        if (!cancelled) {
          setPreflightReasons([
            preflightError instanceof Error
              ? preflightError.message
              : "Preflight konnte nicht ausgeführt werden."
          ]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documents, projectId, selectedDiscipline, service]);

  const clusters = useMemo(() => buildDocumentClusters(documents), [documents]);
  const disciplines = useMemo(
    () =>
      Array.from(
        new Set(
          documents
            .filter((document) => document.documentType === "BASIS_LV")
            .map((document) => document.discipline)
        )
      ),
    [documents]
  );
  const activeBasis = documents.filter(
    (document) =>
      document.documentType === "BASIS_LV" &&
      document.activeBasis &&
      document.discipline === selectedDiscipline
  );
  const valid = preflightReasons.length === 0 && activeBasis.length === 1;

  async function update(
    document: BrowserDocumentRecord,
    patch: Parameters<typeof service.updateDocument>[2]
  ) {
    await service.updateDocument(projectId, document.documentId, patch);
    await reload();
  }

  async function changeRole(
    document: BrowserDocumentRecord,
    nextType: BrowserDocumentType
  ) {
    if (nextType === "BASIS_LV") {
      const warning = invalidManualBasisWarning(document);
      if (warning) {
        setManualBasisCandidate(document);
        return;
      }
    }
    await update(document, {
      documentType: nextType,
      supplierName:
        nextType === "SUPPLIER_OFFER" || nextType === "MANUFACTURER_OFFER"
          ? document.supplierName
          : null,
      manualBasisOverrideConfirmed: false,
      classificationWarnings: document.classificationWarnings,
      processingStatus: "BEREIT"
    });
  }

  async function preview(document: BrowserDocumentRecord) {
    const blob = await service.getDocumentBlob(projectId, document.documentId);
    if (!blob) return;
    setPreviewValue({ blob, title: document.originalFileName });
  }

  async function replace(file: File | undefined) {
    const documentId = replacementId.current;
    if (!file || !documentId) return;
    const document = documents.find(
      (candidate) => candidate.documentId === documentId
    );
    replacementId.current = null;
    if (replaceInput.current) replaceInput.current.value = "";
    if (document) setReplacementCandidate({ document, file });
  }

  async function confirmReplacement() {
    if (!replacementCandidate) return;
    try {
      await service.replaceDocument(
        projectId,
        replacementCandidate.document.documentId,
        replacementCandidate.file
      );
      setReplacementCandidate(null);
      await reload();
    } catch (replaceError) {
      setError(
        replaceError instanceof Error
          ? replaceError.message
          : "Dokument konnte nicht ersetzt werden."
      );
    }
  }

  async function processProject() {
    if (!valid) return;
    await service.updateProject(projectId, {
      status: "IN_VERARBEITUNG",
      lastRoute: "PROCESSING",
      activeDiscipline: selectedDiscipline,
      processingFailureCode: null
    });
    router.push(`/projects/${projectId}/processing`);
  }

  if (loading) {
    return <p className="browser-project-loading">Dokumente werden geladen...</p>;
  }
  if (!project) {
    return <p className="browser-project-error">Projekt nicht gefunden.</p>;
  }

  return (
    <div className="browser-workflow-page" data-document-review>
      <header className="browser-workflow-header">
        <div>
          <Link href="/projects">
            <ArrowLeft size={17} /> Zurück zu Projekten
          </Link>
          <h1>Dokumente prüfen</h1>
          <p>Automatische Zuordnung, Dokumentsets und Preflight prüfen.</p>
        </div>
        <button
          className="workflow-secondary-action"
          onClick={() => setAddFilesOpen(true)}
        >
          <FilePlus2 size={17} /> Dateien hinzufügen
        </button>
      </header>

      <section className="document-review-summary">
        <div>
          <FileText size={20} />
          <span>
            <strong>{documents.length}</strong> Dokumente
          </span>
        </div>
        <div className={activeBasis.length === 1 ? "valid" : "warning"}>
          {activeBasis.length === 1 ? (
            <ShieldCheck size={20} />
          ) : (
            <AlertTriangle size={20} />
          )}
          <span>
            <strong>{activeBasis.length}</strong> aktives Basis-LV
          </span>
        </div>
        <div className={preflightReasons.length ? "warning" : "valid"}>
          {preflightReasons.length ? (
            <AlertTriangle size={20} />
          ) : (
            <CheckCircle2 size={20} />
          )}
          <span>
            <strong>{preflightReasons.length}</strong> Blocker
          </span>
        </div>
      </section>

      <section className="document-cluster-panel" data-document-clusters>
        <header>
          <h2>Vorgeschlagene Dokumentsets</h2>
          <div role="tablist" aria-label="Disziplin auswählen">
            {disciplines.map((discipline) => (
              <button
                key={discipline}
                role="tab"
                aria-selected={selectedDiscipline === discipline}
                className={selectedDiscipline === discipline ? "active" : ""}
                onClick={() => setSelectedDiscipline(discipline)}
              >
                {disciplineLabels[discipline]}
              </button>
            ))}
          </div>
        </header>
        <div className="document-cluster-grid">
          {clusters.map((cluster) => (
            <article key={cluster.id} data-document-cluster={cluster.discipline}>
              <strong>{disciplineLabels[cluster.discipline]}</strong>
              <span>
                Basis: {cluster.basisDocumentIds.length} · Angebote:{" "}
                {cluster.supplierDocumentIds.length}
              </span>
              <small>
                Technische Unterlagen: {cluster.auxiliaryDocumentIds.length} ·
                OCR offen: {cluster.pendingOcrDocumentIds.length}
              </small>
            </article>
          ))}
        </div>
      </section>

      {preflightReasons.length ? (
        <section className="workflow-blockers" role="alert">
          <strong>Verarbeitung noch nicht möglich</strong>
          <ul>
            {preflightReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {preflightWarnings.length ? (
        <section className="workflow-warning">
          {preflightWarnings.join(" ")}
        </section>
      ) : null}

      <section className="document-review-table">
        <table>
          <thead>
            <tr>
              <th>Datei</th>
              <th>Erkannter Typ</th>
              <th>Zugewiesener Typ</th>
              <th>Disziplin</th>
              <th>Lieferant</th>
              <th>Angebotsnummer</th>
              <th>Version / Revision</th>
              <th>Seiten</th>
              <th>Status</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr
                key={document.documentId}
                data-review-document={document.documentId}
                data-document-role={document.documentType}
                data-discipline={document.discipline}
                data-scan-state={document.scanState}
              >
                <td>
                  <FileText size={17} />
                  <span>
                    <strong>{document.originalFileName}</strong>
                    {missingBlobIds.has(document.documentId) ? (
                      <span className="missing-pdf-badge">PDF fehlt — bitte ersetzen</span>
                    ) : null}
                    {document.documentType === "BASIS_LV" ? (
                      <button
                        className={document.activeBasis ? "active-basis" : ""}
                        onClick={() =>
                          void service
                            .selectActiveBasis(projectId, document.documentId)
                            .then(reload)
                        }
                      >
                        {document.activeBasis
                          ? "Aktives Basis-LV"
                          : "Als Basis aktivieren"}
                      </button>
                    ) : null}
                  </span>
                </td>
                <td>{roleLabel(document.detectedDocumentType)}</td>
                <td>
                  <select
                    value={document.documentType}
                    onChange={(event) =>
                      void changeRole(
                        document,
                        event.target.value as BrowserDocumentType
                      )
                    }
                  >
                    {documentTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={document.discipline}
                    aria-label={`Disziplin ${document.originalFileName}`}
                    onChange={(event) =>
                      void update(document, {
                        discipline: event.target.value as BrowserDiscipline
                      })
                    }
                  >
                    {(
                      Object.entries(disciplineLabels) as Array<
                        [BrowserDiscipline, string]
                      >
                    ).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {[
                    "SUPPLIER_OFFER",
                    "MANUFACTURER_OFFER",
                    "EXPLICIT_NO_BID"
                  ].includes(document.documentType) ? (
                    <input
                      value={document.supplierName ?? ""}
                      placeholder="Lieferant"
                      onBlur={(event) =>
                        void update(document, {
                          supplierName: event.target.value
                        })
                      }
                      onChange={(event) =>
                        setDocuments((current) =>
                          current.map((item) =>
                            item.documentId === document.documentId
                              ? { ...item, supplierName: event.target.value }
                              : item
                          )
                        )
                      }
                    />
                  ) : (
                    "—"
                  )}
                </td>
                <td>{document.offerNumber ?? "—"}</td>
                <td>
                  {document.documentVersion
                    ? `Version ${document.documentVersion}`
                    : document.revision !== null
                      ? `Revision ${document.revision}`
                      : "Nicht erkannt"}
                  {document.relationType === "SEPARATE_OFFER" ? (
                    <small>Separates Angebot</small>
                  ) : null}
                </td>
                <td>{document.pageCount}</td>
                <td>
                  {document.scanState === "OCR_AVAILABLE" ? (
                    <span className="classification-confidence confidence-medium">
                      <ScanText size={15} /> Lokal per OCR gelesen · Prüfung
                      erforderlich
                    </span>
                  ) : document.documentType === "SCAN_OCR_REQUIRED" ? (
                    <div className="ocr-required-status">
                      <span className="classification-confidence confidence-low">
                        <AlertTriangle size={15} /> Automatische OCR im Verarbeitungslauf · Prüfung erforderlich
                      </span>
                    </div>
                  ) : (
                    <span
                      className={`classification-confidence confidence-${document.classificationDimensions.documentRole.toLocaleLowerCase("de")}`}
                      title={document.classificationSignals.join(", ")}
                    >
                      {document.classificationDimensions.documentRole ===
                      "HIGH" ? (
                        <CheckCircle2 size={15} />
                      ) : (
                        <AlertTriangle size={15} />
                      )}
                      Rolle {document.classificationDimensions.documentRole} ·
                      Disziplin {document.classificationDimensions.discipline}
                    </span>
                  )}
                  {document.scanState === "OCR_AVAILABLE" ? (
                    <small className="ocr-audit-note">
                      {document.ocrSampledPages ?? 0} Stichprobenseiten ·{" "}
                      {document.ocrMeanConfidence === null ||
                      document.ocrMeanConfidence === undefined
                        ? "Konfidenz offen"
                        : `${Math.round(document.ocrMeanConfidence)} % OCR-Konfidenz`}
                    </small>
                  ) : null}
                  {document.documentType === "SCAN_OCR_REQUIRED" ? (
                    <label className="ocr-exclusion">
                      <input
                        type="checkbox"
                        checked={document.excludedFromProcessing}
                        onChange={(event) =>
                          void update(document, {
                            excludedFromProcessing: event.target.checked
                          })
                        }
                      />
                      Für diesen Lauf ausschließen
                    </label>
                  ) : null}
                </td>
                <td>
                  <button
                    onClick={() => void preview(document)}
                    aria-label={`Vorschau ${document.originalFileName}`}
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    onClick={() => {
                      replacementId.current = document.documentId;
                      replaceInput.current?.click();
                    }}
                    aria-label={`Ersetzen ${document.originalFileName}`}
                  >
                    <RefreshCw size={16} />
                  </button>
                  <button
                    onClick={() => setRemoveCandidate(document)}
                    aria-label={`Entfernen ${document.originalFileName}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <input
          ref={replaceInput}
          hidden
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => void replace(event.target.files?.[0])}
        />
      </section>

      {error ? (
        <p className="browser-project-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer className="browser-workflow-footer">
        <button onClick={() => setAddFilesOpen(true)}>Dokumente ändern</button>
        <div className="browser-workflow-footer-actions">
          {!valid && preflightReasons.length ? (
            <p className="browser-workflow-footer-hint" role="status">
              {preflightReasons[0]}
              {preflightReasons.length > 1
                ? ` (+${preflightReasons.length - 1} weitere)`
                : ""}
            </p>
          ) : null}
          <button
            disabled={!valid}
            onClick={() =>
              void processProject().catch((processError) =>
                setError(
                  processError instanceof Error
                    ? processError.message
                    : "Verarbeitung konnte nicht gestartet werden."
                )
              )
            }
          >
            Verarbeitung starten <ArrowRight size={17} />
          </button>
        </div>
      </footer>

      {removeCandidate ? (
        <Modal
          title="Dokument entfernen"
          onClose={() => setRemoveCandidate(null)}
        >
          <p>
            <strong>{removeCandidate.originalFileName}</strong> und die lokal
            gespeicherte PDF-Datei werden entfernt. Die aktuelle Analyse wird
            ungültig.
          </p>
          <footer>
            <button onClick={() => setRemoveCandidate(null)}>Abbrechen</button>
            <button
              className="danger"
              onClick={() =>
                void service
                  .removeDocument(projectId, removeCandidate.documentId)
                  .then(() => {
                    setRemoveCandidate(null);
                    return reload();
                  })
              }
            >
              Dokument entfernen
            </button>
          </footer>
        </Modal>
      ) : null}

      {manualBasisCandidate ? (
        <Modal
          title="Unplausible Basis-Zuordnung"
          onClose={() => setManualBasisCandidate(null)}
        >
          <p>{invalidManualBasisWarning(manualBasisCandidate)}</p>
          <footer>
            <button
              onClick={() => {
                setManualBasisCandidate(null);
                void reload();
              }}
            >
              Zuordnung zurücksetzen
            </button>
            <button
              className="danger"
              onClick={() =>
                void update(manualBasisCandidate, {
                  documentType: "BASIS_LV",
                  supplierName: null,
                  manualBasisOverrideConfirmed: true,
                  manualRoleOverride: true,
                  processingStatus: "BEREIT"
                }).then(() => setManualBasisCandidate(null))
              }
            >
              Trotzdem als Basis-LV verwenden
            </button>
          </footer>
        </Modal>
      ) : null}

      {replacementCandidate ? (
        <Modal
          title="Dokument ersetzen"
          onClose={() => setReplacementCandidate(null)}
        >
          <p>
            <strong>{replacementCandidate.document.originalFileName}</strong>{" "}
            wird durch <strong>{replacementCandidate.file.name}</strong>{" "}
            ersetzt. SHA-256, Seitenzahl und Zuordnung werden neu ermittelt.
          </p>
          {replacementCandidate.document.documentType === "BASIS_LV" ? (
            <p className="workflow-warning">
              Das Basis-LV wird ersetzt. Die aktuelle Analyse wird ungültig und
              muss vollständig neu verarbeitet werden.
            </p>
          ) : null}
          <footer>
            <button onClick={() => setReplacementCandidate(null)}>
              Abbrechen
            </button>
            <button className="danger" onClick={() => void confirmReplacement()}>
              Dokument ersetzen
            </button>
          </footer>
        </Modal>
      ) : null}

      <AddFilesDialog
        projectId={projectId}
        open={addFilesOpen}
        onClose={() => setAddFilesOpen(false)}
        onReview={() => {
          setAddFilesOpen(false);
          void reload();
        }}
      />
      {previewValue ? (
        <SafePdfPreview
          value={previewValue}
          onClose={() => setPreviewValue(null)}
        />
      ) : null}
    </div>
  );
}
