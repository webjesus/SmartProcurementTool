import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildExtractionRequestBody,
  materializeNativeExtraction,
  type ExtractionResult
} from "@/ai/openai-extraction-adapter";
import {
  CompactNativeExtractionSchema,
  ExtractionEnvelopeSchema,
  type ExtractionEnvelope
} from "@/domain/contracts";
import { applyOfferLineReview } from "@/domain/review";
import {
  canonicalizeExtractionEvidence,
  validatePageExtraction
} from "@/domain/validation";
import type { ParsedPage } from "@/domain/repositories";
import {
  LocalPilotPersistence,
  type PersistedPilotRun
} from "@/storage/document-storage";
import { offerLine } from "../fixtures";

const cleanup: string[] = [];

const page: ParsedPage = {
  pageNumber: 7,
  width: 600,
  height: 800,
  mode: "DIGITAL",
  imageCount: 0,
  textItems: [
    {
      id: "ti-native-1",
      rawText: "3 Stück",
      normalizedText: "3 Stück",
      order: 0,
      region: { x: 0.1, y: 0.2, width: 0.2, height: 0.03 }
    }
  ]
};

function envelope(textItemId = "ti-native-1"): ExtractionEnvelope {
  return {
    promptVersion: "supplier-page-extraction-v1",
    schemaVersion: "extraction-contract-v1",
    preprocessingVersion: "pdf-page-v1",
    extraction: {
      documentId: "doc-real",
      pageNumber: 7,
      pageMode: "DIGITAL",
      documentType: "SUPPLIER_OFFER",
      discipline: "HEIZUNG",
      documentMetadataCandidates: [],
      sections: [],
      offerGroups: [
        {
          id: "group-real",
          documentId: "doc-real",
          label: "Angebot",
          adjustments: [],
          evidence: [],
          lines: [
            {
              ...offerLine,
              id: "line-real",
              quantity: 3,
              interpretedUnitPrice: null,
              interpretedTotalPrice: null,
              evidence: [
                {
                  id: "e-real",
                  documentId: "doc-real",
                  pageNumber: 7,
                  textItemIds: [textItemId],
                  sourceText: "model supplied text must not be trusted",
                  region: { x: 0, y: 0, width: 1, height: 1 },
                  cropPath: null,
                  status: "VERIFIED_VISUAL"
                }
              ]
            }
          ]
        }
      ],
      basisPositions: [],
      unresolvedNotes: []
    }
  };
}

function result(value: ExtractionEnvelope): ExtractionResult {
  return {
    envelope: value,
    metadata: {
      modelId: "fake-openai-model",
      responseId: "resp_fake",
      promptVersion: value.promptVersion,
      schemaVersion: value.schemaVersion,
      preprocessingVersion: value.preprocessingVersion,
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 0,
      durationMs: 10,
      attempt: 0,
      estimatedCostUsd: null,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      cacheKey: "cache-fake"
    }
  };
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("real extraction boundary with fake OpenAI response", () => {
  it("materializes compact native IDs into the immutable domain envelope", () => {
    const compact = CompactNativeExtractionSchema.parse({
      metadataCandidates: [],
      sections: [],
      offerGroups: [
        {
          key: "offer",
          label: "Angebot",
          textItemIds: ["ti-native-1"],
          adjustments: [],
          lines: [
            {
              sourcePositionNumber: ["2.1.730"],
              supplierPositionNumber: [],
              description: "Heizungskomponente",
              manufacturer: [],
              articleNumber: [],
              quantity: [3],
              unit: ["Stk"],
              priceBasis: [1],
              currency: ["EUR"],
              moneyCandidates: [],
              interpretedUnitPrice: [],
              interpretedTotalPrice: [],
              role: "PRIMARY",
              groupKey: ["offer"],
              continuation: false,
              completenessStatus: "OFFER_WITHOUT_PRICE",
              completenessReason: ["Kein gedruckter Preis"],
              textItemIds: ["ti-native-1"]
            }
          ]
        }
      ],
      basisPositions: [],
      unresolvedFlags: []
    });
    const materialized = materializeNativeExtraction({
      compact,
      documentId: "doc-real",
      page,
      documentType: "SUPPLIER_OFFER",
      discipline: "HEIZUNG",
      promptVersion: "supplier-native-compact-v2"
    });
    const canonical = canonicalizeExtractionEvidence(materialized, "doc-real", page);
    const line = canonical.extraction.offerGroups[0].lines[0];
    expect(line.sourcePositionNumber).toBe("2.1.730");
    expect(line.articleNumber).toBeNull();
    expect(line.evidence[0].sourceText).toBe(page.textItems[0].rawText);
    expect(line.evidence[0].status).toBe("VERIFIED_NATIVE");
  });

  it("parses the strict response schema", () => {
    const serialized = JSON.stringify(envelope());
    expect(ExtractionEnvelopeSchema.parse(JSON.parse(serialized)).extraction.documentId).toBe(
      "doc-real"
    );
  });

  it("rebuilds native source text and geometry from existing text IDs", () => {
    const canonical = canonicalizeExtractionEvidence(envelope(), "doc-real", page);
    const evidence =
      canonical.extraction.offerGroups[0].lines[0].evidence[0];
    expect(evidence.sourceText).toBe("3 Stück");
    expect(evidence.region.x).toBeCloseTo(page.textItems[0].region.x);
    expect(evidence.region.y).toBeCloseTo(page.textItems[0].region.y);
    expect(evidence.region.width).toBeCloseTo(page.textItems[0].region.width);
    expect(evidence.region.height).toBeCloseTo(page.textItems[0].region.height);
    expect(evidence.status).toBe("VERIFIED_NATIVE");
  });

  it("rejects an invented native evidence ID", () => {
    const canonical = canonicalizeExtractionEvidence(envelope("ti-invented"), "doc-real", page);
    const issues = validatePageExtraction(canonical, page);
    expect(
      canonical.extraction.offerGroups[0].lines[0].evidence[0].status
    ).toBe("CONFLICTING");
    expect(issues.map((issue) => issue.code)).toContain("EVIDENCE_CONFLICTING");
  });

  it("keeps Basis data out of the supplier extraction request", () => {
    const body = buildExtractionRequestBody({ documentId: "doc-real", page });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("basisPositions");
    expect(serialized).not.toContain("Basis-LV");
    expect(body).toHaveProperty("textItems");
  });

  it("persists a run across repository instances", async () => {
    await mkdir(path.resolve(process.cwd(), ".data"), { recursive: true });
    const directory = await mkdtemp(path.resolve(process.cwd(), ".data", "pilot-test-"));
    cleanup.push(directory);
    const run: PersistedPilotRun = {
      id: "run-real",
      document: {
        id: "doc-real",
        relativePath: "confidential.pdf",
        pageNumber: 7,
        pageCount: 10,
        pageMode: "DIGITAL",
        documentType: "SUPPLIER_OFFER",
        discipline: "HEIZUNG"
      },
      result: result(envelope()),
      validationIssues: [],
      pageImageAsset: "pages/run-real.png",
      cropAssets: {},
      recheck: null,
      createdAt: new Date().toISOString()
    };
    await new LocalPilotPersistence(directory, true).saveRun(run);
    const restarted = new LocalPilotPersistence(directory, true);
    expect((await restarted.read()).runs[0].result.metadata.responseId).toBe("resp_fake");
  });

  it("marks an operator correction and locks the field", () => {
    const corrected = applyOfferLineReview(offerLine, {
      id: "action-real",
      issueId: "issue-real",
      entityId: offerLine.id,
      field: "quantity",
      action: "CORRECT",
      previousValue: 3,
      newValue: 4,
      operator: "tester",
      timestamp: new Date().toISOString(),
      reason: "source checked",
      comment: ""
    });
    expect(corrected.quantity).toBe(4);
    expect(corrected.verificationStatus).toBe("HUMAN_CORRECTED");
    expect(corrected.lockedFields).toContain("quantity");
  });
});
