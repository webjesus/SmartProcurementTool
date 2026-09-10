import type { BasisPosition } from "@/domain/contracts";

export type DisplayRequirement = {
  name: string;
  value: string;
};

function comparable(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("de");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseAdjacentDuplicateWords(value: string): string {
  let result = value;
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = result.replace(/\b([\p{L}][\p{L}\p{M}-]*)\s+\1\b/giu, "$1");
  }
  return result;
}

function collapseAdjacentDuplicateSentences(value: string): string {
  const fragments = value.match(/[^.!?]+[.!?]?/g) ?? [value];
  const result: string[] = [];
  for (const fragment of fragments) {
    const cleaned = fragment.trim();
    if (!cleaned) continue;
    const previous = result.at(-1);
    if (previous && comparable(previous) === comparable(cleaned)) continue;
    result.push(cleaned);
  }
  return result.join(" ");
}

/**
 * Presentation-only cleanup. It deliberately does not parse, round or replace
 * extracted values and must never be persisted back into extraction records.
 */
export function normalizeDisplayText(raw: string, positionNumber?: string): string {
  const normalizedLines = raw
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, index, lines) => {
      if (!line) return false;
      return index === 0 || comparable(line) !== comparable(lines[index - 1] ?? "");
    });

  let result = normalizedLines.join(" ");

  if (positionNumber) {
    const number = escapeRegExp(positionNumber.trim().replace(/\.$/, ""));
    const repeatedPosition = new RegExp(`^(?:${number}\\.?\\s*){1,}`, "i");
    result = result.replace(repeatedPosition, "").trim();
  }

  result = collapseAdjacentDuplicateSentences(result)
    .replace(/^[\-–—•·:;]+\s*/, "")
    .replace(/\s+([,;:!?])/g, "$1")
    .replace(/\s+\./g, ".")
    .replace(/\s+/g, " ")
    .trim();

  return collapseAdjacentDuplicateWords(result);
}

export function uniqueDisplayTexts(values: string[], positionNumber?: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = normalizeDisplayText(value, positionNumber);
    const key = comparable(cleaned);
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

export function displayPositionTitle(position: BasisPosition): string {
  const direct = position.scopeProfile?.directLeafDescription || position.description;
  return normalizeDisplayText(direct, position.positionNumber);
}

export function displayShortDescription(position: BasisPosition): string {
  const title = displayPositionTitle(position);
  const firstTwoSentences = title.match(/[^.!?]+[.!?]?/g)?.slice(0, 2) ?? [title];
  return firstTwoSentences.join(" ").trim();
}

function cleanRequirementLabel(raw: string): string {
  const cleaned = normalizeDisplayText(raw)
    .replace(/^[\-–—•·]+\s*/, "")
    .replace(/\s*:\s*$/, "")
    .trim();
  if (/^art\.?\s*-?\s*nr\.?$/i.test(cleaned)) return "Artikelnummer";
  return cleaned;
}

export function displayTechnicalRequirements(position: BasisPosition): {
  technical: DisplayRequirement[];
  additional: DisplayRequirement[];
} {
  const seen = new Set<string>();
  const technical: DisplayRequirement[] = [];
  const additional: DisplayRequirement[] = [];

  for (const attribute of position.technicalAttributes) {
    const name = cleanRequirementLabel(attribute.name);
    const value = normalizeDisplayText(attribute.value);
    const key = `${comparable(name)}\u0000${comparable(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item = { name: name || "Weitere Anforderung", value };
    if (!name || !/\p{L}/u.test(name)) additional.push(item);
    else technical.push(item);
  }

  return { technical, additional };
}

export function displayInstallationRequirements(position: BasisPosition): string[] {
  const profile = position.scopeProfile;
  const values = [
    ...(profile?.inheritedInstallationRequirements.map((requirement) => requirement.label) ?? []),
    ...(profile?.fullLvExecutionScope
      .filter(
        (requirement) =>
          requirement.category === "INSTALLATION" || requirement.category === "EXECUTION"
      )
      .map((requirement) => requirement.label) ?? []),
    ...position.requiredScope
  ];
  return uniqueDisplayTexts(values, position.positionNumber);
}

export function displayExecutionDescription(position: BasisPosition): string[] {
  return uniqueDisplayTexts(
    position.scopeProfile?.inheritedExecutionDescription ?? [],
    position.positionNumber
  );
}

export function displayManufacturerAndType(position: BasisPosition): string {
  const manufacturers = uniqueDisplayTexts(position.manufacturerRequirements);
  const description = normalizeDisplayText(position.description);
  const typeMatch = description.match(
    /\b(?:Typ|Type|Modell)\s*:?\s*([^,;.\n]{1,90}?)(?=\s+(?:Art\.?\s*-?\s*Nr|Nenninhalt|Abmessungen?|Inhalt|Bereitschaftsverlust|Komplett\s+liefern)\b|[,;.]|$)/i
  );
  const type = typeMatch?.[1]?.trim();
  return uniqueDisplayTexts([...manufacturers, ...(type ? [`Typ ${type}`] : [])]).join(" · ");
}
