import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ManualPositionEditor,
  manualPositionEditorKeyAction,
  validateManualPositionDraft,
  type ManualPositionEditorDraft
} from "@/components/lv/manual-position-editor";

const validDraft: ManualPositionEditorDraft = {
  positionNumber: " 1.2.30 ",
  shortDescription: " Umwälzpumpe ",
  description: " Hocheffizienzpumpe für einen synthetischen Testfall. ",
  articleNumber: " TEST-4711 ",
  quantity: "3",
  unit: "Stk",
  unitPrice: "49,90",
  totalPrice: "170,00",
  pageNumber: "4",
  region: {
    x: "0,10",
    y: "0,20",
    width: "0,50",
    height: "0,25"
  }
};

function supplierMarkup(): string {
  return renderToStaticMarkup(
    <ManualPositionEditor
      mode="CORRECT"
      kind="SUPPLIER_LINE"
      initialValues={{
        positionNumber: "1.2.30",
        shortDescription: "Umwälzpumpe",
        description: "Durch OCR gelesener Ausgangstext",
        articleNumber: "TEST-4711",
        quantity: 3,
        unit: "Stk",
        unitPrice: 49.9,
        totalPrice: 170,
        pageNumber: 4
      }}
      onCancel={vi.fn()}
      onSubmit={vi.fn()}
    />
  );
}

describe("ManualPositionEditor", () => {
  it("renders a keyboard-operable German correction form with connected field labels", () => {
    const markup = supplierMarkup();

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("OCR-Position manuell korrigieren");
    expect(markup).toContain("Angebotsposition");
    expect(markup).toContain("Positionsnummer");
    expect(markup).toContain("Kurzbezeichnung");
    expect(markup).toContain("Beschreibung");
    expect(markup).toContain("Artikelnummer");
    expect(markup).toContain("Menge");
    expect(markup).toContain("Einheit");
    expect(markup).toContain("EP (EUR)");
    expect(markup).toContain("GP (EUR)");
    expect(markup).toContain("Seite");
    expect(markup).toContain("Optionaler Markierungsbereich");
    expect(markup).toMatch(/<label[^>]+for="[^"]+"[^>]*>Positionsnummer/);
    expect(markup).toMatch(/<input[^>]+id="[^"]+"[^>]+name="positionNumber"/);
    expect(markup).toContain('aria-required="true"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain("Abbrechen");
    expect(markup).toContain("Korrektur speichern");
  });

  it("states the price and provenance rules without implying fabricated OCR certainty", () => {
    const markup = supplierMarkup();

    expect(markup).toContain("Der GP wird nicht automatisch aus Menge × EP berechnet.");
    expect(markup).toContain("Der OCR-Originalwert bleibt unverändert erhalten.");
    expect(markup).toContain("als manuelle Korrektur protokolliert");
  });

  it("hides the supplier-only article number for a Basis-LV position", () => {
    const markup = renderToStaticMarkup(
      <ManualPositionEditor
        mode="ADD"
        kind="BASIS_POSITION"
        initialValues={{}}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(markup).toContain("Position manuell hinzufügen");
    expect(markup).toContain("Basis-LV-Position");
    expect(markup).not.toContain("Artikelnummer");
    expect(markup).not.toContain("EP (EUR)");
    expect(markup).not.toContain("GP (EUR)");
    expect(markup).not.toContain("Preisregel:");
    expect(markup).toContain("Position hinzufügen");
  });

  it("ignores supplier-only prices when validating a Basis-LV position", () => {
    const result = validateManualPositionDraft({
      mode: "ADD",
      kind: "BASIS_POSITION",
      draft: {
        ...validDraft,
        articleNumber: "wird nicht übernommen",
        unitPrice: "kein Preis",
        totalPrice: "-99"
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a valid Basis draft");
    expect(result.value.articleNumber).toBeNull();
    expect(result.value.unitPrice).toBeNull();
    expect(result.value.totalPrice).toBeNull();
  });

  it("normalizes German decimal input and returns explicit manual provenance", () => {
    const result = validateManualPositionDraft({
      mode: "CORRECT",
      kind: "SUPPLIER_LINE",
      draft: validDraft
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a valid draft");
    expect(result.value).toEqual({
      mode: "CORRECT",
      kind: "SUPPLIER_LINE",
      positionNumber: "1.2.30",
      shortDescription: "Umwälzpumpe",
      description: "Hocheffizienzpumpe für einen synthetischen Testfall.",
      articleNumber: "TEST-4711",
      quantity: 3,
      unit: "Stk",
      unitPrice: 49.9,
      totalPrice: 170,
      pageNumber: 4,
      region: { x: 0.1, y: 0.2, width: 0.5, height: 0.25 },
      provenance: {
        method: "MANUAL",
        action: "CORRECT",
        originalOcrPreserved: true
      }
    });
  });

  it("reports field-specific errors for missing identity, invalid prices and partial regions", () => {
    const result = validateManualPositionDraft({
      mode: "ADD",
      kind: "SUPPLIER_LINE",
      draft: {
        ...validDraft,
        positionNumber: "",
        shortDescription: "",
        description: "",
        quantity: "0",
        unit: "",
        unitPrice: "-1",
        totalPrice: "unlesbar",
        pageNumber: "0",
        region: { x: "0.1", y: "", width: "0.5", height: "0.2" }
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected validation errors");
    expect(result.errors).toMatchObject({
      positionNumber: "Positionsnummer ist erforderlich.",
      shortDescription: "Kurzbezeichnung ist erforderlich.",
      description: "Beschreibung ist erforderlich.",
      quantity: "Menge muss größer als 0 sein.",
      unit: "Einheit ist bei angegebener Menge erforderlich.",
      unitPrice: "EP darf nicht negativ sein.",
      totalPrice: "GP muss eine gültige Zahl sein.",
      pageNumber: "Seite muss eine ganze Zahl ab 1 sein.",
      region: "Markierungsbereich vollständig oder gar nicht ausfüllen."
    });
  });

  it("rejects normalized rectangles that leave the PDF page", () => {
    const result = validateManualPositionDraft({
      mode: "CORRECT",
      kind: "BASIS_POSITION",
      draft: {
        ...validDraft,
        articleNumber: "",
        region: { x: "0.8", y: "0.2", width: "0.3", height: "0.2" }
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected validation errors");
    expect(result.errors.region).toBe(
      "Markierungsbereich muss vollständig innerhalb der PDF-Seite liegen."
    );
  });

  it("maps Escape to cancel while leaving other keys to native form controls", () => {
    expect(manualPositionEditorKeyAction("Escape")).toBe("CANCEL");
    expect(manualPositionEditorKeyAction("Enter")).toBeNull();
    expect(manualPositionEditorKeyAction("Tab")).toBeNull();
  });
});
