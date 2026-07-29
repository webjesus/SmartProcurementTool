import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PdfJsDocumentParser } from "../src/pdf/pdfjs-parser";
import type { Discipline, DocumentType, PageMode } from "../src/domain/contracts";
import { normalizeLvPositionReference } from "../src/domain/matching";

interface PageInventory {
  pageNumber: number;
  mode: PageMode;
  textItems: number;
  characters: number;
  images: number;
  lvPositionReferences: string[];
}

interface DocumentInventory {
  id: string;
  relativePath: string;
  extension: string;
  bytes: number;
  sha256: string;
  pages: PageInventory[];
  documentType: DocumentType;
  discipline: Discipline;
  roleConfidence: "HIGH" | "MEDIUM" | "LOW" | "OPERATOR";
  dateHints: string[];
  layoutPatterns: string[];
  risks: string[];
  projectKey?: string;
  supplier?: string;
  offerNumber?: string;
  revision?: number;
  active?: boolean;
  supersededByDocumentId?: string;
  relevantPositionNumbers?: string[];
}

interface CorpusOverride {
  documentType?: DocumentType;
  discipline?: Discipline;
  projectKey?: string;
  supplier?: string;
  offerNumber?: string;
  revision?: number;
  active?: boolean;
  supersededByDocumentId?: string;
  relevantPositionNumbers?: string[];
  note?: string;
}

const root = process.cwd();
const corpusDir = path.resolve(root, process.env.CORPUS_DIR ?? "pdffirma");
const outputDir = path.resolve(root, ".data");
const reportPath = path.resolve(root, "docs", "CORPUS_REPORT.local.md");
const parser = new PdfJsDocumentParser();

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() ? [full] : [];
    })
  );
  return nested.flat();
}

const normalize = (value: string) =>
  value.toLocaleLowerCase("de").normalize("NFKD").replace(/\p{M}/gu, "");

function classify(text: string, fileName: string): {
  type: DocumentType;
  discipline: Discipline;
  confidence: "HIGH" | "MEDIUM" | "LOW";
} {
  const content = normalize(`${fileName}\n${text}`);
  let type: DocumentType = "UNKNOWN";
  let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";

  if (/kalkulation \(gesamt\)/.test(content) && /montagezeit/.test(content)) {
    type = "MANUFACTURER_CALCULATION";
    confidence = "HIGH";
  } else if (/kalkulationsblatt|preisspiegel|vergabevorschlag|lieferantenauswahl/.test(content)) {
    type = "HISTORICAL_CALCULATION";
    confidence = "HIGH";
  } else if (/referenzangebot|angebot nr|angebotsnummer/.test(content)) {
    type = "SUPPLIER_OFFER";
    confidence = "HIGH";
  } else if (
    /he lv (?:heizung|sanitar)/.test(content) ||
    /leistungsverzeichnis|langtext[- ]?lv|kurztext[- ]?lv/.test(content) ||
    (/\blv\b/.test(content) && /menge|einheit|position/.test(content))
  ) {
    type = "BASIS_LV";
    confidence = "HIGH";
  } else if (/warmebedarf|heizlast|auslegung|berechnung/.test(content)) {
    type = "MANUFACTURER_CALCULATION";
    confidence = "MEDIUM";
  } else if (/angebot|nettobetrag|angebotssumme|gesamtbetrag/.test(content)) {
    type = "SUPPLIER_OFFER";
    confidence = "HIGH";
  } else if (/preistabelle|preisblatt/.test(content)) {
    type = "MANUAL_PRICE_TABLE";
    confidence = "MEDIUM";
  }

  const sanitary = /sanitar|trinkwasser|abwasser|entwasser/.test(content);
  const heating = /heizung|heizlast|warme|kessel|brenner/.test(content);
  const discipline: Discipline = /he lv heizung/.test(content)
    ? "HEIZUNG"
    : /he lv sanitar/.test(content)
      ? "SANITAER"
      : sanitary && heating
        ? "MIXED"
        : sanitary
          ? "SANITAER"
          : heating
            ? "HEIZUNG"
            : "UNKNOWN";

  return { type, discipline, confidence };
}

function layoutPatterns(pages: PageInventory[]): string[] {
  const patterns = new Set<string>();
  if (pages.some((page) => page.mode === "DIGITAL")) patterns.add("native text layer");
  if (pages.some((page) => page.mode === "SCAN")) patterns.add("full-page raster scan");
  if (pages.some((page) => page.mode === "HYBRID")) patterns.add("text with embedded graphics");
  if (pages.length > 1) patterns.add("multi-page continuation risk");
  return [...patterns];
}

function technicalRisks(pages: PageInventory[], type: DocumentType): string[] {
  const risks: string[] = [];
  if (pages.some((page) => page.mode === "SCAN")) risks.push("visual extraction required");
  if (pages.some((page) => page.mode === "UNREADABLE")) risks.push("blocking unreadable page");
  if (pages.length > 1) risks.push("row continuation across pages");
  if (type === "UNKNOWN") risks.push("document type requires operator confirmation");
  return risks;
}

function dateHints(text: string): string[] {
  return Array.from(
    new Set(
      [...text.matchAll(/\b(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:20)?\d{2}\b/g)].map(
        (match) => match[0]
      )
    )
  ).slice(0, 5);
}

function lvPositionReferences(text: string): string[] {
  return Array.from(
    new Set(
      [...text.matchAll(/\b\d{1,2}\s*(?:[.\s-]\s*)\d{1,3}\s*(?:[.\s-]\s*)\d{2,4}(?:\s*[-–—]\s*\d{2,4})?/g)]
        .map((match) => normalizeLvPositionReference(match[0]))
        .filter((value): value is string => value !== null)
    )
  );
}

async function inspectDocument(filePath: string): Promise<DocumentInventory> {
  const data = new Uint8Array(await readFile(filePath));
  const sha256 = createHash("sha256").update(data).digest("hex");
  const relativePath = path.relative(corpusDir, filePath);
  const info = await parser.inspect(data);
  const pages: PageInventory[] = [];
  let sampleText = "";

  for (let pageNumber = 1; pageNumber <= info.pageCount; pageNumber += 1) {
    const page = await parser.extractPage(sha256.slice(0, 16), data, pageNumber);
    const characters = page.textItems.reduce((sum, item) => sum + item.normalizedText.length, 0);
    pages.push({
      pageNumber,
      mode: page.mode,
      textItems: page.textItems.length,
      characters,
      images: page.imageCount,
      lvPositionReferences: lvPositionReferences(
        page.textItems.map((item) => item.normalizedText).join(" ")
      )
    });
    if (pageNumber <= 3) {
      sampleText += `\n${page.textItems.map((item) => item.normalizedText).join(" ")}`;
    }
  }

  const file = await stat(filePath);
  const classification = classify(sampleText, path.basename(filePath));
  return {
    id: sha256.slice(0, 16),
    relativePath,
    extension: path.extname(filePath).toLowerCase(),
    bytes: file.size,
    sha256,
    pages,
    documentType: classification.type,
    discipline: classification.discipline,
    roleConfidence: classification.confidence,
    dateHints: dateHints(sampleText),
    layoutPatterns: layoutPatterns(pages),
    risks: technicalRisks(pages, classification.type)
  };
}

function renderReport(documents: DocumentInventory[]): string {
  const totalPages = documents.reduce((sum, document) => sum + document.pages.length, 0);
  const modeCounts = documents
    .flatMap((document) => document.pages)
    .reduce<Record<string, number>>((counts, page) => {
      counts[page.mode] = (counts[page.mode] ?? 0) + 1;
      return counts;
    }, {});
  const duplicates = documents.filter(
    (document, index) => documents.findIndex((item) => item.sha256 === document.sha256) !== index
  );
  const rows = documents
    .map((document) => {
      const modes = Object.entries(
        document.pages.reduce<Record<string, number>>((counts, page) => {
          counts[page.mode] = (counts[page.mode] ?? 0) + 1;
          return counts;
        }, {})
      )
        .map(([mode, count]) => `${mode} ${count}`)
        .join(", ");
      return `| ${document.relativePath.replace(/\|/g, "\\|")} | ${document.documentType} | ${document.discipline} | ${document.pages.length} | ${modes} | ${document.roleConfidence} |`;
    })
    .join("\n");

  return `# SmartProcurementTool local corpus report

> Local confidential artifact. Do not commit or publish.
> Generated without OpenAI or any external document upload.

## Inventory

- Files: ${documents.length}
- PDF pages: ${totalPages}
- Formats: ${Array.from(new Set(documents.map((document) => document.extension))).join(", ")}
- Page modes: ${Object.entries(modeCounts)
    .map(([mode, count]) => `${mode} ${count}`)
    .join(", ")}
- Byte-identical duplicates: ${duplicates.length}

| Document | Assumed role | Discipline | Pages | Page modes | Confidence |
| --- | --- | --- | ---: | --- | --- |
${rows}

## Layout patterns

${Array.from(new Set(documents.flatMap((document) => document.layoutPatterns)))
  .map((pattern) => `- ${pattern}`)
  .join("\n")}

## Difficulties and technical risks

${Array.from(new Set(documents.flatMap((document) => document.risks)))
  .map((risk) => `- ${risk}`)
  .join("\n")}

## Assumed relationships

- BASIS_LV documents define independent requirements and must be extracted separately.
- SUPPLIER_OFFER and MANUFACTURER_CALCULATION documents are independently extracted before matching.
- HISTORICAL_CALCULATION or FINAL_DECISION documents are isolated from extraction and matching, and used only for later evaluation.
- Similar supplier documents may be revisions or discipline-specific offers; SHA-256 and content comparison are required before linking them.

## Unknowns

- Supplier and project identities remain hints until operator confirmation.
- Same-position-number matches are never sufficient on their own.
- Optional, alternative, bundle, and page-continuation semantics require evidence-backed extraction.
- Document dates and revisions require operator confirmation where only filename hints exist.

## Processing plan

1. Parse native text items and stable normalized geometry page by page.
2. Render page previews locally; use image input only for scan or hybrid pages when needed.
3. Persist immutable supplier extraction and separate Basis-LV extraction.
4. Run deterministic evidence, arithmetic, quantity, unit, scope, and conflict validation.
5. Run matching only after extraction, then route ambiguity to the operator.
6. Compare the reviewed result with historical decisions only as an evaluation step.
`;
}

async function main() {
  const files = (await walk(corpusDir)).filter((file) => path.extname(file).toLowerCase() === ".pdf");
  const documents: DocumentInventory[] = [];
  let overrides: Record<string, CorpusOverride> = {};
  try {
    overrides = JSON.parse(
      await readFile(path.join(outputDir, "corpus-overrides.local.json"), "utf8")
    ) as Record<string, CorpusOverride>;
  } catch {
    // Operator overrides are optional and remain local.
  }

  for (const [index, file] of files.sort().entries()) {
    process.stdout.write(
      `[${String(index + 1).padStart(2, "0")}/${String(files.length).padStart(2, "0")}] Inspecting ${path.basename(file)}\n`
    );
    const document = await inspectDocument(file);
    const override = overrides[document.id];
    documents.push(
      override
        ? {
            ...document,
            documentType: override.documentType ?? document.documentType,
            discipline: override.discipline ?? document.discipline,
            projectKey: override.projectKey ?? document.projectKey,
            supplier: override.supplier ?? document.supplier,
            offerNumber: override.offerNumber ?? document.offerNumber,
            revision: override.revision ?? document.revision,
            active: override.active ?? document.active,
            supersededByDocumentId:
              override.supersededByDocumentId ??
              document.supersededByDocumentId,
            relevantPositionNumbers:
              override.relevantPositionNumbers ??
              document.relevantPositionNumbers,
            roleConfidence: "OPERATOR",
            risks: document.risks.filter(
              (risk) => risk !== "document type requires operator confirmation"
            )
          }
        : document
    );
  }

  await mkdir(outputDir, { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(
    path.join(outputDir, "corpus-manifest.local.json"),
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        openAiUsed: false,
        documents
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(reportPath, renderReport(documents), "utf8");
  process.stdout.write(
    `Completed: ${documents.length} documents, ${documents.reduce((sum, item) => sum + item.pages.length, 0)} pages. OpenAI used: no.\n`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
