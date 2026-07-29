"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderTree,
  Info
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { OfferLine, SupplierOption } from "@/domain/contracts";
import type { ProjectReviewPosition } from "@/domain/project-review";
import type {
  CentralSupplierDecision,
  DecisionDraftRecord
} from "@/domain/central-decision";
import {
  buildBasisStructureInterpretation,
  buildOperatorSupplierOptionReadModel,
  type OperatorSupplierOptionReadModel
} from "@/domain/operator-supplier-option-read-model";
import { supplierOptionLines } from "@/domain/supplier-option-read-model";
import { displayShortDescription } from "./display-normalization";
import { formatCurrency, formatNumber, shortDescription } from "./format";
import { BrandMark } from "./brand-mark";

export type LvSection = {
  id: string;
  title: string;
  positions: ProjectReviewPosition[];
};

export function latestPositionDecision(
  decisions: readonly CentralSupplierDecision[],
  positionId: string
): CentralSupplierDecision | undefined {
  return decisions
    .filter((decision) => decision.positionId === positionId)
    .sort((left, right) => left.decisionVersion - right.decisionVersion)
    .at(-1);
}

export function operatorSelectedOption(
  position: ProjectReviewPosition,
  decision: CentralSupplierDecision | undefined
): SupplierOption | undefined {
  if (!decision || decision.outcome !== "SELECTED") return undefined;
  return position.options.find(
    (option) => option.id === decision.selectedSupplierOptionId
  );
}

function optionModel(
  position: ProjectReviewPosition,
  option: SupplierOption,
  offerLines: ReadonlyMap<string, OfferLine>,
  supplierSourceDocumentIds?: ReadonlySet<string>
): OperatorSupplierOptionReadModel {
  return buildOperatorSupplierOptionReadModel({
    basis: position.basis,
    option,
    offerLines,
    sourceAvailable:
      (!supplierSourceDocumentIds ||
        supplierSourceDocumentIds.has(option.supplierDocumentId)) &&
      supplierOptionLines(option, offerLines).some(
        (line) => line.evidence.length > 0
      )
  });
}

function optionPrice(
  position: ProjectReviewPosition,
  option: SupplierOption,
  offerLines: ReadonlyMap<string, OfferLine>
): number | null {
  return optionModel(position, option, offerLines).price.total;
}

export function cheapestFoundOption(
  position: ProjectReviewPosition,
  offerLines?: ReadonlyMap<string, OfferLine>
): SupplierOption | undefined {
  if (!offerLines) {
    return [...position.options]
      .filter(
        (option) =>
          (option.comparableTotal ?? option.pricedTotal) !== null &&
          option.offerAvailability !== "EXPLICIT_NO_OFFER"
      )
      .sort(
        (left, right) =>
          (left.comparableTotal ?? left.pricedTotal ?? Infinity) -
            (right.comparableTotal ?? right.pricedTotal ?? Infinity) ||
          left.supplierLabel.localeCompare(right.supplierLabel, "de")
      )[0];
  }
  return [...position.options]
    .filter((option) => {
      const model = optionModel(position, option, offerLines);
      return model.selectable && model.price.total !== null;
    })
    .sort(
      (left, right) =>
        optionPrice(position, left, offerLines)! -
          optionPrice(position, right, offerLines)! ||
        left.supplierLabel.localeCompare(right.supplierLabel, "de")
    )[0];
}

function optionHasWarning(
  option: SupplierOption,
  model: OperatorSupplierOptionReadModel
): boolean {
  return (
    model.price.total === null ||
    model.packageCompleteness !== "COMPLETE" ||
    !option.quantityCompatible ||
    !option.unitCompatible ||
    option.technicalComparisonStatus !== "CONFIRMED_COMPATIBLE" ||
    !option.matchingReliable
  );
}

function SupplierOptionRow({
  position,
  option,
  model,
  selected,
  cheapest,
  groupEnd,
  pending,
  onSelect,
  onSource,
  onInfo
}: {
  position: ProjectReviewPosition;
  option: SupplierOption;
  model: OperatorSupplierOptionReadModel;
  selected: boolean;
  cheapest: boolean;
  groupEnd: boolean;
  pending: boolean;
  onSelect: () => void;
  onSource: () => void;
  onInfo: () => void;
}) {
  const warning = optionHasWarning(option, model);
  const requiresInspector =
    model.packageCompleteness === "PARTIAL" ||
    model.packageCompleteness === "PRIMARY_ONLY";
  return (
    <tr
      className={`lv-supplier-row ${selected ? "selected" : ""} ${
        groupEnd ? "lv-position-group-end" : ""
      }`}
      data-supplier-option={option.id}
      data-supplier-label={option.supplierLabel}
      data-package-completeness={model.packageCompleteness}
      data-price-provenance={model.priceProvenance}
    >
      <td className="lv-supplier-select-cell">
        <span className={`lv-radio-indicator ${selected ? "selected" : ""}`}>
          {selected ? <Check size={12} /> : null}
        </span>
      </td>
      <td className="lv-supplier-product-cell">
        <strong>{shortDescription(model.title, 100)}</strong>
      </td>
      <td className="lv-supplier-name-cell">
        <BrandMark
          resolution={model.supplierBrand}
          label={model.supplierDisplayName}
        />
      </td>
      <td className="lv-supplier-data-cell">
        <strong>
          {[
            model.manufacturerDisplayName,
            model.articleNumber ? `Art. ${model.articleNumber}` : null
          ]
            .filter(Boolean)
            .join(" · ") || "Keine Artikeldaten"}
        </strong>
        <span>{model.packageCompletenessLabelDe}</span>
        <small>
          {model.coveredRequiredComponentCount} von{" "}
          {model.requiredComponentCount} Pflichtbestandteilen
        </small>
      </td>
      <td className="lv-quantity-cell">
        {formatNumber(model.quantity)} {model.unit ?? position.basis.unit ?? ""}
      </td>
      <td className="lv-price-cell">
        {model.price.total !== null ? (
          <strong>{formatCurrency(model.price.total)}</strong>
        ) : null}
        {model.price.unitPrice !== null ? (
          <span>EP {formatCurrency(model.price.unitPrice)}</span>
        ) : null}
        <small className={`lv-price-state ${model.price.state.toLowerCase()}`}>
          {model.priceProvenanceLabelDe}
        </small>
        <details className="lv-price-composition">
          <summary title="Preiszusammensetzung anzeigen">
            Preiszusammensetzung
          </summary>
          <div>
            {model.priceComposition.map((item) => (
              <p key={item.lineId}>
                <strong>{item.articleNumber ?? "Ohne Artikelnummer"}</strong>
                <span>
                  {item.roleDe} · GP {formatCurrency(item.totalPrice)} · Seite{" "}
                  {item.sourcePage ?? "—"}
                </span>
                <em>{item.reasonDe}</em>
              </p>
            ))}
          </div>
        </details>
      </td>
      <td className="lv-option-marker-cell">
        {selected ? <em className="selected">Ausgewählt</em> : null}
        {cheapest ? (
          <em className="cheapest">
            {model.packageCompleteness === "COMPLETE"
              ? "Günstigstes vollständiges Paket"
              : "Günstigster gefundener Preis"}
          </em>
        ) : null}
        {warning ? (
          <em className="warning">
            <AlertTriangle size={12} /> Hinweis
          </em>
        ) : null}
        <button
          className={selected ? "button button-selected" : "button button-secondary"}
          disabled={pending}
          onClick={selected || requiresInspector ? onInfo : onSelect}
        >
          {pending
            ? "Speichern..."
            : selected
              ? "Auswahl ändern"
              : model.selectActionLabelDe}
        </button>
        {model.partialSelectionWarningDe ? (
          <small className="lv-partial-warning">
            {model.partialSelectionWarningDe}
          </small>
        ) : null}
      </td>
      <td className="lv-source-cell">
        <button className="lv-row-action" onClick={onSource}>
          <ExternalLink size={14} /> Zur Quelle
        </button>
      </td>
      <td className="lv-info-cell">
        <button className="lv-row-action" onClick={onInfo}>
          <Info size={15} /> Info
        </button>
      </td>
    </tr>
  );
}

function LvComparisonPosition({
  position,
  offerLines,
  supplierSourceDocumentIds,
  decision,
  draft,
  active,
  expanded,
  pendingOptionId,
  onToggle,
  onInfo,
  onBasisSource,
  onSupplierSource,
  onSelectOption,
  onShowWarnings
}: {
  position: ProjectReviewPosition;
  offerLines: Map<string, OfferLine>;
  supplierSourceDocumentIds?: ReadonlySet<string>;
  decision?: CentralSupplierDecision;
  draft?: DecisionDraftRecord;
  active: boolean;
  expanded: boolean;
  pendingOptionId: string | null;
  onToggle: () => void;
  onInfo: (option?: SupplierOption) => void;
  onBasisSource: () => void;
  onSupplierSource: (option: SupplierOption) => void;
  onSelectOption: (option: SupplierOption) => void;
  onShowWarnings?: () => void;
}) {
  const models = useMemo(
    () =>
      new Map(
        position.options.map((option) => [
          option.id,
          optionModel(
            position,
            option,
            offerLines,
            supplierSourceDocumentIds
          )
        ])
      ),
    [offerLines, position, supplierSourceDocumentIds]
  );
  const selected = operatorSelectedOption(position, decision);
  const selectedModel = selected ? models.get(selected.id) : undefined;
  const cheapest = cheapestFoundOption(position, offerLines);
  const cheapestModel = cheapest ? models.get(cheapest.id) : undefined;
  const availableOptions = position.options.filter(
    (option) => models.get(option.id)?.selectable
  );
  const explicitNoOfferOptions = position.options.filter(
    (option) => models.get(option.id)?.validity === "EXPLICIT_NO_OFFER"
  );
  const structure = buildBasisStructureInterpretation(position.basis);
  const positionHasWarning =
    availableOptions.length === 0 ||
    position.options.some((option) =>
      optionHasWarning(option, models.get(option.id)!)
    );
  const cheaperAvailable =
    selected &&
    cheapest &&
    cheapest.id !== selected.id &&
    optionPrice(position, cheapest, offerLines) !== null &&
    optionPrice(position, selected, offerLines) !== null &&
    optionPrice(position, cheapest, offerLines)! <
      optionPrice(position, selected, offerLines)!;

  return (
    <>
      <tr
        className={`lv-basis-row ${active ? "active" : ""} ${
          selected ? "has-selection" : ""
        } ${!expanded ? "lv-position-group-end" : ""}`}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        tabIndex={0}
        data-lv-position={position.basis.positionNumber}
        data-expanded={expanded ? "true" : "false"}
        data-basis-structure={structure.type}
      >
        <td className="lv-position-cell">
          <button
            className="lv-expand-button"
            aria-label={`${position.basis.positionNumber} ${
              expanded ? "einklappen" : "aufklappen"
            }`}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
          </button>
          <strong>{position.basis.positionNumber}</strong>
        </td>
        <td className="lv-description-cell">
          <span>
            {shortDescription(displayShortDescription(position.basis), 130)}
          </span>
        </td>
        <td className="lv-parent-supplier-cell">
          {selected && selectedModel ? (
            <>
              <BrandMark
                resolution={selectedModel.supplierBrand}
                label={selected.supplierLabel}
                compact
              />
              <em>Ausgewählt</em>
            </>
          ) : (
            <strong>Nicht ausgewählt</strong>
          )}
        </td>
        <td className="lv-parent-data-cell">
          {selected && selectedModel ? (
            <>
              <strong>{shortDescription(selectedModel.title, 90)}</strong>
              <span>{selectedModel.packageCompletenessLabelDe}</span>
            </>
          ) : cheapest && cheapestModel ? (
            <span className="lv-parent-recommendation">
              <small>Empfehlung · Günstigster gefundener Preis</small>
              <BrandMark
                resolution={cheapestModel.supplierBrand}
                label={cheapest.supplierLabel}
                compact
              />
              <strong>
                {formatCurrency(optionPrice(position, cheapest, offerLines))}
              </strong>
            </span>
          ) : (
            "Keine Angebotsdaten"
          )}
        </td>
        <td className="lv-quantity-cell">
          {formatNumber(position.basis.quantity)} {position.basis.unit ?? ""}
        </td>
        <td className="lv-price-cell">
          {selectedModel || cheapestModel ? (
            <>
              <strong>
                {formatCurrency((selectedModel ?? cheapestModel)!.price.total)}
              </strong>
              <span>
                {(selectedModel ?? cheapestModel)!.priceProvenanceLabelDe}
              </span>
            </>
          ) : null}
          {cheaperAvailable ? <span>Günstigeres Angebot vorhanden</span> : null}
        </td>
        <td className="lv-parent-selection-cell">
          {selected ? (
            <span title="Vom Operator ausgewählt">
              <CheckCircle2 size={19} /> Ausgewählt
            </span>
          ) : draft ? (
            <span className="draft">Entwurf · Nicht ausgewählt</span>
          ) : (
            <span className="muted">Nicht ausgewählt</span>
          )}
          {positionHasWarning ? (
            <AlertTriangle
              className="lv-position-warning-icon"
              size={16}
              aria-label="Hinweise vorhanden"
            />
          ) : null}
        </td>
        <td className="lv-source-cell">
          <button
            className="lv-row-action"
            disabled={!position.basis.evidence.length}
            onClick={(event) => {
              event.stopPropagation();
              onBasisSource();
            }}
          >
            <ExternalLink size={14} /> Basis-Quelle
          </button>
        </td>
        <td className="lv-info-cell">
          <button
            className="lv-row-action"
            onClick={(event) => {
              event.stopPropagation();
              onInfo(selected ?? cheapest);
            }}
          >
            <Info size={15} /> Info
          </button>
        </td>
      </tr>

      {expanded && availableOptions.length > 0 ? (
        <tr className="lv-supplier-group-row">
          <td colSpan={9}>
            <span>
              {availableOptions.length === 1
                ? "1 verfügbares Angebot"
                : `Verfügbare Angebote · ${availableOptions.length}`}
            </span>
          </td>
        </tr>
      ) : null}
      {expanded
        ? availableOptions.map((option, optionIndex) => (
            <SupplierOptionRow
              key={option.id}
              position={position}
              option={option}
              model={models.get(option.id)!}
              selected={selected?.id === option.id}
              cheapest={cheapest?.id === option.id}
              groupEnd={
                optionIndex === availableOptions.length - 1 &&
                explicitNoOfferOptions.length === 0
              }
              pending={pendingOptionId === option.id}
              onSelect={() => onSelectOption(option)}
              onSource={() => onSupplierSource(option)}
              onInfo={() => onInfo(option)}
            />
          ))
        : null}
      {expanded
        ? explicitNoOfferOptions.map((option, optionIndex) => {
            const model = models.get(option.id)!;
            const sourceAvailable = supplierOptionLines(
              option,
              offerLines
            ).some((line) => line.evidence.length > 0);
            return (
              <tr
                key={option.id}
                className={`lv-position-no-offer ${
                  optionIndex === explicitNoOfferOptions.length - 1
                    ? "lv-position-group-end"
                    : ""
                }`}
                data-option-validity={model.validity}
                data-supplier-label={option.supplierLabel}
              >
                <td className="lv-supplier-select-cell">
                  <span className="lv-radio-indicator" aria-hidden="true" />
                </td>
                <td className="lv-supplier-product-cell">
                  <strong>Nicht angeboten</strong>
                </td>
                <td className="lv-supplier-name-cell">
                  <BrandMark
                    resolution={model.supplierBrand}
                    label={option.supplierLabel}
                    compact
                  />
                </td>
                <td className="lv-supplier-data-cell">
                  <span>
                    Diese Ausschreibungsposition wird vom Lieferanten nicht
                    angeboten.
                  </span>
                </td>
                <td className="lv-quantity-cell">—</td>
                <td className="lv-price-cell">—</td>
                <td className="lv-option-marker-cell">
                  <em className="warning">Nicht angeboten</em>
                </td>
                <td className="lv-source-cell">
                  {sourceAvailable ? (
                    <button
                      className="lv-row-action"
                      onClick={() => onSupplierSource(option)}
                    >
                      <ExternalLink size={14} /> Zur Quelle
                    </button>
                  ) : null}
                </td>
                <td className="lv-info-cell">
                  {sourceAvailable ? (
                    <button
                      className="lv-row-action"
                      onClick={() => onInfo(option)}
                    >
                      <Info size={15} /> Info
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })
        : null}
      {expanded &&
      availableOptions.length === 0 &&
      explicitNoOfferOptions.length === 0 ? (
        <tr className="lv-position-empty-offers lv-position-group-end">
          <td colSpan={9}>
            <div>
              <AlertTriangle size={18} />
              <span>
                <strong>Keine Angebote gefunden</strong>
                <small>
                  Für diese Basis-Position wurde keine passende
                  Angebotsposition zugeordnet.
                </small>
              </span>
              <button
                className="button button-secondary"
                onClick={onShowWarnings ?? (() => onInfo())}
              >
                Hinweise anzeigen
              </button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function LvComparisonTable({
  sections,
  collapsed,
  expandedPositionIds,
  offerLines,
  supplierSourceDocumentIds,
  activePositionId,
  drafts,
  decisions,
  pendingOptionId,
  scrollTop,
  onScrollTop,
  onToggleSection,
  onTogglePosition,
  onInfo,
  onOpenBasisSource,
  onOpenSupplierSource,
  onSelectOption,
  onShowWarnings
}: {
  sections: LvSection[];
  collapsed: Set<string>;
  expandedPositionIds: Set<string>;
  offerLines: Map<string, OfferLine>;
  supplierSourceDocumentIds?: ReadonlySet<string>;
  activePositionId: string | null;
  drafts: DecisionDraftRecord[];
  decisions: CentralSupplierDecision[];
  pendingOptionId: string | null;
  scrollTop: number;
  onScrollTop: (value: number) => void;
  onToggleSection: (id: string) => void;
  onTogglePosition: (position: ProjectReviewPosition) => void;
  onInfo: (position: ProjectReviewPosition, option?: SupplierOption) => void;
  onOpenBasisSource: (position: ProjectReviewPosition) => void;
  onOpenSupplierSource: (
    position: ProjectReviewPosition,
    option: SupplierOption
  ) => void;
  onSelectOption: (
    position: ProjectReviewPosition,
    option: SupplierOption
  ) => void;
  onShowWarnings?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const appliedScroll = useRef(false);
  useEffect(() => {
    if (!scrollRef.current || appliedScroll.current) return;
    scrollRef.current.scrollTop = scrollTop;
    appliedScroll.current = true;
  }, [scrollTop]);

  return (
    <div className="lv-table-shell" data-lv-comparison-table>
      <div
        className="lv-table-scroll"
        ref={scrollRef}
        onScroll={(event) => onScrollTop(event.currentTarget.scrollTop)}
      >
        <table>
          <thead>
            <tr>
              <th>Position</th>
              <th>Kurzbeschreibung</th>
              <th>Lieferant</th>
              <th>Angebot / Umfang</th>
              <th>Menge</th>
              <th>Preis</th>
              <th>Auswahl</th>
              <th>Quelle</th>
              <th>Info</th>
            </tr>
          </thead>
          <tbody>
            {sections.flatMap((section) => {
              const isCollapsed = collapsed.has(section.id);
              return [
                <tr className="lv-section-row" key={`section:${section.id}`}>
                  <td colSpan={9}>
                    <button onClick={() => onToggleSection(section.id)}>
                      <FolderTree size={19} />
                      <strong>{section.title}</strong>
                      <span>{section.positions.length} Positionen</span>
                      <em>{isCollapsed ? "Öffnen" : "Schließen"}</em>
                    </button>
                  </td>
                </tr>,
                ...(isCollapsed
                  ? []
                  : section.positions.map((position) => {
                      const decision = latestPositionDecision(
                        decisions,
                        position.basis.id
                      );
                      return (
                        <LvComparisonPosition
                          key={position.basis.id}
                          position={position}
                          offerLines={offerLines}
                          supplierSourceDocumentIds={supplierSourceDocumentIds}
                          decision={decision}
                          draft={drafts.find(
                            (draft) => draft.positionId === position.basis.id
                          )}
                          active={activePositionId === position.basis.id}
                          expanded={expandedPositionIds.has(position.basis.id)}
                          pendingOptionId={pendingOptionId}
                          onToggle={() => onTogglePosition(position)}
                          onInfo={(option) => onInfo(position, option)}
                          onBasisSource={() => onOpenBasisSource(position)}
                          onSupplierSource={(option) =>
                            onOpenSupplierSource(position, option)
                          }
                          onSelectOption={(option) =>
                            onSelectOption(position, option)
                          }
                          onShowWarnings={onShowWarnings}
                        />
                      );
                    }))
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
