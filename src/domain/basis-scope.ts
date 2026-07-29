import type {
  BasisPosition,
  BasisScopeProfile,
  BasisScopeRequirement,
  EvidenceReference,
  ExtractedSection
} from "@/domain/contracts";

export interface BasisScopePage {
  pageNumber: number;
  positions: readonly BasisPosition[];
  sections: readonly ExtractedSection[];
}

const normalized = (value: string) =>
  value
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const installationPattern =
  /\b(montier|montage|installation|arbeits|dichtung|kleinmaterial|inbetrieb|anschlussarbeiten)\w*/i;
const executionPattern = /\b(liefer|ausfuhr|leistung|bereitstell)\w*/i;
const thermalInsulationPattern =
  /\b(warmedamm|warmedaemm|warmisol|damm(?:schale|ung)|daemm(?:schale|ung)|isolier(?:ung|schale))\w*/i;

function referenceNumber(value: string): string | null {
  return normalized(value).match(/\bausfuhrungsbeschreibung\s*(\d+)\b/)?.[1] ?? null;
}

function requirementCode(label: string): string {
  return normalized(label)
    .toLocaleUpperCase("de")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function requirement(input: {
  code?: string;
  label: string;
  category: BasisScopeRequirement["category"];
  inherited: boolean;
  evidence: readonly EvidenceReference[];
}): BasisScopeRequirement {
  return {
    code: input.code ?? requirementCode(input.label),
    label: input.label,
    category: input.category,
    inherited: input.inherited,
    evidence: [...input.evidence]
  };
}

function classifyRequirement(
  label: string
): BasisScopeRequirement["category"] {
  const value = normalized(label);
  if (installationPattern.test(value)) return "INSTALLATION";
  if (executionPattern.test(value)) return "EXECUTION";
  return "MATERIAL";
}

function thermalInsulationRequirement(
  text: string,
  evidence: readonly EvidenceReference[],
  inherited: boolean
): BasisScopeRequirement[] {
  if (!thermalInsulationPattern.test(normalized(text))) return [];
  return [
    requirement({
      code: "THERMAL_INSULATION",
      label: "Wärmedämmschale",
      category: "MATERIAL",
      inherited,
      evidence
    })
  ];
}

function uniqueRequirements(
  requirements: readonly BasisScopeRequirement[]
): BasisScopeRequirement[] {
  return Array.from(
    new Map(
      requirements.map((item) => [
        `${item.category}:${item.code}`,
        item
      ])
    ).values()
  );
}

function directRequirements(position: BasisPosition): BasisScopeRequirement[] {
  return position.requiredScope.map((label) =>
    requirement({
      label,
      category: classifyRequirement(label),
      inherited: false,
      evidence: position.evidence
    })
  );
}

export function buildBasisScopeProfiles(input: {
  positions: readonly BasisPosition[];
  pages: readonly BasisScopePage[];
}): BasisPosition[] {
  const pages = [...input.pages].sort(
    (left, right) => left.pageNumber - right.pageNumber
  );
  const headings = pages.flatMap((page) =>
    page.positions
      .map((position, order) => ({ position, order }))
      .filter(({ position }) => position.heading)
      .flatMap(({ position, order }) => {
        const reference = referenceNumber(
          [position.description, ...position.notes].join(" ")
        );
        return reference
          ? [{ reference, pageNumber: page.pageNumber, order, position }]
          : [];
      })
  );

  const inheritedSources = new Map<
    string,
    Array<{ text: string; evidence: EvidenceReference[] }>
  >();
  for (const heading of headings) {
    inheritedSources.set(heading.reference, [
      {
        text: heading.position.description,
        evidence: [...heading.position.evidence]
      }
    ]);
  }
  for (const page of pages) {
    const precedingHeading = headings
      .filter((heading) => heading.pageNumber < page.pageNumber)
      .sort(
        (left, right) =>
          right.pageNumber - left.pageNumber || right.order - left.order
      )[0];
    if (!precedingHeading) continue;
    const continuation = page.sections.filter(
      (section) =>
        section.kind === "NOTE" &&
        normalized(section.label).includes("fortsetzung")
    );
    for (const section of continuation) {
      const text = section.evidence
        .map((evidence) => evidence.sourceText)
        .filter(Boolean)
        .join(" ");
      if (!text) continue;
      inheritedSources.set(precedingHeading.reference, [
        ...(inheritedSources.get(precedingHeading.reference) ?? []),
        { text, evidence: [...section.evidence] }
      ]);
    }
  }

  return input.positions.map((position) => {
    const reference = referenceNumber(
      [position.description, ...position.notes].join(" ")
    );
    const sources = reference
      ? inheritedSources.get(reference) ?? []
      : [];
    const direct = directRequirements(position);
    const inheritedMaterialRequirements = uniqueRequirements(
      sources.flatMap((source) =>
        thermalInsulationRequirement(source.text, source.evidence, true)
      )
    );
    const inheritedInstallationRequirements = uniqueRequirements(
      headings
        .filter((heading) => heading.reference === reference)
        .flatMap((heading) =>
          heading.position.requiredScope
            .filter(
              (label) => classifyRequirement(label) === "INSTALLATION"
            )
            .map((label) =>
              requirement({
                label,
                category: "INSTALLATION",
                inherited: true,
                evidence: heading.position.evidence
              })
            )
        )
    );
    const mainProduct = requirement({
      code: "MAIN_PRODUCT",
      label: position.description,
      category: "MATERIAL",
      inherited: false,
      evidence: position.evidence
    });
    const procurementMaterialScope = uniqueRequirements([
      mainProduct,
      ...direct.filter((item) => item.category === "MATERIAL"),
      ...inheritedMaterialRequirements
    ]);
    const fullLvExecutionScope = uniqueRequirements([
      ...procurementMaterialScope,
      ...direct.filter((item) => item.category !== "MATERIAL"),
      ...inheritedInstallationRequirements
    ]);
    const scopeProfile: BasisScopeProfile = {
      directLeafDescription: position.description,
      directLeafEvidence: [...position.evidence],
      inheritedExecutionDescription: sources.map((source) => source.text),
      inheritedMaterialRequirements,
      inheritedInstallationRequirements,
      fullLvExecutionScope,
      procurementMaterialScope,
      referenceResolved: reference === null || sources.length > 0
    };
    return { ...position, scopeProfile };
  });
}

export function supplierTextSatisfiesMaterialRequirement(
  requirement: BasisScopeRequirement,
  supplierText: string
): boolean {
  const text = normalized(supplierText);
  if (requirement.code === "MAIN_PRODUCT") return true;
  if (requirement.code === "THERMAL_INSULATION") {
    return thermalInsulationPattern.test(text);
  }
  const expected = normalized(requirement.label);
  return Boolean(expected && text.includes(expected));
}
