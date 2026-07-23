import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  BASIS_PROMPT_VERSION,
  ExtractionEnvelopeSchema,
  PREPROCESSING_VERSION,
  PROMPT_VERSION,
  RECHECK_PROMPT_VERSION,
  SCHEMA_VERSION,
  TargetedRecheckSchema,
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
}) {
  return {
    documentId: input.documentId,
    pageNumber: input.page.pageNumber,
    pageMode: input.page.mode,
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
    this.extractionModel = process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-5.6";
    this.recheckModel = process.env.OPENAI_RECHECK_MODEL ?? this.extractionModel;
    this.maxOutputTokens = Number(process.env.SPT_MAX_OUTPUT_TOKENS ?? 12_000);
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

    return this.runStructured({
      model: this.extractionModel,
      promptVersion: PROMPT_VERSION,
      systemPrompt: SUPPLIER_EXTRACTION_SYSTEM_PROMPT,
      content,
      cacheSource: requestBody
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
    return this.runStructured({
      model: this.extractionModel,
      promptVersion: BASIS_PROMPT_VERSION,
      systemPrompt: BASIS_EXTRACTION_SYSTEM_PROMPT,
      content,
      cacheSource: requestBody
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
