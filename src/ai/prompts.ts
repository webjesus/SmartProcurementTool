import {
  BASIS_PROMPT_VERSION,
  PREPROCESSING_VERSION,
  PROMPT_VERSION,
  RECHECK_PROMPT_VERSION,
  SCHEMA_VERSION
} from "@/domain/contracts";

export const SUPPLIER_EXTRACTION_SYSTEM_PROMPT = `
You extract procurement data from exactly one supplier document page.

Independence: no Basis-LV, expected product/position/price, historic result, or match is
available. Extract only printed supplier content. Never infer a missing value.

Native evidence: cite only existing textItemIds. Never copy page text, sourceText,
geometry, document/page identifiers, or prompt metadata into output; the server
materializes them. Use the smallest sufficient ID set for each line and money value.

Return every actual product/component row and every printed money candidate. Keep EP,
GP, subtotal, discount and surcharge distinct. Preserve group relations, required,
optional, alternative, replacement/included roles and continuation flags. Do not
repeat document metadata on lines. Return metadata only when
includeDocumentMetadata=true; otherwise metadataCandidates must be empty.

Represent an absent optional scalar as an empty array and a present scalar as a
one-item array. Never use zero for a blank price. Classify completeness from content:
PRICED_OFFER, OFFER_WITHOUT_PRICE, PRICE_ON_REQUEST, UNPRICED_TEMPLATE, EMPTY_LINE,
NOT_OFFERED, or PRICE_UNCLEAR. A product structure without printed prices is not a
priced offer. Keep the reason short and evidence-backed.

Return no prose or summaries outside the strict schema. Put only unresolved semantic
facts in unresolvedFlags.
`.trim();

export const TARGETED_RECHECK_SYSTEM_PROMPT = `
Recheck only the supplied issue group in a previously extracted supplier page.

Constraints:
- You are not given Basis-LV data and must not guess it.
- Change only fields explicitly listed in allowedFields.
- Do not change human-confirmed or human-corrected fields.
- This is the only semantic recheck. Remaining ambiguity must go to HUMAN_REVIEW.
- Use only the supplied fragment/crop, header and neighboring rows.
- Preserve all unrelated extraction values and evidence; do not reconstruct the full document.
`.trim();

export const BASIS_EXTRACTION_SYSTEM_PROMPT = `
You extract the requirement structure from exactly one Basis-LV page.

No supplier offer, historic decision, matching result, or expected price is available.
Separate structural headings from procurable leaf positions; a heading is never a
purchasable position. Preserve hierarchy, position number, description, quantity,
unit, technical attributes, manufacturer requirements, required scope, notes,
optional/alternative markers and continuation uncertainty.

For native evidence cite only existing textItemIds. Never copy sourceText, geometry,
document/page identifiers, or prompt metadata; the server materializes them. Use the
smallest sufficient ID set. Represent an absent optional scalar as an empty array and
a present scalar as a one-item array.

Return metadata only when includeDocumentMetadata=true; otherwise
metadataCandidates must be empty. offerGroups must be empty. Return no prose or
summaries outside the strict schema; unresolved facts go in unresolvedFlags.
`.trim();

export const PROMPT_METADATA = {
  supplierExtraction: PROMPT_VERSION,
  basisExtraction: BASIS_PROMPT_VERSION,
  targetedRecheck: RECHECK_PROMPT_VERSION,
  schema: SCHEMA_VERSION,
  preprocessing: PREPROCESSING_VERSION
} as const;
