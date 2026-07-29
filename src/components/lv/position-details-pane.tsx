"use client";

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  X
} from "lucide-react";
import type { OfferLine, SupplierOption } from "@/domain/contracts";
import type { ProjectReviewPosition } from "@/domain/project-review";
import { buildOperatorSupplierOptionReadModel } from "@/domain/operator-supplier-option-read-model";
import { supplierOptionLines } from "@/domain/supplier-option-read-model";
import { BrandMark } from "./brand-mark";
import { formatCurrency, formatNumber } from "./format";
import {
  InlineSourceViewer,
  type SourceViewState
} from "./source-overlay";
import type { SourceRecord } from "./types";

export type DetailsPaneTab = "OFFER_DATA" | "ORIGINAL_DOCUMENT";

export function PositionDetailsPane({
  position,
  option,
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
  onFullscreen,
  onPrevious,
  onNext,
  onClose
}: {
  position: ProjectReviewPosition;
  option?: SupplierOption;
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
  onFullscreen: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const lines = option ? supplierOptionLines(option, offerLines) : [];
  const model = option
    ? buildOperatorSupplierOptionReadModel({
        basis: position.basis,
        option,
        offerLines
      })
    : null;
  const primary = lines.find((line) => line.role === "PRIMARY") ?? lines[0];

  return (
    <aside
      className="lv-details-pane"
      data-details-pane
      data-details-tab={tab}
      aria-label={`Details zur Position ${position.basis.positionNumber}`}
    >
      <header className="lv-details-header">
        <div>
          <strong>Details zur Position {position.basis.positionNumber}</strong>
          <span>
            {positionIndex + 1} von {positionTotal}
          </span>
        </div>
        <nav>
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
      <div className="lv-details-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "OFFER_DATA"}
          className={tab === "OFFER_DATA" ? "active" : ""}
          onClick={() => onTab("OFFER_DATA")}
        >
          Angebotsdaten
        </button>
        <button
          role="tab"
          aria-selected={tab === "ORIGINAL_DOCUMENT"}
          className={tab === "ORIGINAL_DOCUMENT" ? "active" : ""}
          onClick={() => onTab("ORIGINAL_DOCUMENT")}
        >
          Originaldokument
        </button>
      </div>

      {tab === "OFFER_DATA" ? (
        <div className="lv-details-content" data-offer-data>
          <section className="lv-detail-card lv-detail-basis">
            <span>Basis-Anforderung</span>
            <h2>{position.basis.description}</h2>
            <p>
              {formatNumber(position.basis.quantity)} {position.basis.unit ?? ""}
            </p>
            <button onClick={onBasisSource}>
              <ExternalLink size={15} /> Basis-Quelle
            </button>
          </section>
          {option && model ? (
            <>
              <section className="lv-detail-card">
                <span>Angebot</span>
                <BrandMark
                  resolution={model.supplierBrand}
                  label={model.supplierDisplayName}
                />
                <dl>
                  <div><dt>Lieferant</dt><dd>{model.supplierDisplayName}</dd></div>
                  <div><dt>Hersteller</dt><dd>{model.manufacturerDisplayName ?? "—"}</dd></div>
                  <div><dt>Produkt</dt><dd>{model.title}</dd></div>
                  <div><dt>Artikel</dt><dd>{model.articleNumber ?? "—"}</dd></div>
                  <div><dt>Menge</dt><dd>{formatNumber(model.quantity)} {model.unit ?? ""}</dd></div>
                  <div><dt>EP</dt><dd>{formatCurrency(model.price.unitPrice)}</dd></div>
                  <div><dt>GP</dt><dd>{formatCurrency(model.price.total)}</dd></div>
                  <div><dt>Preisnachweis</dt><dd>{model.priceProvenanceLabelDe}</dd></div>
                </dl>
                <button onClick={onSupplierSource}>
                  <ExternalLink size={15} /> Angebotsquelle
                </button>
              </section>
              <section className="lv-detail-card">
                <span>Lieferumfang</span>
                <h3>{model.packageCompletenessLabelDe}</h3>
                <p>
                  {model.coveredRequiredComponentCount} von{" "}
                  {model.requiredComponentCount} Pflichtbestandteilen
                </p>
                {model.missingRequiredComponents.length ? (
                  <ul>
                    {model.missingRequiredComponents.map((component) => (
                      <li key={component}>{component}</li>
                    ))}
                  </ul>
                ) : null}
                {model.includedOptionalComponents.length ? (
                  <details>
                    <summary>Optionale Bestandteile</summary>
                    <ul>
                      {model.includedOptionalComponents.map((component) => (
                        <li key={component}>{component}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
              <section className="lv-detail-card">
                <span>Technische Angaben</span>
                <h3>{primary?.description ?? model.title}</h3>
                <dl>
                  <div><dt>Typ</dt><dd>{primary?.articleNumber ?? "—"}</dd></div>
                  <div><dt>Mengenprüfung</dt><dd>{option.quantityCompatible ? "Stimmt überein" : "Abweichend"}</dd></div>
                  <div><dt>Einheitenprüfung</dt><dd>{option.unitCompatible ? "Stimmt überein" : "Abweichend"}</dd></div>
                  <div><dt>Technik</dt><dd>{option.technicalComparisonStatus ?? "UNRESOLVED"}</dd></div>
                </dl>
                {option.reasons.length ? (
                  <details>
                    <summary>Prüfhinweise</summary>
                    <ul>
                      {option.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
            </>
          ) : (
            <section className="lv-detail-card lv-detail-empty">
              <strong>Keine Angebotsdaten verfügbar</strong>
              <p>
                Für diese Basis-Position ist kein reales, auswählbares Angebot
                zugeordnet.
              </p>
            </section>
          )}
        </div>
      ) : activeSourceKey ? (
        <InlineSourceViewer
          key={activeSourceKey}
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
    </aside>
  );
}
