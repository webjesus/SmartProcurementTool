import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocumentRevisionIndex } from "@/domain/decision";
import { buildSupplierCorpusAudit } from "@/domain/supplier-corpus-audit";
import { LocalPilotPersistence } from "@/storage/document-storage";

const localState = path.resolve(".data", "pilot-state.local.json");

describe.skipIf(!existsSync(localState))("real Heizung supplier corpus audit", () => {
  it("audits all 188 positions without critical corrected-read-model inconsistencies", async () => {
    const persistence = new LocalPilotPersistence(
      path.resolve(".data"),
      true
    );
    const state = await persistence.read();
    const audit = buildSupplierCorpusAudit({
      state,
      documentRevisions: buildDocumentRevisionIndex(state.runs)
    });
    expect(audit.after.basisPositions).toBe(188);
    expect(audit.after.supplierOptions).toBe(613);
    expect(audit.after.gpPresentButUiNoPrice).toBe(0);
    expect(audit.after.sourceLinksMissing).toBe(0);
    expect(audit.after.sourceLinksWrongPage).toBe(0);
    expect(audit.after.orphanSupplierOptionLines).toBe(0);
    expect(audit.after.orphanEvidenceReferences).toBe(0);
    expect(audit.after.duplicateSidebarItems).toBe(0);
    expect(audit.after.roleClassificationAnomalies).toBe(0);
    expect(audit.after.criticalInconsistencies).toBe(0);
    expect(
      Object.values(audit.operatorWorkspace.basisStructureCounts).reduce(
        (sum, count) => sum + count,
        0
      )
    ).toBe(188);
    expect(
      Object.values(audit.operatorWorkspace.selectionModeCounts).reduce(
        (sum, count) => sum + count,
        0
      )
    ).toBe(188);
    expect(audit.operatorWorkspace.basisStructureVersion).toBe(
      "basis-structure-interpretation-v1"
    );
    expect(audit.operatorWorkspace.optionReadModelVersion).toBe(
      "operator-supplier-option-read-model-v1"
    );
    expect(
      audit.rows.filter(
        (row) =>
          row.selectable &&
          row.optionValidity !== "REAL_SELECTABLE_OPTION" &&
          row.optionValidity !== "REAL_OPTION_PRICE_MISSING"
      )
    ).toHaveLength(0);
  });

  it(
    "loads every referenced supplier PDF page used by the corrected read model",
    async () => {
      const persistence = new LocalPilotPersistence(
        path.resolve(".data"),
        true
      );
      const state = await persistence.read();
      const audit = buildSupplierCorpusAudit({
        state,
        documentRevisions: buildDocumentRevisionIndex(state.runs)
      });
      const pagesByDocument = new Map<string, Set<number>>();
      for (const row of audit.rows) {
        if (
          !row.supplierOptionId ||
          !row.sourcePage ||
          row.sourceAvailability === "INVALID"
        ) {
          continue;
        }
        const pages = pagesByDocument.get(row.sourceDocument) ?? new Set<number>();
        pages.add(row.sourcePage);
        pagesByDocument.set(row.sourceDocument, pages);
      }

      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      let renderedPageCount = 0;
      for (const [relativePath, pages] of pagesByDocument) {
        const documentPath = path.resolve("pdffirma", relativePath);
        expect(existsSync(documentPath), documentPath).toBe(true);
        const bytes = await readFile(documentPath);
        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(bytes)
        });
        const document = await loadingTask.promise;
        try {
          for (const pageNumber of pages) {
            expect(pageNumber).toBeGreaterThanOrEqual(1);
            expect(pageNumber).toBeLessThanOrEqual(document.numPages);
            const page = await document.getPage(pageNumber);
            const operatorList = await page.getOperatorList();
            expect(operatorList.fnArray.length).toBeGreaterThan(0);
            renderedPageCount += 1;
            page.cleanup();
          }
        } finally {
          await loadingTask.destroy();
        }
      }
      expect(pagesByDocument.size).toBe(4);
      expect(renderedPageCount).toBeGreaterThan(0);
    },
    120_000
  );
});
