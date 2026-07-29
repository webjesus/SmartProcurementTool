"use client";

import type { ProjectReviewPosition } from "@/domain/project-review";

export type SummaryFilter =
  | "ALL"
  | "AUTO_SELECTED_LOWEST_PRICE"
  | "MANUAL_DECISION_REQUIRED"
  | "MANUAL_DECIDED"
  | "NO_COMPARABLE_OFFER"
  | "DEFERRED";

export function LvSummaryBar({
  positions,
  active,
  onChange,
  onStartReview
}: {
  positions: ProjectReviewPosition[];
  active: SummaryFilter;
  onChange: (filter: SummaryFilter) => void;
  onStartReview: () => void;
}) {
  const count = (status: string) =>
    positions.filter((position) => position.liveStatus === status).length;
  const items: Array<[SummaryFilter, string, number]> = [
    ["ALL", "Alle", positions.length],
    ["AUTO_SELECTED_LOWEST_PRICE", "Automatisch", count("AUTO_SELECTED_LOWEST_PRICE")],
    ["MANUAL_DECISION_REQUIRED", "Entscheidung erforderlich", count("MANUAL_DECISION_REQUIRED")],
    ["NO_COMPARABLE_OFFER", "Kein vergleichbares Angebot", count("NO_COMPARABLE_OFFER")],
    ["DEFERRED", "Zurückgestellt", count("DEFERRED")],
    ["MANUAL_DECIDED", "Manuell entschieden", count("MANUAL_DECIDED")]
  ];
  return (
    <div className="lv-summary-bar" aria-label="Statusübersicht">
      <div>
        {items.map(([value, label, total]) => (
          <button
            key={value}
            className={active === value ? "active" : ""}
            onClick={() => onChange(value)}
          >
            <span>{label}</span>
            <strong>{total}</strong>
          </button>
        ))}
      </div>
      <button className="button button-primary" onClick={onStartReview}>
        Offene Entscheidungen bearbeiten
      </button>
    </div>
  );
}
