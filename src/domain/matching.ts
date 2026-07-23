import { createHash } from "node:crypto";
import type {
  BasisPosition,
  BasisRecommendation,
  MatchKindSchema,
  MatchLink,
  MatchStatusSchema,
  OfferAvailability,
  OfferCompletenessStatus,
  OfferLine,
  PilotAnalysis,
  RecommendationStatus,
  SupplierOption
} from "@/domain/contracts";
import { recommendationStatus } from "@/domain/recommendation";
import type { z } from "zod";

type MatchKind = z.infer<typeof MatchKindSchema>;
type MatchStatus = z.infer<typeof MatchStatusSchema>;

export interface OfferLineContext {
  documentId: string;
  documentLabel: string;
  line: OfferLine;
  blockingIssueIds?: string[];
}

export interface MatchCandidate {
  basis: BasisPosition;
  offer: OfferLineContext;
  score: number;
  reasons: string[];
}

export function isMatchingSourceDocumentType(
  documentType: string
): documentType is "BASIS_LV" | "SUPPLIER_OFFER" {
  return documentType === "BASIS_LV" || documentType === "SUPPLIER_OFFER";
}

const normalize = (value: string | null | undefined) =>
  (value ?? "")
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const tokens = (value: string) =>
  new Set(normalize(value).split(" ").filter((token) => token.length > 2));

function stableId(prefix: string, ...parts: unknown[]) {
  return `${prefix}_${createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 18)}`;
}

function tokenSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return (2 * intersection) / (a.size + b.size);
}

interface PositionReference {
  prefix: string;
  start: number;
  end: number;
}

function parsePositionReference(value: string | null | undefined): PositionReference | null {
  const compact = (value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[.,;:]+$/g, "");
  if (!compact) return null;
  const [left, right] = compact.split("-", 2);
  const leftParts = left.match(/\d+/g)?.map(Number) ?? [];
  if (leftParts.length < 2) return null;
  const start = leftParts.at(-1)!;
  const prefix = leftParts.slice(0, -1).join(".");
  const rightParts = right?.match(/\d+/g)?.map(Number) ?? [];
  const end = rightParts.length > 0 ? rightParts.at(-1)! : start;
  return { prefix, start: Math.min(start, end), end: Math.max(start, end) };
}

function positionReferenceMatches(
  basisPositionNumber: string,
  sourcePositionNumber: string | null | undefined
): boolean {
  const basis = parsePositionReference(basisPositionNumber);
  const source = parsePositionReference(sourcePositionNumber);
  return Boolean(
    basis &&
      source &&
      basis.prefix === source.prefix &&
      basis.start >= source.start &&
      basis.start <= source.end
  );
}

function samePosition(basis: BasisPosition, offer: OfferLine) {
  return [offer.sourcePositionNumber, offer.supplierPositionNumber]
    .some((value) => positionReferenceMatches(basis.positionNumber, value));
}

function canonicalUnit(value: string | null | undefined): string | null {
  const unit = normalize(value);
  if (!unit) return null;
  if (["st", "stk", "stck", "stuck", "stueck"].includes(unit)) return "piece";
  if (["m", "meter", "lfm"].includes(unit)) return "meter";
  if (["kg", "kilogramm"].includes(unit)) return "kilogram";
  return unit;
}

const nominalDiameterByInch = new Map<string, number>([
  ["1/2", 15],
  ["3/4", 20],
  ["1", 25],
  ["1 1/4", 32],
  ["1 1/2", 40],
  ["2", 50]
]);

function normalizeFractions(value: string): string {
  return value
    .replace(/[″”]/g, '"')
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ");
}

function expectedNominalDiameter(value: string): number | null {
  const direct = normalizeFractions(value).match(/\bdn\s*(\d{1,3})\b/i);
  if (direct) return Number(direct[1]);
  return null;
}

function offeredNominalDiameters(value: string): Set<number> {
  const result = new Set<number>();
  const normalized = normalizeFractions(value);
  for (const match of normalized.matchAll(/\bdn\s*(\d{1,3})\b/gi)) {
    result.add(Number(match[1]));
  }
  for (const [inch, dn] of nominalDiameterByInch) {
    const escaped = inch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const explicitOrFractionPattern = inch.includes("/")
      ? `(?:^|\\s)${escaped}(?:\\s*(?:\"|zoll)|(?=\\s|,|;|$))`
      : `(?:^|\\s)${escaped}\\s*(?:\"|zoll)`;
    if (
      new RegExp(explicitOrFractionPattern, "i").test(normalized) ||
      new RegExp(`innengewinde\\s+${escaped}(?=\\s|,|;|$)`, "i").test(
        normalized
      )
    ) {
      result.add(dn);
    }
  }
  return result;
}

function compactComparableText(value: string): string {
  return normalize(value).replace(/\s+/g, "");
}

function attributeMatches(
  attribute: BasisPosition["technicalAttributes"][number],
  offerText: string
): boolean {
  const expectedDn = expectedNominalDiameter(attribute.value);
  if (expectedDn !== null) {
    return offeredNominalDiameters(offerText).has(expectedDn);
  }
  const expected = compactComparableText(attribute.value);
  return Boolean(expected && compactComparableText(offerText).includes(expected));
}

function hasUnresolvedBasisReference(basis: BasisPosition): boolean {
  const text = normalize([basis.description, ...basis.notes].join(" "));
  return /\b(ausfuhrungsbeschreibung|specification|anlage|appendix)\b/.test(
    text
  );
}

function scopeLabel(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= 90 ? compact : `${compact.slice(0, 87)}...`;
}

export function scoreMatch(basis: BasisPosition, offer: OfferLine): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  const descriptionScore = tokenSimilarity(basis.description, offer.description);
  let score = descriptionScore * 0.42;

  if (samePosition(basis, offer)) {
    score += 0.34;
    reasons.push("Direkter LV-Positionsbezug");
  }

  if (
    basis.unit &&
    offer.unit &&
    canonicalUnit(basis.unit) === canonicalUnit(offer.unit)
  ) {
    score += 0.08;
    reasons.push("Einheit stimmt überein");
  }

  if (basis.quantity !== null && offer.quantity !== null) {
    const delta = Math.abs(basis.quantity - offer.quantity);
    if (delta <= Math.max(0.001, basis.quantity * 0.01)) {
      score += 0.08;
      reasons.push("Menge ist kompatibel");
    }
  }

  const requiredManufacturers = basis.manufacturerRequirements.map(normalize);
  if (
    offer.manufacturer &&
    requiredManufacturers.some(
      (value) =>
        value.includes(normalize(offer.manufacturer)) ||
        normalize(offer.manufacturer).includes(value)
    )
  ) {
    score += 0.08;
    reasons.push("Herstelleranforderung erfüllt");
  }

  if (
    basis.technicalAttributes.length > 0 &&
    basis.technicalAttributes.some((attribute) =>
      attributeMatches(attribute, offer.description)
    )
  ) {
    score += 0.06;
    reasons.push("Mindestens eine technische Eigenschaft stimmt überein");
  }
  if (descriptionScore >= 0.38) reasons.push("Beschreibung ist inhaltlich ähnlich");

  return { score: Math.min(1, score), reasons };
}

export function generateMatchCandidates(
  basis: BasisPosition[],
  offers: OfferLineContext[]
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  for (const [basisIndex, position] of basis.entries()) {
    if (position.heading) continue;
    const supplierIds = Array.from(new Set(offers.map((offer) => offer.documentId)));
    for (const supplierId of supplierIds) {
      const supplierOffers = offers.filter(
        (offer) => offer.documentId === supplierId
      );
      const ranked = supplierOffers
        .map((offer) => {
          const offerIndex = offers.indexOf(offer);
          const scored = scoreMatch(position, offer.line);
          const reasons = [...scored.reasons];
          let score = scored.score;
          const previousBasis = basis[basisIndex - 1];
          const nextBasis = basis[basisIndex + 1];
          const previousOffer = offers[offerIndex - 1]?.line;
          const nextOffer = offers[offerIndex + 1]?.line;
          if (
            (previousBasis && previousOffer && samePosition(previousBasis, previousOffer)) ||
            (nextBasis && nextOffer && samePosition(nextBasis, nextOffer))
          ) {
            score = Math.min(1, score + 0.05);
            reasons.push("Nachbarposition bestätigt die Reihenfolge");
          }
          if (offer.line.groupId) reasons.push("Lieferantengruppe bleibt erhalten");
          return { basis: position, offer, score, reasons };
        })
        .filter(
          (candidate) =>
            candidate.score >= 0.36 ||
            (samePosition(position, candidate.offer.line) &&
              ["NOT_OFFERED", "PROVIDED_BY_OTHERS"].includes(
                candidate.offer.line.role
              ))
        )
        .sort((left, right) => {
          const directDelta =
            Number(samePosition(position, right.offer.line)) -
            Number(samePosition(position, left.offer.line));
          if (directDelta !== 0) return directDelta;
          return right.score - left.score;
        })
        .slice(0, 4);
      candidates.push(...ranked);
    }
  }
  return candidates;
}

export function composeMatchLink(input: {
  basisPositionIds: string[];
  offerLineIds: string[];
  status: MatchStatus;
  score: number;
  reasons: string[];
  confirmedByOperator?: boolean;
}): MatchLink {
  const basisCount = input.basisPositionIds.length;
  const offerCount = input.offerLineIds.length;
  const kind: MatchKind =
    basisCount > 1 && offerCount > 1
      ? "MANY_TO_MANY"
      : basisCount > 1
        ? "MANY_TO_ONE"
        : offerCount > 1
          ? "ONE_TO_MANY"
          : "ONE_TO_ONE";
  return {
    id: stableId(
      "match",
      input.basisPositionIds,
      input.offerLineIds,
      input.status
    ),
    basisPositionIds: input.basisPositionIds,
    offerLineIds: input.offerLineIds,
    kind,
    status: input.status,
    score: input.score,
    reasons: input.reasons,
    confirmedByOperator: input.confirmedByOperator ?? false
  };
}

function candidateRolePriority(role: OfferLine["role"]): number {
  if (role === "PRIMARY") return 0;
  if (role === "ALTERNATIVE" || role === "OPTIONAL") return 1;
  if (role === "PROVIDED_BY_OTHERS" || role === "NOT_OFFERED") return 2;
  if (role === "REQUIRED_COMPONENT" || role === "INCLUDED_ACCESSORY") return 3;
  return 4;
}

function anchoredBundle(
  basis: BasisPosition,
  anchor: OfferLineContext,
  contexts: OfferLineContext[]
): OfferLineContext[] {
  const supplier = contexts.filter(
    (context) => context.documentId === anchor.documentId
  );
  const anchorIndex = supplier.findIndex(
    (context) => context.line.id === anchor.line.id
  );
  if (anchorIndex < 0) return [anchor];
  const result: OfferLineContext[] = [];
  for (let index = anchorIndex; index < supplier.length; index += 1) {
    const context = supplier[index];
    const source = context.line.sourcePositionNumber;
    if (
      index > anchorIndex &&
      source &&
      !positionReferenceMatches(basis.positionNumber, source)
    ) {
      break;
    }
    result.push(context);
  }
  return result.length > 0 ? result : [anchor];
}

export function proposeMatches(
  basis: BasisPosition[],
  offers: OfferLine[] | OfferLineContext[]
): MatchLink[] {
  const contexts: OfferLineContext[] = offers.map((item) =>
    "line" in item
      ? item
      : { documentId: "offer", documentLabel: "Angebot", line: item }
  );
  const candidates = generateMatchCandidates(basis, contexts);
  const links: MatchLink[] = [];
  for (const position of basis.filter((item) => !item.heading)) {
    const positionCandidates = candidates.filter(
      (candidate) => candidate.basis.id === position.id
    );
    const supplierIds = Array.from(
      new Set(positionCandidates.map((candidate) => candidate.offer.documentId))
    );
    for (const supplierId of supplierIds) {
      const supplierCandidates = positionCandidates
        .filter((candidate) => candidate.offer.documentId === supplierId)
        .sort((left, right) => {
          const directDelta =
            Number(samePosition(position, right.offer.line)) -
            Number(samePosition(position, left.offer.line));
          if (directDelta !== 0) return directDelta;
          const roleDelta =
            candidateRolePriority(left.offer.line.role) -
            candidateRolePriority(right.offer.line.role);
          if (roleDelta !== 0) return roleDelta;
          return right.score - left.score;
        });
      const candidate = supplierCandidates[0];
      if (!candidate) continue;
      const bundle = anchoredBundle(position, candidate.offer, contexts);
      const offerLineIds = Array.from(
        new Set(bundle.map((context) => context.line.id))
      );
      const hasOptional = bundle.some((context) =>
        ["OPTIONAL", "ALTERNATIVE"].includes(context.line.role)
      );
      const hasInferredComponent = bundle.some(
        (context, index) =>
          index > 0 &&
          context.line.role === "PRIMARY" &&
          !context.line.sourcePositionNumber
      );
      const status: MatchStatus =
        ["NOT_OFFERED", "PROVIDED_BY_OTHERS"].includes(candidate.offer.line.role)
          ? "NOT_OFFERED"
          : candidate.offer.line.role === "ALTERNATIVE"
            ? "ALTERNATIVE"
            : candidate.offer.line.role === "REQUIRED_COMPONENT"
              ? "REQUIRED_COMPONENT"
              : samePosition(position, candidate.offer.line)
                ? "EXACT"
                : "PROBABLE";
      links.push(
        composeMatchLink({
          basisPositionIds: [position.id],
          offerLineIds,
          status,
          score: candidate.score,
          reasons: Array.from(
            new Set([
              ...candidate.reasons,
              ...(bundle.length > 1
                ? ["Zusammengehörige Folgezeilen als Bundle verbunden"]
                : []),
              ...(hasInferredComponent
                ? ["Unnummerierte Folgezeile als Pflichtkomponente bewertet"]
                : []),
              ...(hasOptional
                ? ["Optionales oder alternatives Zubehör separat gehalten"]
                : []),
              ...(["NOT_OFFERED", "PROVIDED_BY_OTHERS"].includes(
                candidate.offer.line.role
              )
                ? ["Keine Lieferantenleistung; explizit als bauseits/nicht angeboten belegt"]
                : [])
            ])
          )
        })
      );
    }
  }
  return Array.from(new Map(links.map((link) => [link.id, link])).values());
}

export function matchConstraints(
  basis: BasisPosition,
  offers: OfferLine[]
): {
  quantityCompatible: boolean;
  unitCompatible: boolean;
  technicalCompatible: boolean;
  requiredScopeComplete: boolean;
  optionalSeparated: boolean;
  bundleCompatible: boolean;
  evidenceSufficient: boolean;
  reasons: string[];
  positiveReasons: string[];
  technicalDeviations: string[];
  scopeDifferences: string[];
} {
  const pricedScope = offers.filter(
    (line) =>
      ![
        "OPTIONAL",
        "ALTERNATIVE",
        "NOTE",
        "NOT_OFFERED",
        "PROVIDED_BY_OTHERS"
      ].includes(line.role)
  );
  const candidateScope = offers.filter(
    (line) =>
      !["NOTE", "NOT_OFFERED", "PROVIDED_BY_OTHERS"].includes(line.role)
  );
  const primary =
    pricedScope.find(
      (line) => line.role === "PRIMARY" && samePosition(basis, line)
    ) ?? pricedScope.find((line) => line.role === "PRIMARY");
  const quantityLines = primary
    ? [
        primary,
        ...pricedScope.filter(
          (line) =>
            line.id !== primary.id &&
            ["REQUIRED_COMPONENT", "INCLUDED_ACCESSORY", "PRIMARY"].includes(
              line.role
            )
        )
      ]
    : candidateScope;
  const quantityCompatible =
    basis.quantity !== null &&
    quantityLines.length > 0 &&
    quantityLines.every(
      (line) =>
        line.quantity === null ||
        Math.abs(line.quantity - basis.quantity!) <=
          Math.max(0.001, basis.quantity! * 0.01)
    );
  const unitCompatible =
    basis.unit !== null &&
    candidateScope.length > 0 &&
    candidateScope.every(
      (line) =>
        line.unit === null ||
        canonicalUnit(line.unit) === canonicalUnit(basis.unit)
    );
  const combinedDescription = candidateScope
    .map((line) => line.description)
    .join(" ");
  const technicalDeviations = basis.technicalAttributes
    .filter((attribute) => !attributeMatches(attribute, combinedDescription))
    .map(
      (attribute) =>
        `Technische Eigenschaft abweichend oder nicht belegt: ${attribute.name} erwartet ${attribute.value}`
    );
  const supplierManufacturers = Array.from(
    new Set(candidateScope.map((line) => line.manufacturer).filter(Boolean))
  ) as string[];
  const normalizedManufacturers = supplierManufacturers.map(normalize);
  const manufacturerMismatch =
    basis.manufacturerRequirements.length > 0 &&
    !basis.manufacturerRequirements.some((requirement) =>
      normalizedManufacturers.some(
        (manufacturer) =>
          normalize(requirement).includes(manufacturer) ||
          manufacturer.includes(normalize(requirement))
      )
    );
  if (manufacturerMismatch) {
    technicalDeviations.push(
      `Herstelleranforderung nicht erfüllt: ${basis.manufacturerRequirements.join(", ")}`
    );
  }
  const technicalCompatible = technicalDeviations.length === 0;
  const scopeDifferences = basis.requiredScope
    .filter(
      (scope) =>
        !normalize(combinedDescription).includes(normalize(scope)) &&
        tokenSimilarity(scope, combinedDescription) < 0.32
    )
    .map((scope) => `Pflichtumfang nicht belegt: ${scopeLabel(scope)}`);
  const requiredScopeComplete =
    !offers.some(
      (line) =>
        ["NOT_OFFERED", "PROVIDED_BY_OTHERS", "PRICE_ON_REQUEST"].includes(
          line.role
        )
    ) && scopeDifferences.length === 0;
  const optionalSeparated = offers.every(
    (line) => line.role !== "OPTIONAL" || Boolean(line.groupId)
  );
  const bundleCompatible =
    (Boolean(primary) ||
      candidateScope.every((line) =>
        ["OPTIONAL", "ALTERNATIVE"].includes(line.role)
      )) &&
    pricedScope.filter(
      (line) => line.role === "PRIMARY" && samePosition(basis, line)
    ).length <= 1;
  const basisEvidenceComplete =
    basis.quantity !== null &&
    basis.unit !== null &&
    !hasUnresolvedBasisReference(basis) &&
    basis.evidence.some((evidence) =>
      ["VERIFIED_NATIVE", "VERIFIED_VISUAL"].includes(evidence.status)
    );
  const evidenceSufficient =
    basisEvidenceComplete &&
    offers.length > 0 &&
    offers.every((line) =>
      line.evidence.some((evidence) =>
        ["VERIFIED_NATIVE", "VERIFIED_VISUAL"].includes(evidence.status)
      )
    );
  const reasons: string[] = [];
  const positiveReasons: string[] = [];
  if (quantityCompatible) positiveReasons.push("Menge stimmt überein");
  else if (basis.quantity === null) reasons.push("Basis-Menge fehlt; Mengenvergleich nicht möglich");
  else reasons.push("Menge weicht ab oder ist nicht vollständig belegt");
  if (unitCompatible) positiveReasons.push("Einheit stimmt überein");
  else if (basis.unit === null) reasons.push("Basis-Einheit fehlt; Einheitenvergleich nicht möglich");
  else reasons.push("Einheit ist nicht kompatibel oder nicht belegt");
  if (technicalCompatible && basis.technicalAttributes.length > 0) {
    positiveReasons.push("Extrahierte technische Eigenschaften stimmen überein");
  }
  reasons.push(...technicalDeviations);
  reasons.push(...scopeDifferences);
  if (!optionalSeparated) reasons.push("Optionales Zubehör ist nicht getrennt");
  else if (offers.some((line) => ["OPTIONAL", "ALTERNATIVE"].includes(line.role))) {
    positiveReasons.push("Optionales Zubehör nicht eingerechnet");
  }
  if (!bundleCompatible) reasons.push("Bundle-Zusammensetzung ist unklar");
  if (!basisEvidenceComplete) {
    reasons.push(
      hasUnresolvedBasisReference(basis)
        ? "Referenzierte Ausführungsbeschreibung ist im Pilotumfang nicht vollständig aufgelöst"
        : "Basis-Extraktion ist für Menge, Einheit oder Evidence unvollständig"
    );
  } else if (!evidenceSufficient) {
    reasons.push("Supplier-Evidence ist nicht ausreichend");
  }
  if (
    basis.manufacturerRequirements.length === 0 &&
    supplierManufacturers.length > 0
  ) {
    positiveReasons.push(
      `Hersteller ${supplierManufacturers.join(", ")} genannt; Basis-LV ohne Herstellerbindung`
    );
  } else if (
    basis.manufacturerRequirements.length > 0 &&
    !manufacturerMismatch
  ) {
    positiveReasons.push("Herstelleranforderung erfüllt");
  }
  return {
    quantityCompatible,
    unitCompatible,
    technicalCompatible,
    requiredScopeComplete,
    optionalSeparated,
    bundleCompatible,
    evidenceSufficient,
    reasons,
    positiveReasons,
    technicalDeviations,
    scopeDifferences
  };
}

export function classifyOfferCompleteness(line: OfferLine): OfferCompletenessStatus {
  if (line.completenessStatus) return line.completenessStatus;
  if (["NOT_OFFERED", "PROVIDED_BY_OTHERS"].includes(line.role)) {
    return "NOT_OFFERED";
  }
  if (line.role === "PRICE_ON_REQUEST") return "PRICE_ON_REQUEST";
  const hasPrice =
    line.moneyCandidates.some((candidate) => candidate.amount !== null) ||
    line.interpretedUnitPrice !== null ||
    line.interpretedTotalPrice !== null;
  if (hasPrice) return "PRICED_OFFER";
  return line.description.trim() ? "OFFER_WITHOUT_PRICE" : "EMPTY_LINE";
}

function printedTotal(line: OfferLine): number | null {
  if (line.interpretedTotalPrice !== null) return line.interpretedTotalPrice;
  return (
    line.moneyCandidates.find(
      (candidate) => candidate.kind === "TOTAL_PRICE" && candidate.amount !== null
    )?.amount ?? null
  );
}

function offerAvailability(
  basis: BasisPosition,
  supplierOffers: OfferLineContext[],
  matchedLines: OfferLine[]
): OfferAvailability {
  if (
    matchedLines.some((line) =>
      ["NOT_OFFERED", "PROVIDED_BY_OTHERS"].includes(line.role)
    )
  ) {
    return "EXPLICIT_NO_OFFER";
  }
  if (matchedLines.length > 0) return "PRESENT";
  const basisReference = parsePositionReference(basis.positionNumber);
  if (!basisReference) return "NOT_COVERED";
  const supplierReferences = supplierOffers
    .map((offer) => parsePositionReference(offer.line.sourcePositionNumber))
    .filter(
      (reference): reference is PositionReference =>
        reference !== null && reference.prefix === basisReference.prefix
    );
  if (supplierReferences.length === 0) return "NOT_COVERED";
  const minimum = Math.min(...supplierReferences.map((reference) => reference.start));
  const maximum = Math.max(...supplierReferences.map((reference) => reference.end));
  return basisReference.start >= minimum && basisReference.start <= maximum
    ? "COVERED_WITHOUT_OFFER"
    : "NOT_COVERED";
}

function optionStatus(option: Omit<SupplierOption, "status">): RecommendationStatus {
  return recommendationStatus({
    matchingConfirmed: option.matchingAccepted || option.matchingReliable,
    priceValidated:
      option.extractionValidated && option.pricedTotal !== null,
    quantityCompatible: option.quantityCompatible,
    unitCompatible: option.unitCompatible,
    requiredScopeEquivalent: option.requiredScopeComplete,
    mandatoryComponentsIncluded: option.missingComponents.length === 0,
    technicalDeviation: !option.technicalCompatible,
    optionalSeparated: option.optionalSeparated,
    evidenceSufficient: option.evidenceSufficient,
    offerAvailability: option.offerAvailability
  });
}

export function buildSupplierOptions(input: {
  basisPositions: BasisPosition[];
  offers: OfferLineContext[];
  links: MatchLink[];
}): SupplierOption[] {
  const suppliers = Array.from(
    new Map(
      input.offers.map((offer) => [
        offer.documentId,
        { id: offer.documentId, label: offer.documentLabel }
      ])
    ).values()
  );
  return input.basisPositions.flatMap((basis) =>
    suppliers.map((supplier) => {
      const supplierOffers = input.offers.filter(
        (offer) => offer.documentId === supplier.id
      );
      const supplierLineIds = new Set(
        supplierOffers.map((offer) => offer.line.id)
      );
      const links = input.links.filter(
        (link) =>
          link.basisPositionIds.includes(basis.id) &&
          link.offerLineIds.some((id) => supplierLineIds.has(id))
      );
      const lineIds = Array.from(
        new Set(links.flatMap((link) => link.offerLineIds).filter((id) => supplierLineIds.has(id)))
      );
      const contexts = input.offers.filter((offer) => lineIds.includes(offer.line.id));
      const lines = contexts.map((context) => context.line);
      const availability = offerAvailability(basis, supplierOffers, lines);
      const primary = lines.find(
        (line) => line.role === "PRIMARY" && samePosition(basis, line)
      );
      const mandatory = lines.filter(
        (line) =>
          ["REQUIRED_COMPONENT", "INCLUDED_ACCESSORY"].includes(line.role) ||
          (line.role === "PRIMARY" &&
            line.id !== primary?.id &&
            !line.sourcePositionNumber)
      );
      const optional = lines.filter((line) =>
        ["OPTIONAL", "ALTERNATIVE"].includes(line.role)
      );
      const primaryPrice = primary ? printedTotal(primary) : null;
      const mandatoryComponentPrices = mandatory
        .map(printedTotal)
        .filter((value): value is number => value !== null);
      const optionalPrices = optional
        .map(printedTotal)
        .filter((value): value is number => value !== null);
      const missingComponents: string[] = [];
      if (
        availability === "EXPLICIT_NO_OFFER" ||
        availability === "COVERED_WITHOUT_OFFER"
      ) {
        missingComponents.push("NOT_OFFERED");
      }
      if (mandatory.some((line) => printedTotal(line) === null)) {
        missingComponents.push("Pflichtkomponente ohne bestätigten Gesamtpreis");
      }
      const constraints = matchConstraints(basis, lines);
      const validationIssueIds = Array.from(
        new Set(contexts.flatMap((context) => context.blockingIssueIds ?? []))
      );
      const extractionValidated =
        availability === "PRESENT" &&
        lines.length > 0 &&
        validationIssueIds.length === 0 &&
        lines.every((line) =>
          ["MACHINE_VALIDATED", "HUMAN_CONFIRMED", "HUMAN_CORRECTED"].includes(
            line.verificationStatus
          )
        );
      const matchingAccepted = links.some(
        (link) => link.confirmedByOperator
      );
      const matchingReliable =
        availability === "COVERED_WITHOUT_OFFER" ||
        links.some(
          (link) =>
            link.confirmedByOperator ||
            (link.reasons.includes("Direkter LV-Positionsbezug") &&
              ["EXACT", "ALTERNATIVE", "NOT_OFFERED"].includes(link.status))
        );
      const pricedTotalRaw =
        primaryPrice !== null &&
        mandatoryComponentPrices.length === mandatory.length &&
        validationIssueIds.length === 0
          ? primaryPrice +
            mandatoryComponentPrices.reduce((sum, price) => sum + price, 0)
          : null;
      const pricedTotal =
        pricedTotalRaw === null ? null : Math.round(pricedTotalRaw * 100) / 100;
      const quantityCompatible =
        availability === "PRESENT" ? constraints.quantityCompatible : true;
      const unitCompatible =
        availability === "PRESENT" ? constraints.unitCompatible : true;
      const technicalCompatible =
        availability === "PRESENT" ? constraints.technicalCompatible : true;
      const requiredScopeComplete =
        availability === "PRESENT" ? constraints.requiredScopeComplete : true;
      const optionalSeparated =
        availability === "PRESENT" ? constraints.optionalSeparated : true;
      const evidenceSufficient =
        availability === "PRESENT" ? constraints.evidenceSufficient : true;
      const comparableTotal =
        pricedTotal !== null &&
        quantityCompatible &&
        unitCompatible &&
        technicalCompatible &&
        requiredScopeComplete &&
        optionalSeparated &&
        evidenceSufficient
          ? pricedTotal
          : null;
      const reasons = Array.from(
        new Set([
          ...(availability === "EXPLICIT_NO_OFFER"
            ? ["Keine Lieferantenleistung; explizit als bauseits/nicht angeboten belegt"]
            : []),
          ...(availability === "COVERED_WITHOUT_OFFER"
            ? ["Keine passende Angebotsposition im belegten Positionsintervall gefunden"]
            : []),
          ...(availability === "NOT_COVERED"
            ? ["Keine passende Angebotsposition gefunden; extrahierter Supplier-Bereich deckt die Basis-Position nicht ab"]
            : []),
          ...(availability === "PRESENT" ? constraints.positiveReasons : []),
          ...(availability === "PRESENT" ? constraints.reasons : []),
          ...(mandatory.some(
            (line) => line.role === "PRIMARY" && !line.sourcePositionNumber
          )
            ? ["Unnummerierte Folgezeile als Pflichtkomponente berücksichtigt"]
            : []),
          ...(pricedTotal !== null
            ? ["Preis vollständig bestätigt: Primär- und Pflichtkomponenten belegt"]
            : availability === "PRESENT"
              ? ["Preis nicht vollständig für Primär- und Pflichtkomponenten bestätigt"]
              : []),
          ...(comparableTotal === null &&
          pricedTotal !== null &&
          !requiredScopeComplete
            ? ["Materialsumme vorhanden, aber wegen abweichendem Pflichtumfang nicht als vergleichbarer Gesamtpreis freigegeben"]
            : []),
          ...(matchingAccepted
            ? ["Zuordnung manuell bestätigt"]
            : matchingReliable && availability === "PRESENT"
              ? ["Direkter Positionsbezug eindeutig; Supplier-Auswahl bleibt offen"]
              : availability === "PRESENT"
                ? ["Zuordnung nicht eindeutig bestätigt"]
                : []),
          ...missingComponents
            .filter((component) => component !== "NOT_OFFERED")
            .map((component) => `Pflichtkomponente fehlt: ${component}`)
        ])
      );
      const withoutStatus: Omit<SupplierOption, "status"> = {
        id: stableId("option", basis.id, supplier.id),
        basisPositionIds: [basis.id],
        supplierDocumentId: supplier.id,
        supplierLabel: supplier.label,
        matchedOfferLineIds: lineIds,
        matchLinkIds: links.map((link) => link.id),
        primaryPrice,
        mandatoryComponentPrices,
        optionalPrices,
        pricedTotal,
        comparableTotal,
        quantity: primary?.quantity ?? null,
        unit: primary?.unit ?? null,
        scopeOfSupply: lines
          .filter((line) => !["OPTIONAL", "ALTERNATIVE"].includes(line.role))
          .map((line) => line.description),
        technicalDeviations:
          availability === "PRESENT" ? constraints.technicalDeviations : [],
        missingComponents,
        validationIssueIds,
        evidenceIds: Array.from(
          new Set(lines.flatMap((line) => line.evidence.map((evidence) => evidence.id)))
        ),
        quantityCompatible,
        unitCompatible,
        technicalCompatible,
        requiredScopeComplete,
        optionalSeparated,
        evidenceSufficient,
        extractionValidated,
        matchingAccepted,
        matchingReliable,
        offerAvailability: availability,
        reasons
      };
      return { ...withoutStatus, status: optionStatus(withoutStatus) };
    })
  );
}

export function buildBasisRecommendations(
  basisPositions: BasisPosition[],
  options: SupplierOption[]
): BasisRecommendation[] {
  return basisPositions.map((basis) => {
    const positionOptions = options.filter((option) =>
      option.basisPositionIds.includes(basis.id)
    );
    const eligible = positionOptions.filter(
      (option) =>
        option.status === "CLEAR_RECOMMENDATION" &&
        option.comparableTotal !== null
    );
    const sorted = [...eligible].sort(
      (left, right) => left.comparableTotal! - right.comparableTotal!
    );
    if (sorted.length > 0) {
      return {
        basisPositionId: basis.id,
        status: "CLEAR_RECOMMENDATION",
        recommendedSupplierDocumentId: null,
        reasons: [
          "Alle fachlichen und evidenzbezogenen Gates sind erfüllt",
          "Optionale und alternative Preise bleiben getrennt",
          `${sorted.length} vergleichbare Supplier-Option(en) verfügbar`,
          "Keine automatische Supplier-Auswahl; Operatorentscheidung erforderlich"
        ],
        requiresOperatorConfirmation: true
      };
    }
    if (
      positionOptions.length > 0 &&
      positionOptions.every((option) => option.status === "NO_OFFER")
    ) {
      return {
        basisPositionId: basis.id,
        status: "NO_OFFER",
        recommendedSupplierDocumentId: null,
        reasons: Array.from(
          new Set(positionOptions.flatMap((option) => option.reasons))
        ),
        requiresOperatorConfirmation: false
      };
    }
    const priority: RecommendationStatus[] = [
      "TECHNICAL_DEVIATION",
      "DIFFERENT_SCOPE_OF_SUPPLY",
      "DECISION_REQUIRED",
      "MATCHING_UNCLEAR",
      "PRICE_UNCLEAR",
      "NOT_COMPARABLE",
      "NO_OFFER"
    ];
    const status =
      priority.find((value) =>
        positionOptions.some((option) => option.status === value)
      ) ?? "NO_OFFER";
    return {
      basisPositionId: basis.id,
      status,
      recommendedSupplierDocumentId: null,
      reasons: Array.from(
        new Set(
          positionOptions.flatMap((option) =>
            option.reasons.map(
              (reason) => `${option.supplierLabel}: ${reason}`
            )
          )
        )
      ),
      requiresOperatorConfirmation: true
    };
  });
}

export function refreshPilotAnalysis(analysis: PilotAnalysis): PilotAnalysis {
  const supplierOptions = analysis.supplierOptions.map((option) => {
    const matchingAccepted = option.matchLinkIds.some(
      (linkId) =>
        analysis.matchLinks.find((link) => link.id === linkId)?.confirmedByOperator
    );
    const withoutStatus = { ...option, matchingAccepted };
    return { ...withoutStatus, status: optionStatus(withoutStatus) };
  });
  return {
    ...analysis,
    supplierOptions,
    recommendations: buildBasisRecommendations(
      analysis.basisPositions,
      supplierOptions
    ),
    generatedAt: new Date().toISOString()
  };
}
