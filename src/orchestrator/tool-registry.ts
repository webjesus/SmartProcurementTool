import { z } from "zod";
import {
  AgentToolNameSchema,
  RetryPolicySchema,
  type AgentToolName
} from "@/domain/orchestrator";

const BaseInputSchema = z.object({
  projectRunId: z.string(),
  projectId: z.string(),
  idempotencyKey: z.string()
}).strict();

const DocumentInputSchema = BaseInputSchema.extend({
  documentId: z.string(),
  pageNumbers: z.array(z.number().int().positive())
});

const PositionInputSchema = BaseInputSchema.extend({
  basisPositionIds: z.array(z.string())
});

const ToolOutputSchema = z.object({
  status: z.enum(["SUCCEEDED", "CACHED"]),
  artifactIds: z.array(z.string()),
  issueIds: z.array(z.string()),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
}).strict();

export interface AgentToolDefinition {
  name: AgentToolName;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  timeoutMs: number;
  retryPolicy: z.infer<typeof RetryPolicySchema>;
  aiTool: boolean;
  errorClassifications: readonly string[];
}

const defaultRetry = RetryPolicySchema.parse({
  maxAttempts: 2,
  retryableErrors: ["TIMEOUT", "TRANSIENT_PROVIDER", "STORAGE_CONFLICT"],
  backoffMs: 250
});

const aiRetry = RetryPolicySchema.parse({
  maxAttempts: 2,
  retryableErrors: ["TIMEOUT", "RATE_LIMIT", "TRANSIENT_PROVIDER"],
  backoffMs: 1000
});

function tool(
  name: AgentToolName,
  inputSchema: z.ZodType,
  options: Partial<Pick<AgentToolDefinition, "timeoutMs" | "aiTool" | "retryPolicy">> = {}
): AgentToolDefinition {
  return {
    name: AgentToolNameSchema.parse(name),
    inputSchema,
    outputSchema: ToolOutputSchema,
    timeoutMs: options.timeoutMs ?? 30_000,
    retryPolicy: options.retryPolicy ?? defaultRetry,
    aiTool: options.aiTool ?? false,
    errorClassifications: [
      "INVALID_INPUT",
      "TIMEOUT",
      "STORAGE_CONFLICT",
      "DEPENDENCY_BLOCKED",
      "SELF_CHECK_FAILED"
    ]
  };
}

export const AGENT_TOOL_REGISTRY = {
  scanDocuments: tool("scanDocuments", BaseInputSchema),
  preprocessPages: tool("preprocessPages", DocumentInputSchema, { timeoutMs: 120_000 }),
  extractBasis: tool("extractBasis", DocumentInputSchema, {
    timeoutMs: 300_000,
    aiTool: true,
    retryPolicy: aiRetry
  }),
  extractSupplierOffer: tool("extractSupplierOffer", DocumentInputSchema, {
    timeoutMs: 300_000,
    aiTool: true,
    retryPolicy: aiRetry
  }),
  validateExtraction: tool("validateExtraction", DocumentInputSchema),
  retrieveApprovedRules: tool("retrieveApprovedRules", BaseInputSchema),
  retrieveSimilarConfirmedCases: tool("retrieveSimilarConfirmedCases", PositionInputSchema),
  targetedRecheck: tool(
    "targetedRecheck",
    BaseInputSchema.extend({
      issueIds: z.array(z.string()),
      allowedFields: z.array(z.string()),
      lockedFields: z.array(z.string())
    }),
    { timeoutMs: 180_000, aiTool: true, retryPolicy: aiRetry }
  ),
  generateMatchCandidates: tool("generateMatchCandidates", PositionInputSchema),
  validateMatches: tool("validateMatches", PositionInputSchema),
  buildSupplierOptions: tool("buildSupplierOptions", PositionInputSchema),
  calculateRecommendations: tool("calculateRecommendations", PositionInputSchema),
  createReviewIssues: tool("createReviewIssues", PositionInputSchema),
  applyOperatorActions: tool(
    "applyOperatorActions",
    PositionInputSchema.extend({ reviewActionIds: z.array(z.string()) })
  ),
  exportResult: tool("exportResult", BaseInputSchema)
} satisfies Record<AgentToolName, AgentToolDefinition>;

export function getAgentTool(name: AgentToolName): AgentToolDefinition {
  return AGENT_TOOL_REGISTRY[name];
}
