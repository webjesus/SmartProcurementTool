"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderTree,
  Info
} from "lucide-react";
import type { OfferLine, SupplierOption } from "@/domain/contracts";
import type {
  CentralSupplierDecision,
  DecisionDraftRecord
} from "@/domain/central-decision";
import type { ProjectReviewPosition } from "@/domain/project-review";
import {
  buildOperatorSupplierOptionReadModel,
  type OperatorSupplierOptionReadModel
} from "@/domain/operator-supplier-option-read-model";
import { supplierOptionLines } from "@/domain/supplier-option-read-model";
import { BrandMark } from "./brand-mark";
import { displayShortDescription } from "./display-normalization";
import { formatCurrency, formatNumber, shortDescription } from "./format";
import {
  cheapestFoundOption,
  latestPositionDecision,
  operatorSelectedOption,
  type LvSection
} from "./lv-comparison-table";

const SUPPLIER_GRID_COLUMNS =
  "48px minmax(125px, 145px) minmax(210px, 1.1fr) minmax(190px, 1fr) minmax(75px, 88px) minmax(130px, 150px) 64px 52px";

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
      (!supplierSourceDocumentIds ||
        supplierSourceDocumentIds.has(option.supplierDocumentId)) &&
      supplierOptionLines(option, offerLines).some(
        (line) => line.evidence.length > 0
      )
  });
}

function hasWarning(
  option: SupplierOption,
  model: OperatorSupplierOptionReadModel
) {
  return (
    model.price.total === null ||
    model.packageCompleteness !== "COMPLETE" ||
    !option.quantityCompatible ||
    !option.unitCompatible ||
    option.technicalComparisonStatus !== "CONFIRMED_COMPATIBLE" ||
    !option.matchingReliable
  );
}

function shortInformation(
  model: OperatorSupplierOptionReadModel,
  lines: readonly OfferLine[]
) {
  return Array.from(
    new Set(
      [
        model.manufacturerDisplayName,
        ...lines.map((line) => line.description)
      ].filter((value): value is string => Boolean(value?.trim()))
    )
  )
    .slice(0, 3)
    .map((value) => shortDescription(value, 54));
}

function SupplierRow({
  position,
  option,
  model,
  lines,
  selected,
  cheapest,
  pending,
  onSelect,
  onSource,
  onInfo
}: {
  position: ProjectReviewPosition;
  option: SupplierOption;
  model: OperatorSupplierOptionReadModel;
  lines: OfferLine[];
  selected: boolean;
  cheapest: boolean;
  pending: boolean;
  onSelect: () => void;
  onSource: () => void;
  onInfo: () => void;
}) {
  const warning = hasWarning(option, model);
  return (
    <div
      className={`lv-offer-grid lv-offer-row ${selected ? "selected" : ""}`}
      style={{ gridTemplateColumns: SUPPLIER_GRID_COLUMNS }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-supplier-option={option.id}
      data-supplier-label={option.supplierLabel}
      data-package-completeness={model.packageCompleteness}
      data-price-provenance={model.priceProvenance}
      onClick={pending ? undefined : onSelect}
      onKeyDown={(event) => {
        if (pending || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onSelect();
      }}
    >
      <div className="lv-offer-select" aria-label={selected ? "Ausgewählt" : "Nicht ausgewählt"}>
        <span className={`lv-radio-indicator ${selected ? "selected" : ""}`}>
          {selected ? <Check size={13} /> : null}
        </span>
      </div>
      <div className="lv-offer-supplier">
        <BrandMark
          resolution={model.supplierBrand}
          label={model.supplierDisplayName}
        />
      </div>
      <div className="lv-offer-product">
        <strong>{shortDescription(model.title, 72)}</strong>
        <span>
          {model.articleNumber ? `Art. ${model.articleNumber}` : "Ohne Artikelnummer"}
        </span>
        <small>{model.packageCompletenessLabelDe}</small>
        <small>
          {model.coveredRequiredComponentCount} von {model.requiredComponentCount} Pflichtbestandteilen
        </small>
      </div>
      <div className="lv-offer-summary">
        {shortInformation(model, lines).map((value) => (
          <span key={value}>{value}</span>
        ))}
      </div>
      <div className="lv-offer-quantity">
        <strong>{formatNumber(model.quantity)}</strong>
        <span>{model.unit ?? position.basis.unit ?? ""}</span>
      </div>
      <div className="lv-offer-price">
        <strong>{formatCurrency(model.price.total)}</strong>
        {model.price.unitPrice !== null ? (
          <span>EP {formatCurrency(model.price.unitPrice)}</span>
        ) : null}
        <small>{model.priceProvenanceLabelDe}</small>
        {cheapest ? <em>Günstigster Preis</em> : null}
        {warning ? <i><AlertTriangle size={11} /> Hinweis</i> : null}
      </div>
      <div className="lv-offer-action">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onSource();
          }}
          aria-label={`Quelle ${model.supplierDisplayName}`}
          title="Zur Angebotsquelle"
        >
          <ExternalLink size={18} />
        </button>
      </div>
      <div className="lv-offer-action">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onInfo();
          }}
          aria-label={`Info ${model.supplierDisplayName}`}
          title="Angebotsdaten"
        >
          <Info size={18} />
        </button>
      </div>
    </div>
  );
}

function PositionGroup({
  position,
  expanded,
  active,
  offerLines,
  supplierSourceDocumentIds,
  decision,
  draft,
  pendingOptionId,
  onToggle,
  onInfo,
  onBasisSource,
  onSupplierSource,
  onSelectOption,
  onShowWarnings
}: {
  position: ProjectReviewPosition;
  expanded: boolean;
  active: boolean;
  offerLines: Map<string, OfferLine>;
  supplierSourceDocumentIds?: ReadonlySet<string>;
  decision?: CentralSupplierDecision;
  draft?: DecisionDraftRecord;
  pendingOptionId: string | null;
  onToggle: () => void;
  onInfo: (option?: SupplierOption) => void;
  onBasisSource: () => void;
  onSupplierSource: (option: SupplierOption) => void;
  onSelectOption: (option: SupplierOption) => void;
  onShowWarnings?: () => void;
}) {
  const models = new Map(
    position.options.map((option) => [
      option.id,
      optionModel(position, option, offerLines, supplierSourceDocumentIds)
    ])
  );
  const selected = operatorSelectedOption(position, decision);
  const cheapest = cheapestFoundOption(position, offerLines);
  const selectable = position.options
    .filter((option) => models.get(option.id)?.selectable)
    .sort((left, right) => {
      if (left.id === selected?.id) return -1;
      if (right.id === selected?.id) return 1;
      return (
        (models.get(left.id)?.price.total ?? Infinity) -
          (models.get(right.id)?.price.total ?? Infinity) ||
        left.supplierLabel.localeCompare(right.supplierLabel, "de")
      );
    });
  const explicitNoOffers = position.options.filter(
    (option) => models.get(option.id)?.validity === "EXPLICIT_NO_OFFER"
  );
  const summaryOption = selected ?? cheapest;
  const summaryModel = summaryOption ? models.get(summaryOption.id) : undefined;
  const positionWarning =
    selectable.length === 0 ||
    position.options.some((option) => hasWarning(option, models.get(option.id)!));

  return (
    <article
      className={`lv-position-card ${expanded ? "expanded" : "collapsed"} ${
        active ? "active" : ""
      } ${selected ? "has-selection" : ""}`}
      data-lv-position={position.basis.positionNumber}
      data-position-id={position.basis.id}
      data-expanded={expanded ? "true" : "false"}
    >
      <div
        className="lv-position-card-header"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onToggle();
        }}
      >
        <span className="lv-position-chevron">
          <ChevronDown size={18} />
        </span>
        <strong className="lv-position-number">
          {position.basis.positionNumber}
        </strong>
        <div className="lv-position-title">
          <strong>{shortDescription(displayShortDescription(position.basis), 130)}</strong>
          {expanded ? (
            <span>
              {selectable.length} {selectable.length === 1 ? "Angebot verfügbar" : "Angebote verfügbar"}
            </span>
          ) : null}
        </div>
        {!expanded ? (
          <>
            <div className="lv-position-selected-supplier">
              {summaryOption && summaryModel ? (
                <BrandMark
                  resolution={summaryModel.supplierBrand}
                  label={summaryModel.supplierDisplayName}
                  compact
                />
              ) : (
                <strong>Nicht ausgewählt</strong>
              )}
            </div>
            <div className="lv-position-summary">
              {summaryModel ? (
                <>
                  <strong>{shortDescription(summaryModel.title, 45)}</strong>
                  <span>{summaryModel.packageCompletenessLabelDe}</span>
                </>
              ) : (
                <span>Keine Angebotsdaten</span>
              )}
            </div>
            <div className="lv-position-summary-quantity">
              {formatNumber(position.basis.quantity)} {position.basis.unit ?? ""}
            </div>
            <div className="lv-position-summary-price">
              <strong>{formatCurrency(summaryModel?.price.total ?? null)}</strong>
              <span>{summaryModel?.priceProvenanceLabelDe ?? "Kein Angebot vorhanden"}</span>
            </div>
          </>
        ) : (
          <div className="lv-position-expanded-state">
            {selected ? (
              <span><Check size={13} /> Ausgewählt</span>
            ) : (
              <span className="unselected">Nicht ausgewählt</span>
            )}
            {positionWarning ? <AlertTriangle size={16} aria-label="Hinweise vorhanden" /> : null}
          </div>
        )}
        <button
          className="lv-position-source"
          disabled={!position.basis.evidence.length}
          onClick={(event) => {
            event.stopPropagation();
            onBasisSource();
          }}
          aria-label={`Basis-Quelle ${position.basis.positionNumber}`}
        >
          <ExternalLink size={17} />
          {!expanded ? <span>Basis-Quelle</span> : null}
        </button>
        <button
          className="lv-position-info"
          onClick={(event) => {
            event.stopPropagation();
            onInfo(selected ?? cheapest);
          }}
          aria-label={`Info Position ${position.basis.positionNumber}`}
        >
          <Info size={18} />
        </button>
      </div>

      {expanded ? (
        <div className="lv-position-offers">
          {selectable.length > 0 ? (
            <div
              className="lv-offer-grid lv-offer-grid-header"
              style={{ gridTemplateColumns: SUPPLIER_GRID_COLUMNS }}
            >
              <span />
              <strong>Lieferant</strong>
              <strong>Angebot / Artikel</strong>
              <strong>Kurzinfo</strong>
              <strong>Menge</strong>
              <strong>Preis (EUR)</strong>
              <strong>Quelle</strong>
              <strong>Info</strong>
            </div>
          ) : null}
          {selectable.map((option) => (
            <SupplierRow
              key={option.id}
              position={position}
              option={option}
              model={models.get(option.id)!}
              lines={supplierOptionLines(option, offerLines)}
              selected={selected?.id === option.id}
              cheapest={cheapest?.id === option.id}
              pending={pendingOptionId === option.id}
              onSelect={() => onSelectOption(option)}
              onSource={() => onSupplierSource(option)}
              onInfo={() => onInfo(option)}
            />
          ))}
          {explicitNoOffers.map((option) => {
            const model = models.get(option.id)!;
            return (
              <div
                key={option.id}
                className="lv-offer-grid lv-offer-row explicit-no-offer"
                style={{ gridTemplateColumns: SUPPLIER_GRID_COLUMNS }}
                data-option-validity="EXPLICIT_NO_OFFER"
                data-supplier-label={option.supplierLabel}
              >
                <span />
                <BrandMark
                  resolution={model.supplierBrand}
                  label={model.supplierDisplayName}
                />
                <strong>Nicht angeboten</strong>
                <span>Diese Ausschreibungsposition wird nicht angeboten.</span>
                <span>—</span>
                <span>—</span>
                <div className="lv-offer-action">
                  {model.sourceAvailable ? (
                    <button
                      onClick={() => onSupplierSource(option)}
                      aria-label={`Quelle ${model.supplierDisplayName}`}
                    >
                      <ExternalLink size={18} />
                    </button>
                  ) : null}
                </div>
                <div className="lv-offer-action">
                  <button
                    onClick={() => onInfo(option)}
                    aria-label={`Info ${model.supplierDisplayName}`}
                  >
                    <Info size={18} />
                  </button>
                </div>
              </div>
            );
          })}
          {selectable.length === 0 && explicitNoOffers.length === 0 ? (
            <div className="lv-position-no-offers">
              <AlertTriangle size={17} />
              <span>
                <strong>Keine Angebote gefunden</strong>
                <small>Keine passende Angebotsposition wurde zugeordnet.</small>
              </span>
              <button onClick={onShowWarnings}>Hinweise anzeigen</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {draft ? <span className="lv-position-draft-dot" title="Gespeicherter Entwurf" /> : null}
    </article>
  );
}

export function LvPositionList({
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
  page,
  pageSize,
  total,
  onScrollTop,
  onToggleSection,
  onTogglePosition,
  onInfo,
  onOpenBasisSource,
  onOpenSupplierSource,
  onSelectOption,
  onShowWarnings,
  onPage,
  onPageSize
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
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section className="lv-list-pane" data-lv-list-pane>
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
            <section className="lv-list-section" key={section.id}>
              <button
                className="lv-list-section-row"
                onClick={() => onToggleSection(section.id)}
              >
                <FolderTree size={17} />
                <strong>{section.title}</strong>
                <span>{section.positions.length} Positionen</span>
                <ChevronDown size={16} className={isCollapsed ? "collapsed" : ""} />
              </button>
              {!isCollapsed
                ? section.positions.map((position) => (
                    <PositionGroup
                      key={position.basis.id}
                      position={position}
                      expanded={expandedPositionIds.has(position.basis.id)}
                      active={activePositionId === position.basis.id}
                      offerLines={offerLines}
                      supplierSourceDocumentIds={supplierSourceDocumentIds}
                      decision={latestPositionDecision(decisions, position.basis.id)}
                      draft={drafts.find((draft) => draft.positionId === position.basis.id)}
                      pendingOptionId={pendingOptionId}
                      onToggle={() => onTogglePosition(position)}
                      onInfo={(option) => onInfo(position, option)}
                      onBasisSource={() => onOpenBasisSource(position)}
                      onSupplierSource={(option) => onOpenSupplierSource(position, option)}
                      onSelectOption={(option) => onSelectOption(position, option)}
                      onShowWarnings={onShowWarnings}
                    />
                  ))
                : null}
            </section>
          );
        })}
      </div>
      <footer className="lv-pagination" aria-label="Seitennavigation">
        <span>
          Zeige {total === 0 ? 0 : (page - 1) * pageSize + 1} bis{" "}
          {Math.min(page * pageSize, total)} von {total} Positionen
        </span>
        <nav>
          <button
            onClick={() => onPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            aria-label="Vorherige Seite"
          >
            <ChevronLeft size={16} />
          </button>
          {Array.from({ length: Math.min(pageCount, 7) }, (_, index) => {
            const candidate =
              pageCount <= 7
                ? index + 1
                : Math.min(
                    pageCount - 6 + index,
                    Math.max(1, page - 3) + index
                  );
            return (
              <button
                key={candidate}
                className={candidate === page ? "active" : ""}
                onClick={() => onPage(candidate)}
              >
                {candidate}
              </button>
            );
          })}
          <button
            onClick={() => onPage(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount}
            aria-label="Nächste Seite"
          >
            <ChevronRight size={16} />
          </button>
        </nav>
        <select
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
          aria-label="Positionen pro Seite"
        >
          {[20, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size} pro Seite
            </option>
          ))}
        </select>
      </footer>
    </section>
  );
}
