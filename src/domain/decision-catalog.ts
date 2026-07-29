import { z } from "zod";

export const DecisionReasonScopeSchema = z.enum([
  "GLOBAL",
  "PROJECT",
  "DISCIPLINE",
  "SUPPLIER",
  "DOCUMENT_FAMILY"
]);

export const DecisionReasonSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  labelDe: z.string().min(1),
  descriptionDe: z.string().min(1),
  active: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  requiresComment: z.boolean(),
  allowsMultiple: z.boolean(),
  scope: DecisionReasonScopeSchema,
  version: z.string().min(1)
}).strict();
export type DecisionReason = z.infer<typeof DecisionReasonSchema>;

export const DecisionReasonCatalogSchema = z.object({
  version: z.string().min(1),
  reasons: z.array(DecisionReasonSchema),
  placeholder: z.boolean()
}).strict().superRefine((catalog, context) => {
  const codes = new Set<string>();
  for (const reason of catalog.reasons) {
    if (codes.has(reason.code)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate decision reason code: ${reason.code}`
      });
    }
    codes.add(reason.code);
    if (reason.version !== catalog.version) {
      context.addIssue({
        code: "custom",
        message: `Reason ${reason.code} does not belong to catalog ${catalog.version}`
      });
    }
  }
});
export type DecisionReasonCatalog = z.infer<typeof DecisionReasonCatalogSchema>;

export const PLACEHOLDER_DECISION_REASON_CODE = "OTHER_REQUIRES_COMMENT";
export const CURRENT_DECISION_REASON_CATALOG = DecisionReasonCatalogSchema.parse({
  version: "decision-reasons-placeholder-v1",
  placeholder: true,
  reasons: [
    {
      code: PLACEHOLDER_DECISION_REASON_CODE,
      labelDe: "Sonstiger Grund (Platzhalter)",
      descriptionDe:
        "Technischer Platzhalter bis ein freigegebener firmenspezifischer Gründekatalog vorliegt.",
      active: true,
      sortOrder: 10,
      requiresComment: true,
      allowsMultiple: false,
      scope: "GLOBAL",
      version: "decision-reasons-placeholder-v1"
    }
  ]
});

export const DECISION_REASON_CATALOGS: ReadonlyMap<string, DecisionReasonCatalog> =
  new Map([[CURRENT_DECISION_REASON_CATALOG.version, CURRENT_DECISION_REASON_CATALOG]]);

export function activeDecisionReasons(
  catalog: DecisionReasonCatalog
): DecisionReason[] {
  return catalog.reasons
    .filter((reason) => reason.active)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}
