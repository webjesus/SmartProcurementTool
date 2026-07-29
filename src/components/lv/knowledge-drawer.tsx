"use client";

import { History, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { SupplierDecision } from "@/domain/contracts";
import type { CentralSupplierDecision } from "@/domain/central-decision";
import type { ProjectReviewPosition } from "@/domain/project-review";

function basisId(decision: SupplierDecision): string {
  return decision.basisPositionId;
}

export function KnowledgeDrawer({
  positions,
  decisions,
  centralDecisions,
  serverMode,
  onClose,
  onOpenPosition
}: {
  positions: ProjectReviewPosition[];
  decisions: SupplierDecision[];
  centralDecisions: CentralSupplierDecision[];
  serverMode: boolean;
  onClose: () => void;
  onOpenPosition: (position: ProjectReviewPosition) => void;
}) {
  const [actor, setActor] = useState("ALL");
  const [supplier, setSupplier] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [decisionType, setDecisionType] = useState("ALL");
  const [date, setDate] = useState("");
  const serverRows = useMemo(
    () =>
      centralDecisions.filter((decision) => {
        const position = positions.find(
          (candidate) => candidate.basis.id === decision.positionId
        );
        const selectedSupplier = position?.options.find(
          (option) => option.id === decision.selectedSupplierOptionId
        )?.supplierLabel;
        return (
          (actor === "ALL" || decision.decidedBy === actor) &&
          (supplier === "ALL" || selectedSupplier === supplier) &&
          (status === "ALL" || decision.outcome === status) &&
          (decisionType === "ALL" ||
            decision.decisionType === decisionType) &&
          (!date || decision.decidedAt.slice(0, 10) === date)
        );
      }),
    [
      actor,
      centralDecisions,
      date,
      decisionType,
      positions,
      status,
      supplier
    ]
  );
  const actors = [
    ...new Map(
      centralDecisions.map((decision) => [
        decision.decidedBy,
        decision.decidedByDisplayName
      ])
    )
  ];
  const suppliers = [
    ...new Set(
      centralDecisions
        .map((decision) => {
          const position = positions.find(
            (candidate) => candidate.basis.id === decision.positionId
          );
          return position?.options.find(
            (option) => option.id === decision.selectedSupplierOptionId
          )?.supplierLabel;
        })
        .filter((value): value is string => Boolean(value))
    )
  ];
  return (
    <div className="knowledge-drawer-backdrop" role="presentation">
      <aside className="knowledge-drawer" role="dialog" aria-modal="true">
        <header>
          <div>
            <span>Wissenssammlung</span>
            <h2>Entscheidungen und Begründungen</h2>
          </div>
          <button onClick={onClose} aria-label="Wissenssammlung schließen">
            <X size={20} />
          </button>
        </header>
        {serverMode ? (
          <div className="knowledge-drawer-filters">
            <select value={actor} onChange={(event) => setActor(event.target.value)}>
              <option value="ALL">Alle Bearbeiter</option>
              {actors.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <input
              type="date"
              aria-label="Entscheidungsdatum"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <select value={supplier} onChange={(event) => setSupplier(event.target.value)}>
              <option value="ALL">Alle Lieferanten</option>
              {suppliers.map((value) => <option key={value}>{value}</option>)}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="ALL">Alle Ergebnisse</option>
              <option value="SELECTED">Ausgewählt</option>
              <option value="NONE_CORRECT">Keine Option</option>
              <option value="DEFERRED">Zurückgestellt</option>
              <option value="ADDITIONAL_CHECK_REQUESTED">Weitere Prüfung</option>
            </select>
            <select
              value={decisionType}
              onChange={(event) => setDecisionType(event.target.value)}
            >
              <option value="ALL">Alle Entscheidungstypen</option>
              <option value="AUTOMATIC_OVERRIDE">Automatic override</option>
              <option value="MANUAL_SELECTION">Manual decision</option>
              <option value="DEFERRED">Deferred</option>
              <option value="NONE_CORRECT">No option</option>
            </select>
          </div>
        ) : null}
        <div>
          {serverMode ? serverRows.map((decision) => {
            const position = positions.find(
              (candidate) => candidate.basis.id === decision.positionId
            );
            if (!position) return null;
            const selectedSupplier = position.options.find(
              (option) => option.id === decision.selectedSupplierOptionId
            )?.supplierLabel;
            return (
              <article key={decision.id}>
                <History size={18} />
                <div>
                  <button onClick={() => onOpenPosition(position)}>
                    {position.basis.positionNumber}
                  </button>
                  <strong>
                    {decision.outcome}
                    {selectedSupplier ? ` · ${selectedSupplier}` : ""}
                  </strong>
                  <p>{decision.comment || "Keine Begründung gespeichert."}</p>
                  <small>
                    {decision.decidedByDisplayName} ·{" "}
                    {new Date(decision.decidedAt).toLocaleString("de-DE")} ·
                    Version {decision.decisionVersion}
                    {decision.previousDecisionId ? " · Vorentscheidung vorhanden" : ""}
                  </small>
                  <button onClick={() => onOpenPosition(position)}>
                    Quellen und Historie öffnen
                  </button>
                </div>
              </article>
            );
          }) : decisions.length ? decisions.map((decision) => {
            const position = positions.find(
              (candidate) => candidate.basis.id === basisId(decision)
            );
            if (!position) return null;
            const comment = decision.comment;
            const actor =
              "decidedBy" in decision ? decision.decidedBy : decision.operator;
            const timestamp =
              "decidedAt" in decision ? decision.decidedAt : decision.timestamp;
            return (
              <article key={decision.id}>
                <History size={18} />
                <div>
                  <button onClick={() => onOpenPosition(position)}>
                    {position.basis.positionNumber}
                  </button>
                  <strong>{decision.status}</strong>
                  <p>{comment || "Keine Begründung gespeichert."}</p>
                  <small>
                    {actor} · {new Date(timestamp).toLocaleString("de-DE")}
                  </small>
                </div>
              </article>
            );
          }) : null}
          {(serverMode ? serverRows.length === 0 : decisions.length === 0) ? (
            <p>Noch keine manuellen Entscheidungen gespeichert.</p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
