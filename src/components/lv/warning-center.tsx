"use client";

import { AlertTriangle, X } from "lucide-react";
import type { OfferLine, SupplierOption } from "@/domain/contracts";
import type { ProjectReviewPosition } from "@/domain/project-review";
import {
  isRealSupplierOption,
  supplierOptionLines,
  supplierPriceDisplay
} from "@/domain/supplier-option-read-model";
import { buildOperatorSupplierOptionReadModel } from "@/domain/operator-supplier-option-read-model";

export type LvWarningCategory =
  | "Preis"
  | "Zuordnung"
  | "Lieferumfang"
  | "Menge/Einheit"
  | "Quelle"
  | "Basis-Struktur"
  | "Dokument";

export type LvWarning = {
  id: string;
  positionId: string;
  positionNumber: string;
  supplierOptionId: string | null;
  supplierLabel: string | null;
  category: LvWarningCategory;
  completeness: string | null;
  reason: string;
};

function warningCategory(reason: string): LvWarningCategory {
  if (/Preis/.test(reason)) return "Preis";
  if (/Menge|Einheit/.test(reason)) return "Menge/Einheit";
  if (/Quelle/.test(reason)) return "Quelle";
  if (/Lieferumfang|Pflicht|Auswahl/.test(reason)) return "Lieferumfang";
  if (/Position unvollständig/.test(reason)) return "Basis-Struktur";
  if (/Dokument/.test(reason)) return "Dokument";
  return "Zuordnung";
}

export function buildLvWarnings(
  positions: readonly ProjectReviewPosition[],
  offerLines?: ReadonlyMap<string, OfferLine>
): LvWarning[] {
  const warnings: LvWarning[] = [];
  const add = (
    position: ProjectReviewPosition,
    option: SupplierOption | null,
    reason: string
  ) => {
    warnings.push({
      id: `${position.basis.id}:${option?.id ?? "basis"}:${reason}`,
      positionId: position.basis.id,
      positionNumber: position.basis.positionNumber,
      supplierOptionId: option?.id ?? null,
      supplierLabel: option?.supplierLabel ?? null,
      category: warningCategory(reason),
      completeness:
        option && offerLines
          ? buildOperatorSupplierOptionReadModel({
              basis: position.basis,
              option,
              offerLines
            }).packageCompletenessLabelDe
          : null,
      reason
    });
  };
  for (const position of positions) {
    if (position.basis.verificationStatus === "NEEDS_REVIEW") {
      add(position, null, "Position unvollständig erkannt");
    }
    for (const option of position.options) {
      const real = offerLines ? isRealSupplierOption(option, offerLines) : true;
      const priceMissing = offerLines
        ? supplierPriceDisplay(option, supplierOptionLines(option, offerLines))
            .state === "MISSING"
        : option.pricedTotal === null;
      if (real && priceMissing) add(position, option, "Preis nicht gefunden");
      if (option.offerAvailability !== "PRESENT") {
        add(position, option, "Angebot nicht gefunden");
      }
      if (!option.supplierLabel.trim()) {
        add(position, option, "Lieferant nicht erkannt");
      }
      if (!option.quantityCompatible) add(position, option, "Menge weicht ab");
      if (!option.unitCompatible) add(position, option, "Einheit weicht ab");
      if (!option.matchingReliable) {
        add(position, option, "Mehrere mögliche Angebotszeilen");
      }
      if (real && !option.evidenceIds.length) {
        add(position, option, "Quelle nicht verfügbar");
      }
      if (!option.extractionValidated) {
        add(position, option, "Position unvollständig erkannt");
      }
      if (!option.matchingAccepted) {
        add(position, option, "Dokumentzuordnung prüfen");
      }
    }
  }
  return warnings;
}

export function WarningCenter({
  warnings,
  open,
  onToggle,
  onClose,
  onSelect
}: {
  warnings: LvWarning[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (warning: LvWarning) => void;
}) {
  const affectedPositionCount = new Set(
    warnings.map((warning) => warning.positionId)
  ).size;
  const groups = Array.from(
    warnings.reduce(
      (map, warning) => {
        const existing = map.get(warning.positionId);
        if (existing) {
          existing.warnings.push(warning);
        } else {
          map.set(warning.positionId, {
            positionNumber: warning.positionNumber,
            warnings: [warning]
          });
        }
        return map;
      },
      new Map<
        string,
        { positionNumber: string; warnings: LvWarning[] }
      >()
    )
  );
  return (
    <div className="lv-warning-center">
      <button
        className="lv-warning-trigger"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${affectedPositionCount} Positionen mit Hinweisen`}
      >
        <AlertTriangle size={16} />
        <strong>{affectedPositionCount}</strong>
      </button>
      {open ? (
        <aside className="lv-warning-popover" data-warning-center>
          <header>
            <div>
              <span>Prüfhinweise</span>
              <strong>
                {affectedPositionCount} betroffene Positionen
              </strong>
            </div>
            <button onClick={onClose} aria-label="Warnungen schließen">
              <X size={16} />
            </button>
          </header>
          <div className="lv-warning-position-groups">
            {groups.slice(0, 250).map(([positionId, group]) => (
              <section key={positionId}>
                <header>
                  <strong>{group.positionNumber}</strong>
                  <span>{group.warnings.length} Hinweis(e)</span>
                </header>
                {group.warnings.map((warning) => (
                  <button key={warning.id} onClick={() => onSelect(warning)}>
                    <strong>{warning.category}</strong>
                    <span>
                      {warning.supplierLabel
                        ? `${warning.supplierLabel} · `
                        : ""}
                      {warning.reason}
                    </span>
                    {warning.completeness ? (
                      <small>{warning.completeness}</small>
                    ) : null}
                  </button>
                ))}
              </section>
            ))}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
