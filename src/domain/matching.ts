import { createHash } from "node:crypto";
import type {
  BasisPosition,
  BasisRecommendation,
  MatchKindSchema,
  MatchLink,
  MatchStatusSchema,
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

function samePosition(basis: BasisPosition, offer: OfferLine) {
  const expected = normalize(basis.positionNumber);
  return [offer.sourcePositionNumber, offer.supplierPositionNumber]
    .map(normalize)
    .some((value) => value === expected || value.endsWith(` ${expected}`));
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

  if (basis.unit && offer.unit && normalize(basis.unit) === normalize(offer.unit)) {
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

  const technicalText = basis.technicalAttributes
    .map((attribute) => `${attribute.name} ${attribute.value}`)
    .join(" ");
  if (technicalText && tokenSimilarity(technicalText, offer.description) >= 0.22) {
    score += 0.06;
    reasons.push("Technische Merkmale überlappen");
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
    const ranked = offers
      .map((offer, offerIndex) => {
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
      .filter((candidate) => candidate.score >= 0.36)
      .sort((left, right) => right.score - left.score)
      .slice(0, 4);
    candidates.push(...ranked);
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
    const positionCandidates = candidates
      .filter((candidate) => candidate.basis.id === position.id)
      .slice(0, 3);
    for (const [index, candidate] of positionCandidates.entries()) {
      const related = candidate.offer.line.groupId
        ? contexts
            .filter(
              (context) =>
                context.documentId === candidate.offer.documentId &&
                context.line.groupId === candidate.offer.line.groupId &&
                [
                  "REQUIRED_COMPONENT",
                  "OPTIONAL",
                  "ALTERNATIVE",
                  "INCLUDED_ACCESSORY"
                ].includes(context.line.role)
            )
            .map((context) => context.line.id)
        : [];
      const offerLineIds = Array.from(new Set([candidate.offer.line.id, ...related]));
      const status: MatchStatus =
        candidate.offer.line.role === "NOT_OFFERED"
          ? "NOT_OFFERED"
          : candidate.offer.line.role === "ALTERNATIVE"
            ? "ALTERNATIVE"
            : candidate.offer.line.role === "REQUIRED_COMPONENT"
              ? "REQUIRED_COMPONENT"
              : candidate.score >= 0.82 && index === 0
                ? "EXACT"
                : "PROBABLE";
      links.push(
        composeMatchLink({
          basisPositionIds: [position.id],
          offerLineIds,
          status,
          score: candidate.score,
          reasons: candidate.reasons
        })
      );
    }
  }

  const exactByOffer = new Map<string, MatchLink[]>();
  for (const link of links.filter((item) => item.status === "EXACT")) {
    for (const offerLineId of link.offerLineIds) {
      const list = exactByOffer.get(offerLineId) ?? [];
      list.push(link);
      exactByOffer.set(offerLineId, list);
    }
  }
  for (const [offerLineId, related] of exactByOffer) {
    const basisIds = Array.from(
      new Set(related.flatMap((item) => item.basisPositionIds))
    );
    if (basisIds.length > 1) {
      links.push(
        composeMatchLink({
          basisPositionIds: basisIds,
          offerLineIds: [offerLineId],
          status: "PROBABLE",
          score: Math.min(...related.map((item) => item.score)),
          reasons: ["Eine Lieferantenzeile deckt mehrere LV-Positionen ab"]
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
} {
  const pricedScope = offers.filter(
    (line) => !["OPTIONAL", "ALTERNATIVE", "NOTE"].includes(line.role)
  );
  const quantity = pricedScope.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  const quantityCompatible =
    basis.quantity === null ||
    Math.abs(quantity - basis.quantity) <= Math.max(0.001, basis.quantity * 0.01);
  const unitCompatible =
    basis.unit === null ||
    pricedScope.every(
      (line) => line.unit === null || normalize(line.unit) === normalize(basis.unit)
    );
  const combinedDescription = offers.map((line) => line.description).join(" ");
  const technicalCompatible = basis.technicalAttributes.every((attribute) => {
    const value = normalize(attribute.value);
    return !value || normalize(combinedDescription).includes(value);
  });
  const requiredScopeComplete =
    !offers.some(
      (line) => line.role === "NOT_OFFERED" || line.role === "PRICE_ON_REQUEST"
    ) &&
    basis.requiredScope.every(
      (scope) =>
        normalize(combinedDescription).includes(normalize(scope)) ||
        tokenSimilarity(scope, combinedDescription) >= 0.18
    );
  const optionalSeparated = offers.every(
    (line) => line.role !== "OPTIONAL" || Boolean(line.groupId)
  );
  const bundleCompatible =
    offers.filter((line) => line.role === "PRIMARY").length <= 1 ||
    offers.some((line) => line.role === "REQUIRED_COMPONENT");
  const evidenceSufficient = offers.every((line) =>
    line.evidence.some((evidence) =>
      ["VERIFIED_NATIVE", "VERIFIED_VISUAL"].includes(evidence.status)
    )
  );
  const reasons: string[] = [];
  if (!quantityCompatible) reasons.push("Menge weicht ab");
  if (!unitCompatible) reasons.push("Einheit ist nicht kompatibel");
  if (!technicalCompatible) reasons.push("Technische Merkmale weichen ab");
  if (!requiredScopeComplete) reasons.push("Pflichtumfang ist nicht vollständig");
  if (!optionalSeparated) reasons.push("Optionalposition ist nicht getrennt");
  if (!bundleCompatible) reasons.push("Bundle-Zusammensetzung ist unklar");
  if (!evidenceSufficient) reasons.push("Evidence ist nicht ausreichend");
  return {
    quantityCompatible,
    unitCompatible,
    technicalCompatible,
    requiredScopeComplete,
    optionalSeparated,
    bundleCompatible,
    evidenceSufficient,
    reasons
  };
}

export function classifyOfferCompleteness(line: OfferLine): OfferCompletenessStatus {
  if (line.completenessStatus) return line.completenessStatus;
  if (line.role === "NOT_OFFERED") return "NOT_OFFERED";
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

function optionStatus(option: Omit<SupplierOption, "status">): RecommendationStatus {
  const hasOffer =
    option.matchedOfferLineIds.length > 0 &&
    !option.missingComponents.includes("NOT_OFFERED");
  return recommendationStatus({
    matchingConfirmed: option.matchingAccepted,
    priceValidated:
      option.extractionValidated && option.comparableTotal !== null,
    quantityCompatible: option.quantityCompatible,
    unitCompatible: option.unitCompatible,
    requiredScopeEquivalent: option.requiredScopeComplete,
    mandatoryComponentsIncluded: option.missingComponents.length === 0,
    technicalDeviation: !option.technicalCompatible,
    optionalSeparated: option.optionalSeparated,
    evidenceSufficient: option.evidenceSufficient,
    hasOffer
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
      const supplierLineIds = new Set(
        input.offers
          .filter((offer) => offer.documentId === supplier.id)
          .map((offer) => offer.line.id)
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
      const primary = lines.find((line) => line.role === "PRIMARY") ?? lines[0];
      const mandatory = lines.filter((line) => line.role === "REQUIRED_COMPONENT");
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
      if (lines.some((line) => classifyOfferCompleteness(line) === "NOT_OFFERED")) {
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
      const comparableTotal =
        primaryPrice !== null &&
        mandatoryComponentPrices.length === mandatory.length &&
        validationIssueIds.length === 0
          ? primaryPrice +
            mandatoryComponentPrices.reduce((sum, price) => sum + price, 0)
          : null;
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
        comparableTotal,
        quantity: primary?.quantity ?? null,
        unit: primary?.unit ?? null,
        scopeOfSupply: lines
          .filter((line) => !["OPTIONAL", "ALTERNATIVE"].includes(line.role))
          .map((line) => line.description),
        technicalDeviations: constraints.technicalCompatible
          ? []
          : ["Extrahierte technische Merkmale sind nicht vollständig kompatibel"],
        missingComponents,
        validationIssueIds,
        evidenceIds: Array.from(
          new Set(lines.flatMap((line) => line.evidence.map((evidence) => evidence.id)))
        ),
        quantityCompatible: constraints.quantityCompatible,
        unitCompatible: constraints.unitCompatible,
        technicalCompatible: constraints.technicalCompatible,
        requiredScopeComplete: constraints.requiredScopeComplete,
        optionalSeparated: constraints.optionalSeparated,
        evidenceSufficient: constraints.evidenceSufficient,
        extractionValidated,
        matchingAccepted
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
        recommendedSupplierDocumentId: sorted[0].supplierDocumentId,
        reasons: [
          "Alle fachlichen und evidenzbezogenen Gates sind erfüllt",
          "Optionale und alternative Preise bleiben getrennt",
          "Niedrigster vergleichbarer Gesamtpreis unter den freigegebenen Optionen"
        ],
        requiresOperatorConfirmation: true
      };
    }
    const priority: RecommendationStatus[] = [
      "TECHNICAL_DEVIATION",
      "PRICE_UNCLEAR",
      "DIFFERENT_SCOPE_OF_SUPPLY",
      "MATCHING_UNCLEAR",
      "DECISION_REQUIRED",
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
          positionOptions.flatMap((option) => [
            ...(option.validationIssueIds.length
              ? ["Blockierende Extraktionsprüfung offen"]
              : []),
            ...(!option.matchingAccepted ? ["Zuordnung nicht bestätigt"] : []),
            ...(option.comparableTotal === null
              ? ["Kein belastbarer vergleichbarer Gesamtpreis"]
              : []),
            ...option.technicalDeviations,
            ...option.missingComponents
          ])
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
