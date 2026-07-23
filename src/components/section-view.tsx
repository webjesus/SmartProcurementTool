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
import type {
  BasisPosition,
  EvidenceReference,
  MatchReviewAction,
  OfferLine,
  PilotAnalysis,
  SupplierDecision,
  SupplierOption
} from "@/domain/contracts";
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
  analysis: PilotAnalysis | null;
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
    if (!response.ok) throw new Error(`Pilot API returned ${response.status}.`);
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
              : "Pilotdaten konnten nicht geladen werden."
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
            <Play size={16} /> {isLocal ? "Lokaler Pilot aktiv" : "Extraktion starten"}
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
          <div className="empty-state">Noch keine persistierten Supplier-Zeilen. Pilot-Extraction lokal ausführen.</div>
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
          Keine offenen ReviewIssues im lokalen Pilotlauf.
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
        reason: "Quellenbasierte Pilotprüfung",
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
        description="Reale Pilotdaten, lokale Originalseite und dauerhaft gespeicherte Operatoraktionen."
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
              {["PRIMARY", "REQUIRED_COMPONENT", "OPTIONAL", "ALTERNATIVE", "NOT_OFFERED", "UNKNOWN"].map((role) => (
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
    return <section className="panel empty-state">Pilotdaten werden geladen…</section>;
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
          <Link href="/entscheidungen" className="button button-primary full">Entscheidung öffnen <ArrowRight size={16} /></Link>
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

function pilotSourceHref(
  pilot: PilotStateView,
  documentId: string,
  pageNumber: number
): string | null {
  const run = pilot.runs.find(
    (item) =>
      item.document.id === documentId && item.document.pageNumber === pageNumber
  );
  return run
    ? `/api/local/corpus?asset=${encodeURIComponent(run.pageImageAsset)}`
    : null;
}

function optionDisplay(option: SupplierOption | undefined) {
  if (!option) return "Nicht zugeordnet";
  if (option.comparableTotal === null) return option.status.replaceAll("_", " ");
  return `${formatNumber(option.comparableTotal)} €`;
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
        <PageHeader eyebrow="ZUORDNUNG" title="Reale Pilot-Zuordnung" description="Die begrenzte Matching-Analyse ist noch nicht verfügbar." />
        <div className="notice"><CircleAlert size={19} /><div><strong>Analyse noch nicht erzeugt</strong><span>Die reale Extraktion ist vorhanden, aber der begrenzte Matching-Lauf fehlt.</span></div></div>
      </>
    );
  }
  const selected =
    analysis.matchLinks.find((link) => link.id === selectedLinkId) ??
    analysis.matchLinks[0];

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
        eyebrow="ZUORDNUNG · REAL PILOT"
        title="Angebote mit Basis-LV verbinden"
        description={`${analysis.basisPositionFrom}–${analysis.basisPositionTo}: Kandidaten aus unabhängigen Extraktionen, danach regelbasierte Constraints.`}
      />
      <div className="notice"><Link2 size={19} /><div><strong>Extraktion bleibt unverändert</strong><span>Operatoraktionen erzeugen ReviewAction und AuditEvent in der lokalen Pilotdatei.</span></div></div>
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
                  ? pilotSourceHref(pilot, basisEvidence.documentId, basisEvidence.pageNumber)
                  : null;
                const offerHref = offerEvidence
                  ? pilotSourceHref(pilot, offerEvidence.documentId, offerEvidence.pageNumber)
                  : null;
                return <tr key={link.id} className={selected?.id === link.id ? "selected-row" : ""} onClick={() => setSelectedLinkId(link.id)}>
                  <td><strong>{basis?.positionNumber ?? "—"}</strong></td>
                  <td>{offer?.line.description ?? "Nicht zugeordnet"}{link.offerLineIds.length > 1 ? <small className="scope-note">+ {link.offerLineIds.length - 1} Komponenten</small> : null}</td>
                  <td>{offer?.run.document.relativePath ?? "—"}</td>
                  <td><span className="mono-label">{link.kind}</span></td>
                  <td><StatusBadge>{link.confirmedByOperator ? "HUMAN_CONFIRMED" : link.status}</StatusBadge></td>
                  <td>{link.reasons.join(" · ") || "Keine belastbare Begründung"}</td>
                  <td><div className="source-links">
                    {basisHref ? <a href={basisHref} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Zur Quelle Basis</a> : null}
                    {offerHref ? <a href={offerHref} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Zur Quelle Supplier</a> : null}
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
  if (pilot === undefined) return <div className="panel loading-panel">Pilotdaten werden geladen…</div>;
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
  const [selected, setSelected] = useState(analysis?.basisPositions[0]?.id ?? "");
  const [comment, setComment] = useState("");
  if (!analysis) {
    return (
      <>
        <PageHeader eyebrow="LV-VERGLEICH" title="Realer Pilotvergleich" description="Die begrenzte Matching-Analyse ist noch nicht verfügbar." />
        <div className="notice"><CircleAlert size={19} /><div><strong>Keine Pilotanalyse</strong><span>Matching muss zuerst lokal erzeugt werden.</span></div></div>
      </>
    );
  }
  const recommendationIndex = new Map(
    analysis.recommendations.map((recommendation) => [
      recommendation.basisPositionId,
      recommendation
    ])
  );
  const visible = analysis.basisPositions.filter((position) => {
    const status = recommendationIndex.get(position.id)?.status;
    return filter === "ALL" || status === filter;
  });
  const detail =
    analysis.basisPositions.find((position) => position.id === selected) ??
    analysis.basisPositions[0];
  const detailOptions = analysis.supplierOptions.filter((option) =>
    option.basisPositionIds.includes(detail.id)
  );
  const decision = pilot.supplierDecisions.find(
    (item) => item.basisPositionId === detail.id
  );
  const lineIndex = new Map(
    pilot.runs.flatMap((run) =>
      run.result.envelope.extraction.offerGroups.flatMap((group) =>
        group.lines.map((line) => [line.id, { line, run }] as const)
      )
    )
  );
  async function decide(supplierDocumentId: string | null, status: "SELECTED" | "DEFERRED") {
    const response = await fetch("/api/review-actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "DECISION",
        basisPositionId: detail.id,
        supplierDocumentId,
        status,
        comment,
        operator: "local-operator"
      })
    });
    if (!response.ok) throw new Error(`Decision failed: ${response.status}`);
    await reload();
  }
  return (
    <>
      <PageHeader
        eyebrow="LV-VERGLEICH · REAL PILOT"
        title="Belastbarer Angebotsvergleich"
        description="Comparable totals enthalten nur belegte Primär- und Pflichtkomponenten; Optionalen und Alternativen bleiben separat."
      />
      <div className="comparison-layout">
        <section>
          <div className="filter-tabs">
            {filterOptions.map(([label, value]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
          <div className="panel comparison-table">
            <div className="table-scroll"><table data-real-comparison>
              <thead><tr><th>LV-Pos.</th><th>Beschreibung</th><th>Menge</th>{analysis.supplierDocuments.map((supplier) => <th key={supplier.id}>{supplier.label}</th>)}<th>Empfehlung</th><th>Operator</th></tr></thead>
              <tbody>{visible.map((position) => {
                const options = analysis.supplierOptions.filter((option) => option.basisPositionIds.includes(position.id));
                const recommendation = recommendationIndex.get(position.id);
                const rowDecision = pilot.supplierDecisions.find((item) => item.basisPositionId === position.id);
                return <tr key={position.id} onClick={() => setSelected(position.id)} className={detail.id === position.id ? "selected-row" : ""}>
                  <td><strong>{position.positionNumber}</strong></td><td>{position.description}<small className="scope-note">{position.requiredScope.join(" · ") || "Scope nicht explizit"}</small></td><td>{position.quantity ?? "—"} {position.unit ?? ""}</td>
                  {analysis.supplierDocuments.map((supplier) => <td key={supplier.id}>{optionDisplay(options.find((option) => option.supplierDocumentId === supplier.id))}</td>)}
                  <td><StatusBadge>{recommendation?.status ?? "NO_OFFER"}</StatusBadge></td>
                  <td>{rowDecision ? `${rowDecision.status}${rowDecision.supplierDocumentId ? ` · ${analysis.supplierDocuments.find((item) => item.id === rowDecision.supplierDocumentId)?.label}` : ""}` : "Offen"}</td>
                </tr>;
              })}</tbody>
            </table></div>
          </div>
        </section>
        <aside className="panel position-inspector" data-comparison-inspector>
          <span className="eyebrow">POSITION {detail.positionNumber}</span>
          <h2>{detail.description}</h2>
          <div className="requirement-grid"><div><span>Menge</span><strong>{detail.quantity ?? "—"} {detail.unit ?? ""}</strong></div><div><span>Validation</span><strong>{detail.verificationStatus ?? "NEEDS_REVIEW"}</strong></div></div>
          <h3>Lieferantenoptionen</h3>
          {detailOptions.map((option) => {
            const firstLine = lineIndex.get(option.matchedOfferLineIds[0]);
            const evidence = firstLine?.line.evidence[0];
            const href = evidence ? pilotSourceHref(pilot, evidence.documentId, evidence.pageNumber) : null;
            return <div className="supplier-option" key={option.id}>
              <span>{option.supplierLabel}</span><strong>{optionDisplay(option)}</strong>
              <small>{option.scopeOfSupply.length} Scope-Zeilen · Pflicht {option.mandatoryComponentPrices.length} · Optional {option.optionalPrices.length}</small>
              <small>{option.status.replaceAll("_", " ")}{option.validationIssueIds.length ? ` · ${option.validationIssueIds.length} Issues` : ""}</small>
              {href ? <a href={href} target="_blank" rel="noreferrer">Zur Quelle Supplier</a> : null}
              <Button kind="ghost" onClick={() => decide(option.supplierDocumentId, "SELECTED")}>{decision?.supplierDocumentId === option.supplierDocumentId ? <Check size={15} /> : null} Supplier auswählen</Button>
            </div>;
          })}
          {detail.evidence[0] ? <a className="source-button" href={pilotSourceHref(pilot, detail.evidence[0].documentId, detail.evidence[0].pageNumber) ?? "#"} target="_blank" rel="noreferrer"><Eye size={16} /> Zur Quelle Basis</a> : null}
          <div className="inspector-status"><StatusBadge>{recommendationIndex.get(detail.id)?.status ?? "NO_OFFER"}</StatusBadge><p>{recommendationIndex.get(detail.id)?.reasons.join(" · ") || "Keine vergleichbare Option."}</p></div>
          <label className="comment-field"><span>Entscheidungskommentar</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label>
          <Button kind="secondary" onClick={() => decide(null, "DEFERRED")}>Entscheidung zurückstellen</Button>
        </aside>
      </div>
    </>
  );
}

function Comparison() {
  const { pilot, reload } = usePilotState();
  if (pilot === undefined) return <div className="panel loading-panel">Pilotdaten werden geladen…</div>;
  return pilot === null ? <SyntheticComparison /> : <RealComparison pilot={pilot} reload={reload} />;
}

function RealDecisions({
  pilot,
  reload
}: {
  pilot: PilotStateView;
  reload: () => Promise<void>;
}) {
  const analysis = pilot.analysis;
  const [comments, setComments] = useState<Record<string, string>>({});
  if (!analysis) return <div className="notice">Keine reale Pilotanalyse vorhanden.</div>;
  async function submit(positionId: string, supplierDocumentId: string | null, status: "SELECTED" | "DEFERRED") {
    const response = await fetch("/api/review-actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "DECISION",
        basisPositionId: positionId,
        supplierDocumentId,
        status,
        comment: comments[positionId] ?? "",
        operator: "local-operator"
      })
    });
    if (!response.ok) throw new Error(`Decision failed: ${response.status}`);
    await reload();
  }
  return (
    <>
      <PageHeader eyebrow="ENTSCHEIDUNGEN · REAL PILOT" title="Kommerzielle Auswahl" description="Jede Auswahl oder Zurückstellung erzeugt SupplierDecision und AuditEvent." />
      <div className="decision-grid" data-real-decisions>
        {analysis.basisPositions.map((position) => {
          const recommendation = analysis.recommendations.find((item) => item.basisPositionId === position.id);
          const options = analysis.supplierOptions.filter((option) => option.basisPositionIds.includes(position.id));
          const decision = pilot.supplierDecisions.find((item) => item.basisPositionId === position.id);
          return <article className="panel decision-card" key={position.id}>
            <div className="decision-head"><span className="mono-label">{position.positionNumber}</span><StatusBadge>{recommendation?.status ?? "NO_OFFER"}</StatusBadge></div>
            <h2>{position.description}</h2>
            <div className="choice-grid">{options.map((option) => <button key={option.id} onClick={() => submit(position.id, option.supplierDocumentId, "SELECTED")} className={decision?.supplierDocumentId === option.supplierDocumentId ? "selected" : ""}><span>{option.supplierLabel}</span><strong>{optionDisplay(option)}</strong>{decision?.supplierDocumentId === option.supplierDocumentId ? <CheckCircle2 size={17} /> : null}</button>)}</div>
            <label className="comment-field"><span>Entscheidungsgrund</span><input value={comments[position.id] ?? ""} onChange={(event) => setComments((current) => ({ ...current, [position.id]: event.target.value }))} placeholder="Kommentar für Audit-Trail" /></label>
            <Button kind="secondary" onClick={() => submit(position.id, null, "DEFERRED")}>Zurückstellen</Button>
          </article>;
        })}
      </div>
    </>
  );
}

function Decisions() {
  const { pilot, reload } = usePilotState();
  if (pilot === undefined) return <div className="panel loading-panel">Pilotdaten werden geladen…</div>;
  return pilot === null ? <SyntheticDecisions /> : <RealDecisions pilot={pilot} reload={reload} />;
}

function ExportView() {
  const [confirmedOnly, setConfirmedOnly] = useState(true);
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const exportable = useMemo(() => comparisonRows.filter((row) => row.status === "CLEAR_RECOMMENDATION").length, []);
  return (
    <>
      <PageHeader
        eyebrow="EXPORT"
        title="Prüfergebnis exportieren"
        description="XLSX enthält nur transparent gekennzeichnete, bestätigte Daten und Quellenverweise."
      />
      <div className="export-layout">
        <section className="panel export-settings">
          <div className="export-icon"><Download size={26} /></div>
          <h2>LV-Vergleich als Excel-Datei</h2>
          <p>Positionen, Lieferantenoptionen, vergleichbare Preise, Status, Entscheidungen, Kommentare und Evidence-Seiten.</p>
          <label className="check-row"><input type="checkbox" checked={confirmedOnly} onChange={(event) => setConfirmedOnly(event.target.checked)} /><span><strong>Nur bestätigte Daten</strong><small>Ungeprüfte Werte werden nicht als bestätigt exportiert.</small></span></label>
          <label className="check-row"><input type="checkbox" checked={includeEvidence} onChange={(event) => setIncludeEvidence(event.target.checked)} /><span><strong>Quellenverweise aufnehmen</strong><small>Dokument- und Seitenreferenz je Position.</small></span></label>
          <a className="button button-primary full" href={`/api/export?confirmedOnly=${confirmedOnly}&evidence=${includeEvidence}`}><FileDown size={17} /> XLSX erstellen</a>
        </section>
        <aside className="panel export-summary">
          <span className="eyebrow">EXPORTBEREITSCHAFT</span>
          <div className="readiness-score"><strong>{exportable}</strong><span>eindeutige Positionen</span></div>
          <div className="summary-row"><span>Entscheidung erforderlich</span><strong>3</strong></div>
          <div className="summary-row"><span>Technische Abweichung</span><strong>1</strong></div>
          <div className="summary-row"><span>Preis unklar</span><strong>1</strong></div>
          <div className="summary-row"><span>Kein Angebot</span><strong>1</strong></div>
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
