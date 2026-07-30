"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  CloudUpload,
  Eye,
  FileText,
  FolderOpen,
  Plus,
  RefreshCw,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  getBrowserProjectService,
  type BrowserUploadItemResult,
  type BrowserUploadLimits
} from "@/browser-projects/project-service";
import type {
  BrowserDocumentRecord,
  BrowserProjectRecord
} from "@/browser-projects/types";

const documentTypeLabels: Record<BrowserDocumentRecord["documentType"], string> = {
  BASIS_LV: "Basis-LV",
  SUPPLIER_OFFER: "Lieferantenangebot",
  MANUFACTURER_OFFER: "Herstellerangebot",
  TECHNICAL_CALCULATION: "Technische Kalkulation",
  TECHNICAL_DOCUMENT: "Technische Unterlage",
  COVER_LETTER: "Begleitschreiben",
  OFFER_ATTACHMENT: "Angebotsanlage",
  EXPLICIT_NO_BID: "Explizite Nichtabgabe",
  SCAN_OCR_REQUIRED: "Scan · OCR erforderlich",
  OTHER: "Sonstiges",
  UNKNOWN: "Wird geprüft"
};

const statusLabels: Record<BrowserDocumentRecord["processingStatus"], string> = {
  BEREIT: "Bereit",
  WIRD_GEPRÜFT: "Wird geprüft",
  PRÜFUNG_ERFORDERLICH: "Prüfung erforderlich",
  NICHT_UNTERSTÜTZT: "Nicht unterstützt",
  VERSCHLÜSSELT: "Verschlüsselt",
  FEHLER: "Fehler"
};

const errorLabels: Record<string, string> = {
  TOO_MANY_FILES: "Die maximale Anzahl Dateien wurde erreicht.",
  NOT_ENOUGH_BROWSER_STORAGE: "Nicht genügend Browserspeicher.",
  FILE_TOO_LARGE: "Eine Datei überschreitet die zulässige Größe.",
  UNSUPPORTED_PDF: "Nur gültige, unverschlüsselte PDF-Dateien werden unterstützt.",
  DUPLICATE_PDF: "Diese PDF ist im Projekt bereits vorhanden.",
  TOO_MANY_PAGES: "Die maximale Gesamtseitenzahl wurde überschritten."
};

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function NewProjectPage({ limits }: { limits: BrowserUploadLimits }) {
  const service = useMemo(() => getBrowserProjectService(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get("projectId");
  const [project, setProject] = useState<BrowserProjectRecord | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [documents, setDocuments] = useState<BrowserDocumentRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [uploadResults, setUploadResults] = useState<BrowserUploadItemResult[]>(
    []
  );
  const [removeCandidate, setRemoveCandidate] =
    useState<BrowserDocumentRecord | null>(null);
  const [replacementCandidate, setReplacementCandidate] = useState<{
    document: BrowserDocumentRecord;
    file: File;
  } | null>(null);
  const [loaded, setLoaded] = useState(!initialProjectId);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replacementDocumentId = useRef<string | null>(null);
  const saveSequence = useRef(0);

  useEffect(() => {
    if (!initialProjectId) return;
    let cancelled = false;
    void Promise.all([
      service.getProject(initialProjectId),
      service.listDocuments(initialProjectId)
    ]).then(([storedProject, storedDocuments]) => {
      if (cancelled) return;
      if (!storedProject) {
        router.replace("/projects/new");
        setLoaded(true);
        return;
      }
      setProject(storedProject);
      setName(storedProject.name);
      setDescription(storedProject.objectDescription);
      setDocuments(storedDocuments);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [initialProjectId, router, service]);

  const ensureProject = useCallback(async () => {
    if (project) return project;
    if (!name.trim()) throw new Error("PROJECT_NAME_REQUIRED");
    const created = await service.createProject(name, description);
    setProject(created);
    router.replace(`/projects/new?projectId=${encodeURIComponent(created.projectId)}`);
    return created;
  }, [description, name, project, router, service]);

  useEffect(() => {
    if (!loaded || !name.trim()) return;
    const sequence = ++saveSequence.current;
    const timeout = window.setTimeout(() => {
      void (async () => {
        const current = await ensureProject();
        if (sequence !== saveSequence.current) return;
        const saved = await service.updateProject(current.projectId, {
          name,
          objectDescription: description
        });
        if (sequence === saveSequence.current) setProject(saved);
      })().catch((saveError) =>
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Projekt konnte nicht gespeichert werden."
        )
      );
    }, 550);
    return () => window.clearTimeout(timeout);
  }, [description, ensureProject, loaded, name, service]);

  async function addFiles(fileList: FileList | readonly File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      const current = await ensureProject();
      const replacement = replacementDocumentId.current;
      if (replacement) {
        const [file] = files;
        if (!file) return;
        const document = documents.find(
          (candidate) => candidate.documentId === replacement
        );
        if (!document) throw new Error("DOCUMENT_NOT_FOUND");
        setReplacementCandidate({ document, file });
        replacementDocumentId.current = null;
      } else {
        const result = await service.addFiles(current.projectId, files, limits);
        setUploadResults(result.items);
      }
      setDocuments(await service.listDocuments(current.projectId));
      setProject(await service.getProject(current.projectId));
    } catch (uploadError) {
      const code = uploadError instanceof Error ? uploadError.message : "";
      setError(
        errorLabels[code] ??
          (code || "Dateien konnten nicht gespeichert werden.")
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
      if (replaceInput.current) replaceInput.current.value = "";
    }
  }

  async function remove(documentId: string) {
    if (!project) return;
    await service.removeDocument(project.projectId, documentId);
    setDocuments(await service.listDocuments(project.projectId));
    setProject(await service.getProject(project.projectId));
  }

  async function confirmReplacement() {
    if (!project || !replacementCandidate) return;
    const document = await service.replaceDocument(
      project.projectId,
      replacementCandidate.document.documentId,
      replacementCandidate.file
    );
    setUploadResults([
      {
        fileName: replacementCandidate.file.name,
        status:
          document.documentType === "SCAN_OCR_REQUIRED"
            ? "OCR_REQUIRED"
            : "ADDED",
        document,
        existingDocumentId: null,
        message: "Dokument ersetzt und neu klassifiziert."
      }
    ]);
    setReplacementCandidate(null);
    setDocuments(await service.listDocuments(project.projectId));
    setProject(await service.getProject(project.projectId));
  }

  async function preview(documentId: string) {
    if (!project) return;
    const blob = await service.getDocumentBlob(project.projectId, documentId);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const ready =
    Boolean(name.trim()) &&
    documents.some(
      (document) =>
        document.processingStatus === "BEREIT" ||
        document.processingStatus === "PRÜFUNG_ERFORDERLICH"
    ) &&
    !uploading;

  async function continueToReview() {
    const current = await ensureProject();
    await service.updateProject(current.projectId, {
      lastRoute: "DOCUMENT_REVIEW"
    });
    router.push(`/projects/${current.projectId}/documents/review`);
  }

  return (
    <div className="new-project-page" data-new-project-page>
      <header className="new-project-header">
        <div>
          <Link href="/projects"><ArrowLeft size={17} /> Zurück zu Projekten</Link>
          <h1>Neues Projekt erstellen</h1>
          <p>Projekt anlegen, Dateien hochladen und Verarbeitung starten.</p>
        </div>
        <ol className="project-progress">
          {["Projekt", "Dateien", "Prüfen", "Verarbeitung"].map((label, index) => (
            <li className={index === 0 ? "active" : ""} key={label}>
              <span>{index + 1}</span>{label}
            </li>
          ))}
        </ol>
      </header>

      <div className="new-project-columns">
        <section className="new-project-info-card">
          <header><span>1</span><h2>Projektinformationen</h2></header>
          <label>
            <span>Projektname <b>*</b></span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="z. B. Neubau Verwaltungsgebäude"
              autoFocus
            />
          </label>
          <label>
            <span>Objekt / Beschreibung <small>(optional)</small></span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="z. B. Standort, Bauabschnitt, Notizen"
              rows={3}
            />
          </label>
          {project ? (
            <p className="project-autosave-state"><Check size={15} /> Entwurf gespeichert</p>
          ) : (
            <p className="project-autosave-state"><Clock3 size={15} /> Wird nach Eingabe gespeichert</p>
          )}
        </section>

        <section className="new-project-upload-card">
          <header><span>2</span><div><h2>Dateien hochladen</h2><p>Laden Sie alle Ihre Unterlagen hoch. Die Zuordnung prüfen wir automatisch.</p></div></header>
          <button
            className={`project-dropzone ${dragging ? "dragging" : ""}`}
            onClick={() => fileInput.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void addFiles(event.dataTransfer.files);
            }}
          >
            <CloudUpload size={40} />
            <strong>Dateien hierher ziehen oder <em>auswählen</em></strong>
            <span>PDF-Dateien hochladen</span>
            <i>{uploading ? "Dateien werden gespeichert..." : "Dateien auswählen"}</i>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(event) => void addFiles(event.target.files ?? [])}
          />
          <input
            ref={replaceInput}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(event) => void addFiles(event.target.files ?? [])}
          />
          <div className="upload-limits">
            <span><FileText size={15} /> Max. {limits.maxFiles} Dateien</span>
            <span><Clock3 size={15} /> Max. {formatBytes(limits.maxTotalBytes)} gesamt</span>
            <span><FolderOpen size={15} /> Max. {limits.maxTotalPages} Seiten gesamt</span>
          </div>
          {uploadResults.length ? (
            <div className="browser-upload-batch-summary" data-upload-summary>
              <strong>{uploadResults.length} Dateien ausgewählt</strong>
              <span>
                {uploadResults.filter((item) => item.status === "ADDED").length}{" "}
                hinzugefügt
              </span>
              <span>
                {
                  uploadResults.filter((item) => item.status === "DUPLICATE")
                    .length
                }{" "}
                bereits vorhanden
              </span>
              <span>
                {
                  uploadResults.filter(
                    (item) => item.status === "OCR_REQUIRED"
                  ).length
                }{" "}
                OCR erforderlich
              </span>
              <ul>
                {uploadResults.map((item, index) => (
                  <li
                    key={`${item.fileName}:${index}`}
                    data-upload-status={item.status}
                  >
                    {item.fileName}: {item.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="uploaded-files-heading">
            <h3>Hochgeladene Dateien ({documents.length})</h3>
            <button onClick={() => fileInput.current?.click()} disabled={!name.trim()}>
              <Plus size={17} /> Weitere Dateien hinzufügen
            </button>
          </div>
          <div className={`uploaded-files-table ${documents.length ? "" : "empty"}`}>
            <table>
              <thead><tr><th>Dateiname</th><th>Größe</th><th>Seiten</th><th>Erkannter Typ</th><th>Status</th><th>Aktionen</th></tr></thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.documentId} data-document-id={document.documentId}>
                    <td><FileText size={17} /><strong>{document.originalFileName}</strong></td>
                    <td>{formatBytes(document.size)}</td>
                    <td>{document.pageCount}</td>
                    <td>{documentTypeLabels[document.documentType]}</td>
                    <td><span className={`document-state state-${document.processingStatus.toLocaleLowerCase("de")}`}>{statusLabels[document.processingStatus]}</span></td>
                    <td>
                      <button onClick={() => void preview(document.documentId)} aria-label="Vorschau"><Eye size={16} /></button>
                      <button
                        onClick={() => {
                          replacementDocumentId.current = document.documentId;
                          replaceInput.current?.click();
                        }}
                        aria-label="Ersetzen"
                      ><RefreshCw size={16} /></button>
                      <button onClick={() => setRemoveCandidate(document)} aria-label="Entfernen"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!documents.length ? (
              <div className="uploaded-files-empty">
                <FolderOpen size={42} />
                <strong>Noch keine Dateien hochgeladen</strong>
                <span>Ziehen Sie Dateien hierher oder klicken Sie auf „Dateien auswählen“.</span>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {error ? <p className="browser-project-error" role="alert">{error}</p> : null}
      <footer className="new-project-footer">
        <Link href="/projects">Abbrechen</Link>
        <button disabled={!ready} onClick={() => void continueToReview()}>
          Weiter: Dateien prüfen <ArrowRight size={17} />
        </button>
      </footer>

      {removeCandidate ? (
        <div className="browser-modal-backdrop" role="presentation">
          <section
            className="browser-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-remove-title"
          >
            <header>
              <h2 id="new-project-remove-title">Dokument entfernen</h2>
              <button onClick={() => setRemoveCandidate(null)} aria-label="Schließen">
                <X size={18} />
              </button>
            </header>
            <p>
              <strong>{removeCandidate.originalFileName}</strong> und die lokal
              gespeicherte PDF-Datei werden entfernt.
            </p>
            <footer>
              <button onClick={() => setRemoveCandidate(null)}>Abbrechen</button>
              <button
                className="danger"
                onClick={() =>
                  void remove(removeCandidate.documentId).then(() =>
                    setRemoveCandidate(null)
                  )
                }
              >
                Dokument entfernen
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {replacementCandidate ? (
        <div className="browser-modal-backdrop" role="presentation">
          <section
            className="browser-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-replace-title"
          >
            <header>
              <h2 id="new-project-replace-title">Dokument ersetzen</h2>
              <button onClick={() => setReplacementCandidate(null)} aria-label="Schließen">
                <X size={18} />
              </button>
            </header>
            <p>
              <strong>{replacementCandidate.document.originalFileName}</strong>{" "}
              wird durch <strong>{replacementCandidate.file.name}</strong>{" "}
              ersetzt. SHA-256, Seitenzahl und Klassifikation werden neu
              berechnet; abhängige Analysen werden ungültig.
            </p>
            {replacementCandidate.document.documentType === "BASIS_LV" ? (
              <p className="workflow-warning">
                Das aktive Basis-LV wird ersetzt. Eine vollständige
                Neuverarbeitung ist erforderlich.
              </p>
            ) : null}
            <footer>
              <button onClick={() => setReplacementCandidate(null)}>Abbrechen</button>
              <button className="danger" onClick={() => void confirmReplacement()}>
                Dokument ersetzen
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
