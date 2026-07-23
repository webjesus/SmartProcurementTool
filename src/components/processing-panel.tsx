"use client";

import { useEffect, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Pause,
  Play,
  RefreshCw,
  Square
} from "lucide-react";

type RunStatus =
  | "CREATED"
  | "PLANNING"
  | "RUNNING"
  | "WAITING_FOR_OPERATOR"
  | "PAUSED"
  | "FAILED"
  | "COMPLETED"
  | "CANCELLED";

type PanelState = {
  available: boolean;
  mode: "LOCAL_DURABLE" | "VOLATILE_DEMO";
  projectRun: null | {
    id: string;
    status: RunStatus;
    currentStage: string;
    progress: number;
    processedDocumentIds: string[];
    cacheHits: number;
    aiRequests: number;
    reviewCount: number;
    rulesetVersion: string;
    error: string | null;
    pauseReason: string | null;
    lastToolName: string | null;
  };
  plan?: {
    totalPages: number;
    cacheHits: number;
    expectedAiRequests: number;
    documents: unknown[];
    steps: Array<{
      id: string;
      toolName: string;
      cacheHit: boolean;
      skipReason: string | null;
      mayCallAi: boolean;
    }>;
  };
  checkpoints?: unknown[];
  issues?: Array<{
    id: string;
    toolName: string;
    message: string;
    requiredOperatorAction: string;
    resolvedAt: string | null;
  }>;
};

const statusLabel: Record<RunStatus, string> = {
  CREATED: "Fortsetzung möglich",
  PLANNING: "Verarbeitung läuft",
  RUNNING: "Verarbeitung läuft",
  WAITING_FOR_OPERATOR: "Wartet auf Entscheidung",
  PAUSED: "Fortsetzung möglich",
  FAILED: "Verarbeitung fehlgeschlagen",
  COMPLETED: "Abgeschlossen",
  CANCELLED: "Abgebrochen"
};

const stageLabel: Record<string, string> = {
  DISCOVER_DOCUMENTS: "Dokumente erkennen",
  PREPROCESS_DOCUMENTS: "Seiten vorbereiten",
  EXTRACT_BASIS: "Basis extrahieren",
  EXTRACT_SUPPLIERS: "Angebote extrahieren",
  VALIDATE_EXTRACTION: "Extraktion validieren",
  RECHECK_ISSUES: "Hinweise nachprüfen",
  MATCH_TO_BASIS: "Zuordnung validieren",
  BUILD_COMPARISON: "Vergleich aufbauen",
  WAIT_FOR_OPERATOR: "Operatorentscheidung",
  RECALCULATE: "Abhängige Positionen neu berechnen",
  READY_FOR_EXPORT: "Export vorbereiten",
  COMPLETED: "Abgeschlossen"
};

export function ProcessingPanel() {
  const [state, setState] = useState<PanelState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/orchestrator", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((payload: PanelState) => setState(payload))
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setState({ available: false, mode: "VOLATILE_DEMO", projectRun: null });
      });
    return () => controller.abort();
  }, []);

  async function act(action: "START" | "RESUME" | "PAUSE" | "CANCEL") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/orchestrator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Aktion fehlgeschlagen");
      }
      setState(payload as PanelState);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Aktion fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  if (!state?.available) {
    return (
      <section className="processing-panel processing-panel-disabled" data-processing-panel>
        <div>
          <strong>Verarbeitung</strong>
          <span>Durable ProjectRun ist im lokalen Corpus-Modus verfügbar.</span>
        </div>
      </section>
    );
  }

  const run = state.projectRun;
  const canResume =
    run === null || ["CREATED", "WAITING_FOR_OPERATOR", "PAUSED", "FAILED"].includes(run.status);
  const canPause = run !== null && ["RUNNING", "PLANNING", "WAITING_FOR_OPERATOR"].includes(run.status);
  const canCancel =
    run !== null && !["COMPLETED", "CANCELLED"].includes(run.status);
  const openIssue = state.issues?.find((issue) => issue.resolvedAt === null);

  return (
    <section className="processing-panel" data-processing-panel data-run-status={run?.status ?? "NOT_STARTED"}>
      <div className="processing-summary">
        <div className="processing-title">
          {run?.status === "COMPLETED" ? <CircleCheck size={16} /> : <RefreshCw size={16} />}
          <div>
            <strong>Verarbeitung</strong>
            <span>{run ? statusLabel[run.status] : "Noch nicht gestartet"}</span>
          </div>
        </div>
        <div className="processing-stage">
          <span>Aktueller Schritt</span>
          <strong>{run ? stageLabel[run.currentStage] ?? run.currentStage : "ExecutionPlan bereit"}</strong>
        </div>
        <div className="processing-progress" aria-label="Verarbeitungsfortschritt">
          <span>{run?.progress ?? 0}%</span>
          <div><i style={{ width: `${run?.progress ?? 0}%` }} /></div>
        </div>
      </div>

      <div className="processing-metrics">
        <span>Dokumente <strong>{run?.processedDocumentIds.length ?? 0}</strong></span>
        <span>Cache hits <strong>{run?.cacheHits ?? state.plan?.cacheHits ?? 0}</strong></span>
        <span>AI requests <strong>{run?.aiRequests ?? 0}</strong></span>
        <span>Review <strong>{run?.reviewCount ?? 0}</strong></span>
        <span>Checkpoints <strong>{state.checkpoints?.length ?? 0}</strong></span>
      </div>

      {(openIssue || run?.pauseReason || run?.error) ? (
        <div className="processing-reason">
          <CircleAlert size={14} />
          <div>
            <strong>{run?.error ?? run?.pauseReason ?? openIssue?.requiredOperatorAction}</strong>
            {openIssue ? (
              <span>
                Tool: {openIssue.toolName} · Ruleset: {run?.rulesetVersion} · Quellen: {state.plan?.documents.length ?? 0} Pilotdokumente · {openIssue.message}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="processing-actions">
        {canResume ? (
          <button disabled={busy} onClick={() => act(run ? "RESUME" : "START")}>
            <Play size={13} /> Verarbeitung fortsetzen
          </button>
        ) : null}
        {canPause ? (
          <button disabled={busy} onClick={() => act("PAUSE")}>
            <Pause size={13} /> Pausieren
          </button>
        ) : null}
        {canCancel ? (
          <button disabled={busy} onClick={() => act("CANCEL")}>
            <Square size={12} /> Abbrechen
          </button>
        ) : null}
        <small>
          Plan: {state.plan?.totalPages ?? 0} Seiten · {state.plan?.expectedAiRequests ?? 0} erwartete AI requests
        </small>
      </div>
      {error ? <p className="processing-error">{error}</p> : null}
    </section>
  );
}
