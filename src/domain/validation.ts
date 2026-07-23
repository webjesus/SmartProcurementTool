import { createHash } from "node:crypto";
import type {
  EvidenceReference,
  ExtractionEnvelope,
  IssueCode,
  OfferLine
} from "@/domain/contracts";
import { assertEvidenceOwnership } from "@/domain/repositories";
import type { ParsedPage } from "@/domain/repositories";

export interface ValidationIssue {
  id: string;
  code: IssueCode;
  severity: "BLOCKING" | "WARNING";
  field?: string;
  message: string;
  documentId?: string;
  pageNumber?: number;
  lineId?: string;
  evidenceIds?: string[];
  affectedFields?: string[];
}

function stableIssueId(code: IssueCode, subject = "page", field = ""): string {
  return `issue_${createHash("sha256")
    .update(`${code}:${subject}:${field}`)
    .digest("hex")
    .slice(0, 18)}`;
}

function issue(
  code: IssueCode,
  severity: ValidationIssue["severity"],
  message: string,
  context: Partial<ValidationIssue> = {}
): ValidationIssue {
  const field = context.field ?? context.affectedFields?.join(",") ?? "";
  return {
    id: stableIssueId(code, context.lineId ?? context.documentId ?? "page", field),
    code,
    severity,
    message,
    ...context
  };
}

export function parseGermanNumber(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/\s/g, "")
    .replace(/[€$]/g, "")
    .replace(/[^\d,.\-+]/g, "");

  if (!cleaned || !/[0-9]/.test(cleaned)) return null;

  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (comma > dot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (dot > comma && comma >= 0) {
    normalized = cleaned.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if ((cleaned.match(/\./g) ?? []).length > 1) {
    normalized = cleaned.replace(/\./g, "");
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function pricesApproximatelyEqual(
  quantity: number,
  unitPrice: number,
  totalPrice: number,
  basis = 1,
  tolerance = 0.02
): boolean {
  if (basis <= 0) return false;
  const expected = (quantity * unitPrice) / basis;
  return Math.abs(expected - totalPrice) <= Math.max(0.02, Math.abs(totalPrice) * tolerance);
}

export function validateEvidence(
  evidence: EvidenceReference[],
  documentId: string,
  pageNumber: number,
  validTextItemIds: Set<string>
): ValidationIssue[] {
  if (evidence.length === 0) {
    return [
      issue("EVIDENCE_MISSING", "BLOCKING", "Für dieses Feld fehlt ein prüfbarer Quellenbeleg.", {
        documentId,
        pageNumber
      })
    ];
  }

  const invalid = evidence.some(
    (item) =>
      !assertEvidenceOwnership(item, documentId, pageNumber, validTextItemIds) ||
      ["MISSING", "CONFLICTING", "VISUAL_ONLY_UNCONFIRMED"].includes(item.status)
  );
  return invalid
    ? [
        issue(
          "EVIDENCE_CONFLICTING",
          "BLOCKING",
          "Der Quellenbeleg gehört nicht zur angegebenen Dokumentseite.",
          {
            documentId,
            pageNumber,
            evidenceIds: evidence.map((item) => item.id)
          }
        )
      ]
    : [];
}

export function validateOfferLine(
  line: OfferLine,
  context?: {
    documentId: string;
    pageNumber: number;
    validTextItemIds: Set<string>;
  }
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issueContext = {
    documentId: context?.documentId,
    pageNumber: context?.pageNumber,
    lineId: line.id,
    evidenceIds: line.evidence.map((item) => item.id)
  };

  for (const candidate of line.moneyCandidates) {
    if (candidate.amount !== null) {
      const parsed = parseGermanNumber(candidate.rawValue);
      if (parsed === null || Math.abs(parsed - candidate.amount) > 0.005) {
        issues.push(
          issue(
            "PRICE_COLUMN_CONFLICT",
            "BLOCKING",
            "Der normalisierte Geldwert stimmt nicht mit dem gedruckten deutschen Zahlenformat überein.",
            {
              ...issueContext,
              field: "moneyCandidates",
              affectedFields: ["moneyCandidates"]
            }
          )
        );
      }
    }
    const candidateSource = candidate.evidence.map((item) => item.sourceText).join(" ");
    if (
      candidate.rawValue &&
      !candidateSource.replace(/\s/g, "").includes(candidate.rawValue.replace(/\s/g, ""))
    ) {
      issues.push(
        issue(
          "EVIDENCE_CONFLICTING",
          "BLOCKING",
          "Der gedruckte Geldwert ist im zugeordneten Quellenbeleg nicht vorhanden.",
          {
            ...issueContext,
            field: "moneyCandidates",
            evidenceIds: candidate.evidence.map((item) => item.id),
            affectedFields: ["moneyCandidates"]
          }
        )
      );
    }
  }

  for (const kind of ["UNIT_PRICE", "TOTAL_PRICE"] as const) {
    const values = new Set(
      line.moneyCandidates
        .filter((candidate) => candidate.kind === kind && candidate.amount !== null)
        .map((candidate) => candidate.amount)
    );
    if (values.size > 1) {
      issues.push(
        issue(
          "PRICE_COLUMN_CONFLICT",
          "BLOCKING",
          "Mehrere widersprüchliche Geldwerte wurden derselben Preisspalte zugeordnet.",
          {
            ...issueContext,
            field: "moneyCandidates",
            affectedFields: ["moneyCandidates", "interpretedUnitPrice", "interpretedTotalPrice"]
          }
        )
      );
    }
  }

  if (line.interpretedUnitPrice !== null && line.interpretedTotalPrice !== null) {
    if (line.quantity === null || line.priceBasis === null) {
      issues.push({
        ...issue(
          "PRICE_BASIS_UNCLEAR",
          "BLOCKING",
          "Preis, Menge oder Preisbasis sind nicht eindeutig belegt.",
          {
            ...issueContext,
            field: "priceBasis",
            affectedFields: ["quantity", "priceBasis", "interpretedUnitPrice", "interpretedTotalPrice"]
          }
        ),
        field: "priceBasis",
      });
    } else if (
      !pricesApproximatelyEqual(
        line.quantity,
        line.interpretedUnitPrice,
        line.interpretedTotalPrice,
        line.priceBasis
      )
    ) {
      issues.push({
        ...issue(
          "PRICE_ARITHMETIC_MISMATCH",
          "BLOCKING",
          "Menge × Einheitspreis stimmt nicht mit dem Gesamtpreis überein.",
          {
            ...issueContext,
            field: "interpretedTotalPrice",
            affectedFields: ["quantity", "priceBasis", "interpretedUnitPrice", "interpretedTotalPrice"]
          }
        ),
        field: "interpretedTotalPrice",
      });
    }
  }

  if (line.role === "OPTIONAL" && line.groupId === null) {
    issues.push({
      ...issue(
        "OPTIONAL_PRIMARY_AMBIGUOUS",
        "WARNING",
        "Optionalposition ist keiner Hauptposition eindeutig zugeordnet.",
        { ...issueContext, field: "role", affectedFields: ["role", "groupId"] }
      ),
      field: "role",
    });
  }
  if (line.role === "ALTERNATIVE" && line.groupId === null) {
    issues.push(
      issue(
        "ALTERNATIVE_DIRECT_CONFLICT",
        "WARNING",
        "Alternativposition ist keiner Bezugsposition eindeutig zugeordnet.",
        { ...issueContext, field: "role", affectedFields: ["role", "groupId"] }
      )
    );
  }
  if (
    line.role === "NOT_OFFERED" &&
    (line.interpretedUnitPrice !== null ||
      line.interpretedTotalPrice !== null ||
      line.moneyCandidates.length > 0)
  ) {
    issues.push(
      issue(
        "PRICE_COLUMN_CONFLICT",
        "BLOCKING",
        "Eine als nicht angeboten markierte Zeile enthält zugleich Geldwerte.",
        {
          ...issueContext,
          field: "role",
          affectedFields: ["role", "moneyCandidates", "interpretedUnitPrice", "interpretedTotalPrice"]
        }
      )
    );
  }
  if (line.continuation) {
    issues.push(
      issue(
        "PAGE_CONTINUATION_AMBIGUOUS",
        "WARNING",
        "Die Zeile wird auf einer anderen Seite fortgesetzt und benötigt eine Seitenprüfung.",
        { ...issueContext, field: "continuation", affectedFields: ["continuation"] }
      )
    );
  }

  if (line.evidence.length === 0) {
    issues.push(
      issue("EVIDENCE_MISSING", "BLOCKING", "Extrahierte Zeile besitzt keinen Quellenbeleg.", {
        ...issueContext,
        affectedFields: ["evidence"]
      })
    );
  } else if (context) {
    issues.push(
      ...validateEvidence(
        line.evidence,
        context.documentId,
        context.pageNumber,
        context.validTextItemIds
      ).map((item) => ({ ...item, lineId: line.id, affectedFields: ["evidence"] }))
    );
  }

  return Array.from(new Map(issues.map((item) => [item.id, item])).values());
}

export function canMachineValidate(line: OfferLine, issues: ValidationIssue[]): boolean {
  return (
    line.evidence.some((e) => e.status === "VERIFIED_NATIVE" || e.status === "VERIFIED_VISUAL") &&
    !issues.some((issue) => issue.severity === "BLOCKING")
  );
}

function canonicalizeEvidence(
  references: EvidenceReference[],
  documentId: string,
  page: ParsedPage
): EvidenceReference[] {
  const textItems = new Map(page.textItems.map((item) => [item.id, item]));
  return references.map((reference) => {
    if (reference.documentId !== documentId || reference.pageNumber !== page.pageNumber) {
      return { ...reference, sourceText: "", cropPath: null, status: "CONFLICTING" };
    }
    if (reference.textItemIds.length === 0) {
      return {
        ...reference,
        cropPath: null,
        status: page.mode === "DIGITAL" ? "MISSING" : "VISUAL_ONLY_UNCONFIRMED"
      };
    }

    const items = reference.textItemIds
      .map((id) => textItems.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => left.order - right.order);
    if (items.length !== reference.textItemIds.length) {
      return { ...reference, sourceText: "", cropPath: null, status: "CONFLICTING" };
    }

    const minX = Math.min(...items.map((item) => item.region.x));
    const minY = Math.min(...items.map((item) => item.region.y));
    const maxX = Math.max(...items.map((item) => item.region.x + item.region.width));
    const maxY = Math.max(...items.map((item) => item.region.y + item.region.height));
    return {
      ...reference,
      sourceText: items.map((item) => item.rawText).join(" ").replace(/\s+/g, " ").trim(),
      region: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      cropPath: null,
      status: "VERIFIED_NATIVE"
    };
  });
}

export function canonicalizeExtractionEvidence(
  envelope: ExtractionEnvelope,
  documentId: string,
  page: ParsedPage
): ExtractionEnvelope {
  const result = structuredClone(envelope);
  const normalize = (references: EvidenceReference[]) =>
    canonicalizeEvidence(references, documentId, page);

  for (const metadata of result.extraction.documentMetadataCandidates) {
    metadata.evidence = normalize(metadata.evidence);
  }
  for (const section of result.extraction.sections) section.evidence = normalize(section.evidence);
  for (const group of result.extraction.offerGroups) {
    group.evidence = normalize(group.evidence);
    for (const adjustment of group.adjustments) adjustment.evidence = normalize(adjustment.evidence);
    for (const line of group.lines) {
      line.evidence = normalize(line.evidence);
      for (const candidate of line.moneyCandidates) {
        candidate.evidence = normalize(candidate.evidence);
      }
    }
  }
  for (const basisPosition of result.extraction.basisPositions) {
    basisPosition.evidence = normalize(basisPosition.evidence);
  }
  return result;
}

export function validatePageExtraction(
  envelope: ExtractionEnvelope,
  page: ParsedPage
): ValidationIssue[] {
  const validTextItemIds = new Set(page.textItems.map((item) => item.id));
  const documentId = envelope.extraction.documentId;
  const issues = envelope.extraction.offerGroups.flatMap((group) =>
    group.lines.flatMap((line) =>
      validateOfferLine(line, {
        documentId,
        pageNumber: page.pageNumber,
        validTextItemIds
      })
    )
  );

  for (const position of envelope.extraction.basisPositions) {
    issues.push(
      ...validateEvidence(
        position.evidence,
        documentId,
        page.pageNumber,
        validTextItemIds
      ).map((item) => ({
        ...item,
        lineId: position.id,
        affectedFields: ["evidence"]
      }))
    );
  }

  for (const note of envelope.extraction.unresolvedNotes) {
    issues.push(
      issue(
        "ROW_BOUNDARY_AMBIGUOUS",
        "WARNING",
        `Open extraction question: ${note}`,
        { documentId, pageNumber: page.pageNumber, affectedFields: ["unresolvedNotes"] }
      )
    );
  }

  return Array.from(new Map(issues.map((item) => [item.id, item])).values());
}
