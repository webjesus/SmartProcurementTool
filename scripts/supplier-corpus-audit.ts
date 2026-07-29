import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDocumentRevisionIndex } from "@/domain/decision";
import {
  buildSupplierCorpusAudit,
  type PriceDiscrepancyCode
} from "@/domain/supplier-corpus-audit";
import { LocalPilotPersistence } from "@/storage/document-storage";

async function main() {
const root = process.cwd();
const persistence = new LocalPilotPersistence(path.join(root, ".data"), true);
const state = await persistence.read();
const audit = buildSupplierCorpusAudit({
  state,
  documentRevisions: buildDocumentRevisionIndex(state.runs)
});
const datasetPath = path.join(
  root,
  ".data",
  "supplier-corpus-audit.local.json"
);
const reportPath = path.join(
  root,
  "docs",
  "TECHNICAL_CORPUS_AUDIT.local.md"
);
await mkdir(path.dirname(datasetPath), { recursive: true });
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(datasetPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

const discrepancyCounts = new Map<PriceDiscrepancyCode, number>();
for (const row of audit.rows) {
  for (const code of row.discrepancyCodes) {
    discrepancyCounts.set(code, (discrepancyCounts.get(code) ?? 0) + 1);
  }
}
const metricRows = Object.keys(audit.after).map((key) => {
  const before = audit.before[key as keyof typeof audit.before];
  const after = audit.after[key as keyof typeof audit.after];
  return `| ${key} | ${before} | ${after} |`;
});
const discrepancyRows = [...discrepancyCounts.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([code, count]) => `| ${code} | ${count} |`);
const criticalRows = audit.rows.filter((row) =>
  row.discrepancyCodes.some((code) =>
    [
      "SOURCE_GP_PRESENT_UI_MISSING",
      "GP_PRESENT_MARKED_NO_PRICE",
      "PRICE_WITHOUT_SOURCE",
      "SOURCE_LINE_NOT_LINKED",
      "OPTION_WITHOUT_REAL_LINE"
    ].includes(code)
  )
);
const report = `# Technical supplier corpus audit

Generated: ${audit.generatedAt}

This is a deterministic read-only audit of the existing immutable extraction.
No extraction, MatchLink, bundle, decision, or evidence value was rewritten.

## Metrics before / after corrected read model

| Metric | Before | After |
|---|---:|---:|
${metricRows.join("\n")}

## Discrepancy groups

| Code | Audit rows |
|---|---:|
${discrepancyRows.join("\n")}

## Critical / operator-visible rows

${criticalRows.length} rows remain grouped in the local JSON dataset for
technical or operator review. Placeholder options remain non-selectable.

Dataset: \`.data/supplier-corpus-audit.local.json\`

## Operator workspace structure

- Basis structure interpretation: \`${audit.operatorWorkspace.basisStructureVersion}\`
- Supplier option read model: \`${audit.operatorWorkspace.optionReadModelVersion}\`
- Multi-component Basis positions: ${audit.operatorWorkspace.multiComponentPositions}
- Positions requiring component selection: ${audit.operatorWorkspace.positionsRequiringComponentSelection}
- Existing selected legacy decisions audited: ${audit.operatorWorkspace.legacySelectedDecisionsAudited}
- Potential false single-line selections: ${audit.operatorWorkspace.potentialFalseSingleLineSelections}
- Existing partial selections (warning only; not rewritten): ${audit.operatorWorkspace.existingPartialSelections}
- Positions with continuation page evidence: ${audit.operatorWorkspace.continuationPagePositions}
- Unclear Basis structures: ${audit.operatorWorkspace.unclearStructurePositions}

### Basis structure counts

\`\`\`json
${JSON.stringify(audit.operatorWorkspace.basisStructureCounts, null, 2)}
\`\`\`

### Package completeness counts

\`\`\`json
${JSON.stringify(audit.operatorWorkspace.packageCompletenessCounts, null, 2)}
\`\`\`

### Price provenance counts

\`\`\`json
${JSON.stringify(audit.operatorWorkspace.priceProvenanceCounts, null, 2)}
\`\`\`

## Correction versions

- Price and option read model: \`supplier-option-read-model-v1\`
- Display-role correction: \`supplier-display-role-v1\`
- Source validation: exact revision/document/page/line; page-context is allowed
  only with the explicit label \`Genaue Markierung nicht verfügbar\`.
`;
await writeFile(reportPath, report, "utf8");
console.log(
  JSON.stringify(
    {
      datasetPath,
      reportPath,
      rows: audit.rows.length,
      before: audit.before,
      after: audit.after,
      operatorWorkspace: audit.operatorWorkspace,
      discrepancyCounts: Object.fromEntries(discrepancyCounts)
    },
    null,
    2
  )
);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
