"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  Eye,
  FileCheck2,
  FileDown,
  Filter,
  History,
  Link2,
  LockKeyhole,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { LvComparisonPage } from "@/components/lv/lv-comparison-page";
import type {
  BasisPosition,
  EvidenceReference,
  MatchReviewAction,
  OfferLine,
  PilotAnalysis,
  SupplierDecision,
  SupplierOption
} from "@/domain/contracts";
import {
  CURRENT_DECISION_REASON_CATALOG,
  PLACEHOLDER_DECISION_REASON_CODE,
  activeDecisionReasons
} from "@/domain/decision-catalog";
import { decisionEvidenceHref } from "@/domain/decision-source";
import type { ProjectReviewPosition } from "@/domain/project-review";
import type { ValidationIssue } from "@/domain/validation";
import {
  comparisonRows,
  documents,
  extractedLines,
  issues,
  matchingRows,
  project,
  workflowSteps
} from "@/lib/demo-data";

export const sectionNames = [
  "dokumente",
  "gefundene-daten",
  "pruefung",
  "zuordnung",
  "lv-vergleich",
  "entscheidungen",
  "export"
] as const;
export type SectionName = (typeof sectionNames)[number] | "projektuebersicht";

type PilotReviewActionView = {
  id: string;
  runId: string;
  issueId: string;
  lineId: string;
  field: string;
  action: string;
  newValue: unknown;
  verificationStatus: OfferLine["verificationStatus"];
};

type PilotRunView = {
  id: string;
  document: {
    id: string;
    relativePath: string;
    pageNumber: number;
    pageCount: number;
    documentType: string;
  };
  result: {
    envelope: {
      extraction: {
        offerGroups: Array<{ lines: OfferLine[] }>;
        basisPositions: BasisPosition[];
      };
    };
  };
  validationIssues: ValidationIssue[];
  pageImageAsset: string;
};

type PilotStateView = {
  version: 2;
  runs: PilotRunView[];
  reviewActions: PilotReviewActionView[];
  matchReviewActions: MatchReviewAction[];
  supplierDecisions: SupplierDecision[];
  supplierDecisionReviewActions: Array<{
    id: string;
    supplierDecisionId: string;
    basisPositionId: string;
    action: string;
    previousDecisionId: string | null;
    operator: string;
    comment: string;
    timestamp: string;
  }>;
  analysis: PilotAnalysis | null;
  documentRevisions: Record<string, string>;
  projectReview: {
    positions: ProjectReviewPosition[];
    invariant: {
      valid: boolean;
      totalBasisLeafPositions: number;
      lvRows: number;
      statusCount: number;
      duplicatePositionIds: string[];
      duplicatePositionNumbers: string[];
      missingPositionIds: string[];
      orphanDecisionIds: string[];
      orphanSupplierOptionIds: string[];
      unknownStatusPositionIds: string[];
      problemPositionIds: string[];
    };
    coverage: {
      relevantSupplierDocumentIds: string[];
      relevantSupplierDocuments: Array<{
        id: string;
        label: string;
        supplier: string;
      }>;
      processedSupplierDocumentIds: string[];
      missingSupplierDocuments: Array<{ id: string; label: string }>;
      allRelevantOffersProcessed: boolean;
      projectContextConfirmed: boolean;
      historicalCalculationAvailable: boolean;
    };
  };
};

const Button = ({
  children,
  kind = "primary",
  onClick,
  disabled = false
}: {
  children: React.ReactNode;
  kind?: "primary" | "secondary" | "ghost" | "danger";
  onClick?: () => void;
  disabled?: boolean;
}) => (
  <button className={`button button-${kind}`} onClick={onClick} disabled={disabled}>
    {children}
  </button>
);

function usePilotState() {
  const [pilot, setPilot] = useState<PilotStateView | null>();
  const [error, setError] = useState<string | null>(null);

  const fetchPilot = useCallback(async (): Promise<PilotStateView | null> => {
    const health = await fetch("/api/health", { cache: "no-store" });
    const healthData = (await health.json()) as { mode?: string };
    if (healthData.mode !== "local-corpus") return null;
    const response = await fetch("/api/local/corpus?view=pilot", { cache: "no-store" });
    if (!response.ok) throw new Error(`Quelldaten konnten nicht geladen werden (HTTP ${response.status}).`);
    return (await response.json()) as PilotStateView;
  }, []);

  const load = useCallback(async () => {
    const next = await fetchPilot();
    setPilot(next);
    setError(null);
  }, [fetchPilot]);

  useEffect(() => {
    let cancelled = false;
    fetchPilot()
      .then((next) => {
        if (!cancelled) {
          setPilot(next);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Quelldaten konnten nicht geladen werden."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPilot]);

  return { pilot, error, reload: load };
}

function reviewedLine(
  line: OfferLine,
  runId: string,
  actions: PilotReviewActionView[]
): OfferLine {
  return actions
    .filter((action) => action.runId === runId && action.lineId === line.id)
    .reduce((current, action) => {
      if (action.action === "DEFER") return current;
      return {
        ...current,
        [action.field]: action.newValue,
        verificationStatus: action.verificationStatus,
        lockedFields: Array.from(new Set([...current.lockedFields, action.field]))
      } as OfferLine;
    }, line);
}

function formatNumber(value: number | null): string {
  return value === null
    ? "—"
    : new Intl.NumberFormat("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value);
}

function formatCurrency(value: number | null): string {
  return value === null ? "—" : `${formatNumber(value)} €`;
}

function Overview() {
  return (
    <>
      <PageHeader
        eyebrow="PROJEKTÜBERSICHT"
        title={project.name}
        description="Dokumente verstehen, Angebote belastbar vergleichen und Entscheidungen nachvollziehbar dokumentieren."
        actions={
          <>
            <Button kind="secondary"><Plus size={16} /> Dokument hinzufügen</Button>
            <Link className="button button-primary" href="/pruefung">
              Prüfung fortsetzen <ArrowRight size={16} />
            </Link>
          </>
        }
      />
      <section className="metrics-grid">
        <article className="metric-card">
          <span>Dokumente</span>
          <strong>{project.documents}</strong>
          <small><CheckCircle2 size={14} /> vollständig klassifiziert</small>
        </article>
        <article className="metric-card">
          <span>Verarbeitete Seiten</span>
          <strong>{project.pages}</strong>
          <small><Sparkles size={14} /> 72 % geprüft</small>
        </article>
        <article className="metric-card metric-warning">
          <span>Offene Hinweise</span>
          <strong>3</strong>
          <small><CircleAlert size={14} /> 1 blockiert Vergleich</small>
        </article>
        <article className="metric-card">
          <span>LV-Positionen</span>
          <strong>84</strong>
          <small><Link2 size={14} /> 79 zugeordnet</small>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel panel-wide">
          <div className="panel-header">
            <div>
              <span className="eyebrow">ARBEITSFORTSCHRITT</span>
              <h2>Beschaffungsprüfung</h2>
            </div>
            <span className="progress-value">{project.progress} %</span>
          </div>
          <div className="progress-track"><i style={{ width: `${project.progress}%` }} /></div>
          <div className="workflow-list">
            {workflowSteps.map((step, index) => (
              <div className={`workflow-row workflow-${step.state}`} key={step.label}>
                <span className="step-index">{step.state === "done" ? <Check size={14} /> : index + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <small>
                    {step.label === "Prüfung" ? `${step.value} offene Hinweise` : `${step.value} Einträge`}
                  </small>
                </div>
                <span className="step-state">
                  {step.state === "done" ? "Abgeschlossen" : step.state === "active" ? "In Arbeit" : "Ausstehend"}
                </span>
              </div>
            ))}
          </div>
        </article>
        <aside className="panel next-action">
          <span className="eyebrow">NÄCHSTER SCHRITT</span>
          <div className="action-icon"><CircleAlert size={23} /></div>
          <h2>Preisbasis prüfen</h2>
          <p>Eine unklare Preisbasis blockiert die eindeutige Empfehlung für Position 2.4.20.</p>
          <div className="source-mini">
            <span>Angebot Beta</span><strong>Seite 12</strong>
          </div>
          <Link className="button button-primary full" href="/pruefung">
            Hinweis öffnen <ArrowRight size={16} />
          </Link>
        </aside>
      </section>

      <section className="panel recent-documents">
        <div className="panel-header">
          <div>
            <span className="eyebrow">DOKUMENTE</span>
            <h2>Zuletzt verarbeitet</h2>
          </div>
          <Link href="/dokumente" className="text-link">Alle Dokumente <ArrowRight size={14} /></Link>
        </div>
        <DocumentTable compact />
      </section>
    </>
  );
}

function DocumentTable({ compact = false }: { compact?: boolean }) {
  const rows = compact ? documents.slice(0, 4) : documents;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Dokument</th><th>Typ</th><th>Lieferant</th><th>Seiten</th><th>Modus</th><th>Status</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((document) => (
            <tr key={document.id}>
              <td><div className="file-cell"><FileCheck2 size={17} /><strong>{document.name}</strong></div></td>
              <td><span className="mono-label">{document.type}</span></td>
              <td>{document.supplier}</td>
              <td>{document.pages}</td>
              <td>{document.mode}</td>
              <td><StatusBadge>{document.status}</StatusBadge></td>
              <td><button className="icon-button" aria-label={`${document.name} öffnen`}><MoreHorizontal size={17} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Documents() {
  const [query, setQuery] = useState("");
  const visible = documents.filter((document) =>
    `${document.name} ${document.type} ${document.supplier}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <>
      <PageHeader
        eyebrow="DOKUMENTE"
        title="Projektunterlagen"
        description="Dokumenttypen, Seitenmodi und Verarbeitungsstatus des aktuellen Projekts."
        actions={<Button><Upload size={16} /> Dokumente importieren</Button>}
      />
      <div className="toolbar">
        <label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Dokument oder Lieferant suchen" /></label>
        <Button kind="secondary"><Filter size={16} /> Filter</Button>
        <span className="toolbar-count">{visible.length} Dokumente</span>
      </div>
      <section className="panel">
        <DocumentTable />
      </section>
      <div className="info-strip"><LockKeyhole size={17} /><span><strong>Datenschutz aktiv:</strong> Lokale Originaldokumente werden weder in den Build noch in den Export übernommen.</span></div>
    </>
  );
}

function FoundData() {
  const [role, setRole] = useState("Alle Rollen");
  const { pilot, error } = usePilotState();
  const realRows = useMemo(
    () =>
      pilot?.runs
        .filter((run) => run.document.documentType !== "BASIS_LV")
        .flatMap((run) =>
          run.result.envelope.extraction.offerGroups.flatMap((group) =>
            group.lines.map((line) => ({
              run,
              line: reviewedLine(line, run.id, pilot.reviewActions)
            }))
          )
        ) ?? [],
    [pilot]
  );
  const visibleRealRows =
    role === "Alle Rollen"
      ? realRows
      : realRows.filter(({ line }) => line.role === role);
  const syntheticRows =
    role === "Alle Rollen" ? extractedLines : extractedLines.filter((line) => line.role === role);
  const isLocal = pilot !== null;
  return (
    <>
      <PageHeader
        eyebrow="GEFUNDENE DATEN"
        title="Unabhängige Extraktion"
        description="Unveränderte Angebotsdaten vor LV-Zuordnung und kommerzieller Entscheidung."
        actions={
          <Button kind="secondary" disabled={isLocal}>
            <Play size={16} /> {isLocal ? "Lokale Extraktion" : "Extraktion starten"}
          </Button>
        }
      />
      <div className="notice">
        <ShieldCheck size={19} />
        <div>
          <strong>Blind extraction aktiv</strong>
          <span>
            {isLocal
              ? "Persistierte lokale OpenAI-Runs; Supplier-Requests enthalten kein Basis-LV."
              : "Lieferantenangebote wurden ohne Basis-LV und historischen Gewinner analysiert."}
          </span>
        </div>
      </div>
      {error ? <div className="info-strip"><CircleAlert size={16} /><span>{error}</span></div> : null}
      <div className="toolbar">
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option>Alle Rollen</option>
          <option>PRIMARY</option>
          <option>REQUIRED_COMPONENT</option>
          <option>MANDATORY_COMPONENT</option>
          <option>OPTIONAL</option>
          <option>ALTERNATIVE</option>
          <option>NOT_OFFERED</option>
          <option>UNKNOWN</option>
        </select>
        <span className="toolbar-count">
          {isLocal ? visibleRealRows.length : syntheticRows.length} Angebotszeilen
        </span>
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Seite</th><th>Position</th><th>Beschreibung</th><th>Hersteller</th>
                <th>Artikelnummer</th><th>Menge</th><th>Einheit</th><th>EP</th><th>GP</th>
                <th>Rolle</th><th>Prüfung</th>
              </tr>
            </thead>
            <tbody>
              {isLocal
                ? visibleRealRows.map(({ run, line }) => (
                    <tr key={`${run.id}-${line.id}`} data-pilot-line={line.id}>
                      <td><strong>{run.document.pageNumber}</strong></td>
                      <td>{line.sourcePositionNumber ?? line.supplierPositionNumber ?? "—"}</td>
                      <td>{line.description || "—"}</td>
                      <td>{line.manufacturer ?? "—"}</td>
                      <td>{line.articleNumber ?? "—"}</td>
                      <td>{line.quantity === null ? "—" : formatNumber(line.quantity)}</td>
                      <td>{line.unit ?? "—"}</td>
                      <td>{formatNumber(line.interpretedUnitPrice)}</td>
                      <td><strong>{formatNumber(line.interpretedTotalPrice)}</strong></td>
                      <td><span className="mono-label">{line.role}</span></td>
                      <td><StatusBadge>{line.verificationStatus}</StatusBadge></td>
                    </tr>
                  ))
                : syntheticRows.map((line) => (
                    <tr key={`${line.source}-${line.position}`}>
                      <td><strong>{line.source}</strong></td><td>{line.position}</td>
                      <td>{line.description}</td><td>—</td><td>—</td><td>{line.quantity}</td>
                      <td>{line.unit}</td><td>{line.ep}</td><td><strong>{line.gp}</strong></td>
                      <td><span className="mono-label">{line.role}</span></td>
                      <td><StatusBadge>{line.evidence}</StatusBadge></td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {isLocal && visibleRealRows.length === 0 ? (
          <div className="empty-state">Noch keine gespeicherten Angebotszeilen. Lokale Extraktion ausführen.</div>
        ) : null}
      </section>
    </>
  );
}

function RealReview({
  pilot,
  reload
}: {
  pilot: PilotStateView;
  reload: () => Promise<void>;
}) {
  const queue = useMemo(
    () =>
      pilot.runs
        .filter((run) => run.document.documentType !== "BASIS_LV")
        .flatMap((run) =>
          run.validationIssues.map((issue) => {
            const offerLines = run.result.envelope.extraction.offerGroups.flatMap(
              (group) => group.lines
            );
            const immutableLine =
              offerLines.find((line) => line.id === issue.lineId) ?? offerLines[0];
            return {
              id: `${run.id}:${issue.id}`,
              run,
              issue,
              line: immutableLine
                ? reviewedLine(immutableLine, run.id, pilot.reviewActions)
                : undefined
            };
          })
        )
        .sort((left, right) => {
          const actionable = Number(Boolean(right.line)) - Number(Boolean(left.line));
          if (actionable !== 0) return actionable;
          return (
            Number(right.issue.severity === "BLOCKING") -
            Number(left.issue.severity === "BLOCKING")
          );
        }),
    [pilot]
  );
  const [selectedId, setSelectedId] = useState(queue[0]?.id ?? "");
  const selected = queue.find((item) => item.id === selectedId) ?? queue[0];
  const [zoom, setZoom] = useState(100);
  const [message, setMessage] = useState("");
  const [correctionField, setCorrectionField] = useState(
    queue[0]?.issue.field && queue[0]?.line && queue[0].issue.field in queue[0].line
      ? queue[0].issue.field
      : "description"
  );
  const [correctionValue, setCorrectionValue] = useState(queue[0]?.line?.description ?? "");
  const [roleValue, setRoleValue] = useState<OfferLine["role"]>(
    queue[0]?.line?.role ?? "UNKNOWN"
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<string | null>(null);

  function selectQueueItem(item: (typeof queue)[number]) {
    setSelectedId(item.id);
    if (!item.line) return;
    setCorrectionField(
      item.issue.field && item.issue.field in item.line
        ? item.issue.field
        : "description"
    );
    setCorrectionValue(item.line.description);
    setRoleValue(item.line.role);
  }

  if (!selected) {
    return (
      <>
        <PageHeader
          eyebrow="PRÜFUNG"
          title="Quellenbasierte Prüfung"
          description="Persistierte lokale Extraktion und Quellenbelege."
        />
        <section className="panel empty-state">
          Keine offenen Prüfpunkte im lokalen Verarbeitungslauf.
        </section>
      </>
    );
  }

  const evidence: EvidenceReference | undefined =
    selected.line?.evidence[0] ??
    selected.line?.moneyCandidates.flatMap((candidate) => candidate.evidence)[0];
  const moneyCandidates = selected.line?.moneyCandidates ?? [];

  async function submitAction(
    action: "CONFIRM" | "CORRECT" | "SELECT_VALUE" | "CHANGE_ROLE" | "DEFER",
    field: string,
    newValue: unknown
  ) {
    if (!selected.line) return;
    setActionError(null);
    const response = await fetch("/api/review-actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: selected.run.id,
        issueId: selected.issue.id,
        lineId: selected.line.id,
        field,
        action,
        newValue,
        operator: "LOCAL_OPERATOR",
        reason: "Quellenbasierte Prüfung",
        comment: message
      })
    });
    const body = (await response.json()) as { error?: string; message?: string };
    if (!response.ok) {
      setActionError(body.message ?? body.error ?? `Aktion fehlgeschlagen (${response.status}).`);
      return;
    }
    setActionState(action);
    setMessage("");
    await reload();
  }

  function correctedValue(): unknown {
    if (
      ["quantity", "interpretedUnitPrice", "interpretedTotalPrice", "priceBasis"].includes(
        correctionField
      )
    ) {
      const parsed = Number(correctionValue.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return correctionValue;
  }

  return (
    <>
      <PageHeader
        eyebrow="PRÜFUNG"
        title="Quellenbasierte Prüfung"
        description="Quelldaten, lokale Originalseite und gespeicherte Bearbeitungsschritte."
        actions={<span className="queue-counter">{queue.length} Hinweise</span>}
      />
      <div className="review-layout" data-pilot-review={selected.run.id}>
        <aside className="issue-queue panel">
          <div className="queue-title"><strong>Prüfliste</strong><span>{queue.length}</span></div>
          {queue.map((item) => (
            <button
              key={item.id}
              onClick={() => selectQueueItem(item)}
              className={item.id === selected.id ? "selected" : ""}
            >
              <span className={`severity-dot severity-${item.issue.severity.toLowerCase()}`} />
              <div>
                <strong>{item.issue.code}</strong>
                <small>{item.run.document.relativePath} · S. {item.run.document.pageNumber}</small>
              </div>
              {pilot.reviewActions.some((action) => action.issueId === item.issue.id) ? (
                <CheckCircle2 size={16} className="resolved-icon" />
              ) : null}
            </button>
          ))}
        </aside>
        <section className="document-viewer panel">
          <div className="viewer-toolbar">
            <div>
              <button className="icon-button" disabled><ChevronLeft size={17} /></button>
              <span>Seite {selected.run.document.pageNumber} / {selected.run.document.pageCount}</span>
              <button className="icon-button" disabled><ChevronRight size={17} /></button>
            </div>
            <div>
              <button className="icon-button" onClick={() => setZoom(Math.max(70, zoom - 10))}><ZoomOut size={17} /></button>
              <span>{zoom} %</span>
              <button className="icon-button" onClick={() => setZoom(Math.min(150, zoom + 10))}><ZoomIn size={17} /></button>
            </div>
          </div>
          <div className="paper-stage real-page-stage">
            <div className="real-page-frame" style={{ transform: `scale(${zoom / 100})` }}>
              {/* The asset API allows only paths referenced by the persisted pilot state. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/local/corpus?asset=${encodeURIComponent(selected.run.pageImageAsset)}`}
                alt={`${selected.run.document.relativePath}, Seite ${selected.run.document.pageNumber}`}
              />
              {evidence ? (
                <span
                  className="real-evidence-highlight"
                  data-evidence-status={evidence.status}
                  style={{
                    left: `${evidence.region.x * 100}%`,
                    top: `${evidence.region.y * 100}%`,
                    width: `${evidence.region.width * 100}%`,
                    height: `${evidence.region.height * 100}%`
                  }}
                />
              ) : null}
            </div>
          </div>
        </section>
        <aside className="issue-inspector panel">
          <div className="inspector-head">
            <StatusBadge>{selected.issue.severity}</StatusBadge>
            <span className="mono-label">{selected.issue.code}</span>
          </div>
          <h2>{selected.issue.message}</h2>
          <p>{selected.run.document.relativePath} · Seite {selected.run.document.pageNumber}</p>
          <button className="source-button" onClick={() => setZoom(100)}>
            <Eye size={16} /> Zur Quelle <span>Seite {selected.run.document.pageNumber}</span>
          </button>
          <div className="field-card">
            <label>{selected.issue.field ?? "OfferLine"}</label>
            <strong>{selected.line ? String(
              (selected.line as unknown as Record<string, unknown>)[selected.issue.field ?? "description"] ?? "—"
            ) : "—"}</strong>
            <small>{selected.line?.verificationStatus ?? "REVIEW_REQUIRED"}</small>
          </div>
          {evidence ? (
            <div className="evidence-summary">
              <span className="mono-label">{evidence.status}</span>
              <p>{evidence.sourceText || "Kein serverbestätigter Quelltext."}</p>
            </div>
          ) : null}
          <div className="candidate-block">
            <label>Money candidates</label>
            {moneyCandidates.length === 0 ? <p className="muted-copy">Keine Geldwerte erkannt.</p> : null}
            {moneyCandidates.map((candidate) => (
              <button
                key={candidate.id}
                onClick={() =>
                  void submitAction(
                    "SELECT_VALUE",
                    candidate.kind === "UNIT_PRICE"
                      ? "interpretedUnitPrice"
                      : "interpretedTotalPrice",
                    candidate.amount
                  )
                }
              >
                <span>{candidate.kind}: {candidate.rawValue}</span>
                <small>Anderen Wert auswählen</small>
              </button>
            ))}
          </div>
          <div className="correction-grid">
            <select value={correctionField} onChange={(event) => setCorrectionField(event.target.value)}>
              <option value="description">Beschreibung</option>
              <option value="quantity">Menge</option>
              <option value="unit">Einheit</option>
              <option value="interpretedUnitPrice">EP</option>
              <option value="interpretedTotalPrice">GP</option>
            </select>
            <input
              aria-label="Korrekturwert"
              value={correctionValue}
              onChange={(event) => setCorrectionValue(event.target.value)}
            />
            <Button kind="secondary" onClick={() => void submitAction("CORRECT", correctionField, correctedValue())}>
              Korrigieren
            </Button>
          </div>
          <div className="role-control">
            <select value={roleValue} onChange={(event) => setRoleValue(event.target.value as OfferLine["role"])}>
              {["PRIMARY", "REQUIRED_COMPONENT", "MANDATORY_COMPONENT", "OPTIONAL", "ALTERNATIVE", "NOT_OFFERED", "UNKNOWN"].map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
            <Button kind="secondary" onClick={() => void submitAction("CHANGE_ROLE", "role", roleValue)}>
              Rolle ändern
            </Button>
          </div>
          <label className="comment-field">
            <span>Kommentar</span>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
          </label>
          <div className="review-actions">
            <Button kind="secondary" onClick={() => void submitAction("DEFER", "description", selected.line?.description)}>
              Zurückstellen
            </Button>
            <Button onClick={() => void submitAction("CONFIRM", "description", selected.line?.description)}>
              {actionState === "CONFIRM" ? <Check size={16} /> : null} Bestätigen
            </Button>
          </div>
          {actionError ? <p className="action-error">{actionError}</p> : null}
          <div className="audit-note"><History size={15} /> ReviewAction und AuditEvent werden lokal persistiert.</div>
        </aside>
      </div>
    </>
  );
}

function Review() {
  const { pilot, error, reload } = usePilotState();
  if (error) {
    return <section className="panel empty-state">{error}</section>;
  }
  if (pilot === undefined) {
    return <section className="panel empty-state">Quelldaten werden geladen…</section>;
  }
  return pilot === null ? <SyntheticReview /> : <RealReview pilot={pilot} reload={reload} />;
}

function SyntheticReview() {
  const [selectedId, setSelectedId] = useState(issues[0].id);
  const [page, setPage] = useState(12);
  const [zoom, setZoom] = useState(100);
  const [resolved, setResolved] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const issue = issues.find((item) => item.id === selectedId) ?? issues[0];

  async function submitAction(action: string) {
    const response = await fetch("/api/review-actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        issueId: issue.id,
        action,
        previousValue: issue.current,
        newValue: issue.candidates[0],
        operator: "NK",
        reason: "Operatorprüfung im SPT",
        comment: message
      })
    });
    if (response.ok) {
      setResolved((value) => [...new Set([...value, issue.id])]);
      setMessage("");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="PRÜFUNG"
        title="Quellenbasierte Prüfung"
        description="Hinweis, Beleg und Korrektur bleiben in einem nachvollziehbaren Arbeitsfluss."
        actions={<span className="queue-counter">{issues.length - resolved.length} Hinweise offen</span>}
      />
      <div className="review-layout">
        <aside className="issue-queue panel">
          <div className="queue-title"><strong>Prüfliste</strong><span>{issues.length}</span></div>
          {issues.map((item) => (
            <button key={item.id} onClick={() => { setSelectedId(item.id); setPage(item.page); }} className={item.id === issue.id ? "selected" : ""}>
              <span className={`severity-dot severity-${item.severity.toLowerCase()}`} />
              <div><strong>{item.title}</strong><small>{item.document} · S. {item.page}</small></div>
              {resolved.includes(item.id) ? <CheckCircle2 size={16} className="resolved-icon" /> : null}
            </button>
          ))}
        </aside>
        <section className="document-viewer panel">
          <div className="viewer-toolbar">
            <div><button className="icon-button" onClick={() => setPage(Math.max(1, page - 1))}><ChevronLeft size={17} /></button><span>Seite {page} / 31</span><button className="icon-button" onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button></div>
            <div><button className="icon-button" onClick={() => setZoom(Math.max(70, zoom - 10))}><ZoomOut size={17} /></button><span>{zoom} %</span><button className="icon-button" onClick={() => setZoom(Math.min(150, zoom + 10))}><ZoomIn size={17} /></button></div>
          </div>
          <div className="paper-stage">
            <div className="paper" style={{ transform: `scale(${zoom / 100})` }}>
              <div className="paper-head"><strong>LIEFERANT BETA</strong><span>ANGEBOT · SEITE {page}</span></div>
              <div className="paper-rule" />
              <div className="paper-meta"><span>Projekt Nordtor</span><span>Angebot 2026-014-B</span></div>
              <h3>2.4 Regelungskomponenten</h3>
              <div className="paper-table-head"><span>Pos.</span><span>Beschreibung</span><span>Menge</span><span>EP</span><span>GP</span></div>
              <div className="paper-table-row"><span>88</span><span>Regelmodul DN 25, komplett</span><span>3 Stk</span><span>248,00</span><span>744,00</span></div>
              <div className="evidence-highlight"><small>PREISBASIS</small><strong>je 100 Stück · EP 248,00 € · GP 744,00 €</strong></div>
              <div className="paper-lines">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ width: `${75 + (index % 3) * 8}%` }} />)}</div>
              <span className="page-number">{page}</span>
            </div>
          </div>
        </section>
        <aside className="issue-inspector panel">
          <div className="inspector-head">
            <StatusBadge>{issue.severity}</StatusBadge>
            <span className="mono-label">{issue.code}</span>
          </div>
          <h2>{issue.title}</h2>
          <p>{issue.description}</p>
          <button className="source-button" onClick={() => setPage(issue.page)}><Eye size={16} /> Zur Quelle <span>Seite {issue.page}</span></button>
          <div className="field-card">
            <label>{issue.field}</label>
            <strong>{issue.current}</strong>
            <small>Extrahierter Wert</small>
          </div>
          <div className="candidate-block">
            <label>Kandidaten</label>
            {issue.candidates.map((candidate, index) => <button key={candidate} className={index === 0 ? "preferred" : ""}><span>{candidate}</span>{index === 0 ? <small>empfohlen</small> : null}</button>)}
          </div>
          <div className="validation-list">
            <div><CheckCircle2 size={16} /><span>Evidence gehört zur Seite</span></div>
            <div className="warn"><CircleAlert size={16} /><span>Arithmetik benötigt Preisbasis</span></div>
          </div>
          <label className="comment-field"><span>Kommentar</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Begründung ergänzen" /></label>
          <div className="review-actions">
            <Button kind="secondary" onClick={() => submitAction("DEFER")}>Zurückstellen</Button>
            <Button onClick={() => submitAction("CONFIRM")}>{resolved.includes(issue.id) ? <Check size={16} /> : null} Bestätigen</Button>
          </div>
          <div className="audit-note"><History size={15} /> Aktion erzeugt ReviewAction und AuditEvent.</div>
        </aside>
      </div>
    </>
  );
}

function SyntheticMatching() {
  const [confirmed, setConfirmed] = useState<string[]>([]);
  return (
    <>
      <PageHeader
        eyebrow="ZUORDNUNG"
        title="Angebot mit Basis-LV verbinden"
        description="Kandidaten werden semantisch vorgeschlagen, deterministisch geprüft und bei Unsicherheit bestätigt."
      />
      <div className="notice"><Link2 size={19} /><div><strong>Extraktion bleibt unverändert</strong><span>Zuordnungen verweisen auf Angebotszeilen, überschreiben sie aber niemals.</span></div></div>
      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>LV-Position</th><th>Angebotszeile</th><th>Lieferant</th><th>Art</th><th>Score</th><th>Status</th><th>Begründung</th><th /></tr></thead>
            <tbody>{matchingRows.map((row) => <tr key={`${row.basis}-${row.offer}`}>
              <td><strong>{row.basis}</strong></td><td>{row.offer}</td><td>{row.supplier}</td><td><span className="mono-label">{row.kind}</span></td>
              <td><div className="score"><i style={{ width: `${row.score * 100}%` }} /><span>{Math.round(row.score * 100)} %</span></div></td>
              <td><StatusBadge>{confirmed.includes(row.offer) ? "EXACT" : row.status}</StatusBadge></td><td>{row.reason}</td>
              <td><Button kind="ghost" onClick={() => setConfirmed((value) => [...new Set([...value, row.offer])])}>{confirmed.includes(row.offer) ? <Check size={15} /> : null} Bestätigen</Button></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const filterOptions = [
  ["Alle", "ALL"],
  ["Eindeutige Empfehlungen", "CLEAR_RECOMMENDATION"],
  ["Entscheidung erforderlich", "DECISION_REQUIRED"],
  ["Unterschiedlicher Lieferumfang", "DIFFERENT_SCOPE_OF_SUPPLY"],
  ["Technische Abweichung", "TECHNICAL_DEVIATION"],
  ["Unklare Preise", "PRICE_UNCLEAR"],
  ["Nicht zugeordnet", "MATCHING_UNCLEAR"],
  ["Kein Angebot", "NO_OFFER"]
] as const;

const liveFilterOptions = [
  ["Alle", "ALL"],
  ["Automatisch ausgewählt", "AUTO_SELECTED_LOWEST_PRICE"],
  ["Entscheidung durch Leitung", "MANAGER_DECISION"],
  ["Systemprüfung", "SYSTEM_REVIEW"],
  ["Manuell entschieden", "MANUAL_DECIDED"],
  ["Zurückgestellt", "DEFERRED"],
  ["Kein vergleichbares Angebot", "NO_COMPARABLE_OFFER"],
  ["Verarbeitung ausstehend", "PROCESSING_PENDING"],
  ["Fehler", "PROCESSING_ERROR"]
] as const;

function liveFilterMatches(
  position: ProjectReviewPosition,
  filter: string
): boolean {
  if (filter === "ALL") return true;
  if (filter === "MANAGER_DECISION" || filter === "SYSTEM_REVIEW") {
    return (
      position.liveStatus === "MANUAL_DECISION_REQUIRED" &&
      position.reviewQueue === filter
    );
  }
  return position.liveStatus === filter;
}

function liveStatusLabel(position: ProjectReviewPosition | undefined): string {
  if (!position) return "Verarbeitung ausstehend";
  if (position.liveStatus === "MANUAL_DECISION_REQUIRED") {
    return position.reviewQueue === "MANAGER_DECISION"
      ? "Entscheidung durch Leitung erforderlich"
      : "Technische Systemprüfung erforderlich";
  }
  const labels: Record<string, string> = {
    AUTO_SELECTED_LOWEST_PRICE: "Automatisch ausgewählt",
    MANUAL_DECIDED: "Manuell entschieden",
    DEFERRED: "Zurückgestellt",
    NO_COMPARABLE_OFFER: "Kein vergleichbares Angebot",
    PROCESSING_PENDING: "Verarbeitung ausstehend",
    PROCESSING_ERROR: "Verarbeitungsfehler"
  };
  return labels[position.liveStatus] ?? position.liveStatus;
}

function SyntheticComparison() {
  const [filter, setFilter] = useState("ALL");
  const [selected, setSelected] = useState(comparisonRows[0].position);
  const rows = filter === "ALL" ? comparisonRows : comparisonRows.filter((row) => row.status === filter);
  const detail = comparisonRows.find((row) => row.position === selected) ?? comparisonRows[0];
  return (
    <>
      <PageHeader
        eyebrow="LV-VERGLEICH"
        title="Belastbarer Angebotsvergleich"
        description="Preise werden nur bei kompatibler Menge, Einheit, Technik, Lieferumfang und Evidence verglichen."
        actions={<Link className="button button-secondary" href="/export"><FileDown size={16} /> Export vorbereiten</Link>}
      />
      <div className="comparison-layout">
        <section>
          <div className="filter-tabs">
            {filterOptions.map(([label, value]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
          <div className="panel comparison-table">
            <div className="table-scroll">
              <table>
                <thead><tr><th>LV-Pos.</th><th>Beschreibung</th><th>Menge</th><th>Lieferant Alpha</th><th>Lieferant Beta</th><th>Lieferant Gamma</th><th>Empfehlung</th><th>Status</th></tr></thead>
                <tbody>{rows.map((row) => <tr key={row.position} onClick={() => setSelected(row.position)} className={selected === row.position ? "selected-row" : ""}>
                  <td><strong>{row.position}</strong></td><td>{row.description}<small className="scope-note">{row.scope}</small></td><td>{row.quantity}</td>
                  <td>{row.alpha}</td><td>{row.beta}</td><td>{row.gamma}</td><td><strong>{row.recommendation}</strong></td><td><StatusBadge>{row.status}</StatusBadge></td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>
        </section>
        <aside className="panel position-inspector">
          <span className="eyebrow">POSITION {detail.position}</span>
          <h2>{detail.description}</h2>
          <div className="requirement-grid"><div><span>Menge</span><strong>{detail.quantity}</strong></div><div><span>Lieferumfang</span><strong>{detail.scope}</strong></div></div>
          <h3>Lieferantenoptionen</h3>
          {[["Alpha", detail.alpha], ["Beta", detail.beta], ["Gamma", detail.gamma]].map(([name, price]) => <div className="supplier-option" key={name}><span>Lieferant {name}</span><strong>{price}</strong><small>Evidence geprüft</small></div>)}
          <div className="inspector-status"><StatusBadge>{detail.status}</StatusBadge><p>Maschinelle Empfehlung ist keine finale Lieferantenentscheidung.</p></div>
          <Link href="/lv-vergleich#entscheidungspruefung" className="button button-primary full">Entscheidung öffnen <ArrowRight size={16} /></Link>
        </aside>
      </div>
    </>
  );
}

function SyntheticDecisions() {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const pending = comparisonRows.filter((row) => row.status !== "NO_OFFER");
  return (
    <>
      <PageHeader
        eyebrow="ENTSCHEIDUNGEN"
        title="Kommerzielle Auswahl"
        description="Der Operator trifft und begründet die finale Entscheidung; Empfehlungen bleiben assistierend."
        actions={<span className="queue-counter">{pending.length - Object.keys(selected).length} offen</span>}
      />
      <div className="decision-grid">
        {pending.map((row) => <article className="panel decision-card" key={row.position}>
          <div className="decision-head"><span className="mono-label">{row.position}</span><StatusBadge>{row.status}</StatusBadge></div>
          <h2>{row.description}</h2><p>{row.quantity} · Lieferumfang {row.scope}</p>
          <div className="choice-grid">
            {[["Alpha", row.alpha], ["Beta", row.beta], ["Gamma", row.gamma]].map(([supplier, price]) => <button key={supplier} onClick={() => setSelected((value) => ({ ...value, [row.position]: supplier }))} className={selected[row.position] === supplier ? "selected" : ""}><span>Lieferant {supplier}</span><strong>{price}</strong>{selected[row.position] === supplier ? <CheckCircle2 size={17} /> : null}</button>)}
          </div>
          <label className="comment-field"><span>Entscheidungsgrund</span><input placeholder="Pflichtfeld für Audit-Trail" /></label>
        </article>)}
      </div>
    </>
  );
}

function pilotEvidenceHref(
  pilot: PilotStateView,
  evidence: EvidenceReference,
  lineId?: string
): string | null {
  const documentRevisionId = pilot.documentRevisions[evidence.documentId];
  const run = pilot.runs.find(
    (item) =>
      item.document.id === evidence.documentId &&
      item.document.pageNumber === evidence.pageNumber
  );
  if (!documentRevisionId || !run) return null;
  return decisionEvidenceHref({
    documentId: evidence.documentId,
    documentRevisionId,
    pageNumber: evidence.pageNumber,
    evidenceId: evidence.id
  }, lineId);
}

function materialScopeLabel(option: SupplierOption): string {
  const materialScopeStatus = option.materialScopeStatus as
    | SupplierOption["materialScopeStatus"]
    | undefined;
  if (!materialScopeStatus) {
    if (option.status === "TECHNICAL_DEVIATION") {
      return "Technische Abweichung";
    }
    if (option.status === "NO_OFFER") return "Nicht angeboten";
    if (option.status === "DIFFERENT_SCOPE_OF_SUPPLY") {
      return "Unvollständiger Lieferumfang";
    }
    return "Prüfung erforderlich";
  }
  switch (materialScopeStatus) {
    case "COMPLETE_MATERIAL_SCOPE":
      return "Vollständig vergleichbar";
    case "PARTIAL_MATERIAL_SCOPE":
      return "Unvollständiger Lieferumfang";
    case "TECHNICALLY_DEVIATING":
      return "Technische Abweichung";
    case "EXPLICIT_NO_OFFER":
      return "Nicht angeboten";
    case "NOT_COVERED":
    case "UNKNOWN":
    default:
      return "Prüfung erforderlich";
  }
}

function optionDisplay(option: SupplierOption | undefined) {
  if (!option) return "Nicht zugeordnet";
  const scope = materialScopeLabel(option);
  return option.pricedTotal === null
    ? scope
    : `Preis gefunden: ${formatNumber(option.pricedTotal)} € · ${scope}`;
}

function optionPriceBreakdown(option: SupplierOption): string {
  const mandatory = option.mandatoryComponentPrices.reduce(
    (sum, value) => sum + value,
    0
  );
  const optional = option.optionalPrices.reduce((sum, value) => sum + value, 0);
  return [
    `Primär ${option.primaryPrice === null ? "—" : `${formatNumber(option.primaryPrice)} €`}`,
    `Pflicht ${option.mandatoryComponentPrices.length ? `${formatNumber(mandatory)} €` : "—"}`,
    `Optional ${option.optionalPrices.length ? `${formatNumber(optional)} €` : "—"}`,
    `Vergleich ${option.comparableTotal === null ? "nicht freigegeben" : `${formatNumber(option.comparableTotal)} €`}`,
    materialScopeLabel(option)
  ].join(" · ");
}

function RealMatching({
  pilot,
  reload
}: {
  pilot: PilotStateView;
  reload: () => Promise<void>;
}) {
  const analysis = pilot.analysis;
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(
    analysis?.matchLinks[0]?.id ?? null
  );
  const [manualAction, setManualAction] =
    useState<MatchReviewAction["action"]>("ADD_COMMENT");
  const [basisChoice, setBasisChoice] = useState(
    analysis?.basisPositions[0]?.id ?? ""
  );
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const lineIndex = useMemo(
    () =>
      new Map(
        pilot.runs.flatMap((run) =>
          run.result.envelope.extraction.offerGroups.flatMap((group) =>
            group.lines.map((line) => [
              line.id,
              { line: reviewedLine(line, run.id, pilot.reviewActions), run }
            ] as const)
          )
        )
      ),
    [pilot]
  );
  const basisIndex = useMemo(
    () => new Map((analysis?.basisPositions ?? []).map((position) => [position.id, position])),
    [analysis]
  );
  if (!analysis) {
    return (
      <>
        <PageHeader eyebrow="ZUORDNUNG" title="Dokumentzuordnung" description="Die Zuordnungsanalyse ist noch nicht verfügbar." />
        <div className="notice"><CircleAlert size={19} /><div><strong>Analyse noch nicht erzeugt</strong><span>Die reale Extraktion ist vorhanden, aber der begrenzte Matching-Lauf fehlt.</span></div></div>
      </>
    );
  }
  const selected =
    analysis.matchLinks.find((link) => link.id === selectedLinkId) ??
    analysis.matchLinks[0];
  const selectedSupplierDocumentId = selected
    ? lineIndex.get(selected.offerLineIds[0])?.run.document.id
    : undefined;
  const selectedOption = selected
    ? analysis.supplierOptions.find(
        (option) =>
          option.basisPositionIds.some((id) =>
            selected.basisPositionIds.includes(id)
          ) && option.supplierDocumentId === selectedSupplierDocumentId
      )
    : undefined;

  async function submit(
    action: MatchReviewAction["action"],
    basisPositionIds: string[],
    offerLineIds: string[],
    supplierDocumentId: string
  ) {
    setPending(true);
    try {
      const response = await fetch("/api/review-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "MATCH",
          action,
          basisPositionIds,
          offerLineIds,
          supplierDocumentId,
          comment,
          operator: "local-operator"
        })
      });
      if (!response.ok) throw new Error(`Matching action failed: ${response.status}`);
      await reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="ZUORDNUNG"
        title="Angebote mit Basis-LV verbinden"
        description={`${analysis.basisPositionFrom}–${analysis.basisPositionTo}: Kandidaten aus unabhängigen Extraktionen, danach regelbasierte Constraints.`}
      />
      <div className="notice"><Link2 size={19} /><div><strong>Extraktion bleibt unverändert</strong><span>Änderungen werden mit Prüfvermerk und Änderungsprotokoll lokal gespeichert.</span></div></div>
      <div className="matching-pilot-layout">
        <section className="panel">
          <div className="table-scroll">
            <table data-real-matching>
              <thead><tr><th>LV-Position</th><th>Supplier-Zeile</th><th>Lieferant</th><th>Art</th><th>Status</th><th>Konkrete Gründe</th><th>Quellen</th><th /></tr></thead>
              <tbody>{analysis.matchLinks.map((link) => {
                const basis = basisIndex.get(link.basisPositionIds[0]);
                const offer = lineIndex.get(link.offerLineIds[0]);
                const basisEvidence = basis?.evidence[0];
                const offerEvidence = offer?.line.evidence[0];
                const basisHref = basisEvidence
                  ? pilotEvidenceHref(pilot, basisEvidence)
                  : null;
                const offerHref = offerEvidence
                  ? pilotEvidenceHref(pilot, offerEvidence, offer?.line.id)
                  : null;
                return <tr key={link.id} className={selected?.id === link.id ? "selected-row" : ""} onClick={() => setSelectedLinkId(link.id)}>
                  <td><strong>{basis?.positionNumber ?? "—"}</strong></td>
                  <td>{offer?.line.description ?? "Nicht zugeordnet"}{link.offerLineIds.length > 1 ? <small className="scope-note">+ {link.offerLineIds.length - 1} Komponenten</small> : null}</td>
                  <td>{offer?.run.document.relativePath ?? "—"}</td>
                  <td><span className="mono-label">{link.kind}</span></td>
                  <td><StatusBadge>{link.confirmedByOperator ? "HUMAN_CONFIRMED" : link.status}</StatusBadge></td>
                  <td>{link.reasons.join(" · ") || "Keine belastbare Begründung"}</td>
                  <td><div className="source-links">
                    {basisHref ? <a href={basisHref} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Zur Basis-Quelle</a> : null}
                    {offerHref ? <a href={offerHref} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Zur Angebotsquelle</a> : null}
                  </div></td>
                  <td><Button kind="ghost" disabled={pending || link.confirmedByOperator} onClick={() => submit("CONFIRM_MATCH", link.basisPositionIds, link.offerLineIds, offer?.run.document.id ?? "")}>{link.confirmedByOperator ? <Check size={15} /> : null} Bestätigen</Button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </section>
        {selected ? <aside className="panel position-inspector" data-matching-inspector>
          <span className="eyebrow">MANUELLE KONTROLLE</span>
          <h2>{basisIndex.get(selected.basisPositionIds[0])?.positionNumber}</h2>
          {selectedOption ? <>
            <StatusBadge>{selectedOption.status}</StatusBadge>
            <ul className="option-reasons">
              {selectedOption.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </> : null}
          <label className="comment-field"><span>Andere Basis-Position</span><select value={basisChoice} onChange={(event) => setBasisChoice(event.target.value)}>{analysis.basisPositions.map((position) => <option key={position.id} value={position.id}>{position.positionNumber} · {position.description}</option>)}</select></label>
          <label className="comment-field"><span>Aktion</span><select value={manualAction} onChange={(event) => setManualAction(event.target.value as MatchReviewAction["action"])}>
            <option value="CHOOSE_BASIS">Andere Basis-Position wählen</option>
            <option value="COMBINE_LINES">Mehrere Supplier-Zeilen verbinden</option>
            <option value="SPLIT_GROUP">Supplier-Gruppe teilen</option>
            <option value="INCLUDE_REQUIRED_COMPONENT">Pflichtkomponente einschließen</option>
            <option value="EXCLUDE_OPTIONAL">Optional ausschließen</option>
            <option value="INCLUDE_OPTIONAL">Optional einschließen</option>
            <option value="CONFIRM_REPLACEMENT">Ersatz bestätigen</option>
            <option value="ADD_COMMENT">Kommentar hinzufügen</option>
          </select></label>
          <label className="comment-field"><span>Kommentar</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Begründung für Audit-Trail" /></label>
          <Button disabled={pending} onClick={() => submit(manualAction, manualAction === "CHOOSE_BASIS" ? [basisChoice] : selected.basisPositionIds, selected.offerLineIds, lineIndex.get(selected.offerLineIds[0])?.run.document.id ?? "")}>Aktion speichern</Button>
          <div className="audit-note"><History size={15} /> Persistiert und nach Restart wiederhergestellt.</div>
        </aside> : null}
      </div>
    </>
  );
}

function Matching() {
  const { pilot, reload } = usePilotState();
  if (pilot === undefined) return <div className="panel loading-panel">Quelldaten werden geladen…</div>;
  return pilot === null ? <SyntheticMatching /> : <RealMatching pilot={pilot} reload={reload} />;
}

function RealComparison({
  pilot,
  reload
}: {
  pilot: PilotStateView;
  reload: () => Promise<void>;
}) {
  const analysis = pilot.analysis;
  const [filter, setFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortMode, setSortMode] = useState<
    "LV_ORDER" | "UNRESOLVED_FIRST" | "STATUS" | "PRICE_DIFFERENCE"
  >("LV_ORDER");
  const [selected, setSelected] = useState(analysis?.basisPositions[0]?.id ?? "");
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [comment, setComment] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionPending, setDecisionPending] = useState(false);
  const searchIndex = useMemo(() => {
    if (!analysis) return new Map<string, string>();
    const offerLines = new Map(
      pilot.runs.flatMap((run) =>
        run.result.envelope.extraction.offerGroups.flatMap((group) =>
          group.lines.map((line) => [line.id, line] as const)
        )
      )
    );
    return new Map(
      analysis.basisPositions.map((position) => {
        const options = analysis.supplierOptions.filter((option) =>
          option.basisPositionIds.includes(position.id)
        );
        return [
          position.id,
          [
            position.positionNumber,
            position.description,
            ...options.flatMap((option) => [
              option.supplierLabel,
              ...option.matchedOfferLineIds.flatMap((lineId) => {
                const line = offerLines.get(lineId);
                return line
                  ? [
                      line.description,
                      line.articleNumber ?? "",
                      line.manufacturer ?? ""
                    ]
                  : [];
              })
            ])
          ]
            .join(" ")
            .toLocaleLowerCase("de")
        ];
      })
    );
  }, [analysis, pilot.runs]);
  if (!analysis) {
    return (
      <>
        <PageHeader eyebrow="LV-VERGLEICH" title="Angebotsvergleich" description="Die Zuordnungsanalyse ist noch nicht verfügbar." />
        <div className="notice"><CircleAlert size={19} /><div><strong>Analyse nicht verfügbar</strong><span>Die Zuordnung muss zuerst lokal verarbeitet werden.</span></div></div>
      </>
    );
  }
  const projectReviewIndex = new Map(
    pilot.projectReview.positions.map((position) => [
      position.basis.id,
      position
    ])
  );
  const supplierColumns =
    pilot.projectReview.coverage.relevantSupplierDocuments.length > 0
      ? pilot.projectReview.coverage.relevantSupplierDocuments
      : analysis.supplierDocuments.map((supplier) => ({
          id: supplier.id,
          label: supplier.label,
          supplier: supplier.label
        }));
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase("de");
  const unresolvedStatuses = new Set([
    "MANUAL_DECISION_REQUIRED",
    "PROCESSING_PENDING",
    "PROCESSING_ERROR",
    "NO_COMPARABLE_OFFER",
    "DEFERRED"
  ]);
  const compareLvOrder = (left: BasisPosition, right: BasisPosition) => {
    const a = left.positionNumber.match(/\d+/g)?.map(Number) ?? [];
    const b = right.positionNumber.match(/\d+/g)?.map(Number) ?? [];
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const delta = (a[index] ?? 0) - (b[index] ?? 0);
      if (delta !== 0) return delta;
    }
    return 0;
  };
  const visible = analysis.basisPositions
    .filter((position) => {
      const status = projectReviewIndex.get(position.id)?.liveStatus;
      const reviewPosition = projectReviewIndex.get(position.id);
      return (
        (reviewPosition
          ? liveFilterMatches(reviewPosition, filter)
          : filter === "ALL" || status === filter) &&
        (!normalizedSearch ||
          Boolean(searchIndex.get(position.id)?.includes(normalizedSearch)))
      );
    })
    .sort((left, right) => {
      const leftReview = projectReviewIndex.get(left.id);
      const rightReview = projectReviewIndex.get(right.id);
      if (sortMode === "UNRESOLVED_FIRST") {
        const delta =
          Number(unresolvedStatuses.has(rightReview?.liveStatus ?? "")) -
          Number(unresolvedStatuses.has(leftReview?.liveStatus ?? ""));
        return delta || compareLvOrder(left, right);
      }
      if (sortMode === "STATUS") {
        return (
          (leftReview?.liveStatus ?? "").localeCompare(
            rightReview?.liveStatus ?? "",
            "de"
          ) || compareLvOrder(left, right)
        );
      }
      if (sortMode === "PRICE_DIFFERENCE") {
        const difference = (position: ProjectReviewPosition | undefined) =>
          position?.independent.nextComparableTotal !== null &&
          position?.independent.comparableTotal !== null
            ? position!.independent.nextComparableTotal! -
              position!.independent.comparableTotal!
            : Number.NEGATIVE_INFINITY;
        return (
          difference(rightReview) - difference(leftReview) ||
          compareLvOrder(left, right)
        );
      }
      return compareLvOrder(left, right);
    });
  const detail =
    analysis.basisPositions.find((position) => position.id === selected) ??
    analysis.basisPositions[0];
  const detailOptions = analysis.supplierOptions.filter((option) =>
    option.basisPositionIds.includes(detail.id)
  );
  const selectedOption = detailOptions.find((option) => option.id === selectedOptionId);
  const activeReasons = activeDecisionReasons(CURRENT_DECISION_REASON_CATALOG);
  const selectedReason = activeReasons.find((reason) => reason.code === reasonCode);
  const decision = pilot.supplierDecisions
    .filter((item) => item.basisPositionId === detail.id)
    .at(-1);
  const statusCounts = Object.fromEntries(
    liveFilterOptions
      .filter(([, value]) => value !== "ALL")
      .map(([, value]) => [
        value,
        pilot.projectReview.positions.filter(
          (position) => liveFilterMatches(position, value)
        ).length
      ])
  );
  const lineIndex = new Map(
    pilot.runs.flatMap((run) =>
      run.result.envelope.extraction.offerGroups.flatMap((group) =>
        group.lines.map((line) => [line.id, { line, run }] as const)
      )
    )
  );
  const basisEvidenceAvailable = Boolean(
    detail.evidence[0] && pilotEvidenceHref(pilot, detail.evidence[0])
  );
  const selectedLines = selectedOption
    ? selectedOption.matchedOfferLineIds
        .map((lineId) => lineIndex.get(lineId)?.line)
        .filter((line): line is OfferLine => Boolean(line))
    : [];
  const supplierEvidenceAvailable =
    selectedLines.length > 0 &&
    selectedLines.every((line) =>
      line.evidence.some((evidence) => Boolean(pilotEvidenceHref(pilot, evidence, line.id)))
    );
  const commentSatisfied =
    !selectedReason?.requiresComment || comment.trim().length > 0;
  const canConfirmDecision = Boolean(
    selectedOption &&
      basisEvidenceAvailable &&
      supplierEvidenceAvailable &&
      selectedReason &&
      commentSatisfied
  );

  async function decide(status: "SELECTED" | "DEFERRED") {
    setDecisionPending(true);
    setDecisionError(null);
    try {
      const response = await fetch("/api/review-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "DECISION",
          basisPositionId: detail.id,
          status,
          selectedSupplierOptionId:
            status === "SELECTED" ? selectedOption?.id ?? null : null,
          reasonCodes: status === "SELECTED" && reasonCode ? [reasonCode] : [],
          comment,
          decidedBy: "local-operator"
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          [payload.error, ...(payload.details ?? [])].filter(Boolean).join(": ")
        );
      }
      await reload();
    } catch (error) {
      setDecisionError(
        error instanceof Error ? error.message : "Supplier decision failed"
      );
    } finally {
      setDecisionPending(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="LV-VERGLEICH"
        title="Belastbarer Angebotsvergleich"
        description="Comparable totals enthalten nur belegte Primär- und Pflichtkomponenten; Optionalen und Alternativen bleiben separat."
      />
      {!pilot.projectReview.invariant.valid ? (
        <div className="notice blocking-invariant" data-invariant-warning>
          <CircleAlert size={19} />
          <div>
            <strong>Vollständigkeitsprüfung fehlgeschlagen</strong>
            <span>
              Ergebnisexport gesperrt · problematische Positionen:{" "}
              {pilot.projectReview.invariant.problemPositionIds.join(", ") ||
                "nicht positionsbezogener Strukturfehler"}
            </span>
          </div>
        </div>
      ) : null}
      <div className="lv-status-counters" data-lv-status-counters>
        <div>
          <span>Gesamt</span>
          <strong>{pilot.projectReview.positions.length}</strong>
        </div>
        {liveFilterOptions.slice(1).map(([label, value]) => (
          <div key={value}>
            <span>{label}</span>
            <strong>{statusCounts[value] ?? 0}</strong>
          </div>
        ))}
      </div>
      <div className="comparison-layout">
        <section>
          <div className="filter-tabs">
            {liveFilterOptions.map(([label, value]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
          <div className="lv-table-tools">
            <label>
              <Search size={16} />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Position, Beschreibung, Artikel, Lieferant oder Hersteller"
                aria-label="LV durchsuchen"
              />
            </label>
            <select
              value={sortMode}
              onChange={(event) =>
                setSortMode(
                  event.target.value as
                    | "LV_ORDER"
                    | "UNRESOLVED_FIRST"
                    | "STATUS"
                    | "PRICE_DIFFERENCE"
                )
              }
              aria-label="LV sortieren"
            >
              <option value="LV_ORDER">LV-Reihenfolge</option>
              <option value="UNRESOLVED_FIRST">Offene zuerst</option>
              <option value="STATUS">Status</option>
              <option value="PRICE_DIFFERENCE">Preisdifferenz</option>
            </select>
            <strong>
              {visible.length} von {analysis.basisPositions.length} Positionen
            </strong>
          </div>
          <div className="panel comparison-table">
            <div className="table-scroll"><table data-real-comparison>
              <thead><tr><th className="lv-position-col">LV-Position</th><th className="lv-description-col">Beschreibung</th><th className="lv-quantity-col">Menge / Einheit</th>{supplierColumns.map((supplier) => <th key={supplier.id}>{supplier.supplier}</th>)}<th>Vergleich</th><th>Auswahl</th><th className="lv-status-col">Status</th><th>Kommentar</th><th>Aktion</th></tr></thead>
              <tbody>{visible.map((position) => {
                const options = analysis.supplierOptions.filter((option) => option.basisPositionIds.includes(position.id));
                const projectPosition = projectReviewIndex.get(position.id);
                const rowDecision = pilot.supplierDecisions
                  .filter((item) => item.basisPositionId === position.id)
                  .at(-1);
                const automaticOption = options.find(
                  (option) =>
                    option.id === projectPosition?.independent.selectedSupplierOptionId
                );
                return <tr key={position.id} onClick={() => {
                  setSelected(position.id);
                  setSelectedOptionId(null);
                  setReasonCode("");
                  setComment("");
                  setDecisionError(null);
                }} className={detail.id === position.id ? "selected-row" : ""}>
                  <td className="lv-position-col"><strong>{position.positionNumber}</strong></td><td className="lv-description-col">{position.description}<small className="scope-note">{position.scopeProfile?.procurementMaterialScope.map((requirement) => requirement.label).join(" · ") || "Materialumfang nicht explizit"}</small></td><td className="lv-quantity-col">{position.quantity ?? "—"} {position.unit ?? ""}</td>
                  {supplierColumns.map((supplier) => {
                    const option = options.find(
                      (candidate) =>
                        candidate.supplierDocumentId === supplier.id
                    );
                    const missingSource =
                      projectPosition?.coverage.missingSources.find(
                        (source) =>
                          source.supplierDocumentId === supplier.id
                      );
                    const sourceAvailable = Boolean(
                      option?.matchedOfferLineIds.some((lineId) =>
                        lineIndex
                          .get(lineId)
                          ?.line.evidence.some((evidence) =>
                            Boolean(
                              pilotEvidenceHref(
                                pilot,
                                evidence,
                                lineId
                              )
                            )
                          )
                      )
                    );
                    const specializedIrrelevant =
                      projectPosition?.coverage.irrelevantSpecializedSuppliers.includes(
                        supplier.id
                      );
                    return (
                      <td key={supplier.id}>
                        {specializedIrrelevant
                          ? "Nicht relevant"
                          : optionDisplay(option)}
                        <small className="scope-note">
                          {specializedIrrelevant
                            ? "Spezialanbieter außerhalb des Positionsumfangs"
                            : sourceAvailable
                            ? "Quelle verfügbar"
                            : missingSource?.pages.length
                              ? `Angebotsseite ${missingSource.pages.join(", ")} noch nicht verarbeitet`
                              : "Quelle fehlt"}
                        </small>
                      </td>
                    );
                  })}
                  <td>{formatCurrency(projectPosition?.independent.comparableTotal ?? null)}</td>
                  <td>{automaticOption?.supplierLabel ?? (rowDecision?.supplierDocumentId ? supplierColumns.find((item) => item.id === rowDecision.supplierDocumentId)?.supplier : "—")}</td>
                  <td className="lv-status-col">
                    <StatusBadge>{liveStatusLabel(projectPosition)}</StatusBadge>
                  </td>
                  <td>{rowDecision?.comment ? "Vorhanden" : "—"}</td>
                  <td><button type="button" className="table-action">Prüfen</button></td>
                </tr>;
              })}</tbody>
            </table></div>
          </div>
        </section>
        <aside className="panel position-inspector" data-comparison-inspector>
          <span className="eyebrow">POSITION {detail.positionNumber}</span>
          <h2>{detail.description}</h2>
          <div className="requirement-grid"><div><span>Menge</span><strong>{detail.quantity ?? "—"} {detail.unit ?? ""}</strong></div><div><span>Validation</span><strong>{detail.verificationStatus ?? "NEEDS_REVIEW"}</strong></div></div>
          {detail.scopeProfile ? (
            <div className="scope-profile">
              <div>
                <span>Procurement material scope</span>
                <strong>
                  {detail.scopeProfile.procurementMaterialScope
                    .map((requirement) => requirement.label)
                    .join(" · ")}
                </strong>
              </div>
              <div>
                <span>Execution requirements</span>
                <strong>
                  {detail.scopeProfile.fullLvExecutionScope
                    .filter(
                      (requirement) => requirement.category !== "MATERIAL"
                    )
                    .map((requirement) => requirement.label)
                    .join(" · ") || "Keine zusätzlichen Anforderungen"}
                </strong>
              </div>
              {detail.scopeProfile.inheritedExecutionDescription.length ? (
                <small>
                  Geerbte Ausführungsbeschreibung belegt ·{" "}
                  {detail.scopeProfile.inheritedMaterialRequirements
                    .flatMap((requirement) => requirement.evidence)
                    .map((evidence) => `S. ${evidence.pageNumber}`)
                    .filter(
                      (value, index, values) =>
                        values.indexOf(value) === index
                    )
                    .join(", ")}
                </small>
              ) : null}
            </div>
          ) : null}
          <h3>Lieferantenoptionen</h3>
          {detailOptions.map((option) => {
            const optionLines = option.matchedOfferLineIds
              .map((lineId) => lineIndex.get(lineId)?.line)
              .filter((line): line is OfferLine => Boolean(line));
            const evidenceLinks = Array.from(
              new Map(
                optionLines.flatMap((line) =>
                  line.evidence.flatMap((evidence) => {
                    const href = pilotEvidenceHref(pilot, evidence, line.id);
                    return href
                    ? [[`${line.id}:${evidence.id}`, {
                        href,
                        pageNumber: evidence.pageNumber,
                        lineId: line.id
                      }] as const]
                    : [];
                  })
                )
              ).values()
            );
            return <div
              className={`supplier-option ${selectedOptionId === option.id ? "selected-option" : ""}`}
              data-supplier-option-id={option.id}
              key={option.id}
            >
              <span>{option.supplierLabel}</span><strong>{optionDisplay(option)}</strong>
              <small>{optionPriceBreakdown(option)}</small>
              <small>{option.scopeOfSupply.length} Scope-Zeilen · Pflicht {option.mandatoryComponentPrices.length} · Optional {option.optionalPrices.length}</small>
              <div className="decision-source-lines">
                {optionLines.length ? optionLines.map((line) => (
                  <div key={line.id}>
                    <span className="mono-label">{line.role}</span>
                    <strong>{line.description}</strong>
                    <small>
                      {line.manufacturer ?? "Hersteller —"} · Art. {line.articleNumber ?? "—"} · {line.quantity ?? "—"} {line.unit ?? ""}
                    </small>
                  </div>
                )) : <p>Keine originale Supplier-Zeile verknüpft.</p>}
              </div>
              <ul className="option-reasons">
                {option.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              <div className="source-links">
                {evidenceLinks.map((evidence) => <a key={evidence.href} href={evidence.href} target="_blank" rel="noreferrer">Zur Angebotsquelle · S. {evidence.pageNumber}</a>)}
              </div>
              <Button kind="ghost" onClick={() => {
                setSelectedOptionId(option.id);
                setDecisionError(null);
              }}>{selectedOptionId === option.id ? <Check size={15} /> : null} Option zur Entscheidung auswählen</Button>
            </div>;
          })}
          {detail.evidence[0] ? <a className="source-button" href={pilotEvidenceHref(pilot, detail.evidence[0]) ?? "#"} target="_blank" rel="noreferrer"><Eye size={16} /> Zur Basis-Quelle</a> : null}
          <div className="inspector-status">
            <StatusBadge>
              {liveStatusLabel(projectReviewIndex.get(detail.id))}
            </StatusBadge>
            {projectReviewIndex.get(detail.id)?.primaryReasonDe ? (
              <p>
                {projectReviewIndex.get(detail.id)?.primaryReasonDe}
              </p>
            ) : null}
            {projectReviewIndex.get(detail.id)?.independent.reasons.length ? (
              <ul className="option-reasons">
                {projectReviewIndex.get(detail.id)?.independent.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            ) : <p>Keine vergleichbare Option.</p>}
            <p>
              Supplier coverage:{" "}
              <strong>
                {projectReviewIndex.get(detail.id)?.coverage.coverageStatus ??
                  "UNKNOWN"}
              </strong>
            </p>
            {projectReviewIndex.get(detail.id)?.coverage.missingSources.length ? (
              <ul className="option-reasons">
                {projectReviewIndex
                  .get(detail.id)
                  ?.coverage.missingSources.map((source) => {
                    const supplier =
                      supplierColumns.find(
                        (candidate) =>
                          candidate.id === source.supplierDocumentId
                      )?.supplier ?? source.supplierDocumentId;
                    return (
                      <li key={source.supplierDocumentId}>
                        {supplier}
                        {source.pages.length
                          ? `-Angebotsseite ${source.pages.join(", ")} noch nicht verarbeitet.`
                          : ": fehlende Angebotsseite noch nicht bestimmt."}
                      </li>
                    );
                  })}
              </ul>
            ) : null}
          </div>
          {decision ? (
            <div className="decision-history-note">
              <strong>Gespeicherte Entscheidung: {decision.status}</strong>
              <span>
                ID {decision.id}
                {"catalogVersion" in decision ? ` · Katalog ${decision.catalogVersion}` : " · Legacy decision"}
              </span>
            </div>
          ) : null}
          <label className="comment-field">
            <span>Entscheidungsgrund · Katalog {CURRENT_DECISION_REASON_CATALOG.version}</span>
            <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
              <option value="">Grund auswählen</option>
              {activeReasons.map((reason) => (
                <option key={reason.code} value={reason.code}>
                  {reason.labelDe}
                </option>
              ))}
            </select>
          </label>
          {selectedReason ? (
            <p className="placeholder-reason">
              {CURRENT_DECISION_REASON_CATALOG.placeholder ? "Placeholder · " : ""}
              {selectedReason.descriptionDe}
            </p>
          ) : null}
          <label className="comment-field"><span>Entscheidungskommentar</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label>
          <ul className="decision-validation">
            <li className={basisEvidenceAvailable ? "ok" : "invalid"}>Basis evidence {basisEvidenceAvailable ? "verfügbar" : "fehlt"}</li>
            <li className={supplierEvidenceAvailable ? "ok" : "invalid"}>Supplier evidence {supplierEvidenceAvailable ? "verfügbar" : "fehlt"}</li>
            <li className={selectedReason ? "ok" : "invalid"}>Entscheidungsgrund {selectedReason ? "gewählt" : "fehlt"}</li>
            <li className={commentSatisfied ? "ok" : "invalid"}>Pflichtkommentar {commentSatisfied ? "vorhanden" : "fehlt"}</li>
          </ul>
          {decisionError ? <p className="action-error">{decisionError}</p> : null}
          <div className="review-actions">
            <Button disabled={decisionPending || !canConfirmDecision} onClick={() => decide("SELECTED")}>Supplier decision bestätigen</Button>
            <Button kind="secondary" disabled={decisionPending} onClick={() => decide("DEFERRED")}>Entscheidung zurückstellen</Button>
          </div>
        </aside>
      </div>
    </>
  );
}

function Comparison() {
  const { pilot, reload } = usePilotState();
  if (pilot === undefined) return <div className="panel loading-panel">Quelldaten werden geladen…</div>;
  return pilot === null ? (
    <SyntheticComparison />
  ) : (
    <LvComparisonPage pilot={pilot} reload={reload} />
  );
}

function RealDecisions({
  pilot,
  reload,
  embedded = false
}: {
  pilot: PilotStateView;
  reload: () => Promise<void>;
  embedded?: boolean;
}) {
  const analysis = pilot.analysis;
  const automaticPositions = pilot.projectReview.positions.filter(
    (position) => position.liveStatus === "AUTO_SELECTED_LOWEST_PRICE"
  );
  const unresolvedPositions = pilot.projectReview.positions.filter(
    (position) =>
      (position.liveStatus === "MANUAL_DECISION_REQUIRED" &&
        position.reviewQueue === "MANAGER_DECISION") ||
      position.liveStatus === "DEFERRED"
  );
  const [reviewBasisId, setReviewBasisId] = useState(
    unresolvedPositions[0]?.basis.id ?? ""
  );
  const [overrideBasisId, setOverrideBasisId] = useState<string | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [draftLoadedFor, setDraftLoadedFor] = useState<string | null>(null);
  const [queueRestored, setQueueRestored] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("ALL");

  const reviewPosition =
    pilot.projectReview.positions.find(
      (position) => position.basis.id === (overrideBasisId ?? reviewBasisId)
    ) ?? unresolvedPositions[0] ?? null;
  const reviewIndex = reviewPosition
    ? unresolvedPositions.findIndex(
        (position) => position.basis.id === reviewPosition.basis.id
      )
    : -1;
  const lineIndex = new Map(
    pilot.runs.flatMap((run) =>
      run.result.envelope.extraction.offerGroups.flatMap((group) =>
        group.lines.map((line) => [line.id, line] as const)
      )
    )
  );
  const draftKey = reviewPosition && analysis
    ? `spt-manager-draft:${analysis.id}:${reviewPosition.basis.id}`
    : null;
  const reviewPositionId = reviewPosition?.basis.id ?? null;
  const queueKey = analysis ? `spt-manager-last-position:${analysis.id}` : null;
  const unresolvedPositionIds = unresolvedPositions
    .map((position) => position.basis.id)
    .join("|");

  useEffect(() => {
    if (!queueKey) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const savedPositionId = localStorage.getItem(queueKey);
      if (
        savedPositionId &&
        unresolvedPositionIds.split("|").includes(savedPositionId)
      ) {
        setReviewBasisId(savedPositionId);
      }
      setQueueRestored(true);
    });
    return () => {
      cancelled = true;
    };
  }, [queueKey, unresolvedPositionIds]);

  useEffect(() => {
    if (!queueRestored || !queueKey || !reviewBasisId) return;
    localStorage.setItem(queueKey, reviewBasisId);
  }, [queueKey, queueRestored, reviewBasisId]);

  useEffect(() => {
    if (!draftKey || !reviewPositionId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const stored = localStorage.getItem(draftKey);
        const draft = stored
          ? (JSON.parse(stored) as {
              selectedOptionId?: string | null;
              selectedLineIds?: string[];
              comment?: string;
            })
          : null;
        setSelectedOptionId(draft?.selectedOptionId ?? null);
        setSelectedLineIds(draft?.selectedLineIds ?? []);
        setComment(draft?.comment ?? "");
      } catch {
        setSelectedOptionId(null);
        setSelectedLineIds([]);
        setComment("");
      }
      setDraftLoadedFor(reviewPositionId);
      setActionError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [draftKey, reviewPositionId]);

  useEffect(() => {
    if (
      !draftKey ||
      !reviewPositionId ||
      draftLoadedFor !== reviewPositionId
    ) {
      return;
    }
    localStorage.setItem(
      draftKey,
      JSON.stringify({ selectedOptionId, selectedLineIds, comment })
    );
  }, [
    comment,
    draftKey,
    draftLoadedFor,
    reviewPositionId,
    selectedLineIds,
    selectedOptionId
  ]);

  if (!analysis) {
    return <div className="notice">Noch keine Analyse vorhanden.</div>;
  }

  async function submitDecision(
    status:
      | "SELECTED"
      | "DEFERRED"
      | "NONE_CORRECT"
      | "ADDITIONAL_CHECK_REQUESTED"
  ) {
    if (!reviewPosition) return;
    const commentRequired =
      status === "SELECTED" ||
      status === "NONE_CORRECT" ||
      Boolean(overrideBasisId);
    if (commentRequired && comment.trim().length === 0) {
      setActionError("Entscheidungsbegründung ist erforderlich.");
      return;
    }
    if (
      status === "SELECTED" &&
      (!selectedOptionId || selectedLineIds.length === 0)
    ) {
      setActionError("Supplier-Option und exakte Bundle-Zeilen auswählen.");
      return;
    }
    setPending(true);
    setActionError(null);
    try {
      const response = await fetch("/api/review-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "DECISION",
          basisPositionId: reviewPosition.basis.id,
          status,
          selectedSupplierOptionId:
            status === "SELECTED" ? selectedOptionId : null,
          selectedSupplierLineIds:
            status === "SELECTED" ? selectedLineIds : [],
          reasonCodes:
            status === "SELECTED" || status === "NONE_CORRECT"
              ? [PLACEHOLDER_DECISION_REASON_CODE]
              : [],
          comment,
          decidedBy: "local-manager",
          ...(status === "SELECTED"
            ? {
                decisionType: overrideBasisId
                  ? "AUTOMATIC_OVERRIDE"
                  : "MANUAL_SELECTION"
              }
            : {})
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          [payload.error, ...(payload.details ?? [])].filter(Boolean).join(": ")
        );
      }
      if (draftKey) localStorage.removeItem(draftKey);
      setOverrideBasisId(null);
      setSelectedOptionId(null);
      setSelectedLineIds([]);
      setComment("");
      await reload();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Entscheidung fehlgeschlagen."
      );
    } finally {
      setPending(false);
    }
  }

  const ownerPositions = pilot.projectReview.positions.filter((position) => {
    const decisions = pilot.supplierDecisions.filter(
      (decision) => decision.basisPositionId === position.basis.id
    );
    const latest = decisions.at(-1);
    const autoOverridden = decisions.some(
      (decision) =>
        "decisionType" in decision &&
        decision.decisionType === "AUTOMATIC_OVERRIDE"
    );
    if (ownerFilter === "ALL") return true;
    if (ownerFilter === "AUTO_CONFIRMED") {
      return position.liveStatus === "AUTO_SELECTED_LOWEST_PRICE";
    }
    if (ownerFilter === "AUTO_CHANGED") return autoOverridden;
    if (ownerFilter === "OPEN") {
      return (
        position.liveStatus === "MANUAL_DECISION_REQUIRED" &&
        position.reviewQueue === "MANAGER_DECISION"
      );
    }
    if (ownerFilter === "SYSTEM_REVIEW") {
      return (
        position.liveStatus === "MANUAL_DECISION_REQUIRED" &&
        position.reviewQueue === "SYSTEM_REVIEW"
      );
    }
    if (ownerFilter === "MANUAL") return latest?.status === "SELECTED";
    if (ownerFilter === "DEFERRED") {
      return ["DEFERRED", "ADDITIONAL_CHECK_REQUESTED"].includes(
        latest?.status ?? ""
      );
    }
    if (ownerFilter === "HISTORICAL_EXPENSIVE") {
      return (
        position.historical.classification ===
        "AUTO_LOWEST_BUT_HISTORY_DIFFERS"
      );
    }
    return position.liveStatus === "NO_COMPARABLE_OFFER";
  });
  const pendingPositions = pilot.projectReview.positions.filter(
    (position) => position.liveStatus === "PROCESSING_PENDING"
  ).length;

  return (
    <>
      {!embedded ? (
        <PageHeader
          eyebrow="WISSENSSAMMLUNG · ENTSCHEIDUNGEN"
          title="Manager-Entscheidungen"
          description="Automatische Ergebnisse bleiben sichtbar und jede manuelle Änderung wird versioniert."
        />
      ) : null}
      {embedded ? (
        <div
          id="entscheidungspruefung"
          className="lv-decision-divider"
        >
          <span>ENTSCHEIDUNGSPRÜFUNG IM LV-VERGLEICH</span>
        </div>
      ) : null}
      {pendingPositions > 0 ? (
        <div className="info-strip manager-coverage-warning">
          <CircleAlert size={18} />
          <span>
            {pendingPositions} Positionen bleiben in Verarbeitung, bis ihre
            relevante Supplier-Abdeckung vollständig ist.
          </span>
        </div>
      ) : null}

      <section className="manager-section" data-automatic-decisions>
        <div className="manager-section-head">
          <div>
            <span className="eyebrow">A · AUTOMATISCH ZUGEORDNET</span>
            <h2>Unique lowest fully comparable</h2>
          </div>
          <strong>{automaticPositions.length}</strong>
        </div>
        {automaticPositions.length ? (
          <div className="automatic-decision-list">
            {automaticPositions.map((position) => {
              const chosen = position.options.find(
                (candidate) =>
                  candidate.id === position.independent.selectedSupplierOptionId
              );
              return (
                <article className="panel automatic-decision-card" key={position.basis.id}>
                  <div>
                    <span className="mono-label">{position.basis.positionNumber}</span>
                    <h3>{position.basis.description}</h3>
                  </div>
                  <dl>
                    <div><dt>Supplier</dt><dd>{chosen?.supplierLabel ?? "—"}</dd></div>
                    <div><dt>Vergleichspreis</dt><dd>{formatCurrency(position.independent.comparableTotal)}</dd></div>
                    <div><dt>Nächste Option</dt><dd>{formatCurrency(position.independent.nextComparableTotal)}</dd></div>
                    <div><dt>Ersparnis</dt><dd>{formatCurrency(position.independent.saving)}</dd></div>
                  </dl>
                  {position.basis.evidence[0] ? (
                    <a className="source-button" href={pilotEvidenceHref(pilot, position.basis.evidence[0]) ?? "#"} target="_blank" rel="noreferrer">Zur Basis-Quelle</a>
                  ) : null}
                  <Button kind="secondary" onClick={() => {
                    setOverrideBasisId(position.basis.id);
                    setReviewBasisId(position.basis.id);
                  }}>Automatische Auswahl ändern</Button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="panel empty-manager-section">
            Noch keine Position erfüllt Supplier-Coverage, Vergleichbarkeit und
            ein eindeutiges Preisminimum gleichzeitig.
          </div>
        )}
      </section>

      <section className="manager-section" data-manager-queue>
        <div className="manager-section-head">
          <div>
            <span className="eyebrow">B · ENTSCHEIDUNG ERFORDERLICH</span>
            <h2>Eine Position nach der anderen</h2>
          </div>
          <strong>{unresolvedPositions.length}</strong>
        </div>
        {reviewPosition ? (
          <article className="panel manager-review-card">
            <div className="manager-progress">
              <span>
                {overrideBasisId
                  ? "Automatische Auswahl ändern"
                  : `Position ${Math.max(1, reviewIndex + 1)} von ${unresolvedPositions.length}`}
              </span>
              <div>
                <Button kind="ghost" disabled={overrideBasisId !== null || reviewIndex <= 0} onClick={() => setReviewBasisId(unresolvedPositions[reviewIndex - 1]?.basis.id ?? reviewPosition.basis.id)}><ChevronLeft size={18} /> Zurück</Button>
                <Button kind="ghost" disabled={overrideBasisId !== null || reviewIndex < 0 || reviewIndex >= unresolvedPositions.length - 1} onClick={() => setReviewBasisId(unresolvedPositions[reviewIndex + 1]?.basis.id ?? reviewPosition.basis.id)}>Weiter <ChevronRight size={18} /></Button>
              </div>
            </div>
            <div className="manager-basis">
              <span className="mono-label">{reviewPosition.basis.positionNumber}</span>
              <h2>{reviewPosition.basis.description}</h2>
              <strong>{reviewPosition.basis.quantity ?? "—"} {reviewPosition.basis.unit ?? ""}</strong>
              {reviewPosition.basis.evidence[0] ? (
                <a className="source-button" href={pilotEvidenceHref(pilot, reviewPosition.basis.evidence[0]) ?? "#"} target="_blank" rel="noreferrer"><Eye size={18} /> Zur Basis-Quelle</a>
              ) : null}
            </div>
            <div className="manager-discrepancy">
              <h3>Warum ist eine Entscheidung nötig?</h3>
              <ul>
                {[
                  ...reviewPosition.independent.reasons,
                  `Supplier coverage: ${reviewPosition.coverage.coverageStatus}`,
                  ...reviewPosition.coverage.missingExpectedSuppliers.map(
                    (supplier) =>
                      `Erwartetes Supplier-Angebot noch nicht verarbeitet: ${supplier}`
                  )
                ].map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              <dl>
                <div><dt>System: günstigste vergleichbare Option</dt><dd>{formatCurrency(reviewPosition.independent.comparableTotal)}</dd></div>
              </dl>
            </div>
            <div className="manager-options">
              {reviewPosition.options.map((candidate) => {
                const lines = candidate.matchedOfferLineIds
                  .map((lineId) => lineIndex.get(lineId))
                  .filter((line): line is OfferLine => Boolean(line));
                const required = lines.filter(
                  (line) => !["OPTIONAL", "ALTERNATIVE"].includes(line.role)
                );
                const optional = lines.filter((line) =>
                  ["OPTIONAL", "ALTERNATIVE"].includes(line.role)
                );
                return (
                  <section className={`manager-option ${selectedOptionId === candidate.id ? "selected" : ""}`} key={candidate.id}>
                    <button type="button" className="manager-option-select" onClick={() => {
                      setSelectedOptionId(candidate.id);
                      setSelectedLineIds(required.map((line) => line.id));
                    }}>
                      <span>{candidate.supplierLabel}</span>
                      <strong>{optionDisplay(candidate)}</strong>
                      <StatusBadge>{candidate.status}</StatusBadge>
                    </button>
                    <h4>Komplettes Bundle</h4>
                    {required.length ? required.map((line) => (
                      <label className="manager-line" key={line.id}>
                        <input
                          type="checkbox"
                          checked={selectedLineIds.includes(line.id)}
                          disabled={selectedOptionId !== candidate.id}
                          onChange={(event) => setSelectedLineIds((current) =>
                            event.target.checked
                              ? Array.from(new Set([...current, line.id]))
                              : current.filter((id) => id !== line.id)
                          )}
                        />
                        <span><strong>{line.description}</strong><small>{line.quantity ?? "—"} {line.unit ?? ""} · {line.role}</small></span>
                        <span className="manager-line-sources">
                          {line.evidence.map((evidence) => {
                            const href = pilotEvidenceHref(pilot, evidence, line.id);
                            return href ? <a key={evidence.id} href={href} target="_blank" rel="noreferrer">Zur Angebotsquelle · S. {evidence.pageNumber}</a> : null;
                          })}
                        </span>
                      </label>
                    )) : <p>Keine belastbar zugeordnete Angebotszeile.</p>}
                    {optional.length ? (
                      <div className="manager-optional">
                        <h4>Optional separat</h4>
                        {optional.map((line) => <p key={line.id}>{line.description}</p>)}
                      </div>
                    ) : null}
                    {candidate.technicalDeviations.length ? (
                      <div className="manager-technical">
                        <h4>Technische Unterschiede</h4>
                        {candidate.technicalDeviations.map((difference) => <p key={difference}>{difference}</p>)}
                      </div>
                    ) : null}
                    <ul className="option-reasons">
                      {candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </section>
                );
              })}
            </div>
            <label className="manager-comment">
              <span>Entscheidungsbegründung</span>
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Bitte ausführlich erklären, warum diese Entscheidung getroffen wird." />
              <small>Entwurf wird auf diesem Gerät automatisch gespeichert.</small>
            </label>
            {actionError ? <p className="action-error">{actionError}</p> : null}
            <div className="manager-actions">
              <Button disabled={pending || !selectedOptionId || selectedLineIds.length === 0 || comment.trim().length === 0} onClick={() => submitDecision("SELECTED")}>Ausgewählte Option bestätigen</Button>
              <Button kind="secondary" disabled={pending || comment.trim().length === 0} onClick={() => submitDecision("NONE_CORRECT")}>Keine Option ist richtig</Button>
              <Button kind="ghost" disabled={pending} onClick={() => submitDecision("DEFERRED")}>Zurückstellen</Button>
              <Button kind="ghost" disabled={pending} onClick={() => submitDecision("ADDITIONAL_CHECK_REQUESTED")}>Zusätzliche Prüfung anfordern</Button>
              {overrideBasisId ? <Button kind="ghost" onClick={() => setOverrideBasisId(null)}>Änderung abbrechen</Button> : null}
            </div>
          </article>
        ) : (
          <div className="panel empty-manager-section">Keine offene Managerentscheidung.</div>
        )}
      </section>

      <section className="manager-section owner-knowledge" data-owner-knowledge>
        <div className="manager-section-head">
          <div>
            <span className="eyebrow">OWNER VIEW</span>
            <h2>Wissenssammlung / Entscheidungen</h2>
          </div>
          <strong>{ownerPositions.length}</strong>
        </div>
        <div className="owner-filters">
          {[
            ["ALL", "Alle"],
            ["AUTO_CONFIRMED", "Auto bestätigt"],
            ["AUTO_CHANGED", "Auto geändert"],
            ["OPEN", "Entscheidung durch Leitung"],
            ["SYSTEM_REVIEW", "Technische Systemprüfung"],
            ["MANUAL", "Manuell entschieden"],
            ["DEFERRED", "Zurückgestellt"],
            ...(pilot.projectReview.coverage.historicalCalculationAvailable
              ? [["HISTORICAL_EXPENSIVE", "Historisch teurer gewählt"]]
              : []),
            ["NOT_COMPARABLE", "Nicht vergleichbar"]
          ].map(([value, label]) => <button key={value} className={ownerFilter === value ? "active" : ""} onClick={() => setOwnerFilter(value)}>{label}</button>)}
        </div>
        <div className="owner-list">
          {ownerPositions.map((position) => {
            const history = pilot.supplierDecisions.filter(
              (decision) => decision.basisPositionId === position.basis.id
            );
            const latest = history.at(-1);
            const independentOption = position.options.find(
              (candidate) =>
                candidate.id === position.independent.systemCheapestOptionId
            );
            return (
              <article className="panel owner-record" key={position.basis.id}>
                <div><span className="mono-label">{position.basis.positionNumber}</span><StatusBadge>{liveStatusLabel(position)}</StatusBadge></div>
                <h3>{position.basis.description}</h3>
                <p>Unabhängig günstigste Option: <strong>{independentOption?.supplierLabel ?? "nicht vergleichbar"}</strong></p>
                <p>Managerentscheidung: <strong>{latest?.status ?? "offen"}</strong></p>
                {latest?.comment ? <blockquote>{latest.comment}</blockquote> : null}
                {position.basis.evidence[0] ? <a href={pilotEvidenceHref(pilot, position.basis.evidence[0]) ?? "#"} target="_blank" rel="noreferrer">Zur Basis-Quelle</a> : null}
                <details>
                  <summary>Entscheidungshistorie ({history.length})</summary>
                  <ol>{history.map((decision) => <li key={decision.id}>{decision.status} · {decision.comment || "ohne Kommentar"} · ID {decision.id}</li>)}</ol>
                </details>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

function Decisions() {
  const { pilot, reload } = usePilotState();
  if (pilot === undefined) return <div className="panel loading-panel">Quelldaten werden geladen…</div>;
  return pilot === null ? <SyntheticDecisions /> : <RealDecisions pilot={pilot} reload={reload} />;
}

function ExportView({ embedded = false }: { embedded?: boolean } = {}) {
  const { pilot, reload } = usePilotState();
  const [confirmedOnly, setConfirmedOnly] = useState(true);
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const exportable = useMemo(() => comparisonRows.filter((row) => row.status === "CLEAR_RECOMMENDATION").length, []);
  const realAutomatic =
    pilot?.projectReview.positions.filter(
      (position) => position.liveStatus === "AUTO_SELECTED_LOWEST_PRICE"
    ).length ?? 0;
  const realOpen =
    pilot?.projectReview.positions.filter(
      (position) =>
        ["MANUAL_DECISION_REQUIRED", "NO_COMPARABLE_OFFER"].includes(
          position.liveStatus
        )
    ).length ?? 0;
  async function importReviewPackage(file: File) {
    setImportMessage("Review-Paket wird geprüft…");
    try {
      const response = await fetch("/api/review-package", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: await file.text()
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "Import fehlgeschlagen");
      }
      setImportMessage(
        `${payload.imported} Entscheidungen importiert, ${payload.skipped} bereits vorhanden.`
      );
      await reload();
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "Import fehlgeschlagen"
      );
    }
  }
  return (
    <>
      {embedded ? (
        <div className="lv-decision-divider">
          <span>EXPORT IM LV-VERGLEICH</span>
          <h2>Prüfergebnis und Review-Paket</h2>
        </div>
      ) : (
        <PageHeader
          eyebrow="EXPORT"
          title="Prüfergebnis exportieren"
          description="XLSX enthält nur transparent gekennzeichnete, bestätigte Daten und Quellenverweise."
        />
      )}
      <div className="export-layout">
        <section className="panel export-settings">
          <div className="export-icon"><Download size={26} /></div>
          <h2>LV-Vergleich als Excel-Datei</h2>
          <p>Positionen, Lieferantenoptionen, vergleichbare Preise, Status, Entscheidungen, Kommentare und Evidence-Seiten.</p>
          <label className="check-row"><input type="checkbox" checked={confirmedOnly} onChange={(event) => setConfirmedOnly(event.target.checked)} /><span><strong>Nur bestätigte Daten</strong><small>Ungeprüfte Werte werden nicht als bestätigt exportiert.</small></span></label>
          <label className="check-row"><input type="checkbox" checked={includeEvidence} onChange={(event) => setIncludeEvidence(event.target.checked)} /><span><strong>Quellenverweise aufnehmen</strong><small>Dokument- und Seitenreferenz je Position.</small></span></label>
          {pilot ? (
            <>
              <Link className="button button-primary full" href="/api/review-package?format=json"><FileDown size={17} /> SPT review package JSON</Link>
              {pilot.projectReview.invariant.valid ? (
                <Link className="button button-secondary full" href="/api/review-package?format=xlsx"><FileDown size={17} /> Ergebnis exportieren (XLSX)</Link>
              ) : (
                <button className="button button-secondary full" disabled title="Vollständigkeitsprüfung fehlgeschlagen"><LockKeyhole size={17} /> Ergebnisexport gesperrt</button>
              )}
              <label className="review-package-import">
                <span><Upload size={17} /> Review-Paket importieren</span>
                <input type="file" accept="application/json,.json" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importReviewPackage(file);
                }} />
              </label>
              {importMessage ? <p className="import-message">{importMessage}</p> : null}
              <small className="package-note">Originale PDF-Dateien werden nicht in das Paket eingebettet.</small>
            </>
          ) : (
            <a className="button button-primary full" href={`/api/export?confirmedOnly=${confirmedOnly}&evidence=${includeEvidence}`}><FileDown size={17} /> XLSX erstellen</a>
          )}
        </section>
        <aside className="panel export-summary">
          <span className="eyebrow">EXPORTBEREITSCHAFT</span>
          <div className="readiness-score"><strong>{pilot ? realAutomatic : exportable}</strong><span>automatisch bestätigt</span></div>
          <div className="summary-row"><span>Entscheidung erforderlich</span><strong>{pilot ? realOpen : 3}</strong></div>
          <div className="summary-row"><span>Entscheidungshistorie</span><strong>{pilot?.supplierDecisions.length ?? 0}</strong></div>
          <div className="summary-row"><span>Supplier coverage</span><strong>{pilot?.projectReview.coverage.allRelevantOffersProcessed ? "vollständig" : "unvollständig"}</strong></div>
          <div className="summary-row"><span>Vollständigkeitsinvariant</span><strong>{pilot?.projectReview.invariant.valid ? "erfüllt" : "blockiert"}</strong></div>
          <div className="info-strip compact"><CircleAlert size={16} /><span>Offene Positionen bleiben im Export klar als ungeprüft markiert.</span></div>
        </aside>
      </div>
    </>
  );
}

export function SectionView({ section }: { section: SectionName }) {
  if (section === "projektuebersicht") return <Overview />;
  if (section === "dokumente") return <Documents />;
  if (section === "gefundene-daten") return <FoundData />;
  if (section === "pruefung") return <Review />;
  if (section === "zuordnung") return <Matching />;
  if (section === "lv-vergleich") return <Comparison />;
  if (section === "entscheidungen") return <Decisions />;
  return <ExportView />;
}
