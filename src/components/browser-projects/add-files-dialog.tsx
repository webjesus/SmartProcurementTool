"use client";

import { CloudUpload, FileText, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  DEFAULT_BROWSER_UPLOAD_LIMITS,
  getBrowserProjectService,
  type BrowserUploadItemResult
} from "@/browser-projects/project-service";

export function AddFilesDialog({
  projectId,
  open,
  onClose,
  onReview
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onReview: () => void;
}) {
  const service = useMemo(() => getBrowserProjectService(), []);
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<BrowserUploadItemResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await service.addFiles(
        projectId,
        Array.from(files),
        DEFAULT_BROWSER_UPLOAD_LIMITS
      );
      setItems((current) => [...current, ...result.items]);
    } catch (uploadError) {
      const code = uploadError instanceof Error ? uploadError.message : "";
      setError(
        code === "DUPLICATE_PDF"
          ? "Diese PDF ist bereits im Projekt vorhanden."
          : code === "NOT_ENOUGH_BROWSER_STORAGE"
            ? "Nicht genügend Browserspeicher."
            : code || "Dateien konnten nicht gespeichert werden."
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="browser-modal-backdrop" role="presentation">
      <section
        className="browser-add-files-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-files-title"
      >
        <header>
          <div>
            <h2 id="add-files-title">Weitere Dateien hinzufügen</h2>
            <p>Neue PDFs werden lokal in diesem Projekt gespeichert.</p>
          </div>
          <button onClick={onClose} aria-label="Schließen"><X size={18} /></button>
        </header>
        <button className="browser-add-files-dropzone" onClick={() => input.current?.click()}>
          <CloudUpload size={34} />
          <strong>PDF-Dateien auswählen</strong>
          <span>oder hierher ziehen</span>
        </button>
        <input
          ref={input}
          hidden
          multiple
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => void add(event.target.files)}
        />
        {items.length ? (
          <p className="browser-upload-batch-summary" data-upload-summary>
            {items.length} Dateien ausgewählt ·{" "}
            {items.filter((item) => item.status === "ADDED").length} hinzugefügt
            · {items.filter((item) => item.status === "DUPLICATE").length} bereits
            vorhanden ·{" "}
            {items.filter((item) => item.status === "OCR_REQUIRED").length} OCR
            erforderlich
          </p>
        ) : null}
        {items.length ? (
          <ul>
            {items.map((item, index) => (
              <li key={`${item.fileName}:${index}`} data-upload-status={item.status}>
                <FileText size={15} /> {item.fileName} · {item.message}
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="browser-project-error" role="alert">{error}</p> : null}
        <footer>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="browser-primary-button"
            disabled={
              !items.some((item) =>
                ["ADDED", "OCR_REQUIRED"].includes(item.status)
              ) || busy
            }
            onClick={onReview}
          >
            Dateien prüfen
          </button>
        </footer>
      </section>
    </div>
  );
}
