"use client";

import { useLayoutEffect, useRef } from "react";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Info,
  PencilLine,
  ShieldQuestion,
  Sparkles,
  X
} from "lucide-react";
import type { MatchLink, OfferLine, SupplierOption } from "@/domain/contracts";
import type { ProjectReviewPosition } from "@/domain/project-review";
import { buildOperatorSupplierOptionReadModel } from "@/domain/operator-supplier-option-read-model";
import { supplierOptionLines } from "@/domain/supplier-option-read-model";
import { BrandMark } from "./brand-mark";
import { cheapestFoundOption, supplierOptionNeedsReview } from "./lv-comparison-table";
import { formatCurrency, formatNumber, shortDescription } from "./format";
import { displayPositionTitle } from "./display-normalization";
import { InlineSourceViewer, type SourceViewState } from "./source-overlay";
import type { SourceRecord } from "./types";
import { WorkspacePaneDivider } from "./workspace-pane-divider";

export type DetailsPaneTab = "OFFER_DATA" | "ORIGINAL_DOCUMENT";

export function isOfferPreviewKey(key: string, isCardTarget: boolean): boolean {
  return isCardTarget && (key === "Enter" || key === " ");
}

export function offerUnitPriceLabel(value: number | null, priceBasis: number | null | undefined, unit: string | null): string {
  if (value === null) return "Preis prüfen";
  return `EP ${formatCurrency(value)}${priceBasis && priceBasis !== 1 ? ` / ${formatNumber(priceBasis)} ${unit ?? "Einheiten"}` : ""}`;
}

export function PositionDetailsPane({
  position,
  workspaceKey = "lv",
  option,
  previewedOptionId,
  selectedOptionId,
  pendingOptionId,
  basisDisplayLabel,
  supplierDisplayLabel,
  offerLines,
  tab,
  sources,
  activeSourceKey,
  sourceView,
  positionIndex,
  positionTotal,
  onTab,
  onSourceSelect,
  onSourceView,
  onBasisSource,
  onSupplierSource,
  onPreviewOption,
  onSelectOption,
  onCorrectBasis,
  onCorrectSupplier,
  onFullscreen,
  onPrevious,
  onNext,
  onNextOpen,
  nextOpenAvailable = false,
  onClose,
  matchLink,
  matchDecision,
  matchReviewPending = false,
  onConfirmMatch,
  onRejectMatch
}: {
  position: ProjectReviewPosition;
  workspaceKey?: string;
  option?: SupplierOption;
  previewedOptionId?: string | null;
  selectedOptionId?: string | null;
  pendingOptionId?: string | null;
  basisDisplayLabel?: string;
  supplierDisplayLabel?: string;
  offerLines: Map<string, OfferLine>;
  tab: DetailsPaneTab;
  sources: SourceRecord[];
  activeSourceKey: string | null;
  sourceView: SourceViewState | null;
  positionIndex: number;
  positionTotal: number;
  onTab: (tab: DetailsPaneTab) => void;
  onSourceSelect: (key: string) => void;
  onSourceView: (view: SourceViewState) => void;
  onBasisSource: () => void;
  onSupplierSource: () => void;
  onPreviewOption?: (option: SupplierOption) => void;
  onSelectOption?: (option: SupplierOption) => void;
  onCorrectBasis?: () => void;
  onCorrectSupplier?: (line: OfferLine) => void;
  onFullscreen: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onNextOpen?: () => void;
  nextOpenAvailable?: boolean;
  onClose: () => void;
  matchLink?: MatchLink;
  matchDecision?: "CONFIRMED" | "REJECTED" | null;
  matchReviewPending?: boolean;
  onConfirmMatch?: () => void;
  onRejectMatch?: () => void;
}) {
  const paneRef = useRef<HTMLElement>(null);
  // Independent from PDF state: changing the data tab must not remount the source.
  const scrollKey = `lv-decision-scroll:${workspaceKey}:${position.basis.id}:${tab}`;
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    try {
      pane.scrollTop = Number(sessionStorage.getItem(scrollKey)) || 0;
    } catch { /* Storage may be unavailable; the working pane remains usable. */ }
    const saveScroll = () => {
      try { sessionStorage.setItem(scrollKey, String(pane.scrollTop)); } catch { /* optional view state */ }
    };
    pane.addEventListener("scroll", saveScroll, { passive: true });
    return () => { saveScroll(); pane.removeEventListener("scroll", saveScroll); };
  }, [scrollKey]);
  const resolvedBasisLabel = basisDisplayLabel?.trim() || displayPositionTitle(position.basis);
  const cheapest = cheapestFoundOption(position, offerLines);
  const allOfferModels = position.options.map((candidate) => {
    const lines = supplierOptionLines(candidate, offerLines);
    const model = buildOperatorSupplierOptionReadModel({
      basis: position.basis,
      option: candidate,
      offerLines,
      sourceAvailable: lines.some((line) => line.evidence.length > 0)
    });
    const primary = lines.find((line) => line.role === "PRIMARY") ?? lines[0];
    return { candidate, lines, model, primary };
  });
  const offerModels = allOfferModels
    .filter(({ model, lines }) => model.selectable || (model.validity === "MATCHING_REVIEW_REQUIRED" && lines.length > 0))
    .sort((left, right) => {
      if (left.candidate.id === cheapest?.id) return -1;
      if (right.candidate.id === cheapest?.id) return 1;
      return (
        (left.model.price.total ?? Number.POSITIVE_INFINITY) -
          (right.model.price.total ?? Number.POSITIVE_INFINITY) ||
        left.model.supplierDisplayName.localeCompare(right.model.supplierDisplayName, "de")
      );
    });
  const explicitNoOfferModels = allOfferModels.filter(
    ({ model }) => model.validity === "EXPLICIT_NO_OFFER"
  );
  const activeOffer = allOfferModels.find(({ candidate }) => candidate.id === option?.id);
  const activeModel = activeOffer?.model;
  const activePrimary = activeOffer?.primary;
  const resolvedSupplierLabel = supplierDisplayLabel?.trim() || activeModel?.title;
  const resolvedMatchDecision =
    matchDecision ??
    (matchLink?.confirmedByOperator
      ? "CONFIRMED"
      : matchLink?.status === "UNMATCHED"
        ? "REJECTED"
        : null);

  return (
    <>
    <aside
      className="lv-details-pane"
      ref={paneRef}
      data-lv-decision-pane
      data-details-pane
      data-details-tab={tab}
      data-persistent-inspector
      aria-label={`Details zur Position ${position.basis.positionNumber}`}
    >
      <header className="lv-details-header">
        <div>
          <span>Position {position.basis.positionNumber}</span>
          <strong title={resolvedBasisLabel}>{shortDescription(resolvedBasisLabel, 84)}</strong>
          <small>
            <b className="lv-required-quantity">{formatNumber(position.basis.quantity)} {position.basis.unit ?? ""}</b> ·{" "}
            {positionIndex + 1} von {positionTotal}
          </small>
        </div>
        <nav>
          {onNextOpen ? (
            <button
              type="button"
              className="lv-next-open"
              onClick={onNextOpen}
              disabled={!nextOpenAvailable}
            >
              Nächste offene <ChevronRight size={15} />
            </button>
          ) : null}
          <button
            onClick={onPrevious}
            disabled={positionIndex <= 0}
            aria-label="Vorherige Position"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            onClick={onNext}
            disabled={positionIndex < 0 || positionIndex >= positionTotal - 1}
            aria-label="Nächste Position"
          >
            <ChevronRight size={17} />
          </button>
          <button onClick={onClose} aria-label="Details schließen">
            <X size={18} />
          </button>
        </nav>
      </header>

      <section className="lv-inspector-basis-bar">
        <div>
          <span>Basis-LV</span>
          <strong>{position.basis.positionNumber}</strong>
          {position.basis.verificationStatus === "HUMAN_CORRECTED" ? (
            <small>Manuell korrigiert</small>
          ) : null}
        </div>
        <button type="button" onClick={onBasisSource}>
          <Eye size={15} /> Quelle anzeigen
        </button>
        {onCorrectBasis ? (
          <button type="button" onClick={onCorrectBasis} aria-label="Basisdaten korrigieren">
            <PencilLine size={15} />
          </button>
        ) : null}
      </section>

      {matchLink ? (
        <section
          className={`lv-match-strip state-${resolvedMatchDecision?.toLocaleLowerCase("de") ?? "pending"}`}
          data-match-review={resolvedMatchDecision ?? "PENDING"}
        >
          <span>
            {resolvedMatchDecision === "CONFIRMED" ? (
              <CheckCircle2 size={16} />
            ) : resolvedMatchDecision === "REJECTED" ? (
              <X size={16} />
            ) : (
              <ShieldQuestion size={16} />
            )}
            <strong>
              {resolvedMatchDecision === "CONFIRMED"
                ? "Zuordnung bestätigt"
                : resolvedMatchDecision === "REJECTED"
                  ? "Zuordnung abgelehnt"
                  : "Zuordnung prüfen"}
            </strong>
            <small>Matching-Score: {Math.round(matchLink.score * 100)} %</small>
          </span>
          <div>
            {matchLink.reasons.length ? (
              <details>
                <summary>Warum?</summary>
                <ul>
                  {Array.from(new Set(matchLink.reasons)).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {!resolvedMatchDecision ? (
              <>
                {onRejectMatch ? (
                  <button type="button" disabled={matchReviewPending} onClick={onRejectMatch}>
                    Zuordnung ablehnen
                  </button>
                ) : null}
                {onConfirmMatch ? (
                  <button type="button" disabled={matchReviewPending} onClick={onConfirmMatch}>
                    Zuordnung bestätigen
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="lv-offer-comparison" data-offer-comparison>
        <header>
          <div>
            <span>Angebote</span>
            <strong>
              {offerModels.length} zugeordnete {offerModels.length === 1 ? "Option" : "Optionen"}
            </strong>
          </div>
          <small>Vorschlag und Auswahl bleiben getrennt</small>
        </header>
        {offerModels.length || explicitNoOfferModels.length ? (
          <div className="lv-offer-table" role="table" aria-label="Angebotsvergleich">
            <div className="lv-offer-table-head" role="row">
              <span role="columnheader">Lieferant</span>
              <span role="columnheader">Angebot</span>
              <span role="columnheader">Menge</span>
              <span role="columnheader">Angebots-GP</span>
              <span role="columnheader">Aktion</span>
            </div>
            {offerModels.map(({ candidate, model }) => {
              const selected = candidate.id === selectedOptionId;
              const suggested = candidate.id === cheapest?.id;
              const suggestionNeedsReview =
                suggested && supplierOptionNeedsReview(candidate, model);
              const active = candidate.id === previewedOptionId;
              const pending = candidate.id === pendingOptionId;
              const displayLabel =
                active && supplierDisplayLabel ? supplierDisplayLabel : model.title;
              return (
                <div
                  key={candidate.id}
                  className={`lv-offer-row ${selected ? "selected" : ""} ${active ? "active" : ""}`}
                  role="row"
                  tabIndex={0}
                  aria-selected={selected}
                  data-supplier-option={candidate.id}
                  data-supplier-label={candidate.supplierLabel}
                  data-package-completeness={model.packageCompleteness}
                  data-price-provenance={model.priceProvenance}
                  data-price-state={selected ? "selected" : suggested ? "cheapest" : "standard"}
                  data-cheapest={suggested ? "true" : "false"}
                  data-recommendation-state={suggestionNeedsReview ? "review" : "ready"}
                  onClick={() => onPreviewOption?.(candidate)}
                  onKeyDown={(event) => {
                    if (!isOfferPreviewKey(event.key, event.target === event.currentTarget)) return;
                    event.preventDefault();
                    onPreviewOption?.(candidate);
                  }}
                >
                  <div className="lv-offer-supplier" role="cell">
                    <button
                      type="button"
                      className={`lv-radio-indicator ${selected ? "selected" : ""}`}
                      disabled={pending || !model.selectable}
                      title={!model.selectable ? "Zuerst Zuordnung bestätigen" : undefined}
                      aria-label={`${model.supplierDisplayName} auswählen`}
                      aria-pressed={selected}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectOption?.(candidate);
                      }}
                    >
                      {selected ? <Check size={12} /> : null}<span>{selected ? "Gewählt" : "Auswählen"}</span>
                    </button>
                    <BrandMark
                      resolution={model.supplierBrand}
                      label={model.supplierDisplayName}
                      compact
                    />
                    <span>
                      <strong>{model.supplierDisplayName}</strong>
                      <small className="lv-offer-preview-label">{active ? "In Vorschau" : selected ? "Ausgewählt" : "Angebot"}</small>
                      {suggested ? (
                        <small>
                          {suggestionNeedsReview ? (
                            <AlertTriangle size={11} />
                          ) : (
                            <Sparkles size={11} />
                          )}
                          {suggestionNeedsReview
                            ? "Günstigster Preis · prüfen"
                            : "Günstigster Vorschlag"}
                        </small>
                      ) : null}
                    </span>
                  </div>
                  <div className="lv-offer-product" role="cell">
                    <strong title={displayLabel}>{shortDescription(displayLabel, 110)}</strong>
                    <span>
                      {model.articleNumber
                        ? `Art. ${model.articleNumber}`
                        : model.packageCompletenessLabelDe}
                    </span>
                  </div>
                  <div className="lv-offer-quantity" role="cell">
                    <strong>{formatNumber(model.quantity)}</strong>
                    <span>{model.unit ?? position.basis.unit ?? ""}</span>
                  </div>
                  <div className="lv-offer-price" role="cell">
                    <strong>{formatCurrency(model.price.total)}</strong>
                    <span>
                      {offerUnitPriceLabel(model.price.unitPrice, model.price.priceBasis, model.unit)}
                    </span>
                    <small>{model.priceProvenanceLabelDe}</small>
                  </div>
                  <div className="lv-offer-actions" role="cell">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPreviewOption?.(candidate);
                      }}
                      aria-label={`Quelle ${model.supplierDisplayName}`}
                      title="Quelle anzeigen"
                    >
                      <ExternalLink size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPreviewOption?.(candidate);
                        onTab("OFFER_DATA");
                      }}
                      aria-label={`Info ${model.supplierDisplayName}`}
                      title="Angebotsdaten"
                    >
                      <Info size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
            {explicitNoOfferModels.map(({ candidate, model }) => (
              <div
                key={candidate.id}
                className="lv-offer-row lv-offer-row-unavailable"
                role="row"
                aria-selected="false"
                data-option-validity="EXPLICIT_NO_OFFER"
                data-supplier-label={candidate.supplierLabel}
                onClick={() => onPreviewOption?.(candidate)}
              >
                <div className="lv-offer-supplier" role="cell">
                  <span className="lv-radio-indicator" aria-hidden="true" />
                  <BrandMark
                    resolution={model.supplierBrand}
                    label={model.supplierDisplayName}
                    compact
                  />
                  <span>
                    <strong>{model.supplierDisplayName}</strong>
                    <small>Nicht angeboten</small>
                  </span>
                </div>
                <div className="lv-offer-product" role="cell">
                  <strong>Nicht angeboten</strong>
                  <span>Explizite Angabe im Quelldokument</span>
                </div>
                <div className="lv-offer-quantity" role="cell">
                  —
                </div>
                <div className="lv-offer-price" role="cell">
                  <strong>—</strong>
                </div>
                <div className="lv-offer-actions" role="cell">
                  {model.sourceAvailable ? (
                    <button type="button" aria-label={`Quelle ${model.supplierDisplayName}`}>
                      <ExternalLink size={15} />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="lv-offer-empty">
            <AlertTriangle size={17} />
            <span>
              <strong>Kein sicheres Angebot zugeordnet</strong>
              <small>Quelle und erkannte Daten prüfen oder die Position manuell korrigieren.</small>
            </span>
          </div>
        )}
      </section>

      <div className="lv-inspector-view-switch" role="tablist" aria-label="Inspector-Ansicht">
        <button
          role="tab"
          aria-selected={tab === "ORIGINAL_DOCUMENT"}
          className={tab === "ORIGINAL_DOCUMENT" ? "active" : ""}
          onClick={() => onTab("ORIGINAL_DOCUMENT")}
        >
          Beschreibung
        </button>
        <button
          role="tab"
          aria-selected={tab === "OFFER_DATA"}
          className={tab === "OFFER_DATA" ? "active" : ""}
          onClick={() => onTab("OFFER_DATA")}
        >
          Angebotsdaten
        </button>
      </div>

        <section className="lv-basis-description" data-basis-description hidden={tab !== "ORIGINAL_DOCUMENT"}>
          <h3>Leistungsbeschreibung</h3>
          <p>{position.basis.description}</p>
          <button type="button" onClick={onBasisSource}><Eye size={15} /> Basis-Quelle anzeigen</button>
        </section>
        <section className="lv-inspector-detail-drawer" data-offer-data hidden={tab !== "OFFER_DATA"}>
          <header>
            <strong>Angebotsdetails</strong>
            <button
              type="button"
              onClick={() => onTab("ORIGINAL_DOCUMENT")}
              aria-label="Angebotsdaten schließen"
            >
              <X size={15} />
            </button>
          </header>
          {activeModel && option && (activeModel.selectable || activeModel.validity === "MATCHING_REVIEW_REQUIRED" || activeModel.validity === "EXPLICIT_NO_OFFER") ? (
            <>
              <dl>
                <div>
                  <dt>Lieferant</dt>
                  <dd>{activeModel.supplierDisplayName}</dd>
                </div>
                <div>
                  <dt>Produkt</dt>
                  <dd>{resolvedSupplierLabel ?? "—"}</dd>
                </div>
                <div>
                  <dt>Artikel</dt>
                  <dd>{activeModel.articleNumber ?? "—"}</dd>
                </div>
                <div>
                  <dt>Lieferumfang</dt>
                  <dd>{activeModel.packageCompletenessLabelDe}</dd>
                </div>
                <div>
                  <dt>Preisnachweis</dt>
                  <dd>{activeModel.priceProvenanceLabelDe}</dd>
                </div>
                <div>
                  <dt>Technische Prüfung</dt>
                  <dd>{option.technicalComparisonStatus ?? "UNRESOLVED"}</dd>
                </div>
              </dl>
              <div className="lv-inspector-detail-actions">
                <button type="button" onClick={onSupplierSource}>
                  <ExternalLink size={14} /> Angebotsquelle
                </button>
                {onCorrectSupplier && activePrimary ? (
                  <button type="button" onClick={() => onCorrectSupplier(activePrimary)}>
                    <PencilLine size={14} /> Angebotsdaten korrigieren
                  </button>
                ) : null}
              </div>
              {activeOffer?.lines.length ? (
                <section className="lv-bundle-lines" aria-label="Bestandteile des Angebots">
                  <h3>Bestandteile & Preis</h3>
                  {activeOffer.lines.map((line) => (
                    <div key={line.id}>
                      <span><strong>{shortDescription(line.description, 110)}</strong><small>{line.articleNumber ? `Art. ${line.articleNumber} · ` : ""}{formatNumber(line.quantity)} {line.unit ?? ""}</small></span>
                      <strong>{formatCurrency(line.interpretedTotalPrice)}</strong>
                      {onCorrectSupplier ? <button type="button" onClick={() => onCorrectSupplier(line)} aria-label={`Angebotszeile ${line.articleNumber ?? line.id} korrigieren`}><PencilLine size={14} /></button> : null}
                    </div>
                  ))}
                </section>
              ) : null}
              <details className="lv-inspector-descriptions">
                <summary>Vollständige Beschreibung</summary>
                <strong>Basis-LV</strong>
                <p>{position.basis.description}</p>
                {activePrimary ? (
                  <>
                    <strong>Angebot</strong>
                    <p>{activePrimary.description}</p>
                  </>
                ) : null}
              </details>
            </>
          ) : (
            <p>Für diese Position liegen keine auswählbaren Angebotsdaten vor.</p>
          )}
        </section>
    </aside>
      <section className="lv-inspector-source" data-lv-source-pane aria-label="Dokumentvorschau">
        <WorkspacePaneDivider workspaceKey={workspaceKey} />
        {activeSourceKey ? (
          <InlineSourceViewer
            sources={sources}
            activeKey={activeSourceKey}
            initialView={sourceView}
            onViewChange={onSourceView}
            onSelect={onSourceSelect}
            onFullscreen={onFullscreen}
          />
        ) : (
          <div className="lv-inline-source-empty">
            Für diese Position ist keine Dokumentquelle verfügbar.
          </div>
        )}
      </section>
    </>
  );
}
