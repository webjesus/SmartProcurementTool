import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  BASIS_PROMPT_VERSION,
  CompactNativeExtractionSchema,
  ExtractionEnvelopeSchema,
  PREPROCESSING_VERSION,
  PROMPT_VERSION,
  RECHECK_PROMPT_VERSION,
  SCHEMA_VERSION,
  TargetedRecheckSchema,
  type CompactNativeExtraction,
  type Discipline,
  type DocumentType,
  type ExtractionEnvelope,
  type TargetedRecheck
} from "@/domain/contracts";
import type { OpenAiExtractionAdapter, ParsedPage } from "@/domain/repositories";
import {
  BASIS_EXTRACTION_SYSTEM_PROMPT,
  SUPPLIER_EXTRACTION_SYSTEM_PROMPT,
  TARGETED_RECHECK_SYSTEM_PROMPT
} from "@/ai/prompts";

export interface AiRunMetadata {
  modelId: string;
  responseId: string | null;
  promptVersion: string;
  schemaVersion: string;
  preprocessingVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  durationMs: number;
  attempt: number;
  estimatedCostUsd: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string;
  cacheKey: string;
  extractedLineCount?: number;
  inputTokensPerPage?: number | null;
  outputTokensPerExtractedLine?: number | null;
  costPerExtractedLineUsd?: number | null;
}

export interface ExtractionResult {
  envelope: ExtractionEnvelope;
  metadata: AiRunMetadata;
}

export interface RecheckResult {
  result: TargetedRecheck;
  metadata: AiRunMetadata;
}

export function buildExtractionRequestBody(input: {
  documentId: string;
  page: ParsedPage;
  includeDocumentMetadata?: boolean;
}) {
  return {
    documentId: input.documentId,
    pageNumber: input.page.pageNumber,
    pageMode: input.page.mode,
    includeDocumentMetadata: input.includeDocumentMetadata ?? true,
    ...(input.page.mode === "SCAN"
      ? {}
      : {
          textItems: input.page.textItems.map((item) => ({
            id: item.id,
            text: item.rawText,
            order: item.order,
            region: item.region
          }))
        })
  };
}

function stableId(prefix: string, ...parts: unknown[]): string {
  return `${prefix}_${createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 18)}`;
}

function first<T>(values: T[]): T | null {
  return values[0] ?? null;
}

function compactEvidence(
  documentId: string,
  pageNumber: number,
  textItemIds: string[],
  key: string
) {
  return [
    {
      id: stableId("evidence", documentId, pageNumber, key, textItemIds),
      documentId,
      pageNumber,
      textItemIds,
      sourceText: "",
      region: { x: 0, y: 0, width: 0, height: 0 },
      cropPath: null,
      status: "VERIFIED_NATIVE" as const
    }
  ];
}

export function materializeNativeExtraction(input: {
  compact: CompactNativeExtraction;
  documentId: string;
  page: ParsedPage;
  documentType: DocumentType;
  discipline: Discipline;
  promptVersion: string;
}): ExtractionEnvelope {
  const { compact, documentId, page } = input;
  const sectionIds = new Map(
    compact.sections.map((section, index) => [
      section.key,
      stableId("section", documentId, page.pageNumber, index, section.key, section.label)
    ])
  );
  const groupIds = new Map(
    compact.offerGroups.map((group, index) => [
      group.key,
      stableId("group", documentId, page.pageNumber, index, group.key, group.label)
    ])
  );

  return {
    promptVersion: input.promptVersion,
    schemaVersion: SCHEMA_VERSION,
    preprocessingVersion: PREPROCESSING_VERSION,
    extraction: {
      documentId,
      pageNumber: page.pageNumber,
      pageMode: page.mode,
      documentType: input.documentType,
      discipline: input.discipline,
      documentMetadataCandidates: compact.metadataCandidates.map((candidate, index) => ({
        id: stableId("metadata", documentId, page.pageNumber, index, candidate.field),
        field: candidate.field,
        value: candidate.value,
        confidence: candidate.confidence,
        evidence: compactEvidence(
          documentId,
          page.pageNumber,
          candidate.textItemIds,
          `metadata:${index}`
        )
      })),
      sections: compact.sections.map((section, index) => ({
        id: sectionIds.get(section.key)!,
        parentId: section.parentKey[0]
          ? (sectionIds.get(section.parentKey[0]) ?? null)
          : null,
        label: section.label,
        kind: section.kind,
        evidence: compactEvidence(
          documentId,
          page.pageNumber,
          section.textItemIds,
          `section:${index}`
        )
      })),
      offerGroups: compact.offerGroups.map((group, groupIndex) => {
        const groupId = groupIds.get(group.key)!;
        return {
          id: groupId,
          documentId,
          label: group.label,
          lines: group.lines.map((line, lineIndex) => ({
            id: stableId(
              "line",
              documentId,
              page.pageNumber,
              groupIndex,
              lineIndex,
              line.sourcePositionNumber,
              line.supplierPositionNumber,
              line.description
            ),
            sourcePositionNumber: first(line.sourcePositionNumber),
            supplierPositionNumber: first(line.supplierPositionNumber),
            description: line.description,
            manufacturer: first(line.manufacturer),
            articleNumber: first(line.articleNumber),
            quantity: first(line.quantity),
            unit: first(line.unit),
            priceBasis: first(line.priceBasis),
            currency: first(line.currency),
            moneyCandidates: line.moneyCandidates.map((money, moneyIndex) => ({
              id: stableId("money", documentId, page.pageNumber, groupIndex, lineIndex, moneyIndex),
              kind: money.kind,
              rawValue: money.rawValue,
              amount: first(money.amount),
              currency: first(money.currency),
              priceBasis: first(money.priceBasis),
              evidence: compactEvidence(
                documentId,
                page.pageNumber,
                money.textItemIds,
                `money:${groupIndex}:${lineIndex}:${moneyIndex}`
              )
            })),
            interpretedUnitPrice: first(line.interpretedUnitPrice),
            interpretedTotalPrice: first(line.interpretedTotalPrice),
            role: line.role,
            groupId: line.groupKey[0]
              ? (groupIds.get(line.groupKey[0]) ??
                stableId("relation", documentId, page.pageNumber, line.groupKey[0]))
              : groupId,
            continuation: line.continuation,
            evidence: compactEvidence(
              documentId,
              page.pageNumber,
              line.textItemIds,
              `line:${groupIndex}:${lineIndex}`
            ),
            verificationStatus: "NEEDS_REVIEW" as const,
            lockedFields: [],
            completenessStatus: line.completenessStatus,
            completenessReason: line.completenessReason[0] ?? ""
          })),
          adjustments: group.adjustments.map((adjustment, adjustmentIndex) => ({
            id: stableId(
              "adjustment",
              documentId,
              page.pageNumber,
              groupIndex,
              adjustmentIndex
            ),
            kind: adjustment.kind,
            label: adjustment.label,
            percentage: first(adjustment.percentage),
            amount: first(adjustment.amount),
            evidence: compactEvidence(
              documentId,
              page.pageNumber,
              adjustment.textItemIds,
              `adjustment:${groupIndex}:${adjustmentIndex}`
            )
          })),
          evidence:
            group.textItemIds.length > 0
              ? compactEvidence(
                  documentId,
                  page.pageNumber,
                  group.textItemIds,
                  `group:${groupIndex}`
                )
              : []
        };
      }),
      basisPositions: compact.basisPositions.map((position, index) => ({
        id: stableId(
          "basis",
          documentId,
          page.pageNumber,
          index,
          position.positionNumber,
          position.description
        ),
        documentId,
        parentId: position.parentKey[0]
          ? (sectionIds.get(position.parentKey[0]) ?? null)
          : null,
        positionNumber: position.positionNumber,
        description: position.description,
        quantity: first(position.quantity),
        unit: first(position.unit),
        technicalAttributes: position.technicalAttributes,
        manufacturerRequirements: position.manufacturerRequirements,
        requiredScope: position.requiredScope,
        notes: position.notes,
        optional: position.optional,
        alternative: position.alternative,
        heading: position.heading,
        evidence: compactEvidence(
          documentId,
          page.pageNumber,
          position.textItemIds,
          `basis:${index}`
        ),
        verificationStatus: "NEEDS_REVIEW" as const
      })),
      unresolvedNotes: compact.unresolvedFlags
    }
  };
}

function estimateGpt56SolCost(
  inputTokens: number | null,
  outputTokens: number | null,
  cachedTokens: number | null
): number | null {
  if (inputTokens === null || outputTokens === null) return null;
  const cached = Math.max(0, cachedTokens ?? 0);
  const uncached = Math.max(0, inputTokens - cached);
  return (uncached * 5 + cached * 0.5 + outputTokens * 30) / 1_000_000;
}

export function createExtractionCacheKey(input: {
  promptVersion: string;
  schemaVersion: string;
  preprocessingVersion: string;
  model: string;
  source: unknown;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

export class OfficialOpenAiExtractionAdapter implements OpenAiExtractionAdapter {
  private readonly client: OpenAI;
  private readonly extractionModel: string;
  private readonly recheckModel: string;
  private readonly maxOutputTokens: number;
  private readonly semaphore: Semaphore;

  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not configured. Corpus scanning remains available without OpenAI."
      );
    }
    this.client = new OpenAI({
      apiKey,
      timeout: 90_000,
      maxRetries: 2
    });
    this.extractionModel = process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-5.6-sol";
    this.recheckModel = process.env.OPENAI_RECHECK_MODEL ?? this.extractionModel;
    this.maxOutputTokens = Number(process.env.SPT_MAX_OUTPUT_TOKENS ?? 6_000);
    this.semaphore = new Semaphore(Number(process.env.SPT_MAX_CONCURRENT_REQUESTS ?? 2));
  }

  async extractPage(input: {
    documentId: string;
    page: ParsedPage;
    pageImageDataUrl?: string;
  }): Promise<ExtractionEnvelope> {
    return (await this.extractPageWithMetadata(input)).envelope;
  }

  async extractPageWithMetadata(input: {
    documentId: string;
    page: ParsedPage;
    pageImageDataUrl?: string;
    documentType?: DocumentType;
    discipline?: Discipline;
    includeDocumentMetadata?: boolean;
  }): Promise<ExtractionResult> {
    const requestBody = buildExtractionRequestBody(input);
    const content: OpenAI.Responses.ResponseInputContent[] = [
      {
        type: "input_text",
        text: JSON.stringify(requestBody)
      }
    ];

    if (input.pageImageDataUrl) {
      content.push({
        type: "input_image",
        image_url: input.pageImageDataUrl,
        detail: "high"
      });
    }

    if (input.page.mode === "SCAN") {
      return this.runStructured({
        model: this.extractionModel,
        promptVersion: PROMPT_VERSION,
        systemPrompt: SUPPLIER_EXTRACTION_SYSTEM_PROMPT,
        content,
        cacheSource: requestBody
      });
    }
    return this.runNativeStructured({
      model: this.extractionModel,
      promptVersion: PROMPT_VERSION,
      systemPrompt: SUPPLIER_EXTRACTION_SYSTEM_PROMPT,
      content,
      cacheSource: requestBody,
      documentId: input.documentId,
      page: input.page,
      documentType: input.documentType ?? "SUPPLIER_OFFER",
      discipline: input.discipline ?? "UNKNOWN"
    });
  }

  async recheckIssue(input: {
    issueCodes: string[];
    allowedFields: string[];
    lockedFields: string[];
    fragmentText: string;
    headerText: string;
    neighboringRows: string[];
    cropDataUrl?: string;
  }): Promise<TargetedRecheck> {
    return (await this.recheckIssueWithMetadata(input)).result;
  }

  async recheckIssueWithMetadata(input: {
    issueCodes: string[];
    allowedFields: string[];
    lockedFields: string[];
    fragmentText: string;
    headerText: string;
    neighboringRows: string[];
    cropDataUrl?: string;
  }): Promise<RecheckResult> {
    const allowedFields = input.allowedFields.filter(
      (field) => !input.lockedFields.includes(field)
    );
    const content: OpenAI.Responses.ResponseInputContent[] = [
      {
        type: "input_text",
        text: JSON.stringify({
          issueCodes: input.issueCodes,
          allowedFields,
          lockedFields: input.lockedFields,
          fragmentText: input.fragmentText,
          headerText: input.headerText,
          neighboringRows: input.neighboringRows
        })
      }
    ];
    if (input.cropDataUrl) {
      content.push({
        type: "input_image",
        image_url: input.cropDataUrl,
        detail: "high"
      });
    }

    const startedAt = new Date();
    const cacheSource = {
      issueCodes: input.issueCodes,
      allowedFields,
      lockedFields: input.lockedFields,
      fragmentText: input.fragmentText,
      headerText: input.headerText,
      neighboringRows: input.neighboringRows
    };
    const cacheKey = createExtractionCacheKey({
      promptVersion: RECHECK_PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      preprocessingVersion: PREPROCESSING_VERSION,
      model: this.recheckModel,
      source: cacheSource
    });
    const response = await this.semaphore.run(() =>
      this.client.responses.parse({
        model: this.recheckModel,
        instructions: TARGETED_RECHECK_SYSTEM_PROMPT,
        input: [{ role: "user", content }],
        text: {
          format: zodTextFormat(TargetedRecheckSchema, "procurement_targeted_recheck")
        },
        reasoning: { effort: "low" },
        max_output_tokens: Math.min(this.maxOutputTokens, 4_000),
        store: false
      })
    );
    const completedAt = new Date();
    if (!response.output_parsed) throw new Error("OpenAI returned no structured recheck.");
    return {
      result: response.output_parsed,
      metadata: {
        modelId: this.recheckModel,
        responseId: response.id ?? null,
        promptVersion: RECHECK_PROMPT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        preprocessingVersion: PREPROCESSING_VERSION,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        cachedTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        attempt: 1,
        estimatedCostUsd: null,
        error: null,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        cacheKey
      }
    };
  }

  async extractBasisPageWithMetadata(input: {
    documentId: string;
    page: ParsedPage;
    pageImageDataUrl?: string;
    documentType?: DocumentType;
    discipline?: Discipline;
    includeDocumentMetadata?: boolean;
  }): Promise<ExtractionResult> {
    const requestBody = buildExtractionRequestBody(input);
    const content: OpenAI.Responses.ResponseInputContent[] = [
      { type: "input_text", text: JSON.stringify(requestBody) }
    ];
    if (input.pageImageDataUrl) {
      content.push({
        type: "input_image",
        image_url: input.pageImageDataUrl,
        detail: "high"
      });
    }
    return this.runNativeStructured({
      model: this.extractionModel,
      promptVersion: BASIS_PROMPT_VERSION,
      systemPrompt: BASIS_EXTRACTION_SYSTEM_PROMPT,
      content,
      cacheSource: requestBody,
      documentId: input.documentId,
      page: input.page,
      documentType: input.documentType ?? "BASIS_LV",
      discipline: input.discipline ?? "UNKNOWN"
    });
  }

  private async runNativeStructured(input: {
    model: string;
    promptVersion: string;
    systemPrompt: string;
    content: OpenAI.Responses.ResponseInputContent[];
    cacheSource: unknown;
    documentId: string;
    page: ParsedPage;
    documentType: DocumentType;
    discipline: Discipline;
  }): Promise<ExtractionResult> {
    return this.semaphore.run(async () => {
      const startedAt = new Date();
      const cacheKey = createExtractionCacheKey({
        promptVersion: input.promptVersion,
        schemaVersion: SCHEMA_VERSION,
        preprocessingVersion: PREPROCESSING_VERSION,
        model: input.model,
        source: input.cacheSource
      });
      const response = await this.client.responses.parse({
        model: input.model,
        instructions: input.systemPrompt,
        input: [{ role: "user", content: input.content }],
        text: {
          format: zodTextFormat(CompactNativeExtractionSchema, "procurement_native_compact"),
          verbosity: "low"
        },
        reasoning: { effort: "low" },
        max_output_tokens: this.maxOutputTokens,
        store: false
      });
      const completedAt = new Date();
      if (!response.output_parsed) {
        throw new Error("OpenAI returned no compact structured extraction.");
      }
      const envelope = materializeNativeExtraction({
        compact: response.output_parsed,
        documentId: input.documentId,
        page: input.page,
        documentType: input.documentType,
        discipline: input.discipline,
        promptVersion: input.promptVersion
      });
      const extractedLineCount =
        envelope.extraction.offerGroups.reduce((sum, group) => sum + group.lines.length, 0) +
        envelope.extraction.basisPositions.filter((position) => !position.heading).length;
      const inputTokens = response.usage?.input_tokens ?? null;
      const outputTokens = response.usage?.output_tokens ?? null;
      const cachedTokens = response.usage?.input_tokens_details?.cached_tokens ?? null;
      const cost = estimateGpt56SolCost(inputTokens, outputTokens, cachedTokens);
      return {
        envelope,
        metadata: {
          modelId: input.model,
          responseId: response.id ?? null,
          promptVersion: input.promptVersion,
          schemaVersion: SCHEMA_VERSION,
          preprocessingVersion: PREPROCESSING_VERSION,
          inputTokens,
          outputTokens,
          cachedTokens,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          attempt: 0,
          estimatedCostUsd: cost,
          error: null,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          cacheKey,
          extractedLineCount,
          inputTokensPerPage: inputTokens,
          outputTokensPerExtractedLine:
            extractedLineCount > 0 && outputTokens !== null ? outputTokens / extractedLineCount : null,
          costPerExtractedLineUsd:
            extractedLineCount > 0 && cost !== null ? cost / extractedLineCount : null
        }
      };
    });
  }

  private async runStructured(input: {
    model: string;
    promptVersion: string;
    systemPrompt: string;
    content: OpenAI.Responses.ResponseInputContent[];
    cacheSource: unknown;
  }): Promise<ExtractionResult> {
    return this.semaphore.run(async () => {
      const startedAt = new Date();
      const cacheKey = createExtractionCacheKey({
        promptVersion: input.promptVersion,
        schemaVersion: SCHEMA_VERSION,
        preprocessingVersion: PREPROCESSING_VERSION,
        model: input.model,
        source: input.cacheSource
      });

      const response = await this.client.responses.parse({
        model: input.model,
        instructions: input.systemPrompt,
        input: [{ role: "user", content: input.content }],
        text: {
          format: zodTextFormat(ExtractionEnvelopeSchema, "procurement_page_extraction")
        },
        reasoning: { effort: "low" },
        max_output_tokens: this.maxOutputTokens,
        store: false
      });
      const completedAt = new Date();

      if (!response.output_parsed) {
        throw new Error("OpenAI returned no structured extraction.");
      }

      return {
        envelope: response.output_parsed,
        metadata: {
          modelId: input.model,
          responseId: response.id ?? null,
          promptVersion: input.promptVersion,
          schemaVersion: SCHEMA_VERSION,
          preprocessingVersion: PREPROCESSING_VERSION,
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null,
          cachedTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          attempt: 0,
          estimatedCostUsd: null,
          error: null,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          cacheKey
        }
      };
    });
  }
}
