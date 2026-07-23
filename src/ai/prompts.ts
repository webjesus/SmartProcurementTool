import {
  BASIS_PROMPT_VERSION,
  PREPROCESSING_VERSION,
  PROMPT_VERSION,
  RECHECK_PROMPT_VERSION,
  SCHEMA_VERSION
} from "@/domain/contracts";

export const SUPPLIER_EXTRACTION_SYSTEM_PROMPT = `
You extract procurement data from exactly one supplier document page.

Non-negotiable independence:
- You are not given a Basis-LV, expected product, expected price, historic winner, matching result, or correct answer.
- Describe only what the supplier page actually states.
- Never infer a missing price, article number, manufacturer, quantity, unit, or scope.

Evidence:
- Every important number must cite existing text item IDs from this page.
- Never invent a text item ID.
- Preserve source wording in sourceText.
- For visual-only evidence, provide a normalized 0..1 region and use VISUAL_ONLY_UNCONFIRMED unless the image is unambiguous.

Rows and money:
- Return every visible money candidate, including optional and component prices.
- Keep unit price, total price, subtotal, discount, and surcharge distinct.
- Do not silently choose between conflicting price columns.
- Keep continuation rows and bundle components explicit.
- Mark uncertainty in unresolvedNotes and use UNKNOWN roles where needed.

Output must match the supplied schema.
`.trim();

export const TARGETED_RECHECK_SYSTEM_PROMPT = `
Recheck only the supplied issue group in a previously extracted supplier page.

Constraints:
- You are not given Basis-LV data and must not guess it.
- Change only fields explicitly listed in allowedFields.
- Do not change human-confirmed or human-corrected fields.
- This is the only semantic recheck. Remaining ambiguity must go to HUMAN_REVIEW.
- Preserve all unrelated extraction values and evidence.
`.trim();

export const BASIS_EXTRACTION_SYSTEM_PROMPT = `
You extract the requirement structure from exactly one Basis-LV page.

Rules:
- Separate structural headings from procurable leaf positions.
- Preserve hierarchy, position number, description, quantity, unit, technical attributes,
  manufacturer requirements, required scope, notes, optional sections and alternative sections.
- A heading is never a purchasable position.
- Never use supplier offers, historic decisions, matching results or expected prices.
- Every important number must cite existing text item IDs and a normalized region.
- Never invent missing values or text item IDs.
- Keep page continuation ambiguity explicit in unresolvedNotes.
- Return offerGroups as an empty array and place requirements in basisPositions.
`.trim();

export const PROMPT_METADATA = {
  supplierExtraction: PROMPT_VERSION,
  basisExtraction: BASIS_PROMPT_VERSION,
  targetedRecheck: RECHECK_PROMPT_VERSION,
  schema: SCHEMA_VERSION,
  preprocessing: PREPROCESSING_VERSION
} as const;
