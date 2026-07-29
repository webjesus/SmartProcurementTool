import { z } from "zod";

export const DecisionOutcomeSchema = z.enum([
  "SELECTED",
  "NONE_CORRECT",
  "DEFERRED",
  "ADDITIONAL_CHECK_REQUESTED"
]);
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;

export const DecisionDisplayNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .refine(
    (value) => (value.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2,
    "Der Anzeigename muss mindestens zwei aussagekräftige Zeichen enthalten."
  );

export const DecisionDraftRecordSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().min(1),
  positionId: z.string().min(1),
  userId: z.string().uuid(),
  selectedSupplierOptionId: z.string().min(1).nullable(),
  selectedBundleLineIds: z.array(z.string().min(1)),
  rejectedOptionIds: z.array(z.string().min(1)),
  reasonCodes: z.array(z.string().min(1)),
  outcome: DecisionOutcomeSchema.nullable(),
  comment: z.string(),
  analysisVersionId: z.string().min(1),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  updatedBy: z.string().uuid(),
  updatedByDisplayName: z.string().min(1),
  deviceSessionId: z.string().min(1)
});
export type DecisionDraftRecord = z.infer<typeof DecisionDraftRecordSchema>;

export const SaveDecisionDraftInputSchema = z.object({
  selectedSupplierOptionId: z.string().min(1).nullable(),
  selectedBundleLineIds: z.array(z.string().min(1)),
  rejectedOptionIds: z.array(z.string().min(1)).default([]),
  reasonCodes: z.array(z.string().min(1)).default([]),
  outcome: DecisionOutcomeSchema.nullable(),
  comment: z.string(),
  analysisVersionId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative().nullable(),
  deviceSessionId: z.string().min(1)
});
export type SaveDecisionDraftInput = z.infer<
  typeof SaveDecisionDraftInputSchema
>;

export const CentralSupplierDecisionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().min(1),
  positionId: z.string().min(1),
  selectedSupplierOptionId: z.string().min(1).nullable(),
  selectedBundleLineIds: z.array(z.string().min(1)),
  rejectedOptionIds: z.array(z.string().min(1)),
  outcome: DecisionOutcomeSchema,
  reasonCodes: z.array(z.string().min(1)),
  comment: z.string(),
  decidedBy: z.string().uuid(),
  decidedByDisplayName: z.string().min(1),
  decidedAt: z.string().datetime(),
  previousDecisionId: z.string().uuid().nullable(),
  analysisVersionId: z.string().min(1),
  decisionVersion: z.number().int().positive(),
  decisionType: z.enum([
    "MANUAL_SELECTION",
    "AUTOMATIC_OVERRIDE",
    "DEFERRED",
    "NONE_CORRECT",
    "ADDITIONAL_CHECK_REQUESTED"
  ]),
  contextSnapshot: z.unknown(),
  evidenceSnapshot: z.unknown(),
  documentRevisionIds: z.array(z.string()),
  createdAt: z.string().datetime()
});
export type CentralSupplierDecision = z.infer<
  typeof CentralSupplierDecisionSchema
>;

export const CreateCentralDecisionInputSchema = z.object({
  selectedSupplierOptionId: z.string().min(1).nullable(),
  selectedBundleLineIds: z.array(z.string().min(1)),
  rejectedOptionIds: z.array(z.string().min(1)).default([]),
  outcome: DecisionOutcomeSchema,
  reasonCodes: z.array(z.string().min(1)).default([]),
  comment: z.string(),
  analysisVersionId: z.string().min(1),
  expectedDecisionVersion: z.number().int().nonnegative(),
  decisionType: CentralSupplierDecisionSchema.shape.decisionType
});
export type CreateCentralDecisionInput = z.infer<
  typeof CreateCentralDecisionInputSchema
>;

export const DecisionEventRecordSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().min(1),
  positionId: z.string().min(1),
  decisionId: z.string().uuid().nullable(),
  draftId: z.string().uuid().nullable(),
  eventType: z.string().min(1),
  actorId: z.string().uuid(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown())
});
export type DecisionEventRecord = z.infer<typeof DecisionEventRecordSchema>;

export const DecisionUserSchema = z.object({
  id: z.string().uuid(),
  displayName: DecisionDisplayNameSchema,
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime()
});
export type DecisionUser = z.infer<typeof DecisionUserSchema>;

export type AuthenticatedDecisionUser = DecisionUser & {
  sessionId: string;
};
