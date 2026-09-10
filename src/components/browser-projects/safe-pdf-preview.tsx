"use client";

import { X } from "lucide-react";
import { useEffect, useMemo } from "react";

export type SafePdfPreviewValue = {
  blob: Blob;
  title: string;
};

export function SafePdfPreview({
  value,
  onClose
}: {
  value: SafePdfPreviewValue;
  onClose: () => void;
}) {
  const url = useMemo(
    () => URL.createObjectURL(
      new Blob([value.blob], { type: "application/pdf" })
    ),
    [value.blob]
  );

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="safe-pdf-preview-backdrop" role="presentation">
      <section
        className="safe-pdf-preview"
        role="dialog"
        aria-modal="true"
        aria-label={`PDF-Vorschau: ${value.title}`}
      >
        <header>
          <div>
            <strong>{value.title}</strong>
            <small>Isolierte PDF-Vorschau</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Vorschau schließen">
            <X size={19} />
          </button>
        </header>
        {url ? (
          <iframe
            src={url}
            title={`PDF-Vorschau ${value.title}`}
            sandbox=""
            referrerPolicy="no-referrer"
          />
        ) : null}
      </section>
    </div>
  );
}
