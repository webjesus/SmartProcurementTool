import { notFound, redirect } from "next/navigation";
import path from "node:path";
import { buildDocumentRevisionIndex } from "@/domain/decision";
import { decisionEvidenceHref } from "@/domain/decision-source";
import type {
  BasisPosition,
  DecisionEvidenceSnapshot,
  DecisionEvidenceSource,
  OfferLine
} from "@/domain/contracts";
import { localCorpusEnabled } from "@/services/deployment-profile";
import { LocalPilotPersistence } from "@/storage/document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type SnapshotBasis = DecisionEvidenceSnapshot["basisPosition"];
type SnapshotLine = DecisionEvidenceSnapshot["selectedLines"][number];
type EvidenceContextItem = BasisPosition | OfferLine | SnapshotBasis | SnapshotLine;
type SavedEvidenceRecord = {
  source: DecisionEvidenceSource;
  basis: SnapshotBasis | null;
  line: SnapshotLine | null;
  context: EvidenceContextItem[];
};

function value(params: SearchParams, name: string): string | null {
  const candidate = params[name];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function contextItemId(item: EvidenceContextItem): string {
  return "lineId" in item ? item.lineId : item.id;
}

function contextItemLabel(item: EvidenceContextItem): string {
  if ("positionNumber" in item) {
    return `${item.positionNumber} · ${item.description}`;
  }
  if ("sourcePositionNumber" in item) {
    return `${item.sourcePositionNumber ?? item.supplierPositionNumber ?? "—"} · ${item.description}`;
  }
  return `${item.role} · ${item.description}`;
}

export default async function EvidencePage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!localCorpusEnabled()) redirect("/projects");
  const params = await searchParams;
  const documentId = value(params, "documentId");
  const documentRevisionId = value(params, "documentRevisionId");
  const evidenceId = value(params, "evidenceId");
  const lineId = value(params, "lineId");
  const requestedPage = Number(value(params, "pageNumber"));
  if (!documentId || !documentRevisionId || !evidenceId || !requestedPage) notFound();

  const persistence = new LocalPilotPersistence(
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data"),
    true
  );
  const state = await persistence.read();
  const revisions = buildDocumentRevisionIndex(state.runs);
  const savedEvidenceRecords: SavedEvidenceRecord[] =
    state.supplierDecisions.flatMap((decision): SavedEvidenceRecord[] => {
      if (!("evidenceSnapshot" in decision) || !decision.evidenceSnapshot) return [];
      const snapshot = decision.evidenceSnapshot;
      const basisRecords: SavedEvidenceRecord[] =
        snapshot.basisPosition.sources.map((source) => ({
          source,
          basis: snapshot.basisPosition,
          line: null,
          context: snapshot.basisContext
        }));
      const supplierRecords: SavedEvidenceRecord[] = [
        ...snapshot.selectedLines,
        ...snapshot.supplierContextLines,
        ...snapshot.excludedOptionalComponents,
        ...(snapshot.visibleSupplierOptions ?? []).flatMap((option) => option.lines)
      ].flatMap((snapshotLine) =>
        snapshotLine.sources.map((source) => ({
          source,
          basis: null,
          line: snapshotLine,
          context: snapshot.supplierContextLines
        }))
      );
      const continuationRecords: SavedEvidenceRecord[] =
        snapshot.continuationPages.map((source) => ({
          source,
          basis: null,
          line: null,
          context: snapshot.supplierContextLines
        }));
      return [...basisRecords, ...supplierRecords, ...continuationRecords];
    });
  const savedEvidence = savedEvidenceRecords.find(
    (record) =>
      record.source.documentId === documentId &&
      record.source.documentRevisionId === documentRevisionId &&
      record.source.pageNumber === requestedPage &&
      record.source.evidenceId === evidenceId
  );
  const currentRevision = revisions[documentId] === documentRevisionId;
  if (!currentRevision && !savedEvidence) notFound();
  const run = state.runs.find(
    (item) =>
      item.document.id === documentId &&
      item.document.pageNumber === requestedPage
  );
  if (!run && !savedEvidence) notFound();

  const basisPositions = state.analysis?.basisPositions ?? [];
  const offerLines = state.runs.flatMap((item) =>
    item.result.envelope.extraction.offerGroups.flatMap((group) => group.lines)
  );
  const basis = currentRevision
    ? basisPositions.find((position) =>
        position.evidence.some((evidence) => evidence.id === evidenceId)
      )
    : undefined;
  const line =
    currentRevision
      ? offerLines.find((item) => item.id === lineId) ??
        offerLines.find((item) =>
          item.evidence.some((evidence) => evidence.id === evidenceId)
        )
      : undefined;
  const evidence =
    basis?.evidence.find((item) => item.id === evidenceId) ??
    line?.evidence.find((item) => item.id === evidenceId) ??
    savedEvidence?.source;
  if (
    !evidence ||
    evidence.documentId !== documentId ||
    evidence.pageNumber !== requestedPage
  ) {
    notFound();
  }

  const basisIndex = basis
    ? basisPositions.findIndex((position) => position.id === basis.id)
    : -1;
  const documentLines = offerLines.filter((item) =>
    item.evidence.some((source) => source.documentId === documentId)
  );
  const lineIndex = line
    ? documentLines.findIndex((item) => item.id === line.id)
    : -1;
  const context: EvidenceContextItem[] = savedEvidence
    ? savedEvidence.context
    : basis
    ? basisPositions.slice(Math.max(0, basisIndex - 1), basisIndex + 2)
    : documentLines.slice(Math.max(0, lineIndex - 1), lineIndex + 2);
  const currentContinuationSources =
    line?.groupId
      ? offerLines
          .filter(
            (item) =>
              item.groupId === line.groupId &&
              item.id !== line.id
          )
          .flatMap((item) =>
            item.evidence
              .filter(
                (source) =>
                  source.documentId === documentId &&
                  source.pageNumber !== requestedPage
              )
              .map((source) => ({ lineId: item.id, evidence: source }))
          )
      : [];
  const savedContinuationSources = state.supplierDecisions.flatMap((decision) =>
    "evidenceSnapshot" in decision && decision.evidenceSnapshot
      ? decision.evidenceSnapshot.continuationPages
          .filter(
            (source) =>
              source.documentId === documentId &&
              source.documentRevisionId === documentRevisionId &&
              source.pageNumber !== requestedPage
          )
          .map((source) => ({ lineId: "", evidence: source }))
      : []
  );
  const continuationSources = savedEvidence
    ? savedContinuationSources
    : currentContinuationSources;

  const region = evidence.region;
  const documentLabel = run?.document.relativePath ?? documentId;
  const assetKey =
    "assetKey" in evidence ? evidence.assetKey : run?.pageImageAsset;
  if (!assetKey) notFound();
  const evidenceBasis = basis ?? savedEvidence?.basis;
  const evidenceLine = line ?? savedEvidence?.line;
  const evidenceIdentity =
    "evidenceId" in evidence ? evidence.evidenceId : evidence.id;
  const evidenceHeading =
    evidenceBasis?.positionNumber ??
    (evidenceLine && "sourcePositionNumber" in evidenceLine
      ? evidenceLine.sourcePositionNumber ?? "Angebotszeile"
      : "Angebotszeile");
  const activeEntityId =
    evidenceBasis?.id ??
    (evidenceLine && "lineId" in evidenceLine
      ? evidenceLine.lineId
      : line?.id);
  if (process.env.DEV_UI_ENABLED !== "true") {
    const overlayParams = new URLSearchParams({
      position: evidenceBasis?.positionNumber ?? evidenceHeading,
      source: evidenceBasis ? "Basis" : "Angebot",
      page: String(requestedPage)
    });
    redirect(`/lv-vergleich?${overlayParams.toString()}`);
  }
  return (
    <div className="evidence-page" data-decision-evidence>
      <header className="evidence-page-header">
        <span className="eyebrow">SOURCE EVIDENCE · IMMUTABLE REVISION</span>
        <h1>{evidenceBasis ? "Basis-Quelle" : "Angebotsquelle"}</h1>
        <p>
          {documentLabel} · Revision {documentRevisionId} · Seite {requestedPage}
        </p>
      </header>
      <div className="evidence-page-layout">
        <section className="panel evidence-page-viewer">
          <div className="decision-page-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/local/corpus?asset=${encodeURIComponent(assetKey)}`}
              alt={`${documentLabel}, Seite ${requestedPage}`}
            />
            <span
              className="decision-evidence-highlight"
              data-evidence-id={evidenceIdentity}
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`
              }}
            />
          </div>
        </section>
        <aside className="panel evidence-context">
          <span className="eyebrow">ORIGINALKONTEXT</span>
          <h2>{evidenceHeading}</h2>
          <p>{evidenceBasis?.description ?? evidenceLine?.description}</p>
          <dl>
            <div><dt>Document revision</dt><dd>{documentRevisionId}</dd></div>
            <div><dt>Evidence</dt><dd>{evidenceIdentity}</dd></div>
            <div><dt>Region</dt><dd>{region.x.toFixed(3)} / {region.y.toFixed(3)} / {region.width.toFixed(3)} / {region.height.toFixed(3)}</dd></div>
          </dl>
          <h3>Benachbarter Kontext</h3>
          <ul className="evidence-context-list">
            {context.map((item) => (
              <li
                key={contextItemId(item)}
                className={contextItemId(item) === activeEntityId ? "active" : ""}
              >
                {contextItemLabel(item)}
              </li>
            ))}
          </ul>
          <h3>Continuation pages</h3>
          {continuationSources.length ? (
            <ul className="evidence-context-list">
              {continuationSources.map(({ lineId: continuationLineId, evidence: source }) => {
                const sourceEvidenceId =
                  "evidenceId" in source ? source.evidenceId : source.id;
                const continuationHref = decisionEvidenceHref({
                  documentId: source.documentId,
                  documentRevisionId,
                  pageNumber: source.pageNumber,
                  evidenceId: sourceEvidenceId
                }, continuationLineId || undefined);
                return <li key={`${continuationLineId}:${sourceEvidenceId}`}><a href={continuationHref}>Continuation Seite {source.pageNumber}</a></li>;
              })}
            </ul>
          ) : <p>Keine weitere Continuation-Seite in dieser Revision.</p>}
        </aside>
      </div>
    </div>
  );
}
