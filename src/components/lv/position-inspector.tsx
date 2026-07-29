"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  History,
  Save,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  OfferLine,
  SupplierDecision,
  SupplierOption
} from "@/domain/contracts";
import type { CentralSupplierDecision } from "@/domain/central-decision";
import type { ProjectReviewPosition } from "@/domain/project-review";
import {
  CURRENT_DECISION_REASON_CATALOG,
  PLACEHOLDER_DECISION_REASON_CODE,
  activeDecisionReasons
} from "@/domain/decision-catalog";
import { StatusBadge } from "@/components/status-badge";
import { useDecisionIdentity } from "@/components/decision-identity";
import {
  displayExecutionDescription,
  displayInstallationRequirements,
  displayManufacturerAndType,
  displayPositionTitle,
  displayShortDescription,
  displayTechnicalRequirements
} from "./display-normalization";
import {
  formatCurrency,
  formatNumber,
  liveStatusLabel,
  materialScopeLabel,
  shortDescription as truncateDescription,
  userReason
} from "./format";
import {
  primarySupplierLine,
  supplierDisplayRole,
  supplierDisplayRoleLabel,
  unavailableSupplierStatus
} from "@/domain/supplier-option-read-model";
import {
  buildBasisStructureInterpretation,
  buildOperatorSupplierOptionReadModel,
  buildPositionSelectionMode,
  type OperatorSupplierOptionReadModel
} from "@/domain/operator-supplier-option-read-model";
import { BrandMark } from "./brand-mark";
import {
  type DecisionFormDraft,
  type DraftSaveState,
  useServerDecisionDraft
} from "./use-server-decision-draft";

type InspectorTab =
  | "overview"
  | "requirement"
  | "offers"
  | "scope"
  | "information"
  | "source"
  | "decision"
  | "history";
type DecisionAction =
  | "SELECTED"
  | "NONE_CORRECT"
  | "DEFERRED"
  | "ADDITIONAL_CHECK_REQUESTED";

const minimumCommentLength = 40;

function warningSummary(label: string): string {
  const summaries: Record<string, string> = {
    "Menge und Einheit": "Menge oder Einheit prüfen",
    Preis: "Preisangaben nicht vollständig bestätigt",
    Pflichtbestandteile: "Lieferumfang prüfen",
    "Technische Angaben": "Mehrere Werte nicht eindeutig bestätigt",
    Zuordnung: "Angebotszuordnung prüfen",
    Quelle: "Quellennachweis prüfen"
  };
  return summaries[label] ?? "Prüfung erforderlich";
}

function latestDecision(
  decisions: SupplierDecision[],
  basisPositionId: string
): SupplierDecision | undefined {
  return decisions.filter(
    (decision) => decision.basisPositionId === basisPositionId
  ).at(-1);
}

function decisionTimestamp(decision: SupplierDecision): string {
  return "decidedAt" in decision ? decision.decidedAt : decision.timestamp;
}

function decisionActor(decision: SupplierDecision): string {
  return "decidedBy" in decision ? decision.decidedBy : decision.operator;
}

export function SupplierOptionPanel({
  option,
  model,
  lines,
  selected,
  selectedLineIds,
  onSelect,
  onToggleLine,
  onOpenSource
}: {
  option: SupplierOption;
  model: OperatorSupplierOptionReadModel;
  lines: OfferLine[];
  selected: boolean;
  selectedLineIds: string[];
  onSelect: () => void;
  onToggleLine: (lineId: string) => void;
  onOpenSource: (line: OfferLine) => void;
}) {
  const price = model.price;
  const incomplete =
    !option.quantityCompatible ||
    !option.unitCompatible ||
    !option.bundleCompatible ||
    !option.requiredScopeComplete ||
    option.technicalComparisonStatus !== "CONFIRMED_COMPATIBLE";
  return (
    <article className={`lv-supplier-panel ${selected ? "selected" : ""}`}>
      <header>
        <div>
          <BrandMark
            resolution={model.supplierBrand}
            label={model.supplierDisplayName}
          />
          <strong>
            {formatCurrency(price.total)}
          </strong>
          <small>{model.priceProvenanceLabelDe}</small>
        </div>
        <div>
          <small>{model.packageCompletenessLabelDe}</small>
          <small>
            {model.coveredRequiredComponentCount} von{" "}
            {model.requiredComponentCount} Pflichtbestandteilen
          </small>
          {incomplete ? <em>Nicht im automatischen Vergleich</em> : null}
        </div>
      </header>
      <dl className="lv-option-totals">
        <div><dt>Preis gefunden</dt><dd>{formatCurrency(option.pricedTotal)}</dd></div>
        <div><dt>Vergleichssumme</dt><dd>{formatCurrency(option.comparableTotal)}</dd></div>
        <div><dt>Menge</dt><dd>{formatNumber(option.quantity)} {option.unit ?? ""}</dd></div>
      </dl>
      <ul className="lv-option-reasons">
        {option.reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
      <section className="lv-option-lines">
        {lines.length ? lines.map((line) => (
          <div key={line.id}>
            <label>
              <input
                type="checkbox"
                checked={selectedLineIds.includes(line.id)}
                disabled={!selected}
                onChange={() => onToggleLine(line.id)}
              />
              <span>
                <small>
                  {supplierDisplayRoleLabel(supplierDisplayRole(line, lines))}
                </small>
                <strong>{line.description}</strong>
                <em>
                  {line.manufacturer ?? "Hersteller nicht angegeben"} · Art.{" "}
                  {line.articleNumber ?? "—"} · {formatNumber(line.quantity)}{" "}
                  {line.unit ?? ""}
                </em>
              </span>
            </label>
            {line.evidence.length ? (
              <button onClick={() => onOpenSource(line)}>
                <ExternalLink size={15} /> Quelle
              </button>
            ) : (
              <small>Quelle nicht verfügbar</small>
            )}
          </div>
        )) : <p>Keine originale Angebotszeile verknüpft.</p>}
      </section>
      <button className="button button-secondary" onClick={onSelect}>
        {selected ? <Check size={16} /> : null}
        {model.selectActionLabelDe}
      </button>
      {model.partialSelectionWarningDe ? (
        <p className="lv-partial-warning">{model.partialSelectionWarningDe}</p>
      ) : null}
    </article>
  );
}

function DecisionForm({
  position,
  draft,
  isAutomatic,
  pending,
  error,
  saved,
  saveState,
  author,
  updatedAt,
  version,
  onDraft,
  onSubmit,
  onOpenBasisSource,
  onOpenSupplierSource
}: {
  position: ProjectReviewPosition;
  draft: DecisionFormDraft;
  isAutomatic: boolean;
  pending: boolean;
  error: string | null;
  saved: boolean;
  saveState: DraftSaveState;
  author: string | null;
  updatedAt: string | null;
  version: number | null;
  onDraft: (draft: DecisionFormDraft) => void;
  onSubmit: (action: DecisionAction) => void;
  onOpenBasisSource: () => void;
  onOpenSupplierSource: () => void;
}) {
  const activeReasons = activeDecisionReasons(CURRENT_DECISION_REASON_CATALOG);
  const meaningfulLength = draft.comment.trim().length;
  const selectedOption = position.options.find(
    (option) => option.id === draft.selectedOptionId
  );
  const hasBasisEvidence = position.basis.evidence.length > 0;
  const hasSupplierEvidence =
    selectedOption?.matchedOfferLineIds.length === draft.selectedLineIds.length &&
    draft.selectedLineIds.length > 0;
  const valid =
    Boolean(draft.selectedOptionId) &&
    Boolean(draft.reasonCode) &&
    meaningfulLength >= minimumCommentLength &&
    hasBasisEvidence &&
    hasSupplierEvidence;
  return (
    <div className="lv-decision-form" data-decision-form>
      <div className="lv-decision-sources">
        <button onClick={onOpenBasisSource}>
          <ExternalLink size={15} /> Zur Basis-Quelle
        </button>
        <button
          onClick={onOpenSupplierSource}
          disabled={!selectedOption}
        >
          <ExternalLink size={15} /> Zur Angebotsquelle
        </button>
      </div>
      {isAutomatic ? (
        <div className="lv-automatic-note">
          <strong>Automatische Auswahl wird geändert</strong>
          <span>Die ursprüngliche Empfehlung bleibt in der Historie sichtbar.</span>
        </div>
      ) : null}
      <label>
        <span>
          Technischer Übergangsgrund · Katalog{" "}
          {CURRENT_DECISION_REASON_CATALOG.version}
        </span>
        <select
          value={draft.reasonCode}
          onChange={(event) =>
            onDraft({ ...draft, reasonCode: event.target.value })
          }
        >
          <option value="">Grund auswählen</option>
          {activeReasons.map((reason) => (
            <option key={reason.code} value={reason.code}>
              {reason.labelDe}
            </option>
          ))}
        </select>
        <small>
          Placeholder: Bis der Firmenkatalog vorliegt, ist ein ausführlicher
          Kommentar zwingend.
        </small>
      </label>
      <label>
        <span>Entscheidungsbegründung</span>
        <textarea
          value={draft.comment}
          onChange={(event) => onDraft({ ...draft, comment: event.target.value })}
          placeholder="Warum wurde diese Variante gewählt? Welche technischen, kaufmännischen oder praktischen Unterschiede waren entscheidend? Warum wurden die anderen Angebote nicht gewählt?"
        />
        <small className={meaningfulLength >= minimumCommentLength ? "valid" : ""}>
          {meaningfulLength} Zeichen · mindestens {minimumCommentLength} aussagekräftige Zeichen
        </small>
      </label>
      <div className="lv-draft-state" aria-live="polite">
        {saveState === "saving"
          ? "Wird gespeichert..."
          : saveState === "offline"
            ? "Offline – lokal zwischengespeichert"
            : saveState === "error"
              ? "Speichern fehlgeschlagen"
              : saved
                ? "Entwurf gespeichert"
                : "Entwurf wird gespeichert…"}
        {author ? <span>Bearbeitet von: {author}</span> : null}
        {updatedAt ? (
          <span>
            Zuletzt gespeichert: {new Date(updatedAt).toLocaleString("de-DE")}
          </span>
        ) : null}
        {version ? <span>Version {version}</span> : null}
      </div>
      {error ? <p className="action-error">{error}</p> : null}
      <div className="lv-decision-actions">
        <button
          className="button button-primary"
          disabled={pending || !valid}
          onClick={() => onSubmit("SELECTED")}
        >
          <Save size={16} /> Speichern und weiter
        </button>
        <button
          className="button button-secondary"
          disabled={pending || meaningfulLength < minimumCommentLength}
          onClick={() => onSubmit("NONE_CORRECT")}
        >
          Keine der Varianten
        </button>
        <button
          className="button button-secondary"
          disabled={pending || meaningfulLength < minimumCommentLength}
          onClick={() => onSubmit("ADDITIONAL_CHECK_REQUESTED")}
        >
          Weitere Prüfung erforderlich
        </button>
        <button
          className="button button-secondary"
          disabled={pending || meaningfulLength < minimumCommentLength}
          onClick={() => onSubmit("DEFERRED")}
        >
          Zurückstellen
        </button>
      </div>
    </div>
  );
}

export function PositionInspector({
  position,
  positionIndex,
  positionTotal,
  offerLines,
  decisions,
  projectId,
  analysisVersionId,
  initialTab,
  focusedOptionId,
  onTabChange,
  onClose,
  onPrevious,
  onNext,
  onSaved,
  onSelectOption,
  onOpenBasisSource,
  onOpenSupplierSource
}: {
  position: ProjectReviewPosition;
  positionIndex: number;
  positionTotal: number;
  offerLines: Map<string, OfferLine>;
  decisions: SupplierDecision[];
  projectId: string;
  analysisVersionId: string;
  initialTab: InspectorTab;
  focusedOptionId: string | null;
  onTabChange: (tab: InspectorTab) => void;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSaved: () => Promise<void>;
  onSelectOption: (option: SupplierOption, comment: string) => Promise<void>;
  onOpenBasisSource: () => void;
  onOpenSupplierSource: (option: SupplierOption, line?: OfferLine) => void;
}) {
  const identity = useDecisionIdentity();
  const automatic = position.liveStatus === "AUTO_SELECTED_LOWEST_PRICE";
  const systemOptionId = position.independent.selectedSupplierOptionId;
  const stored = latestDecision(decisions, position.basis.id);
  const storedOptionId =
    stored && "selectedSupplierOptionId" in stored
      ? stored.selectedSupplierOptionId
      : null;
  const defaultOptionId = storedOptionId ?? systemOptionId ?? null;
  const [tab, setTab] = useState<InspectorTab>(
    initialTab === "decision" || initialTab === "history"
      ? "information"
      : initialTab
  );
  const [overrideOpen, setOverrideOpen] = useState(false);
  const initialDraft = useMemo<DecisionFormDraft>(() => {
    const optionId = defaultOptionId;
    const option = position.options.find(
      (candidate) => candidate.id === optionId
    );
    return {
      selectedOptionId: optionId,
      selectedLineIds: option?.matchedOfferLineIds ?? [],
      rejectedOptionIds: [],
      reasonCode: "",
      comment: "",
      outcome: optionId ? "SELECTED" : null
    };
  }, [defaultOptionId, position.options]);
  const sync = useServerDecisionDraft({
    enabled: identity.enabled,
    user: identity.user,
    projectId,
    positionId: position.basis.id,
    analysisVersionId,
    initialDraft
  });
  const draft = sync.draft;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [allTechnicalVisible, setAllTechnicalVisible] = useState(false);
  const [fullInformationVisible, setFullInformationVisible] = useState(false);

  const displayTitle = displayPositionTitle(position.basis);
  const shortDescription = displayShortDescription(position.basis);
  const executionDescription = displayExecutionDescription(position.basis);
  const installationRequirements = displayInstallationRequirements(position.basis);
  const requirements = displayTechnicalRequirements(position.basis);
  const manufacturerAndType = displayManufacturerAndType(position.basis);
  const visibleTechnical = allTechnicalVisible
    ? requirements.technical
    : requirements.technical.slice(0, 12);

  const optionModels = new Map(
    position.options.map((option) => [
      option.id,
      buildOperatorSupplierOptionReadModel({
        basis: position.basis,
        option,
        offerLines
      })
    ])
  );
  const realOptions = position.options.filter(
    (option) => optionModels.get(option.id)?.selectable
  );
  const unavailableOptions = position.options.filter(
    (option) => !optionModels.get(option.id)?.selectable
  );
  const selectedOption = realOptions.find(
    (option) => option.id === draft.selectedOptionId
  );
  const focusedOption =
    realOptions.find((option) => option.id === focusedOptionId) ??
    selectedOption ??
    realOptions[0];
  const focusedLines = focusedOption
    ? focusedOption.matchedOfferLineIds
        .map((lineId) => offerLines.get(lineId))
        .filter((line): line is OfferLine => Boolean(line))
    : [];
  const focusedModel = focusedOption
    ? optionModels.get(focusedOption.id) ?? null
    : null;
  const basisStructure = buildBasisStructureInterpretation(position.basis);
  const positionSelectionMode = buildPositionSelectionMode(
    position.basis,
    [...optionModels.values()]
  );
  const latestCentralDecision = [...sync.serverDecisions]
    .sort((left, right) => left.decisionVersion - right.decisionVersion)
    .at(-1);
  const persistedSelectedOptionId =
    latestCentralDecision?.outcome === "SELECTED"
      ? latestCentralDecision.selectedSupplierOptionId
      : storedOptionId;
  const storedSelectedOption = realOptions.find(
    (option) => option.id === persistedSelectedOptionId
  );
  const storedSelectedModel = storedSelectedOption
    ? optionModels.get(storedSelectedOption.id) ?? null
    : null;
  const storedSelectionIncomplete = Boolean(
    storedSelectedModel &&
      (storedSelectedModel.packageCompleteness !== "COMPLETE" ||
        (latestCentralDecision?.outcome === "SELECTED" &&
          latestCentralDecision.selectedBundleLineIds.length !==
            storedSelectedOption?.matchedOfferLineIds.length))
  );
  const focusedPrimary = primarySupplierLine(focusedLines);
  const focusedPrice = focusedModel?.price ?? null;
  const cheapestOption = [...realOptions]
    .filter(
      (option) =>
        optionModels.get(option.id)?.price.total !== null
    )
    .sort(
      (left, right) =>
        (optionModels.get(left.id)?.price.total ?? Number.POSITIVE_INFINITY) -
        (optionModels.get(right.id)?.price.total ?? Number.POSITIVE_INFINITY)
    )[0];
  const focusedWarnings = focusedOption
    ? [
        {
          label: "Menge und Einheit",
          count:
            Number(!focusedOption.quantityCompatible) +
            Number(!focusedOption.unitCompatible)
        },
        {
          label: "Preis",
          count: Number(focusedPrice?.state === "MISSING")
        },
        {
          label: "Pflichtbestandteile",
          count: focusedOption.missingComponents.length
        },
        {
          label: "Technische Angaben",
          count:
            focusedOption.technicalDeviations.length +
            (focusedOption.unresolvedTechnicalAttributes?.length ?? 0)
        },
        {
          label: "Zuordnung",
          count: Number(
            !focusedOption.matchingAccepted || !focusedOption.matchingReliable
          )
        },
        {
          label: "Quelle",
          count: Number(!focusedOption.evidenceIds.length)
        }
      ].filter((warning) => warning.count > 0)
    : [];
  const operatorSelected =
    position.liveStatus === "MANUAL_DECIDED" ? selectedOption : undefined;
  const history = useMemo(
    () => ({
      legacy: decisions.filter(
        (decision) => decision.basisPositionId === position.basis.id
      ),
      central: sync.serverDecisions
    }),
    [decisions, position.basis.id, sync.serverDecisions]
  );

  function updateDraft(next: DecisionFormDraft) {
    sync.updateDraft(next);
  }

  function chooseOption(option: SupplierOption) {
    updateDraft({
      ...draft,
      selectedOptionId: option.id,
      selectedLineIds: [...option.matchedOfferLineIds],
      outcome: "SELECTED"
    });
    setError(null);
  }

  function chooseOptionLines(option: SupplierOption, lineIds: string[]) {
    updateDraft({
      ...draft,
      selectedOptionId: option.id,
      selectedLineIds: [...lineIds],
      outcome: "SELECTED"
    });
    setError(null);
  }

  function resetOptionSelection() {
    updateDraft({
      ...draft,
      selectedOptionId: null,
      selectedLineIds: [],
      outcome: null
    });
    setError(null);
  }

  function toggleLine(lineId: string) {
    updateDraft({
      ...draft,
      selectedLineIds: draft.selectedLineIds.includes(lineId)
        ? draft.selectedLineIds.filter((id) => id !== lineId)
        : [...draft.selectedLineIds, lineId]
    });
  }

  async function submit(action: DecisionAction) {
    setPending(true);
    setError(null);
    try {
      const selected = action === "SELECTED";
      const central = identity.enabled && Boolean(identity.user);
      const endpoint = central
        ? `/api/projects/${encodeURIComponent(projectId)}/positions/${encodeURIComponent(
            position.basis.id
          )}/decisions`
        : "/api/review-actions";
      const body = central
        ? {
            selectedSupplierOptionId: selected ? draft.selectedOptionId : null,
            selectedBundleLineIds: selected ? draft.selectedLineIds : [],
            rejectedOptionIds: draft.rejectedOptionIds,
            outcome: action,
            reasonCodes:
              action === "DEFERRED" ||
              action === "ADDITIONAL_CHECK_REQUESTED"
                ? []
                : [draft.reasonCode || PLACEHOLDER_DECISION_REASON_CODE],
            comment: draft.comment,
            analysisVersionId,
            expectedDecisionVersion:
              sync.serverDecisions.at(-1)?.decisionVersion ?? 0,
            decisionType:
              action === "SELECTED"
                ? automatic
                  ? "AUTOMATIC_OVERRIDE"
                  : "MANUAL_SELECTION"
                : action
          }
        : {
            kind: "DECISION",
            status: action,
            basisPositionId: position.basis.id,
            selectedSupplierOptionId: selected ? draft.selectedOptionId : null,
            ...(action === "DEFERRED"
              ? {}
              : {
                  selectedSupplierLineIds: selected
                    ? draft.selectedLineIds
                    : []
                }),
            reasonCodes:
              action === "DEFERRED" ||
              action === "ADDITIONAL_CHECK_REQUESTED"
                ? []
                : [draft.reasonCode || PLACEHOLDER_DECISION_REASON_CODE],
            comment: draft.comment,
            decidedBy: "lokaler-operator",
            ...(selected
              ? {
                  decisionType: automatic
                    ? "AUTOMATIC_OVERRIDE"
                    : "MANUAL_SELECTION"
                }
              : {})
          };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as {
        error?: string;
        details?: unknown;
        currentVersion?: number;
      };
      if (!response.ok) {
        if (response.status === 409 && central) {
          await sync.refresh();
          throw new Error(
            `Diese Position wurde auf einem anderen Gerät geändert (Version ${
              payload.currentVersion ?? "unbekannt"
            }). Neueste Version wurde geladen; bitte prüfen und erneut speichern.`
          );
        }
        throw new Error(
          [payload.error, payload.details ? JSON.stringify(payload.details) : ""]
            .filter(Boolean)
            .join(" · ")
        );
      }
      sync.clearRecovery();
      setOverrideOpen(false);
      await sync.refresh();
      await onSaved();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Entscheidung konnte nicht gespeichert werden."
      );
    } finally {
      setPending(false);
    }
  }

  const tabs: Array<[InspectorTab, string]> = [
    ["overview", "Überblick"],
    ["requirement", "LV-Anforderung"],
    ["offers", "Angebote"],
    ["scope", "Lieferumfang"],
    ["information", "Informationen"],
    ["source", "Quelle"]
  ];
  return (
    <div className="position-inspector-backdrop" role="presentation">
      <aside
        className="lv-position-inspector"
        role="dialog"
        aria-modal="true"
        aria-label={`Position ${position.basis.positionNumber}`}
        data-position-inspector
      >
        <header>
          <div className="lv-inspector-title">
            <span>Position {position.basis.positionNumber}</span>
            <h2 className={titleExpanded ? "expanded" : ""}>{displayTitle}</h2>
            {displayTitle.length > 150 ? (
              <button
                className="lv-title-toggle"
                type="button"
                onClick={() => setTitleExpanded((value) => !value)}
              >
                {titleExpanded
                  ? "Titel einklappen"
                  : "Vollständigen Titel anzeigen"}
              </button>
            ) : null}
            <p>
              {formatNumber(position.basis.quantity)} {position.basis.unit ?? ""} ·{" "}
              <StatusBadge>
                {operatorSelected ? "Ausgewählt" : "Nicht ausgewählt"}
              </StatusBadge>
              {operatorSelected ? (
                <strong className="lv-inspector-selected-supplier">
                  <Check size={13} />
                  <BrandMark
                    resolution={optionModels.get(operatorSelected.id)!.supplierBrand}
                    label={operatorSelected.supplierLabel}
                    compact
                  />
                  <span>Ausgewählt</span>
                </strong>
              ) : null}
              {focusedWarnings.length ? <span>Hinweis vorhanden</span> : null}
            </p>
            <div className="lv-inspector-source-actions">
              <button onClick={onOpenBasisSource}>
                <ExternalLink size={14} /> Basis-Quelle
              </button>
              {focusedOption ? (
                <button onClick={() => onOpenSupplierSource(focusedOption)}>
                  <ExternalLink size={14} /> Supplier-Quelle
                </button>
              ) : null}
            </div>
            <small>
              Position {positionIndex + 1} von {positionTotal} LV-Positionen
            </small>
          </div>
          <nav>
            <button onClick={onPrevious} aria-label="Vorherige Position">
              <ChevronLeft size={19} />
            </button>
            <button onClick={onNext} aria-label="Nächste Position">
              <ChevronRight size={19} />
            </button>
            <button onClick={onClose} aria-label="Inspector schließen">
              <X size={20} />
            </button>
          </nav>
        </header>
        <div className="lv-inspector-tabs" role="tablist">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "active" : ""}
              onClick={() => {
                setTab(value);
                onTabChange(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="lv-inspector-content">
          {tab === "overview" ? (
            <section className="lv-inspector-overview" data-inspector-overview>
              <div className="lv-source-heading">
                <div>
                  <span>Überblick</span>
                  {focusedModel ? (
                    <BrandMark
                      resolution={focusedModel.supplierBrand}
                      label={focusedModel.supplierDisplayName}
                    />
                  ) : (
                    <h3>Keine Supplier-Option verfügbar</h3>
                  )}
                </div>
                {focusedOption ? (
                  <div className="lv-overview-markers">
                    {operatorSelected?.id === focusedOption.id ? (
                      <em className="selected">Ausgewählt</em>
                    ) : null}
                    {cheapestOption?.id === focusedOption.id ? (
                      <em className="cheapest">
                        {focusedPrice?.total !== null
                          ? "Günstigstes Angebot"
                          : "Günstigster gefundener Preis"}
                      </em>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {focusedOption ? (
                <>
                  <dl className="lv-overview-grid">
                    <div>
                      <dt>Lieferant</dt>
                      <dd>
                        <BrandMark
                          resolution={focusedModel!.supplierBrand}
                          label={focusedOption.supplierLabel}
                          compact
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Hersteller</dt>
                      <dd>
                        {focusedModel?.manufacturerDisplayName ? (
                          <BrandMark
                            resolution={focusedModel.manufacturerBrand!}
                            label={focusedModel.manufacturerDisplayName}
                            compact
                            allowFallback={false}
                          />
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Produkt / Typ</dt>
                      <dd>
                        {focusedPrimary
                          ? truncateDescription(focusedPrimary.description, 180)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Artikelnummer</dt>
                      <dd>{focusedPrimary?.articleNumber ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Menge</dt>
                      <dd>
                        {formatNumber(
                          focusedPrimary?.quantity ?? focusedOption.quantity
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Einheit</dt>
                      <dd>
                        {focusedPrimary?.unit ?? focusedOption.unit ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Einzelpreis</dt>
                      <dd>
                        {formatCurrency(
                          focusedPrimary?.interpretedUnitPrice ?? null
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Gesamtpreis</dt>
                      <dd>
                        {formatCurrency(focusedPrice?.total ?? null)}
                        <small>{focusedModel?.priceProvenanceLabelDe}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Lieferumfang</dt>
                      <dd>
                        {focusedModel?.packageCompletenessLabelDe ?? "Unklar"}
                        <small>
                          {focusedModel?.coveredRequiredComponentCount ?? 0} von{" "}
                          {focusedModel?.requiredComponentCount ?? 0} Pflichtbestandteilen
                        </small>
                      </dd>
                    </div>
                    <div>
                      <dt>Dokument / Seite</dt>
                      <dd>
                        {focusedOption.supplierLabel} ·{" "}
                        {focusedPrimary?.evidence[0]?.pageNumber
                          ? `Seite ${focusedPrimary.evidence[0].pageNumber}`
                          : "Quelle nicht verfügbar"}
                      </dd>
                    </div>
                  </dl>
                  {storedSelectionIncomplete ? (
                    <div className="lv-existing-partial-warning" role="status">
                      <strong>
                        Bestehende Auswahl deckt den erkannten Lieferumfang nicht
                        vollständig ab.
                      </strong>
                      <p>
                        Die gespeicherte Entscheidung bleibt unverändert. Prüfen Sie
                        die enthaltenen Komponenten, bevor Sie eine neue Version
                        speichern.
                      </p>
                      <div>
                        <button
                          className="button button-secondary"
                          onClick={() => {
                            setTab("scope");
                            onTabChange("scope");
                          }}
                        >
                          Auswahl prüfen
                        </button>
                        <button
                          className="button button-secondary"
                          onClick={() => {
                            setTab("scope");
                            onTabChange("scope");
                          }}
                        >
                          Komponenten ergänzen
                        </button>
                        <span>Auswahl beibehalten oder bewusst ändern</span>
                      </div>
                    </div>
                  ) : null}
                  {focusedWarnings.length ? (
                    <div className="lv-warning-groups">
                      {focusedWarnings.map((warning) => (
                        <button
                          key={warning.label}
                          onClick={() => {
                            setFullInformationVisible(true);
                            setTab("information");
                            onTabChange("information");
                          }}
                        >
                          <span>{warning.label}</span>
                          <strong>{warningSummary(warning.label)}</strong>
                          <small>{warning.count} Prüfpunkte anzeigen</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="lv-compact-success">
                      Keine offenen Warnungen in den extrahierten Angebotsdaten.
                    </p>
                  )}
                  <label className="lv-internal-note">
                    <span>Interne Notiz</span>
                    <textarea
                      value={draft.comment}
                      onChange={(event) =>
                        updateDraft({ ...draft, comment: event.target.value })
                      }
                      placeholder="Optional"
                    />
                  </label>
                  <div className="lv-overview-actions">
                    <button
                      className={
                        operatorSelected?.id === focusedOption.id
                          ? "button button-selected"
                          : "button button-primary"
                      }
                      disabled={operatorSelected?.id === focusedOption.id}
                      onClick={() => {
                        if (
                          focusedModel?.packageCompleteness === "PARTIAL" ||
                          focusedModel?.packageCompleteness === "PRIMARY_ONLY"
                        ) {
                          setTab("scope");
                          onTabChange("scope");
                          return;
                        }
                        void onSelectOption(focusedOption, draft.comment);
                      }}
                    >
                      {operatorSelected?.id === focusedOption.id ? (
                        <>
                          <Check size={15} /> Ausgewählt
                        </>
                      ) : operatorSelected ? (
                        "Auswahl ändern"
                      ) : (
                        focusedModel?.selectActionLabelDe ?? "Angebot auswählen"
                      )}
                    </button>
                    <button
                      className="button button-secondary"
                      onClick={() => onOpenSupplierSource(focusedOption)}
                    >
                      <ExternalLink size={15} /> Zur Quelle
                    </button>
                    <button
                      className="button button-secondary"
                      onClick={() => setFullInformationVisible((value) => !value)}
                    >
                      {fullInformationVisible
                        ? "Kompakte Ansicht"
                        : "Alle Informationen anzeigen"}
                    </button>
                  </div>
                  {fullInformationVisible ? (
                    <div
                      className="lv-full-information visible"
                      data-full-information
                    >
                      <section>
                        <h4>Basis-Anforderung</h4>
                        <p>{position.basis.description}</p>
                        <small>
                          {formatNumber(position.basis.quantity)}{" "}
                          {position.basis.unit ?? ""} ·{" "}
                          {position.basis.hierarchyPath?.join(" › ") ||
                            "LV-Position"}
                        </small>
                      </section>
                      <section>
                        <h4>Angebotsdaten</h4>
                        <p>{focusedPrimary?.description ?? "—"}</p>
                        <small>
                          {focusedPrimary?.manufacturer ?? "Hersteller —"} ·{" "}
                          {focusedPrimary?.articleNumber ?? "Artikel —"} · EP{" "}
                          {formatCurrency(
                            focusedPrimary?.interpretedUnitPrice ?? null
                          )}{" "}
                          · GP{" "}
                          {formatCurrency(focusedPrice?.total ?? null)}
                        </small>
                      </section>
                      <section>
                        <h4>Lieferumfang</h4>
                        {focusedLines.map((line) => (
                          <p key={line.id}>
                            <strong>
                              {supplierDisplayRoleLabel(
                                supplierDisplayRole(line, focusedLines)
                              )}
                              :
                            </strong>{" "}
                            {line.description}
                          </p>
                        ))}
                        {focusedOption.missingComponents.length ? (
                          <p>
                            <strong>Fehlend:</strong>{" "}
                            {focusedOption.missingComponents.join(", ")}
                          </p>
                        ) : null}
                      </section>
                      <section>
                        <h4>Technische Eigenschaften</h4>
                        <p>
                          {focusedOption.technicalDeviations.length
                            ? focusedOption.technicalDeviations.join(" · ")
                            : "Keine bestätigte technische Abweichung."}
                        </p>
                        {focusedOption.unresolvedTechnicalAttributes?.length ? (
                          <p>
                            Nicht bestätigt:{" "}
                            {focusedOption.unresolvedTechnicalAttributes.join(
                              ", "
                            )}
                          </p>
                        ) : null}
                      </section>
                      <section>
                        <h4>Quelle</h4>
                        <button
                          className="button button-secondary"
                          onClick={() => onOpenSupplierSource(focusedOption)}
                        >
                          Dokument und Belegstelle öffnen
                        </button>
                      </section>
                      <details className="lv-original-text">
                        <summary>Originaltext anzeigen</summary>
                        <pre>
                          {position.basis.description}
                          {"\n\n"}
                          {focusedLines
                            .map((line) => line.description)
                            .join("\n")}
                        </pre>
                      </details>
                    </div>
                  ) : null}
                </>
              ) : (
                <p>Keine Supplier-Option für diese Position vorhanden.</p>
              )}
            </section>
          ) : null}

          {tab === "requirement" ? (
            <section className="lv-requirement" data-inspector-requirement>
              <div className="lv-source-heading">
                <h3>LV-Anforderung</h3>
                <button onClick={onOpenBasisSource}>
                  <ExternalLink size={15} /> Zur Basis-Quelle
                </button>
              </div>

              <section className="lv-requirement-section">
                <h4>Kurzbeschreibung</h4>
                <p>{shortDescription}</p>
              </section>

              <section className="lv-requirement-section">
                <h4>Basisdaten</h4>
                <dl className="lv-basis-data">
                  <div>
                    <dt>Menge</dt>
                    <dd>{formatNumber(position.basis.quantity)}</dd>
                  </div>
                  <div>
                    <dt>Einheit</dt>
                    <dd>{position.basis.unit ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>LV-Position</dt>
                    <dd>{position.basis.positionNumber}</dd>
                  </div>
                  <div className="wide">
                    <dt>Hierarchie</dt>
                    <dd>
                      {position.basis.hierarchyPath?.join(" › ") || "LV-Position"}
                    </dd>
                  </div>
                  <div className="wide">
                    <dt>Ausführungsbeschreibung</dt>
                    <dd>
                      {executionDescription.length
                        ? executionDescription.join(" ")
                        : "Keine separate Ausführungsbeschreibung extrahiert"}
                    </dd>
                  </div>
                  <div className="wide">
                    <dt>Fabrikat / Typ</dt>
                    <dd>{manufacturerAndType || "Nicht vorgegeben"}</dd>
                  </div>
                </dl>
              </section>

              {requirements.technical.length ? (
                <section className="lv-requirement-section">
                  <h4>Technische Anforderungen</h4>
                  <div className="lv-technical-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Eigenschaft</th>
                          <th>Anforderung</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTechnical.map((attribute) => (
                          <tr key={`${attribute.name}:${attribute.value}`}>
                            <th scope="row">{attribute.name}</th>
                            <td>{attribute.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {requirements.technical.length > 12 ? (
                    <button
                      className="button button-secondary lv-show-more"
                      type="button"
                      onClick={() => setAllTechnicalVisible((value) => !value)}
                    >
                      {allTechnicalVisible
                        ? "Weniger anzeigen"
                        : `Alle ${requirements.technical.length} Anforderungen anzeigen`}
                    </button>
                  ) : null}
                </section>
              ) : null}

              {installationRequirements.length ? (
                <section className="lv-requirement-section">
                  <h4>Montage- und Ausführungsanforderungen</h4>
                  <ul className="lv-installation-list">
                    {installationRequirements.map((requirement) => (
                      <li key={requirement}>{requirement}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {requirements.additional.length ? (
                <section className="lv-requirement-section">
                  <h4>Weitere Anforderungen</h4>
                  <ul>
                    {requirements.additional.map((requirement) => (
                      <li key={`${requirement.name}:${requirement.value}`}>
                        <strong>{requirement.name}</strong> {requirement.value}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <details className="lv-original-text">
                <summary>Originaltext anzeigen</summary>
                <pre data-raw-extraction-text>{position.basis.description}</pre>
              </details>
            </section>
          ) : null}

          {tab === "offers" ? (
            <section className="lv-offers" data-inspector-offers>
              {realOptions.map((option) => (
                <SupplierOptionPanel
                  key={option.id}
                  option={option}
                  model={optionModels.get(option.id)!}
                  lines={option.matchedOfferLineIds
                    .map((lineId) => offerLines.get(lineId))
                    .filter((line): line is OfferLine => Boolean(line))}
                  selected={draft.selectedOptionId === option.id}
                  selectedLineIds={draft.selectedLineIds}
                  onSelect={() => chooseOption(option)}
                  onToggleLine={toggleLine}
                  onOpenSource={(line) => onOpenSupplierSource(option, line)}
                />
              ))}
              {unavailableOptions.length ? (
                <section className="lv-inspector-unavailable">
                  <h3>Nicht zugeordnete Lieferanten</h3>
                  {unavailableOptions.map((option) => (
                    <article key={option.id}>
                      <BrandMark
                        resolution={optionModels.get(option.id)!.supplierBrand}
                        label={option.supplierLabel}
                        compact
                      />
                      <div>
                        <span>Keine passende Angebotsposition gefunden</span>
                        <em>{unavailableSupplierStatus(option)}</em>
                      </div>
                      <details>
                        <summary>Info</summary>
                        <p>
                          Für diese Basis-Position ist keine auswählbare
                          Angebotsposition dieses Lieferanten bestätigt.
                        </p>
                      </details>
                      {optionModels.get(option.id)?.sourceAvailable ? (
                        <button
                          className="button button-secondary"
                          onClick={() => onOpenSupplierSource(option)}
                        >
                          <ExternalLink size={14} /> Quelle
                        </button>
                      ) : null}
                    </article>
                  ))}
                </section>
              ) : null}
            </section>
          ) : null}

          {tab === "scope" ? (
            <section className="lv-scope-tab" data-inspector-scope>
              <div className="lv-source-heading">
                <div>
                  <span>Strukturinterpretation · {basisStructure.version}</span>
                  <h3>Lieferumfang und Komponentenauswahl</h3>
                </div>
                <strong>{basisStructure.type}</strong>
              </div>
              <p className="lv-selection-mode-note">
                {positionSelectionMode === "COMPLETE_OPTION_SELECTION"
                  ? "Ein vollständiges Angebot kann als Einheit ausgewählt werden."
                  : positionSelectionMode === "MULTI_LINE_SELECTION"
                    ? "Die Angebotszeilen bilden gemeinsam den Lieferumfang."
                    : positionSelectionMode === "MIXED_SUPPLIER_SELECTION"
                      ? "Kein vollständiges Paket ist bestätigt. Komponenten müssen einzeln geprüft werden; eine automatische lieferantenübergreifende Kombination findet nicht statt."
                      : "Nur ein Teil des erkannten Lieferumfangs ist abgedeckt."}
              </p>
              <section className="lv-inspector-section">
                <h4>Erkannte Basis-Pflichtbestandteile</h4>
                <div className="lv-scope-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Bestandteil</th>
                        <th>Typ</th>
                        <th>Abdeckung im fokussierten Angebot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {basisStructure.requiredComponents.map(
                        (requirement, index) => {
                          const covered =
                            (focusedModel?.coveredRequiredComponentCount ?? 0) >
                            index;
                          return (
                            <tr key={`${requirement.category}:${requirement.code}`}>
                              <td>{requirement.label}</td>
                              <td>{requirement.category}</td>
                              <td>
                                {covered
                                  ? "Abgedeckt"
                                  : focusedModel
                                    ? "Nicht bestätigt"
                                    : "Kein Angebot fokussiert"}
                              </td>
                            </tr>
                          );
                        }
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="lv-inspector-section">
                <h4>Angebotszeilen</h4>
                {realOptions.map((option) => {
                  const model = optionModels.get(option.id)!;
                  const lines = option.matchedOfferLineIds
                    .map((lineId) => offerLines.get(lineId))
                    .filter((line): line is OfferLine => Boolean(line));
                  const active = draft.selectedOptionId === option.id;
                  return (
                    <article
                      className={`lv-scope-option ${active ? "selected" : ""}`}
                      key={option.id}
                    >
                      <header>
                        <BrandMark
                          resolution={model.supplierBrand}
                          label={model.supplierDisplayName}
                          compact
                        />
                        <span>{model.packageCompletenessLabelDe}</span>
                        <strong>{formatCurrency(model.price.total)}</strong>
                      </header>
                      {model.partialSelectionWarningDe ? (
                        <p className="lv-partial-selection-warning">
                          {model.partialSelectionWarningDe}
                        </p>
                      ) : null}
                      <div className="lv-scope-lines">
                        {lines.map((line) => (
                          <label key={line.id}>
                            <input
                              type="checkbox"
                              checked={
                                active && draft.selectedLineIds.includes(line.id)
                              }
                              onChange={() => {
                                if (!active) {
                                  chooseOptionLines(option, [line.id]);
                                } else {
                                  toggleLine(line.id);
                                }
                              }}
                            />
                            <span>
                              <strong>
                                {supplierDisplayRoleLabel(
                                  supplierDisplayRole(line, lines)
                                )}
                              </strong>
                              {line.description}
                            </span>
                            <small>
                              {line.articleNumber ?? "Artikel —"} ·{" "}
                              {formatCurrency(line.interpretedTotalPrice)}
                            </small>
                          </label>
                        ))}
                      </div>
                      <div className="lv-scope-actions">
                        <button
                          className="button button-primary"
                          onClick={() => chooseOption(option)}
                        >
                          Gesamtes Paket auswählen
                        </button>
                        <button
                          className="button button-secondary"
                          onClick={() => chooseOptionLines(option, [])}
                        >
                          Komponenten einzeln auswählen
                        </button>
                      </div>
                    </article>
                  );
                })}
                <button
                  className="button button-secondary"
                  onClick={resetOptionSelection}
                >
                  Auswahl zurücksetzen
                </button>
                {selectedOption && draft.selectedLineIds.length > 0 ? (
                  <div className="lv-scope-decision">
                    <h4>Ausgewählten Lieferumfang bestätigen</h4>
                    <DecisionForm
                      position={position}
                      draft={draft}
                      isAutomatic={automatic}
                      pending={pending}
                      error={error}
                      saved={sync.saveState === "saved"}
                      saveState={sync.saveState}
                      author={
                        sync.serverDraft?.updatedByDisplayName ??
                        identity.user?.displayName ??
                        null
                      }
                      updatedAt={sync.serverDraft?.updatedAt ?? null}
                      version={sync.serverDraft?.version ?? null}
                      onDraft={updateDraft}
                      onSubmit={submit}
                      onOpenBasisSource={onOpenBasisSource}
                      onOpenSupplierSource={() =>
                        onOpenSupplierSource(selectedOption)
                      }
                    />
                  </div>
                ) : null}
              </section>
            </section>
          ) : null}

          {tab === "information" ? (
            <section className="lv-information-tab" data-inspector-information>
              <div className="lv-source-heading">
                <h3>Informationen</h3>
                {focusedOption ? (
                  <button onClick={() => onOpenSupplierSource(focusedOption)}>
                    <ExternalLink size={15} /> Zur Quelle
                  </button>
                ) : null}
              </div>
              {focusedOption ? (
                <div className="lv-full-information visible">
                  <section>
                    <h4>Basis-Anforderung</h4>
                    <p>{position.basis.description}</p>
                    <small>
                      {formatNumber(position.basis.quantity)}{" "}
                      {position.basis.unit ?? ""} ·{" "}
                      {position.basis.hierarchyPath?.join(" › ") ||
                        "LV-Position"}
                    </small>
                  </section>
                  <section>
                    <h4>Angebotsdaten</h4>
                    <dl className="lv-overview-grid">
                      <div>
                        <dt>Lieferant</dt>
                        <dd>{focusedOption.supplierLabel}</dd>
                      </div>
                      <div>
                        <dt>Supplier-Position</dt>
                        <dd>
                          {focusedPrimary?.supplierPositionNumber ??
                            focusedPrimary?.sourcePositionNumber ??
                            "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Hersteller</dt>
                        <dd>{focusedPrimary?.manufacturer ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Artikel</dt>
                        <dd>{focusedPrimary?.articleNumber ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>EP</dt>
                        <dd>
                          {formatCurrency(
                            focusedPrimary?.interpretedUnitPrice ?? null
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>GP</dt>
                        <dd>
                          {formatCurrency(focusedPrice?.total ?? null)}
                        </dd>
                      </div>
                    </dl>
                  </section>
                  <section>
                    <h4>Lieferumfang</h4>
                    {focusedLines.map((line) => (
                      <p key={line.id}>
                        <strong>
                          {supplierDisplayRoleLabel(
                            supplierDisplayRole(line, focusedLines)
                          )}
                          :
                        </strong>{" "}
                        {line.description}
                      </p>
                    ))}
                    {focusedOption.missingComponents.length ? (
                      <p>
                        <strong>Fehlende Pflichtbestandteile:</strong>{" "}
                        {focusedOption.missingComponents.join(", ")}
                      </p>
                    ) : null}
                  </section>
                  <section>
                    <h4>Technische Eigenschaften</h4>
                    {focusedWarnings.length ? (
                      <div className="lv-warning-groups">
                        {focusedWarnings.map((warning) => (
                          <div key={warning.label}>
                            <span>{warning.label}</span>
                            <strong>{warningSummary(warning.label)}</strong>
                            <small>{warning.count} Prüfpunkte anzeigen</small>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>Keine offenen Warnungen.</p>
                    )}
                    {focusedOption.reasons.length ? (
                      <details>
                        <summary>
                          Alle {focusedOption.reasons.length} Hinweise anzeigen
                        </summary>
                        <ul>
                          {Array.from(new Set(focusedOption.reasons)).map(
                            (reason) => (
                              <li key={reason}>{reason}</li>
                            )
                          )}
                        </ul>
                      </details>
                    ) : null}
                  </section>
                  <details className="lv-original-text">
                    <summary>Originaltext anzeigen</summary>
                    <pre>
                      {position.basis.description}
                      {"\n\n"}
                      {focusedLines
                        .map((line) => line.description)
                        .join("\n")}
                    </pre>
                  </details>
                </div>
              ) : (
                <p>Keine Supplier-Option verfügbar.</p>
              )}
              <details className="lv-selection-history" data-decision-history>
                <summary>Auswahlverlauf anzeigen</summary>
                <div className="lv-history">
                  {systemOptionId ? (
                    <article>
                      <History size={18} />
                      <div>
                        <strong>Ursprüngliche automatische Empfehlung</strong>
                        <p>
                          {position.options.find(
                            (option) => option.id === systemOptionId
                          )?.supplierLabel ?? "—"}
                        </p>
                      </div>
                    </article>
                  ) : null}
                  {history.central.map((decision: CentralSupplierDecision) => (
                    <article key={decision.id}>
                      <History size={18} />
                      <div>
                        <strong>
                          {decision.outcome} · Version {decision.decisionVersion}
                        </strong>
                        <p>{decision.comment || "Ohne Kommentar"}</p>
                        <small>
                          {decision.decidedByDisplayName} ·{" "}
                          {new Date(decision.decidedAt).toLocaleString("de-DE")}
                        </small>
                      </div>
                    </article>
                  ))}
                  {history.legacy.map((decision) => (
                    <article key={decision.id}>
                      <History size={18} />
                      <div>
                        <strong>{decision.status}</strong>
                        <p>{decision.comment || "Ohne Kommentar"}</p>
                        <small>
                          {decisionActor(decision)} ·{" "}
                          {new Date(decisionTimestamp(decision)).toLocaleString(
                            "de-DE"
                          )}
                        </small>
                      </div>
                    </article>
                  ))}
                  {!systemOptionId &&
                  history.legacy.length === 0 &&
                  history.central.length === 0 ? (
                    <p>Noch keine Auswahl gespeichert.</p>
                  ) : null}
                </div>
              </details>
            </section>
          ) : null}

          {tab === "source" ? (
            <section className="lv-source-tab" data-inspector-source>
              <h3>Quelle</h3>
              <p>
                Öffnen Sie den Dokumentkontext oder direkt die markierte
                Belegstelle.
              </p>
              <div className="lv-overview-actions">
                <button
                  className="button button-secondary"
                  onClick={onOpenBasisSource}
                >
                  <ExternalLink size={15} /> Basis-Quelle
                </button>
                {focusedOption ? (
                  <button
                    className="button button-primary"
                    onClick={() => onOpenSupplierSource(focusedOption)}
                  >
                    <ExternalLink size={15} /> Supplier-Quelle
                  </button>
                ) : (
                  <span>Keine Supplier-Quelle verfügbar</span>
                )}
              </div>
              <dl className="lv-overview-grid">
                <div>
                  <dt>Basis Evidence</dt>
                  <dd>
                    {position.basis.evidence.length
                      ? `${position.basis.evidence.length} Belegstelle(n)`
                      : "Nicht verfügbar"}
                  </dd>
                </div>
                <div>
                  <dt>Supplier Evidence</dt>
                  <dd>
                    {focusedOption?.evidenceIds.length
                      ? `${focusedOption.evidenceIds.length} Belegstelle(n)`
                      : "Nicht verfügbar"}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}

          {tab === "decision" ? (
            <section className="lv-decision-tab">
              <div className="lv-decision-summary">
                <h3>{liveStatusLabel(position)}</h3>
                <p>{userReason(position)}</p>
                {systemOptionId ? (
                  <p>
                    Automatische Empfehlung:{" "}
                    <strong>
                      {position.options.find((option) => option.id === systemOptionId)
                        ?.supplierLabel ?? "—"}
                    </strong>
                  </p>
                ) : null}
              </div>
              {sync.recoveryCandidate ? (
                <div className="lv-decision-sync-notice">
                  <strong>Neuere lokale Wiederherstellung gefunden.</strong>
                  <button type="button" onClick={sync.restoreRecovery}>
                    Lokale Eingabe wiederherstellen
                  </button>
                  <button type="button" onClick={sync.dismissRecovery}>
                    Server-Version verwenden
                  </button>
                </div>
              ) : null}
              {sync.conflictRecord ? (
                <div className="lv-decision-sync-notice" role="alert">
                  <strong>
                    Diese Position wurde auf einem anderen Gerät geändert.
                  </strong>
                  <button type="button" onClick={sync.useLatestServerVersion}>
                    Neueste Version laden
                  </button>
                  <button type="button" onClick={sync.keepLocalInput}>
                    Meine Eingabe lokal behalten
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      sync.setCompareVisible((visible) => !visible)
                    }
                  >
                    Änderungen vergleichen
                  </button>
                  {sync.compareVisible ? (
                    <p>
                      Die lokale Eingabe steht im Formular. Die neue
                      Server-Version stammt von{" "}
                      {sync.conflictRecord.updatedByDisplayName} und wurde am{" "}
                      {new Date(
                        sync.conflictRecord.updatedAt
                      ).toLocaleString("de-DE")}{" "}
                      gespeichert.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {automatic ? (
                overrideOpen ? (
                  <p className="lv-override-open-note">
                    Der Änderungsdialog ist geöffnet.
                  </p>
                ) : (
                  <button
                    className="button button-primary"
                    onClick={() => setOverrideOpen(true)}
                  >
                    Automatische Auswahl ändern
                  </button>
                )
              ) : (
                <DecisionForm
                  position={position}
                  draft={draft}
                  isAutomatic={automatic}
                  pending={pending}
                  error={error}
                  saved={sync.saveState === "saved"}
                  saveState={sync.saveState}
                  author={
                    sync.serverDraft?.updatedByDisplayName ??
                    identity.user?.displayName ??
                    null
                  }
                  updatedAt={sync.serverDraft?.updatedAt ?? null}
                  version={sync.serverDraft?.version ?? null}
                  onDraft={updateDraft}
                  onSubmit={submit}
                  onOpenBasisSource={onOpenBasisSource}
                  onOpenSupplierSource={() => {
                    if (selectedOption) onOpenSupplierSource(selectedOption);
                  }}
                />
              )}
            </section>
          ) : null}

          {tab === "history" ? (
            <section className="lv-history" data-decision-history>
              {systemOptionId ? (
                <article>
                  <History size={18} />
                  <div>
                    <strong>Ursprüngliche automatische Empfehlung</strong>
                    <p>
                      {position.options.find((option) => option.id === systemOptionId)
                        ?.supplierLabel ?? "—"}{" "}
                      · {formatCurrency(
                        position.options.find((option) => option.id === systemOptionId)
                          ?.comparableTotal ?? null
                      )}
                    </p>
                  </div>
                </article>
              ) : null}
              {history.central.map((decision: CentralSupplierDecision) => (
                <article key={decision.id}>
                  <History size={18} />
                  <div>
                    <strong>
                      {decision.outcome} · Version {decision.decisionVersion}
                    </strong>
                    <p>{decision.comment || "Ohne Kommentar"}</p>
                    <small>
                      {decision.decidedByDisplayName} ·{" "}
                      {new Date(decision.decidedAt).toLocaleString("de-DE")}
                    </small>
                  </div>
                </article>
              ))}
              {history.legacy.map((decision) => (
                <article key={decision.id}>
                  <History size={18} />
                  <div>
                    <strong>{decision.status}</strong>
                    <p>{decision.comment || "Ohne Kommentar"}</p>
                    <small>
                      {decisionActor(decision)} ·{" "}
                      {new Date(decisionTimestamp(decision)).toLocaleString("de-DE")}
                    </small>
                  </div>
                </article>
              ))}
              {!systemOptionId &&
              history.legacy.length === 0 &&
              history.central.length === 0 ? (
                <p>Noch keine Entscheidung gespeichert.</p>
              ) : null}
            </section>
          ) : null}
        </div>
      </aside>
      {overrideOpen && tab === "decision" ? (
        <div className="automatic-override-dialog" role="dialog" aria-modal="true">
          <header>
            <div>
              <span>Automatische Auswahl ändern</span>
              <strong>{position.basis.positionNumber}</strong>
            </div>
            <button onClick={() => setOverrideOpen(false)} aria-label="Dialog schließen">
              <X size={19} />
            </button>
          </header>
          <div className="automatic-override-options">
            {realOptions.map((option) => (
              <button
                key={option.id}
                className={draft.selectedOptionId === option.id ? "selected" : ""}
                onClick={() => chooseOption(option)}
              >
                <span>{option.supplierLabel}</span>
                <strong>{formatCurrency(option.comparableTotal ?? option.pricedTotal)}</strong>
                <small>{materialScopeLabel(option)}</small>
              </button>
            ))}
          </div>
          <DecisionForm
            position={position}
            draft={draft}
            isAutomatic
            pending={pending}
            error={error}
            saved={sync.saveState === "saved"}
            saveState={sync.saveState}
            author={
              sync.serverDraft?.updatedByDisplayName ??
              identity.user?.displayName ??
              null
            }
            updatedAt={sync.serverDraft?.updatedAt ?? null}
            version={sync.serverDraft?.version ?? null}
            onDraft={updateDraft}
            onSubmit={submit}
            onOpenBasisSource={onOpenBasisSource}
            onOpenSupplierSource={() => {
              if (selectedOption) onOpenSupplierSource(selectedOption);
            }}
          />
        </div>
      ) : null}
      <button className="inspector-return-focus" onClick={onClose}>
        <ArrowLeft size={15} /> Zur Tabelle
      </button>
      <span className="inspector-position-nav" aria-hidden>
        <ArrowRight size={15} />
      </span>
    </div>
  );
}
