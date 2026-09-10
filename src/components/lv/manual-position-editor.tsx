"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "./manual-position-editor.module.css";

export type ManualPositionEditorMode = "CORRECT" | "ADD";
export type ManualPositionEditorKind = "BASIS_POSITION" | "SUPPLIER_LINE";

export type ManualPositionRegionDraft = {
  x: string;
  y: string;
  width: string;
  height: string;
};

export type ManualPositionEditorDraft = {
  positionNumber: string;
  shortDescription: string;
  description: string;
  articleNumber: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  totalPrice: string;
  pageNumber: string;
  region: ManualPositionRegionDraft;
};

export type ManualPositionEditorInitialValues = Partial<{
  positionNumber: string | null;
  shortDescription: string | null;
  description: string | null;
  articleNumber: string | null;
  quantity: number | string | null;
  unit: string | null;
  unitPrice: number | string | null;
  totalPrice: number | string | null;
  pageNumber: number | string | null;
  region: Partial<{
    x: number | string | null;
    y: number | string | null;
    width: number | string | null;
    height: number | string | null;
  }> | null;
}>;

export type ManualPositionEditorValue = {
  mode: ManualPositionEditorMode;
  kind: ManualPositionEditorKind;
  positionNumber: string;
  shortDescription: string;
  description: string;
  articleNumber: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  pageNumber: number;
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  provenance: {
    method: "MANUAL";
    action: ManualPositionEditorMode;
    originalOcrPreserved: true;
  };
};

type ManualPositionField =
  | "positionNumber"
  | "shortDescription"
  | "description"
  | "articleNumber"
  | "quantity"
  | "unit"
  | "unitPrice"
  | "totalPrice"
  | "pageNumber"
  | "region";

export type ManualPositionEditorErrors = Partial<Record<ManualPositionField, string>>;

export type ManualPositionEditorValidationResult =
  | { ok: true; value: ManualPositionEditorValue }
  | { ok: false; errors: ManualPositionEditorErrors };

export type ManualPositionEditorProps = {
  mode: ManualPositionEditorMode;
  kind: ManualPositionEditorKind;
  initialValues?: ManualPositionEditorInitialValues;
  onCancel: () => void;
  onSubmit: (value: ManualPositionEditorValue) => void | Promise<void>;
};

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

function draftText(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function createDraft(
  initialValues: ManualPositionEditorInitialValues | undefined
): ManualPositionEditorDraft {
  return {
    positionNumber: draftText(initialValues?.positionNumber),
    shortDescription: draftText(initialValues?.shortDescription),
    description: draftText(initialValues?.description),
    articleNumber: draftText(initialValues?.articleNumber),
    quantity: draftText(initialValues?.quantity),
    unit: draftText(initialValues?.unit),
    unitPrice: draftText(initialValues?.unitPrice),
    totalPrice: draftText(initialValues?.totalPrice),
    pageNumber: draftText(initialValues?.pageNumber),
    region: {
      x: draftText(initialValues?.region?.x),
      y: draftText(initialValues?.region?.y),
      width: draftText(initialValues?.region?.width),
      height: draftText(initialValues?.region?.height)
    }
  };
}

function parseGermanNumber(rawValue: string): number | null | "INVALID" {
  const compact = rawValue.trim().replace(/\s/g, "");
  if (!compact) return null;

  const normalized = compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return "INVALID";
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : "INVALID";
}

function validateOptionalPositiveNumber(
  rawValue: string,
  label: "Menge" | "EP" | "GP",
  errors: ManualPositionEditorErrors,
  field: "quantity" | "unitPrice" | "totalPrice"
): number | null {
  const value = parseGermanNumber(rawValue);
  if (value === "INVALID") {
    errors[field] = `${label} muss eine gültige Zahl sein.`;
    return null;
  }
  if (value === null) return null;
  if (label === "Menge" && value <= 0) {
    errors[field] = "Menge muss größer als 0 sein.";
    return null;
  }
  if (label !== "Menge" && value < 0) {
    errors[field] = `${label} darf nicht negativ sein.`;
    return null;
  }
  return value;
}

function validateRegion(
  draft: ManualPositionRegionDraft,
  errors: ManualPositionEditorErrors
): ManualPositionEditorValue["region"] {
  const raw = [draft.x, draft.y, draft.width, draft.height];
  const populated = raw.filter((value) => value.trim().length > 0).length;
  if (populated === 0) return null;
  if (populated !== raw.length) {
    errors.region = "Markierungsbereich vollständig oder gar nicht ausfüllen.";
    return null;
  }

  const parsed = raw.map(parseGermanNumber);
  if (parsed.some((value) => value === null || value === "INVALID")) {
    errors.region = "Markierungsbereich muss aus gültigen Zahlen bestehen.";
    return null;
  }

  const [x, y, width, height] = parsed as [number, number, number, number];
  if (
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x > 1 ||
    y > 1 ||
    width > 1 ||
    height > 1 ||
    x + width > 1 + Number.EPSILON ||
    y + height > 1 + Number.EPSILON
  ) {
    errors.region = "Markierungsbereich muss vollständig innerhalb der PDF-Seite liegen.";
    return null;
  }

  return { x, y, width, height };
}

export function validateManualPositionDraft(input: {
  mode: ManualPositionEditorMode;
  kind: ManualPositionEditorKind;
  draft: ManualPositionEditorDraft;
}): ManualPositionEditorValidationResult {
  const errors: ManualPositionEditorErrors = {};
  const positionNumber = input.draft.positionNumber.trim();
  const shortDescription = input.draft.shortDescription.trim();
  const description = input.draft.description.trim();
  const articleNumber = input.draft.articleNumber.trim();
  const unit = input.draft.unit.trim();

  if (!positionNumber) errors.positionNumber = "Positionsnummer ist erforderlich.";
  if (!shortDescription) {
    errors.shortDescription = "Kurzbezeichnung ist erforderlich.";
  }
  if (!description) errors.description = "Beschreibung ist erforderlich.";

  const quantity = validateOptionalPositiveNumber(
    input.draft.quantity,
    "Menge",
    errors,
    "quantity"
  );
  const unitPrice =
    input.kind === "SUPPLIER_LINE"
      ? validateOptionalPositiveNumber(input.draft.unitPrice, "EP", errors, "unitPrice")
      : null;
  const totalPrice =
    input.kind === "SUPPLIER_LINE"
      ? validateOptionalPositiveNumber(input.draft.totalPrice, "GP", errors, "totalPrice")
      : null;

  if (input.draft.quantity.trim() && !unit) {
    errors.unit = "Einheit ist bei angegebener Menge erforderlich.";
  } else if (!input.draft.quantity.trim() && unit && !errors.quantity) {
    errors.quantity = "Menge ist bei angegebener Einheit erforderlich.";
  }

  const parsedPage = parseGermanNumber(input.draft.pageNumber);
  const pageNumber =
    typeof parsedPage === "number" && Number.isInteger(parsedPage) && parsedPage >= 1
      ? parsedPage
      : null;
  if (pageNumber === null) {
    errors.pageNumber = "Seite muss eine ganze Zahl ab 1 sein.";
  }

  const region = validateRegion(input.draft.region, errors);
  if (Object.keys(errors).length > 0 || pageNumber === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      mode: input.mode,
      kind: input.kind,
      positionNumber,
      shortDescription,
      description,
      articleNumber: input.kind === "SUPPLIER_LINE" ? articleNumber || null : null,
      quantity,
      unit: unit || null,
      unitPrice,
      totalPrice,
      pageNumber,
      region,
      provenance: {
        method: "MANUAL",
        action: input.mode,
        originalOcrPreserved: true
      }
    }
  };
}

export function manualPositionEditorKeyAction(key: string): "CANCEL" | null {
  return key === "Escape" ? "CANCEL" : null;
}

function RequiredMark() {
  return (
    <span className={styles.required} aria-hidden="true">
      {" "}
      *
    </span>
  );
}

export function ManualPositionEditor({
  mode,
  kind,
  initialValues,
  onCancel,
  onSubmit
}: ManualPositionEditorProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<ManualPositionEditorDraft>(() => createDraft(initialValues));
  const [errors, setErrors] = useState<ManualPositionEditorErrors>({});
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const provenanceId = `${id}-provenance`;
  const fieldId = (field: string) => `${id}-${field.replace(".", "-")}`;
  const errorId = (field: ManualPositionField) => `${id}-${field}-error`;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    firstInputRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  function clearError(field: ManualPositionField) {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setSubmitError(null);
  }

  function updateField(field: Exclude<keyof ManualPositionEditorDraft, "region">, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    clearError(field);
  }

  function updateRegion(field: keyof ManualPositionRegionDraft, value: string) {
    setDraft((current) => ({
      ...current,
      region: { ...current.region, [field]: value }
    }));
    clearError("region");
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (manualPositionEditorKeyAction(event.key) === "CANCEL") {
      event.preventDefault();
      if (!pending) onCancel();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []
    ).filter((element) => !element.hasAttribute("hidden"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1) ?? first;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateManualPositionDraft({ mode, kind, draft });
    if (!result.ok) {
      setErrors(result.errors);
      const firstField = Object.keys(result.errors)[0] as ManualPositionField;
      const inputName = firstField === "region" ? "region.x" : firstField;
      rootRef.current?.querySelector<HTMLElement>(`[name="${inputName}"]`)?.focus();
      return;
    }

    setErrors({});
    setSubmitError(null);
    setPending(true);
    try {
      await onSubmit(result.value);
    } catch (error) {
      setSubmitError(
        error instanceof Error && error.message
          ? error.message
          : "Die manuelle Eingabe konnte nicht gespeichert werden."
      );
    } finally {
      setPending(false);
    }
  }

  function describedBy(field: ManualPositionField, hintId?: string) {
    return [hintId, errors[field] ? errorId(field) : null].filter(Boolean).join(" ") || undefined;
  }

  const title =
    mode === "CORRECT" ? "OCR-Position manuell korrigieren" : "Position manuell hinzufügen";
  const kindLabel = kind === "SUPPLIER_LINE" ? "Angebotsposition" : "Basis-LV-Position";
  const saveLabel = mode === "CORRECT" ? "Korrektur speichern" : "Position hinzufügen";

  return (
    <div className={styles.backdrop} data-manual-position-editor>
      <div
        ref={rootRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${provenanceId}`}
        onKeyDown={handleDialogKeyDown}
      >
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>{kindLabel}</span>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>Fehlende oder falsch gelesene Werte nachvollziehbar ergänzen.</p>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Editor schließen"
            disabled={pending}
            onClick={onCancel}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className={styles.body}>
          <aside id={provenanceId} className={styles.provenance}>
            <strong>{mode === "CORRECT" ? "OCR" : "MANUELL"}</strong>
            <span>
              {mode === "CORRECT"
                ? "Der OCR-Originalwert bleibt unverändert erhalten."
                : "Vorhandene OCR-Rohdaten bleiben unverändert erhalten."}
            </span>
            <small>
              Diese Eingabe wird{" "}
              {mode === "CORRECT" ? "als manuelle Korrektur" : "als manuelle Ergänzung"}{" "}
              protokolliert.
            </small>
          </aside>

          <form className={styles.form} noValidate onSubmit={handleSubmit}>
            <fieldset className={styles.section} disabled={pending}>
              <legend>Positionsdaten</legend>
              <div className={styles.grid}>
                <div className={styles.fieldCompact}>
                  <div className={styles.field}>
                    <label htmlFor={fieldId("positionNumber")}>
                      Positionsnummer <RequiredMark />
                    </label>
                    <input
                      ref={firstInputRef}
                      id={fieldId("positionNumber")}
                      name="positionNumber"
                      value={draft.positionNumber}
                      required
                      aria-required="true"
                      aria-invalid={Boolean(errors.positionNumber)}
                      aria-describedby={describedBy("positionNumber")}
                      autoComplete="off"
                      onChange={(event) => updateField("positionNumber", event.target.value)}
                    />
                    {errors.positionNumber ? (
                      <span id={errorId("positionNumber")} className={styles.error} role="alert">
                        {errors.positionNumber}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label htmlFor={fieldId("shortDescription")}>
                    Kurzbezeichnung <RequiredMark />
                  </label>
                  <input
                    id={fieldId("shortDescription")}
                    name="shortDescription"
                    value={draft.shortDescription}
                    required
                    aria-required="true"
                    aria-invalid={Boolean(errors.shortDescription)}
                    aria-describedby={describedBy("shortDescription")}
                    autoComplete="off"
                    onChange={(event) => updateField("shortDescription", event.target.value)}
                  />
                  {errors.shortDescription ? (
                    <span id={errorId("shortDescription")} className={styles.error} role="alert">
                      {errors.shortDescription}
                    </span>
                  ) : null}
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label htmlFor={fieldId("description")}>
                    Beschreibung <RequiredMark />
                  </label>
                  <textarea
                    id={fieldId("description")}
                    name="description"
                    value={draft.description}
                    required
                    aria-required="true"
                    aria-invalid={Boolean(errors.description)}
                    aria-describedby={describedBy("description")}
                    onChange={(event) => updateField("description", event.target.value)}
                  />
                  {errors.description ? (
                    <span id={errorId("description")} className={styles.error} role="alert">
                      {errors.description}
                    </span>
                  ) : null}
                </div>

                {kind === "SUPPLIER_LINE" ? (
                  <div className={styles.field}>
                    <label htmlFor={fieldId("articleNumber")}>Artikelnummer</label>
                    <input
                      id={fieldId("articleNumber")}
                      name="articleNumber"
                      value={draft.articleNumber}
                      aria-invalid={Boolean(errors.articleNumber)}
                      aria-describedby={describedBy("articleNumber")}
                      autoComplete="off"
                      onChange={(event) => updateField("articleNumber", event.target.value)}
                    />
                  </div>
                ) : null}
              </div>
            </fieldset>

            <fieldset className={styles.section} disabled={pending}>
              <legend>{kind === "SUPPLIER_LINE" ? "Menge und Preise" : "Menge"}</legend>
              <div className={styles.grid}>
                <div className={`${styles.field} ${styles.fieldCompact}`}>
                  <label htmlFor={fieldId("quantity")}>Menge</label>
                  <input
                    id={fieldId("quantity")}
                    name="quantity"
                    inputMode="decimal"
                    value={draft.quantity}
                    aria-invalid={Boolean(errors.quantity)}
                    aria-describedby={describedBy("quantity")}
                    autoComplete="off"
                    onChange={(event) => updateField("quantity", event.target.value)}
                  />
                  {errors.quantity ? (
                    <span id={errorId("quantity")} className={styles.error} role="alert">
                      {errors.quantity}
                    </span>
                  ) : null}
                </div>

                <div className={`${styles.field} ${styles.fieldCompact}`}>
                  <label htmlFor={fieldId("unit")}>Einheit</label>
                  <input
                    id={fieldId("unit")}
                    name="unit"
                    value={draft.unit}
                    aria-invalid={Boolean(errors.unit)}
                    aria-describedby={describedBy("unit")}
                    autoComplete="off"
                    onChange={(event) => updateField("unit", event.target.value)}
                  />
                  {errors.unit ? (
                    <span id={errorId("unit")} className={styles.error} role="alert">
                      {errors.unit}
                    </span>
                  ) : null}
                </div>

                {kind === "SUPPLIER_LINE" ? (
                  <>
                    <div className={`${styles.field} ${styles.fieldCompact}`}>
                      <label htmlFor={fieldId("unitPrice")}>EP (EUR)</label>
                      <input
                        id={fieldId("unitPrice")}
                        name="unitPrice"
                        inputMode="decimal"
                        value={draft.unitPrice}
                        aria-invalid={Boolean(errors.unitPrice)}
                        aria-describedby={describedBy("unitPrice")}
                        autoComplete="off"
                        onChange={(event) => updateField("unitPrice", event.target.value)}
                      />
                      {errors.unitPrice ? (
                        <span id={errorId("unitPrice")} className={styles.error} role="alert">
                          {errors.unitPrice}
                        </span>
                      ) : null}
                    </div>

                    <div className={`${styles.field} ${styles.fieldCompact}`}>
                      <label htmlFor={fieldId("totalPrice")}>GP (EUR)</label>
                      <input
                        id={fieldId("totalPrice")}
                        name="totalPrice"
                        inputMode="decimal"
                        value={draft.totalPrice}
                        aria-invalid={Boolean(errors.totalPrice)}
                        aria-describedby={describedBy("totalPrice")}
                        autoComplete="off"
                        onChange={(event) => updateField("totalPrice", event.target.value)}
                      />
                      {errors.totalPrice ? (
                        <span id={errorId("totalPrice")} className={styles.error} role="alert">
                          {errors.totalPrice}
                        </span>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </fieldset>

            {kind === "SUPPLIER_LINE" ? (
              <p className={styles.warning} role="note">
                <strong>Preisregel:</strong> Der GP wird nicht automatisch aus Menge × EP berechnet.
                Beide Werte werden so gespeichert, wie sie im Angebot stehen oder manuell eingegeben
                wurden.
              </p>
            ) : null}

            <fieldset className={styles.section} disabled={pending}>
              <legend>Quellstelle im PDF</legend>
              <div className={styles.grid}>
                <div className={`${styles.field} ${styles.fieldCompact}`}>
                  <label htmlFor={fieldId("pageNumber")}>
                    Seite <RequiredMark />
                  </label>
                  <input
                    id={fieldId("pageNumber")}
                    name="pageNumber"
                    type="number"
                    min="1"
                    step="1"
                    value={draft.pageNumber}
                    required
                    aria-required="true"
                    aria-invalid={Boolean(errors.pageNumber)}
                    aria-describedby={describedBy("pageNumber")}
                    onChange={(event) => updateField("pageNumber", event.target.value)}
                  />
                  {errors.pageNumber ? (
                    <span id={errorId("pageNumber")} className={styles.error} role="alert">
                      {errors.pageNumber}
                    </span>
                  ) : null}
                </div>

                <div className={styles.regionGroup}>
                  <span className={styles.regionLabel}>Optionaler Markierungsbereich</span>
                  <span id={`${id}-region-hint`} className={styles.hint}>
                    Normierte Werte von 0 bis 1. Alle vier Felder gemeinsam ausfüllen.
                  </span>
                  <div className={styles.regionGrid}>
                    {(
                      [
                        ["x", "X"],
                        ["y", "Y"],
                        ["width", "Breite"],
                        ["height", "Höhe"]
                      ] as const
                    ).map(([field, label]) => (
                      <div className={styles.field} key={field}>
                        <label htmlFor={fieldId(`region.${field}`)}>{label}</label>
                        <input
                          id={fieldId(`region.${field}`)}
                          name={`region.${field}`}
                          inputMode="decimal"
                          value={draft.region[field]}
                          aria-invalid={Boolean(errors.region)}
                          aria-describedby={describedBy("region", `${id}-region-hint`)}
                          autoComplete="off"
                          onChange={(event) => updateRegion(field, event.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                  {errors.region ? (
                    <span id={errorId("region")} className={styles.error} role="alert">
                      {errors.region}
                    </span>
                  ) : null}
                </div>
              </div>
            </fieldset>

            {submitError ? (
              <p className={styles.submitError} role="alert">
                {submitError}
              </p>
            ) : null}

            <footer className={styles.footer}>
              <button
                className={`${styles.button} ${styles.secondaryButton}`}
                type="button"
                disabled={pending}
                onClick={onCancel}
              >
                Abbrechen
              </button>
              <button
                className={`${styles.button} ${styles.primaryButton}`}
                type="submit"
                disabled={pending}
              >
                {pending ? "Wird gespeichert …" : saveLabel}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );
}
