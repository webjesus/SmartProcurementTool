import type { BasisPosition, MatchLink, OfferLine } from "@/domain/contracts";

const normalize = (value: string | null | undefined) =>
  (value ?? "")
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const tokens = (value: string) => new Set(normalize(value).split(" ").filter((token) => token.length > 2));

function tokenSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return (2 * intersection) / (a.size + b.size);
}

export function scoreMatch(basis: BasisPosition, offer: OfferLine): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = tokenSimilarity(basis.description, offer.description) * 0.5;

  if (
    basis.positionNumber &&
    [offer.sourcePositionNumber, offer.supplierPositionNumber]
      .map(normalize)
      .includes(normalize(basis.positionNumber))
  ) {
    score += 0.2;
    reasons.push("Positionsnummer stimmt überein");
  }

  if (basis.unit && offer.unit && normalize(basis.unit) === normalize(offer.unit)) {
    score += 0.1;
    reasons.push("Einheit stimmt überein");
  }

  if (basis.quantity !== null && offer.quantity !== null) {
    const delta = Math.abs(basis.quantity - offer.quantity);
    if (delta <= Math.max(0.001, basis.quantity * 0.01)) {
      score += 0.1;
      reasons.push("Menge ist kompatibel");
    }
  }

  const requiredManufacturers = basis.manufacturerRequirements.map(normalize);
  if (
    offer.manufacturer &&
    requiredManufacturers.some((value) => value.includes(normalize(offer.manufacturer)))
  ) {
    score += 0.1;
    reasons.push("Herstelleranforderung erfüllt");
  }

  if (tokenSimilarity(basis.description, offer.description) >= 0.55) {
    reasons.push("Beschreibung ist semantisch ähnlich");
  }

  return { score: Math.min(1, score), reasons };
}

export function proposeMatches(basis: BasisPosition[], offers: OfferLine[]): MatchLink[] {
  return basis.flatMap((position) => {
    if (position.heading) return [];
    const candidates = offers
      .map((offer) => ({ offer, ...scoreMatch(position, offer) }))
      .filter((candidate) => candidate.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return candidates.map((candidate, index) => ({
      id: crypto.randomUUID(),
      basisPositionIds: [position.id],
      offerLineIds: [candidate.offer.id],
      kind: "ONE_TO_ONE" as const,
      status:
        candidate.offer.role === "NOT_OFFERED"
          ? ("NOT_OFFERED" as const)
          : candidate.score >= 0.82 && index === 0
            ? ("EXACT" as const)
            : ("PROBABLE" as const),
      score: candidate.score,
      reasons: candidate.reasons,
      confirmedByOperator: false
    }));
  });
}

export function matchConstraints(
  basis: BasisPosition,
  offers: OfferLine[]
): { quantityCompatible: boolean; unitCompatible: boolean; requiredScopeComplete: boolean } {
  const quantity = offers.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  const quantityCompatible =
    basis.quantity === null ||
    Math.abs(quantity - basis.quantity) <= Math.max(0.001, basis.quantity * 0.01);
  const unitCompatible =
    basis.unit === null ||
    offers.every((line) => line.unit === null || normalize(line.unit) === normalize(basis.unit));
  const requiredScopeComplete = !offers.some(
    (line) => line.role === "NOT_OFFERED" || line.role === "PRICE_ON_REQUEST"
  );
  return { quantityCompatible, unitCompatible, requiredScopeComplete };
}
