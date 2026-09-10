"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  FolderTree,
  Minus,
  Sparkles
} from "lucide-react";
import type { OfferLine, SupplierOption } from "@/domain/contracts";
import type { CentralSupplierDecision, DecisionDraftRecord } from "@/domain/central-decision";
import type { ProjectReviewPosition } from "@/domain/project-review";
import { buildOperatorSupplierOptionReadModel } from "@/domain/operator-supplier-option-read-model";
import { displayShortDescription } from "./display-normalization";
import { formatCurrency, formatNumber, shortDescription } from "./format";
import {
  cheapestFoundOption,
  latestPositionDecision,
  operatorSelectedOption,
  supplierOptionNeedsReview,
  type LvSection
} from "./lv-comparison-table";

export type PositionSelectionState =
  | "UNSELECTED"
  | "SELECTED_VALID"
  | "SELECTED_WITH_WARNING"
  | "NO_OFFER"
  | "MATCH_REVIEW_REQUIRED";

export function derivePositionSelectionState(input: {
  selected: boolean;
  selectedHasWarning: boolean;
  selectableCount: number;
  explicitNoOfferCount: number;
  optionCount: number;
}): PositionSelectionState {
  if (input.selected) {
    return input.selectedHasWarning ? "SELECTED_WITH_WARNING" : "SELECTED_VALID";
  }
  if (input.selectableCount > 0) return "UNSELECTED";
  if (input.explicitNoOfferCount > 0 && input.explicitNoOfferCount === input.optionCount) {
    return "NO_OFFER";
  }
  return "MATCH_REVIEW_REQUIRED";
}

function optionModel(
  position: ProjectReviewPosition,
  option: SupplierOption,
  offerLines: ReadonlyMap<string, OfferLine>,
  supplierSourceDocumentIds?: ReadonlySet<string>
) {
  return buildOperatorSupplierOptionReadModel({
    basis: position.basis,
    option,
    offerLines,
    sourceAvailable:
      !supplierSourceDocumentIds || supplierSourceDocumentIds.has(option.supplierDocumentId)
  });
}

function PositionRow({
  position,
  active,
  expanded,
  offerLines,
  manualDisplayLabels,
  supplierSourceDocumentIds,
  decision,
  draft,
  onOpen,
  onBasisSource
}: {
  position: ProjectReviewPosition;
  active: boolean;
  expanded: boolean;
  offerLines: Map<string, OfferLine>;
  manualDisplayLabels?: Readonly<Record<string, string>>;
  supplierSourceDocumentIds?: ReadonlySet<string>;
  decision?: CentralSupplierDecision;
  draft?: DecisionDraftRecord;
  onOpen: () => void;
  onBasisSource: () => void;
}) {
  const models = new Map(
    position.options.map((option) => [
      option.id,
      optionModel(position, option, offerLines, supplierSourceDocumentIds)
    ])
  );
  const selected = operatorSelectedOption(position, decision);
  const cheapest = cheapestFoundOption(position, offerLines);
  const selectable = position.options.filter((option) => models.get(option.id)?.selectable);
  const explicitNoOffers = position.options.filter(
    (option) => models.get(option.id)?.validity === "EXPLICIT_NO_OFFER"
  );
  const selectedModel = selected ? models.get(selected.id) : undefined;
  const suggestion = !selected ? cheapest : undefined;
  const summaryOption = selected ?? suggestion;
  const summaryModel = summaryOption ? models.get(summaryOption.id) : undefined;
  const suggestionNeedsReview = Boolean(
    suggestion && summaryModel && supplierOptionNeedsReview(suggestion, summaryModel)
  );
  const selectionState = derivePositionSelectionState({
    selected: Boolean(selected),
    selectedHasWarning: Boolean(
      selected && selectedModel && supplierOptionNeedsReview(selected, selectedModel)
    ),
    selectableCount: selectable.length,
    explicitNoOfferCount: explicitNoOffers.length,
    optionCount: position.options.length
  });
  const basisDisplayLabel =
    manualDisplayLabels?.[`BASIS_POSITION:${position.basis.id}`] ??
    displayShortDescription(position.basis);
  const status =
    selectionState === "SELECTED_VALID"
      ? { label: "Entschieden", tone: "done", icon: <Check size={13} /> }
      : selectionState === "SELECTED_WITH_WARNING"
        ? { label: "Prüfen", tone: "warning", icon: <AlertTriangle size={13} /> }
        : selectionState === "NO_OFFER"
          ? { label: "Kein Angebot", tone: "muted", icon: <Minus size={13} /> }
          : selectionState === "MATCH_REVIEW_REQUIRED"
            ? { label: "Zuordnung", tone: "warning", icon: <AlertTriangle size={13} /> }
            : { label: "Offen", tone: "open", icon: <span className="lv-status-dot" /> };

  return (
    <article
      className={`lv-position-card collapsed ${active ? "active" : ""} ${
        selected ? "has-selection" : ""
      }`}
      data-lv-position={position.basis.positionNumber}
      data-position-id={position.basis.id}
      data-expanded={expanded ? "true" : "false"}
    >
      <div className="lv-position-card-header">
        <button
          type="button"
          className="lv-position-open-target"
          aria-label={`${position.basis.positionNumber} ${basisDisplayLabel}`}
          aria-current={active ? "true" : undefined}
          onClick={onOpen}
        />
        <div className="lv-position-primary">
          <strong className="lv-position-number">{position.basis.positionNumber}</strong>
          <span className="lv-position-title" title={basisDisplayLabel}>
            {shortDescription(basisDisplayLabel, 92)}
          </span>
          <small>
            {selectable.length} {selectable.length === 1 ? "Angebot" : "Angebote"}
            {position.basis.verificationStatus === "HUMAN_CORRECTED" ? " · Manuell korrigiert" : ""}
          </small>
        </div>

        <div className="lv-position-choice">
          {summaryModel ? (
            <>
              <span
                className={suggestion ? "is-suggestion" : "is-selected"}
                data-recommendation-state={suggestionNeedsReview ? "review" : "ready"}
              >
                {suggestionNeedsReview ? (
                  <AlertTriangle size={12} />
                ) : suggestion ? (
                  <Sparkles size={12} />
                ) : (
                  <Check size={12} />
                )}
                {suggestionNeedsReview ? "Preis prüfen" : suggestion ? "Vorschlag" : "Auswahl"}
              </span>
              <strong>{shortDescription(summaryModel.supplierDisplayName, 28)}</strong>
            </>
          ) : (
            <span className="lv-position-empty">Noch keine Auswahl</span>
          )}
        </div>

        <div className="lv-position-quantity">
          <strong>{formatNumber(position.basis.quantity)}</strong>
          <span>{position.basis.unit ?? ""}</span>
        </div>

        <div
          className="lv-position-price"
          data-price-state={selected ? "selected" : suggestion ? "cheapest" : "standard"}
        >
          <strong>{formatCurrency(summaryModel?.price.total ?? null)}</strong>
          <span>
            {selected
              ? "gewählt"
              : suggestionNeedsReview
                ? "niedrigster Preis · prüfen"
                : suggestion
                  ? "günstigster Vorschlag"
                  : ""}
          </span>
        </div>

        <div className="lv-position-state">
          <span
            className={`lv-state-pill tone-${status.tone}`}
            data-position-selection-state={selectionState}
          >
            {status.icon}
            {status.label}
          </span>
          <button
            type="button"
            className="lv-row-source"
            disabled={!position.basis.evidence.length}
            onClick={(event) => {
              event.stopPropagation();
              onBasisSource();
            }}
            aria-label={`Basis-Quelle ${position.basis.positionNumber}`}
            title="Basis-LV anzeigen"
          >
            <ExternalLink size={15} />
          </button>
        </div>
        {draft ? <span className="lv-position-draft-dot" title="Gespeicherter Entwurf" /> : null}
      </div>
    </article>
  );
}

type LvPositionListProps = {
  sections: LvSection[];
  collapsed: Set<string>;
  expandedPositionIds: Set<string>;
  offerLines: Map<string, OfferLine>;
  manualDisplayLabels?: Readonly<Record<string, string>>;
  supplierSourceDocumentIds?: ReadonlySet<string>;
  activePositionId: string | null;
  drafts: DecisionDraftRecord[];
  decisions: CentralSupplierDecision[];
  pendingOptionId: string | null;
  scrollTop: number;
  page: number;
  pageSize: number;
  total: number;
  onScrollTop: (value: number) => void;
  onToggleSection: (id: string) => void;
  onTogglePosition: (position: ProjectReviewPosition) => void;
  onInfo: (position: ProjectReviewPosition, option?: SupplierOption) => void;
  onOpenBasisSource: (position: ProjectReviewPosition) => void;
  onOpenSupplierSource: (position: ProjectReviewPosition, option: SupplierOption) => void;
  onSelectOption: (position: ProjectReviewPosition, option: SupplierOption) => void;
  onShowWarnings?: () => void;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
};

export function LvPositionList(props: LvPositionListProps) {
  const {
    sections,
    collapsed,
    expandedPositionIds,
    offerLines,
    manualDisplayLabels,
    supplierSourceDocumentIds,
    activePositionId,
    drafts,
    decisions,
    scrollTop,
    total,
    onScrollTop,
    onToggleSection,
    onTogglePosition,
    onOpenBasisSource
  } = props;

  return (
    <section className="lv-list-pane" data-lv-list-pane data-position-navigator aria-label="Positionen">
      <div className="lv-position-list-head">
        <strong>Positionen</strong><span>{total}</span>
      </div>
      <div
        className="lv-position-list"
        onScroll={(event) => onScrollTop(event.currentTarget.scrollTop)}
        ref={(element) => {
          if (element && Math.abs(element.scrollTop - scrollTop) > 2) {
            element.scrollTop = scrollTop;
          }
        }}
      >
        {sections.map((section) => {
          const isCollapsed = collapsed.has(section.id);
          return (
            <section
              className="lv-list-section"
              key={section.id}
              data-lv-section={section.id}
              data-collapsed={isCollapsed ? "true" : "false"}
            >
              <button className="lv-list-section-row" onClick={() => onToggleSection(section.id)}>
                <FolderTree size={15} />
                <strong>{section.title}</strong>
                <span>{section.totalPositionCount ?? section.positions.length}</span>
                <ChevronDown size={15} className={isCollapsed ? "collapsed" : ""} />
              </button>
              {!isCollapsed
                ? section.positions.map((position) => (
                    <PositionRow
                      key={position.basis.id}
                      position={position}
                      active={activePositionId === position.basis.id}
                      expanded={expandedPositionIds.has(position.basis.id)}
                      offerLines={offerLines}
                      manualDisplayLabels={manualDisplayLabels}
                      supplierSourceDocumentIds={supplierSourceDocumentIds}
                      decision={latestPositionDecision(decisions, position.basis.id)}
                      draft={drafts.find((draft) => draft.positionId === position.basis.id)}
                      onOpen={() => onTogglePosition(position)}
                      onBasisSource={() => onOpenBasisSource(position)}
                    />
                  ))
                : null}
            </section>
          );
        })}
      </div>
      <footer className="lv-pagination lv-list-summary" aria-label="Listenstatus">
        <span>{total} Positionen in der aktuellen Ansicht</span>
        <span>Auswahl und Ansicht werden automatisch gespeichert</span>
      </footer>
    </section>
  );
}
