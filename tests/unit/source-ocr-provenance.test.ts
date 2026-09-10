import { describe, expect, it } from "vitest";
import {
  sourceOcrLabel,
  sourceUsesOcr
} from "@/components/lv/source-overlay";
import type { SourceRecord } from "@/components/lv/types";

function sourceWithTextItemIds(textItemIds: string[]): SourceRecord {
  return {
    key: "supplier:line-1",
    kind: "supplier",
    tabLabel: "Angebot",
    documentId: "offer-1",
    documentRevisionId: "revision-1",
    documentLabel: "Angebot.pdf",
    pageNumber: 2,
    pageCount: 3,
    evidence: [
      {
        id: "evidence-1",
        documentId: "offer-1",
        pageNumber: 2,
        textItemIds,
        sourceText: "Pumpe WHI",
        region: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
        cropPath: null,
        status: "VISUAL_ONLY_UNCONFIRMED"
      }
    ],
    positionNumber: "1.1.160",
    title: "Pumpe WHI",
    description: "Pumpe WHI",
    quantity: 1,
    unit: "St",
    context: []
  };
}

describe("OCR provenance in the source viewer", () => {
  it("detects OCR evidence by its measured OCR word identifiers", () => {
    expect(sourceUsesOcr(sourceWithTextItemIds(["ocr-word:42"]))).toBe(true);
  });

  it("does not label native PDF text as OCR", () => {
    expect(sourceUsesOcr(sourceWithTextItemIds(["pdf-text:42"]))).toBe(false);
  });

  it("uses an explicit German OCR review label until a person confirms the source", () => {
    expect(sourceOcrLabel(sourceWithTextItemIds(["ocr-word:42"]))).toBe(
      "OCR · manuell prüfen"
    );
    const confirmed = sourceWithTextItemIds(["ocr-word:42"]);
    confirmed.evidence[0]!.status = "VERIFIED_VISUAL";
    expect(sourceOcrLabel(confirmed)).toBe("OCR · manuell bestätigt");
    expect(sourceOcrLabel(sourceWithTextItemIds(["pdf-text:42"]))).toBeNull();
  });
});
