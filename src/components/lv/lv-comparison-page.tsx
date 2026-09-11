"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  BasisPosition,
  EvidenceReference,
  OfferLine,
  SupplierOption
} from "@/domain/contracts";
import type { CentralSupplierDecision, DecisionDraftRecord } from "@/domain/central-decision";
import {
  resolveWorkspaceSourceView,
  type ProjectWorkspaceState,
  type WorkspaceSourceState
} from "@/domain/project-workspace";
import type { BrowserMatchReviewRecord } from "@/browser-projects/types";
import type { BrowserManualCorrectionCommand } from "@/browser-projects/manual-corrections";
import { useDecisionIdentity } from "@/components/decision-identity";
import type { ProjectReviewPosition } from "@/domain/project-review";
import { cheapestFoundOption, latestPositionDecision } from "./lv-comparison-table";
import { LvPositionList } from "./lv-position-list";
import { LvPageHeader } from "./lv-page-header";
import { LvToolbar, type LvPositionFilter, type LvSortMode } from "./lv-toolbar";
import { PositionDetailsPane, type DetailsPaneTab } from "./position-details-pane";
import { SourceOverlay } from "./source-overlay";
import { previewOptionAfterSourceChange } from "./workspace-layout";
import { buildLvWarnings, type LvWarning } from "./warning-center";
import { shortDescription, supplierBucket } from "./format";
import { supplierDisplayRole } from "@/domain/supplier-option-read-model";
import { buildOperatorSupplierOptionReadModel } from "@/domain/operator-supplier-option-read-model";
import type { PilotStateView, SourceOpenContext, SourceRecord } from "./types";
import type { SourceViewState } from "./source-overlay";
import { isAbortError } from "./async-lifecycle";
import { paginateGroupedPositions } from "./grouped-pagination";
import {
  ManualPositionEditor,
  type ManualPositionEditorInitialValues,
  type ManualPositionEditorKind,
  type ManualPositionEditorValue
} from "./manual-position-editor";

function compareLv(left: ProjectReviewPosition, right: ProjectReviewPosition): number {
  const a = left.basis.positionNumber.match(/\d+/g)?.map(Number) ?? [];
  const b = right.basis.positionNumber.match(/\d+/g)?.map(Number) ?? [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.basis.positionNumber.localeCompare(right.basis.positionNumber, "de");
}

function priceDifference(position: ProjectReviewPosition): number {
  const prices = position.options
    .map((option) => option.comparableTotal)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  return prices.length > 1 ? prices.at(-1)! - prices[0] : 0;
}

function sectionFor(position: ProjectReviewPosition): { id: string; title: string } {
  const major = position.basis.positionNumber.match(/^\d+(?:\.\d+)?/)?.[0] ?? "LV";
  const hierarchy = position.basis.hierarchyPath?.find(
    (entry) => entry.trim() && !entry.includes(position.basis.positionNumber)
  );
  return {
    id: major,
    title: hierarchy ? `${major} · ${shortDescription(hierarchy, 90)}` : `${major} · LV-Positionen`
  };
}

function contextFor(positions: ProjectReviewPosition[], active: ProjectReviewPosition) {
  const index = positions.findIndex((position) => position.basis.id === active.basis.id);
  return positions.slice(Math.max(0, index - 1), index + 2).map((position) => ({
    key: position.basis.id,
    label: `${position.basis.positionNumber} · ${shortDescription(
      position.basis.description,
      100
    )}`,
    active: position.basis.id === active.basis.id
  }));
}

function groupEvidenceByPage(evidence: EvidenceReference[]) {
  const groups = new Map<number, EvidenceReference[]>();
  for (const item of evidence) {
    groups.set(item.pageNumber, [...(groups.get(item.pageNumber) ?? []), item]);
  }
  return [...groups.entries()].sort(([left], [right]) => left - right);
}

export function sourceRecordsFor(
  pilot: PilotStateView,
  position: ProjectReviewPosition,
  offerLines: Map<string, OfferLine>,
  documentUrls: Readonly<Record<string, string>> = {}
): SourceRecord[] {
  const allPositions = pilot.projectReview.positions;
  const context = contextFor(allPositions, position);
  const records: SourceRecord[] = [];
  const basisRevision = pilot.documentRevisions[position.basis.documentId];
  const basisRun = pilot.runs.find((run) => run.document.id === position.basis.documentId);
  const basisEvidence = [
    ...position.basis.evidence,
    ...(position.basis.continuationEvidence ?? [])
  ];
  if (basisRevision && basisRun) {
    for (const [pageNumber, evidence] of groupEvidenceByPage(basisEvidence)) {
      records.push({
        key: `basis:${pageNumber}:${evidence.map((item) => item.id).join(":")}`,
        kind: "basis",
        tabLabel: "Basis",
        documentId: position.basis.documentId,
        documentRevisionId: basisRevision,
        documentLabel: basisRun.document.relativePath,
        pdfUrl: documentUrls[position.basis.documentId],
        pageNumber,
        pageCount: basisRun.document.pageCount,
        evidence,
        positionNumber: position.basis.positionNumber,
        title: position.basis.positionNumber,
        description: position.basis.description,
        quantity: position.basis.quantity,
        unit: position.basis.unit,
        context
      });
    }
  }
  for (const option of position.options) {
    const metadata = pilot.projectReview.coverage.relevantSupplierDocuments.find(
      (document) => document.id === option.supplierDocumentId
    );
    const revision = pilot.documentRevisions[option.supplierDocumentId];
    const run = pilot.runs.find((candidate) => candidate.document.id === option.supplierDocumentId);
    if (!revision || !run) continue;
    for (const lineId of option.matchedOfferLineIds) {
      const line = offerLines.get(lineId);
      if (!line) continue;
      for (const [pageNumber, evidence] of groupEvidenceByPage(line.evidence)) {
        records.push({
          key: `supplier:${option.id}:${line.id}:${pageNumber}:${evidence
            .map((item) => item.id)
            .join(":")}`,
          kind: "supplier",
          tabLabel: supplierBucket(option.supplierLabel),
          documentId: option.supplierDocumentId,
          documentRevisionId: revision,
          documentLabel: run.document.relativePath,
          pdfUrl: documentUrls[option.supplierDocumentId],
          pageNumber,
          pageCount: run.document.pageCount,
          evidence,
          positionNumber: position.basis.positionNumber,
          title: line.supplierPositionNumber ?? line.sourcePositionNumber ?? lineRoleTitle(line),
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          supplier: metadata?.supplier ?? option.supplierLabel,
          offerNumber: metadata?.offerNumber,
          revision: metadata?.revision,
          date: metadata?.date,
          lineId: line.id,
          supplierOptionId: option.id,
          lineRole: line.role,
          displayRole: supplierDisplayRole(
            line,
            option.matchedOfferLineIds
              .map((candidateId) => offerLines.get(candidateId))
              .filter((candidate): candidate is OfferLine => Boolean(candidate))
          ),
          supplierPositionNumber: line.supplierPositionNumber,
          articleNumber: line.articleNumber,
          manufacturer: line.manufacturer,
          unitPrice: line.interpretedUnitPrice,
          totalPrice: line.interpretedTotalPrice,
          includedInBundle: option.matchedOfferLineIds.includes(line.id),
          context
        });
      }
    }
  }
  return records;
}

function lineRoleTitle(line: OfferLine): string {
  return line.role === "PRIMARY" ? "Hauptposition" : "Angebotszeile";
}

function optionSourceKey(
  records: SourceRecord[],
  option: SupplierOption,
  line?: OfferLine
): string | null {
  return (
    records.find(
      (record) =>
        record.kind === "supplier" &&
        (line
          ? record.lineId === line.id
          : option.matchedOfferLineIds.includes(record.lineId ?? ""))
    )?.key ?? null
  );
}

export type ExistingManualCorrectionEditorState = {
  kind: ManualPositionEditorKind;
  entityId: string;
  evidenceId?: string;
  initialValues: ManualPositionEditorInitialValues;
};

function correctionRegion(evidence: EvidenceReference | undefined) {
  if (!evidence || evidence.region.width <= 0 || evidence.region.height <= 0) {
    return null;
  }
  return { ...evidence.region };
}

function manualDisplayLabel(
  labels: Readonly<Record<string, string>> | undefined,
  kind: ManualPositionEditorKind,
  entityId: string,
  fallback: string
): string {
  return labels?.[`${kind}:${entityId}`] ?? shortDescription(fallback, 120);
}

export function buildBasisCorrectionEditorState(
  basis: BasisPosition,
  labels?: Readonly<Record<string, string>>
): ExistingManualCorrectionEditorState {
  const evidence = [...basis.evidence, ...(basis.continuationEvidence ?? [])][0];
  return {
    kind: "BASIS_POSITION",
    entityId: basis.id,
    ...(evidence ? { evidenceId: evidence.id } : {}),
    initialValues: {
      positionNumber: basis.positionNumber,
      shortDescription: manualDisplayLabel(labels, "BASIS_POSITION", basis.id, basis.description),
      description: basis.description,
      articleNumber: null,
      quantity: basis.quantity,
      unit: basis.unit,
      unitPrice: null,
      totalPrice: null,
      pageNumber: evidence?.pageNumber ?? 1,
      region: correctionRegion(evidence)
    }
  };
}

export function buildSupplierCorrectionEditorState(
  line: OfferLine,
  basisPositionNumber: string,
  labels?: Readonly<Record<string, string>>
): ExistingManualCorrectionEditorState {
  const evidence = line.evidence[0];
  return {
    kind: "SUPPLIER_LINE",
    entityId: line.id,
    ...(evidence ? { evidenceId: evidence.id } : {}),
    initialValues: {
      positionNumber:
        line.sourcePositionNumber ?? line.supplierPositionNumber ?? basisPositionNumber,
      shortDescription: manualDisplayLabel(labels, "SUPPLIER_LINE", line.id, line.description),
      description: line.description,
      articleNumber: line.articleNumber,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.interpretedUnitPrice,
      totalPrice: line.interpretedTotalPrice,
      pageNumber: evidence?.pageNumber ?? 1,
      region: correctionRegion(evidence)
    }
  };
}

export function buildExistingManualCorrectionCommand(
  state: ExistingManualCorrectionEditorState,
  value: ManualPositionEditorValue
): BrowserManualCorrectionCommand {
  if (state.kind !== value.kind || value.mode !== "CORRECT") {
    throw new Error("MANUAL_CORRECTION_EDITOR_STATE_INVALID");
  }
  const sharedPatch = {
    positionNumber: value.positionNumber,
    shortLabel: value.shortDescription,
    description: value.description,
    quantity: value.quantity,
    unit: value.unit,
    source: {
      pageNumber: value.pageNumber,
      region: value.region
    }
  };
  return {
    action: "CORRECT_FIELDS",
    target: {
      kind: state.kind,
      entityId: state.entityId,
      ...(state.evidenceId ? { evidenceId: state.evidenceId } : {})
    },
    patch:
      state.kind === "SUPPLIER_LINE"
        ? {
            ...sharedPatch,
            articleNumber: value.articleNumber,
            unitPrice: value.unitPrice,
            totalPrice: value.totalPrice
          }
        : sharedPatch
  };
}

export function isInitialLvQueryReady({
  requestedPositionNumber,
  requestedSourceLabel,
  requestedPage,
  availablePositionNumbers,
  availableSources
}: {
  requestedPositionNumber: string;
  requestedSourceLabel: string | null;
  requestedPage: number;
  availablePositionNumbers: readonly string[];
  availableSources: ReadonlyArray<{
    positionNumber: string;
    tabLabel: string;
    pageNumber: number;
  }>;
}): boolean {
  if (!availablePositionNumbers.includes(requestedPositionNumber)) return false;
  if (!requestedSourceLabel) return true;
  return availableSources.some(
    (source) =>
      source.positionNumber === requestedPositionNumber &&
      (source.tabLabel === requestedSourceLabel ||
        (requestedSourceLabel === "Angebot" && source.tabLabel !== "Basis")) &&
      (!requestedPage || source.pageNumber === requestedPage)
  );
}

export function resolveTableScrollUpdate(
  current: number,
  incoming: number,
  workspaceLoaded: boolean
): number {
  return workspaceLoaded ? incoming : current;
}

export function shouldAutoScrollActivePosition({
  hasActivePosition,
  restoringWorkspace
}: {
  hasActivePosition: boolean;
  restoringWorkspace: boolean;
}): boolean {
  return hasActivePosition && !restoringWorkspace;
}

export function resolveInitialQueryWorkspaceNavigation({
  requestedPositionId,
  filteredPositionIds,
  visiblePositionIds,
  lvOrderedPositionIds,
  pageSize
}: {
  requestedPositionId: string;
  filteredPositionIds: readonly string[];
  visiblePositionIds: readonly string[];
  lvOrderedPositionIds: readonly string[];
  pageSize: number;
}): { resetFilters: boolean; expandAll: boolean; page: number } {
  const visibleIndex = visiblePositionIds.indexOf(requestedPositionId);
  if (visibleIndex >= 0) {
    return {
      resetFilters: false,
      expandAll: false,
      page: Math.floor(visibleIndex / pageSize) + 1
    };
  }

  const filteredIndex = filteredPositionIds.indexOf(requestedPositionId);
  if (filteredIndex >= 0) {
    return {
      resetFilters: false,
      expandAll: true,
      page: Math.floor(filteredIndex / pageSize) + 1
    };
  }

  const lvIndex = lvOrderedPositionIds.indexOf(requestedPositionId);
  return {
    resetFilters: true,
    expandAll: true,
    page: Math.floor(Math.max(0, lvIndex) / pageSize) + 1
  };
}

export function LvComparisonPage({
  pilot,
  reload,
  browserLocal,
  headerContext
}: {
  pilot: PilotStateView;
  reload: () => Promise<void>;
  headerContext?: {
    name: string;
    leaving: boolean;
    onBack: () => void;
    onDocuments: () => void;
    onAddDocuments: () => void;
    disciplineLabel?: string;
    utilityActions?: ReactNode;
  };
  browserLocal?: {
    decisions: CentralSupplierDecision[];
    documentUrls: Readonly<Record<string, string>>;
    manualDisplayLabels?: Readonly<Record<string, string>>;
    loadWorkspace: () => Promise<ProjectWorkspaceState | null>;
    stageWorkspace?: (state: ProjectWorkspaceState) => void;
    saveWorkspace: (state: ProjectWorkspaceState) => Promise<void>;
    selectSupplierOption: (input: {
      positionId: string;
      optionId: string;
      lineIds: string[];
      comment: string;
    }) => Promise<void>;
    matchReviews: BrowserMatchReviewRecord[];
    reviewMatch: (input: {
      positionId: string;
      matchLinkId: string;
      decision: BrowserMatchReviewRecord["decision"];
    }) => Promise<void>;
    applyManualCorrection: (command: BrowserManualCorrectionCommand) => Promise<void>;
    exportExcel?: () => void;
    exportPdf?: () => void;
  };
}) {
  const identity = useDecisionIdentity();
  const browserDecisions = browserLocal?.decisions;
  const browserDocumentUrls = browserLocal?.documentUrls;
  const manualDisplayLabels = browserLocal?.manualDisplayLabels;
  const browserLoadWorkspace = browserLocal?.loadWorkspace;
  const browserSaveWorkspace = browserLocal?.saveWorkspace;
  const offerLines = useMemo(
    () =>
      new Map(
        pilot.runs.flatMap((run) =>
          run.result.envelope.extraction.offerGroups.flatMap((group) =>
            group.lines.map((line) => [line.id, line] as const)
          )
        )
      ),
    [pilot.runs]
  );
  const supplierSourceDocumentIds = useMemo(
    () =>
      new Set(
        pilot.runs
          .map((run) => run.document.id)
          .filter((documentId) => Boolean(pilot.documentRevisions[documentId]))
      ),
    [pilot.documentRevisions, pilot.runs]
  );
  const summaryFilter = "ALL" as const;
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("ALL");
  const [positionFilter, setPositionFilter] = useState<LvPositionFilter>("ALL");
  const [sort, setSort] = useState<LvSortMode>("LV_ORDER");
  const [pendingMatchLinkId, setPendingMatchLinkId] = useState<string | null>(null);
  const [, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 50 | 100>(20);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedPositionIds, setExpandedPositionIds] = useState<Set<string>>(new Set());
  const [selectedBasisPositionId, setSelectedBasisPositionId] = useState<string | null>(null);
  const [activePositionId, setActivePositionId] = useState<string | null>(null);
  const [activeSupplierOptionId, setActiveSupplierOptionId] = useState<string | null>(null);
  const [detailsPaneTab, setDetailsPaneTab] = useState<DetailsPaneTab>("OFFER_DATA");
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [sourceViews, setSourceViews] = useState<Record<string, WorkspaceSourceState>>({});
  const [fullscreenSourceOpen, setFullscreenSourceOpen] = useState(false);
  const [tableScroll, setTableScroll] = useState(0);
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [manualCorrection, setManualCorrection] =
    useState<ExistingManualCorrectionEditorState | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const [centralDecisions, setCentralDecisions] = useState<CentralSupplierDecision[]>([]);
  const [centralDrafts, setCentralDrafts] = useState<DecisionDraftRecord[]>([]);
  const initialQueryApplied = useRef(false);
  const workspaceVersion = useRef<number | null>(null);
  const restoredActivePositionPending = useRef(false);
  const sourceReturnFocus = useRef<HTMLElement | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const workspaceReady =
    workspaceLoaded || (!browserLoadWorkspace && (!identity.enabled || !identity.user));
  const projectId = pilot.projectReview.projectId ?? "central-server-disabled";

  useEffect(() => {
    if (!browserDecisions) return;
    const timeout = window.setTimeout(() => setCentralDecisions(browserDecisions), 0);
    return () => window.clearTimeout(timeout);
  }, [browserDecisions]);
  const positions = useMemo(
    () =>
      pilot.projectReview.positions.map((position) => {
        const latest = centralDecisions
          .filter((decision) => decision.positionId === position.basis.id)
          .sort((left, right) => left.decisionVersion - right.decisionVersion)
          .at(-1);
        if (!latest) return position;
        return {
          ...position,
          liveStatus:
            latest.outcome === "SELECTED" || latest.outcome === "NONE_CORRECT"
              ? ("MANUAL_DECIDED" as const)
              : ("DEFERRED" as const),
          independent: {
            ...position.independent,
            selectedSupplierOptionId:
              latest.outcome === "SELECTED" ? latest.selectedSupplierOptionId : null
          }
        };
      }),
    [centralDecisions, pilot.projectReview.positions]
  );
  const warnings = useMemo(() => {
    const result = buildLvWarnings(positions, offerLines);
    for (const position of positions) {
      const latest = centralDecisions
        .filter((decision) => decision.positionId === position.basis.id)
        .sort((left, right) => left.decisionVersion - right.decisionVersion)
        .at(-1);
      if (latest?.outcome !== "SELECTED") continue;
      const option = position.options.find(
        (candidate) => candidate.id === latest.selectedSupplierOptionId
      );
      if (!option) continue;
      const model = buildOperatorSupplierOptionReadModel({
        basis: position.basis,
        option,
        offerLines
      });
      if (
        model.packageCompleteness === "COMPLETE" &&
        latest.selectedBundleLineIds.length === option.matchedOfferLineIds.length
      ) {
        continue;
      }
      result.push({
        id: `${position.basis.id}:${option.id}:existing-partial-selection`,
        positionId: position.basis.id,
        positionNumber: position.basis.positionNumber,
        supplierOptionId: option.id,
        supplierLabel: model.supplierDisplayName,
        category: "Lieferumfang",
        completeness: model.packageCompletenessLabelDe,
        reason: "Bestehende Auswahl deckt den erkannten Lieferumfang nicht vollständig ab"
      });
    }
    return result;
  }, [centralDecisions, offerLines, positions]);

  const loadCentralDecisions = useCallback(async () => {
    if (browserDecisions) {
      setCentralDecisions(browserDecisions);
      setCentralDrafts([]);
      return;
    }
    if (!identity.enabled || !identity.user) return;
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/decisions`, {
      cache: "no-store",
      credentials: "include"
    });
    if (!response.ok) return;
    const payload = (await response.json()) as {
      decisions: CentralSupplierDecision[];
      drafts: DecisionDraftRecord[];
    };
    setCentralDecisions(payload.decisions);
    setCentralDrafts(payload.drafts);
  }, [browserDecisions, identity.enabled, identity.user, projectId]);

  const applyWorkspace = useCallback((state: ProjectWorkspaceState) => {
    restoredActivePositionPending.current = Boolean(
      state.inspectorOpen && state.selectedBasisPositionId
    );
    setSearch(state.search);
    setSupplier(state.supplierFilter);
    setPositionFilter(state.positionFilter);
    setSort(state.sort as LvSortMode);
    setTableScroll(state.tableScroll);
    setPage(state.page);
    setPageSize(state.pageSize);
    setCollapsed(new Set(state.collapsedSectionIds));
    setExpandedPositionIds(new Set(state.expandedPositionIds));
    setSelectedBasisPositionId(state.selectedBasisPositionId);
    setActiveSupplierOptionId(state.selectedSupplierOptionId);
    setDetailsPaneTab(state.detailsPaneTab);
    setFullscreenSourceOpen(state.fullscreenSourceOpen);
    setWarningOpen(state.warningCenterOpen);
    setActivePositionId(state.inspectorOpen ? state.selectedBasisPositionId : null);
    setSourceKey(state.sourceOverlay?.sourceKey ?? null);
    setSourceViews(() => {
      const views = { ...(state.sourceViews ?? {}) };
      if (state.sourceOverlay && !views[state.sourceOverlay.sourceKey]) {
        views[state.sourceOverlay.sourceKey] = state.sourceOverlay;
      }
      return views;
    });
  }, []);

  useEffect(() => {
    if (browserLoadWorkspace) {
      let cancelled = false;
      void browserLoadWorkspace()
        .then((workspace) => {
          if (!cancelled && workspace) applyWorkspace(workspace);
        })
        .catch((error: unknown) => {
          if (cancelled || isAbortError(error)) return;
          setSelectionError(
            error instanceof Error
              ? error.message
              : "Der Arbeitsbereich konnte nicht geladen werden."
          );
        })
        .finally(() => {
          if (!cancelled) setWorkspaceLoaded(true);
        });
      return () => {
        cancelled = true;
      };
    }
    if (!identity.enabled || !identity.user) return;
    const controller = new AbortController();
    const recoveryKey = `spt.project-workspace.${projectId}`;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace`, {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("WORKSPACE_LOAD_FAILED");
        return (await response.json()) as {
          workspace: {
            state: ProjectWorkspaceState;
            version: number;
          } | null;
        };
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (payload.workspace) {
          workspaceVersion.current = payload.workspace.version;
          applyWorkspace(payload.workspace.state);
          return;
        }
        const recovery = window.localStorage.getItem(recoveryKey);
        if (recovery) {
          applyWorkspace(JSON.parse(recovery) as ProjectWorkspaceState);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        const recovery = window.localStorage.getItem(recoveryKey);
        if (recovery) {
          try {
            applyWorkspace(JSON.parse(recovery) as ProjectWorkspaceState);
            return;
          } catch {
            // A malformed recovery copy is ignored; server state remains primary.
          }
        }
        setSelectionError(
          error instanceof Error ? error.message : "Der Arbeitsbereich konnte nicht geladen werden."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setWorkspaceLoaded(true);
      });
    return () => {
      if (!controller.signal.aborted) controller.abort();
    };
  }, [applyWorkspace, browserLoadWorkspace, identity.enabled, identity.user, projectId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadCentralDecisions();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadCentralDecisions]);

  const searchable = useMemo(
    () =>
      new Map(
        positions.map((position) => [
          position.basis.id,
          [
            position.basis.positionNumber,
            position.basis.description,
            ...position.options.flatMap((option) => [
              ...option.matchedOfferLineIds.flatMap((lineId) => {
                const line = offerLines.get(lineId);
                return line ? [line.description, line.articleNumber ?? ""] : [];
              })
            ])
          ]
            .join(" ")
            .toLocaleLowerCase("de")
        ])
      ),
    [offerLines, positions]
  );
  const filteredSortedPositions = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("de");
    const warningPositionIds = new Set(warnings.map((warning) => warning.positionId));
    const result = positions.filter((position) => {
      if (normalized && !searchable.get(position.basis.id)?.includes(normalized)) {
        return false;
      }
      if (
        supplier !== "ALL" &&
        !position.options.some((option) => supplierBucket(option.supplierLabel) === supplier)
      ) {
        return false;
      }
      const selected = position.liveStatus === "MANUAL_DECIDED";
      if (positionFilter === "SELECTED" && !selected) return false;
      if (positionFilter === "UNSELECTED" && selected) return false;
      if (positionFilter === "WARNINGS" && !warningPositionIds.has(position.basis.id)) {
        return false;
      }
      return true;
    });
    return [...result].sort((left, right) => {
      if (sort === "LV_ORDER") return compareLv(left, right);
      if (sort === "UNRESOLVED_FIRST") {
        const score = (position: ProjectReviewPosition) =>
          position.liveStatus === "MANUAL_DECISION_REQUIRED" ? 0 : 1;
        return score(left) - score(right) || compareLv(left, right);
      }
      if (sort === "AUTOMATIC_FIRST") {
        const score = (position: ProjectReviewPosition) =>
          position.liveStatus === "AUTO_SELECTED_LOWEST_PRICE" ? 0 : 1;
        return score(left) - score(right) || compareLv(left, right);
      }
      if (sort === "PRICE_DIFFERENCE") {
        return priceDifference(right) - priceDifference(left) || compareLv(left, right);
      }
      return left.liveStatus.localeCompare(right.liveStatus, "de") || compareLv(left, right);
    });
  }, [positionFilter, positions, search, searchable, sort, supplier, warnings]);
  const supplierFilters = useMemo(
    () =>
      Array.from(
        new Set(
          positions.flatMap((position) =>
            position.options.map((option) => supplierBucket(option.supplierLabel))
          )
        )
      ).sort((left, right) => left.localeCompare(right, "de")),
    [positions]
  );
  const groupedPagination = useMemo(
    () =>
      paginateGroupedPositions({
        positions: filteredSortedPositions,
        collapsedSectionIds: collapsed,
        page: 1,
        pageSize: Math.max(1, filteredSortedPositions.length),
        groupFor: sectionFor
      }),
    [collapsed, filteredSortedPositions]
  );
  const {
    sections,
    visiblePositions: visible,
    currentPage,
    allSectionIds: sectionIds
  } = groupedPagination;
  const activePosition = positions.find((position) => position.basis.id === activePositionId);
  const selectedPositionCount = positions.filter(
    (position) => position.liveStatus === "MANUAL_DECIDED"
  ).length;
  const warningPositionCount = new Set(warnings.map((warning) => warning.positionId)).size;
  const activeIndex = activePosition
    ? filteredSortedPositions.findIndex((position) => position.basis.id === activePosition.basis.id)
    : -1;
  const nextOpenPosition = useMemo(() => {
    if (!filteredSortedPositions.length) return undefined;
    const activeOrderIndex = activePosition
      ? filteredSortedPositions.findIndex(
          (position) => position.basis.id === activePosition.basis.id
        )
      : -1;
    for (let offset = 1; offset <= filteredSortedPositions.length; offset += 1) {
      const candidate =
        filteredSortedPositions[
          (activeOrderIndex + offset + filteredSortedPositions.length) %
            filteredSortedPositions.length
        ];
      const decision = latestPositionDecision(centralDecisions, candidate.basis.id);
      const decided = decision?.outcome === "SELECTED" || candidate.liveStatus === "MANUAL_DECIDED";
      if (!decided && candidate.basis.id !== activePosition?.basis.id) return candidate;
    }
    return undefined;
  }, [activePosition, centralDecisions, filteredSortedPositions]);
  const sourcePosition = activePosition;
  const sources = useMemo(
    () =>
      sourcePosition
        ? sourceRecordsFor(pilot, sourcePosition, offerLines, browserDocumentUrls)
        : [],
    [browserDocumentUrls, offerLines, pilot, sourcePosition]
  );
  const activeSource = sources.find((source) => source.key === sourceKey);
  const activeWorkspaceSourceView = activeSource
    ? resolveWorkspaceSourceView(sourceViews, {
        sourceKey: activeSource.key,
        documentRevisionId: activeSource.documentRevisionId
      })
    : null;
  const sourceView: SourceViewState | null = activeWorkspaceSourceView
    ? {
        pageNumber: activeWorkspaceSourceView.page,
        zoom: activeWorkspaceSourceView.zoom,
        fitMode: activeWorkspaceSourceView.fitMode,
        scrollLeft: activeWorkspaceSourceView.scrollLeft,
        scrollTop: activeWorkspaceSourceView.scrollTop
      }
    : null;
  const saveActiveSourceView = useCallback(
    (view: SourceViewState) => {
      if (!activeSource) return;
      const next: WorkspaceSourceState = {
        sourceKey: activeSource.key,
        documentRevisionId: activeSource.documentRevisionId,
        page: view.pageNumber,
        zoom: view.zoom,
        fitMode: view.fitMode,
        scrollLeft: view.scrollLeft,
        scrollTop: view.scrollTop
      };
      setSourceViews((current) => {
        const previous = current[activeSource.key];
        if (
          previous &&
          previous.documentRevisionId === next.documentRevisionId &&
          previous.page === next.page &&
          previous.zoom === next.zoom &&
          previous.fitMode === next.fitMode &&
          previous.scrollLeft === next.scrollLeft &&
          previous.scrollTop === next.scrollTop
        ) {
          return current;
        }
        return { ...current, [activeSource.key]: next };
      });
    },
    [activeSource]
  );
  const selectSource = useCallback(
    (key: string) => {
      setSourceKey(key);
      const source = sources.find((record) => record.key === key);
      if (!source || !activePosition) return;
      setActiveSupplierOptionId((current) => previewOptionAfterSourceChange(current, source));
      const url = new URL(window.location.href);
      url.searchParams.set("position", activePosition.basis.positionNumber);
      url.searchParams.set("source", source.tabLabel);
      url.searchParams.set("page", String(source.pageNumber));
      window.history.replaceState({ sptInspector: true }, "", url);
    },
    [activePosition, sources]
  );
  const detailsOption = useMemo(() => {
    if (!activePosition) return undefined;
    const requested = activePosition.options.find((option) => option.id === activeSupplierOptionId);
    if (requested) return requested;
    const decision = latestPositionDecision(centralDecisions, activePosition.basis.id);
    const selected =
      decision?.outcome === "SELECTED"
        ? activePosition.options.find((option) => option.id === decision.selectedSupplierOptionId)
        : undefined;
    return (
      selected ??
      cheapestFoundOption(activePosition, offerLines) ??
      activePosition.options.find(
        (option) =>
          buildOperatorSupplierOptionReadModel({
            basis: activePosition.basis,
            option,
            offerLines
          }).selectable
      ) ??
      activePosition.options.find((option) => option.matchedOfferLineIds.length > 0)
    );
  }, [activePosition, activeSupplierOptionId, centralDecisions, offerLines]);
  const selectedDetailsOptionId = activePosition
    ? (latestPositionDecision(centralDecisions, activePosition.basis.id)
        ?.selectedSupplierOptionId ?? null)
    : null;
  const detailsMatchLink = useMemo(() => {
    if (!detailsOption || !pilot.analysis) return undefined;
    return pilot.analysis.matchLinks.find((link) => detailsOption.matchLinkIds.includes(link.id));
  }, [detailsOption, pilot.analysis]);
  const detailsMatchReview = detailsMatchLink
    ? browserLocal?.matchReviews.find((review) => review.matchLinkId === detailsMatchLink.id)
    : undefined;

  async function reviewMatch(decision: BrowserMatchReviewRecord["decision"]) {
    if (!browserLocal || !activePosition || !detailsMatchLink || pendingMatchLinkId) {
      return;
    }
    setPendingMatchLinkId(detailsMatchLink.id);
    setSelectionError("");
    try {
      await browserLocal.reviewMatch({
        positionId: activePosition.basis.id,
        matchLinkId: detailsMatchLink.id,
        decision
      });
      await reload();
    } catch (error) {
      setSelectionError(
        error instanceof Error
          ? error.message
          : "Die Zuordnungsprüfung konnte nicht gespeichert werden."
      );
    } finally {
      setPendingMatchLinkId(null);
    }
  }

  function openBasisCorrection() {
    if (!browserLocal || !activePosition) return;
    setSelectionError("");
    setManualCorrection(buildBasisCorrectionEditorState(activePosition.basis, manualDisplayLabels));
  }

  function openSupplierCorrection(line: OfferLine) {
    if (!browserLocal || !activePosition) return;
    setSelectionError("");
    setManualCorrection(
      buildSupplierCorrectionEditorState(
        line,
        activePosition.basis.positionNumber,
        manualDisplayLabels
      )
    );
  }

  async function saveExistingManualCorrection(value: ManualPositionEditorValue) {
    if (!browserLocal || !manualCorrection) {
      throw new Error("Die manuelle Korrektur ist nicht verfügbar.");
    }
    const command = buildExistingManualCorrectionCommand(manualCorrection, value);
    await browserLocal.applyManualCorrection(command);
    setManualCorrection(null);
    setActiveSupplierOptionId(null);
    setSourceKey(null);
    setFullscreenSourceOpen(false);
    try {
      await reload();
    } catch (error) {
      setSelectionError(
        error instanceof Error
          ? `Die Korrektur wurde gespeichert, die Ansicht konnte aber nicht neu geladen werden: ${error.message}`
          : "Die Korrektur wurde gespeichert, die Ansicht konnte aber nicht neu geladen werden."
      );
    }
  }
  const workspaceState = useMemo<ProjectWorkspaceState>(
    () => ({
      discipline: "HEIZUNG",
      section: "lv-vergleich",
      search,
      supplierFilter: supplier,
      positionFilter,
      summaryFilter,
      sort,
      tableScroll,
      page: currentPage,
      pageSize,
      collapsedSectionIds: [...collapsed],
      expandedPositionIds: [...expandedPositionIds],
      selectedBasisPositionId,
      selectedSupplierOptionId: activeSupplierOptionId,
      inspectorOpen: activePositionId !== null,
      inspectorSection: detailsPaneTab === "ORIGINAL_DOCUMENT" ? "source" : "information",
      detailsPaneTab,
      fullscreenSourceOpen,
      warningCenterOpen: warningOpen,
      sourceOverlay:
        sourceKey && activeSource
          ? (sourceViews[sourceKey] ?? {
              sourceKey,
              documentRevisionId: activeSource.documentRevisionId,
              page: activeSource.pageNumber,
              zoom: 1,
              fitMode: "WIDTH",
              scrollLeft: 0,
              scrollTop: 0
            })
          : null,
      sourceViews
    }),
    [
      activePositionId,
      activeSource,
      activeSupplierOptionId,
      collapsed,
      detailsPaneTab,
      expandedPositionIds,
      fullscreenSourceOpen,
      currentPage,
      pageSize,
      positionFilter,
      search,
      selectedBasisPositionId,
      sort,
      sourceKey,
      sourceViews,
      summaryFilter,
      supplier,
      tableScroll,
      warningOpen
    ]
  );

  useLayoutEffect(() => {
    browserLocal?.stageWorkspace?.(workspaceState);
  }, [browserLocal, workspaceState]);

  useEffect(() => {
    if (browserSaveWorkspace) {
      if (!workspaceReady) return;
      let cancelled = false;
      void browserSaveWorkspace(workspaceState).catch((error: unknown) => {
        if (cancelled || isAbortError(error)) return;
        setSelectionError(
          error instanceof Error
            ? error.message
            : "Der Arbeitsbereich konnte nicht gespeichert werden."
        );
      });
      return () => {
        cancelled = true;
      };
    }
    if (
      !workspaceReady ||
      !identity.enabled ||
      !identity.user ||
      projectId === "central-server-disabled"
    ) {
      return;
    }
    const controller = new AbortController();
    const recoveryKey = `spt.project-workspace.${projectId}`;
    window.localStorage.setItem(recoveryKey, JSON.stringify(workspaceState));
    const timeout = window.setTimeout(() => {
      const save = async (expectedVersion: number | null, retry: boolean) => {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace`, {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            state: workspaceState,
            expectedVersion
          }),
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => null)) as {
          workspace?: { version: number };
          currentVersion?: number;
        } | null;
        if (response.status === 409 && retry) {
          await save(payload?.currentVersion ?? 0, false);
          return;
        }
        if (!response.ok) {
          throw new Error("Der Arbeitsbereich konnte nicht gespeichert werden.");
        }
        if (response.ok && payload?.workspace) {
          workspaceVersion.current = payload.workspace.version;
        }
      };
      void save(workspaceVersion.current, true).catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setSelectionError(
          error instanceof Error
            ? error.message
            : "Der Arbeitsbereich konnte nicht gespeichert werden."
        );
      });
    }, 650);
    return () => {
      window.clearTimeout(timeout);
      if (!controller.signal.aborted) controller.abort();
    };
  }, [
    identity.enabled,
    identity.user,
    browserSaveWorkspace,
    projectId,
    workspaceReady,
    workspaceState
  ]);

  const restoreAfterSource = useCallback(() => {
    setFullscreenSourceOpen(false);
    window.requestAnimationFrame(() => sourceReturnFocus.current?.focus());
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (fullscreenSourceOpen) {
        restoreAfterSource();
        return;
      }
      if (activePositionId && !event.state?.sptInspector) {
        setActivePositionId(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [activePositionId, fullscreenSourceOpen, restoreAfterSource]);

  useEffect(() => {
    if (initialQueryApplied.current || !workspaceReady) return;
    const params = new URLSearchParams(window.location.search);
    const positionNumber = params.get("position");
    const sourceTab = params.get("source");
    const requestedPage = Number(params.get("page"));
    if (!positionNumber) {
      initialQueryApplied.current = true;
      return;
    }
    const position = positions.find(
      (candidate) => candidate.basis.positionNumber === positionNumber
    );
    if (!position) return;
    const records = sourceTab
      ? sourceRecordsFor(pilot, position, offerLines, browserDocumentUrls)
      : [];
    if (
      !isInitialLvQueryReady({
        requestedPositionNumber: positionNumber,
        requestedSourceLabel: sourceTab,
        requestedPage,
        availablePositionNumbers: positions.map((candidate) => candidate.basis.positionNumber),
        availableSources: records.map((record) => ({
          positionNumber: record.positionNumber,
          tabLabel: record.tabLabel,
          pageNumber: record.pageNumber
        }))
      })
    ) {
      return;
    }
    initialQueryApplied.current = true;
    if (!sourceTab) {
      const navigation = resolveInitialQueryWorkspaceNavigation({
        requestedPositionId: position.basis.id,
        filteredPositionIds: filteredSortedPositions.map((candidate) => candidate.basis.id),
        visiblePositionIds: visible.map((candidate) => candidate.basis.id),
        lvOrderedPositionIds: [...positions].sort(compareLv).map((candidate) => candidate.basis.id),
        pageSize
      });
      const preserveRestoredListScroll =
        restoredActivePositionPending.current && selectedBasisPositionId === position.basis.id;
      const timeout = window.setTimeout(() => {
        if (navigation.resetFilters) {
          setSearch("");
          setSupplier("ALL");
          setPositionFilter("ALL");
          setSort("LV_ORDER");
        }
        if (navigation.expandAll) setCollapsed(new Set());
        setPage(navigation.page);
        if (!preserveRestoredListScroll) setTableScroll(0);
        setSelectedBasisPositionId(position.basis.id);
        setActivePositionId(position.basis.id);
        setExpandedPositionIds((current) => new Set(current).add(position.basis.id));
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    const source = records.find(
      (record) =>
        (record.tabLabel === sourceTab ||
          (sourceTab === "Angebot" && record.kind === "supplier")) &&
        (!requestedPage || record.pageNumber === requestedPage)
    );
    if (!source) return;
    const navigation = resolveInitialQueryWorkspaceNavigation({
      requestedPositionId: position.basis.id,
      filteredPositionIds: filteredSortedPositions.map((candidate) => candidate.basis.id),
      visiblePositionIds: visible.map((candidate) => candidate.basis.id),
      lvOrderedPositionIds: [...positions].sort(compareLv).map((candidate) => candidate.basis.id),
      pageSize
    });
    const preserveRestoredListScroll =
      restoredActivePositionPending.current && selectedBasisPositionId === position.basis.id;
    const timeout = window.setTimeout(() => {
      if (navigation.resetFilters) {
        setSearch("");
        setSupplier("ALL");
        setPositionFilter("ALL");
        setSort("LV_ORDER");
      }
      if (navigation.expandAll) setCollapsed(new Set());
      setPage(navigation.page);
      if (!preserveRestoredListScroll) setTableScroll(0);
      setSelectedBasisPositionId(position.basis.id);
      setActivePositionId(position.basis.id);
      setSourceKey(source.key);
      setDetailsPaneTab("ORIGINAL_DOCUMENT");
      setExpandedPositionIds((current) => new Set(current).add(position.basis.id));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    browserDocumentUrls,
    filteredSortedPositions,
    offerLines,
    pageSize,
    pilot,
    positions,
    selectedBasisPositionId,
    visible,
    workspaceReady
  ]);

  const openPosition = useCallback(
    (position: ProjectReviewPosition, option?: SupplierOption, requestedTab?: DetailsPaneTab) => {
      const decision = latestPositionDecision(centralDecisions, position.basis.id);
      const selected =
        decision?.outcome === "SELECTED"
          ? position.options.find((candidate) => candidate.id === decision.selectedSupplierOptionId)
          : undefined;
      const resolvedOption =
        option ??
        selected ??
        cheapestFoundOption(position, offerLines) ??
        position.options.find(
          (candidate) =>
            buildOperatorSupplierOptionReadModel({
              basis: position.basis,
              option: candidate,
              offerLines
            }).selectable
        );
      setSelectedBasisPositionId(position.basis.id);
      setActivePositionId(position.basis.id);
      setActiveSupplierOptionId(resolvedOption?.id ?? null);
      const targetTab = requestedTab ?? "ORIGINAL_DOCUMENT";
      setDetailsPaneTab(targetTab);
      setExpandedPositionIds((current) => new Set(current).add(position.basis.id));
      const records = sourceRecordsFor(pilot, position, offerLines, browserDocumentUrls);
      const key = option
        ? optionSourceKey(records, option)
        : records.find((record) => record.kind === "basis")?.key;
      setSourceKey(key ?? null);
      const resolvedSource = records.find((record) => record.key === key);
      const url = new URL(window.location.href);
      url.searchParams.set("position", position.basis.positionNumber);
      if (resolvedSource) {
        url.searchParams.set("source", resolvedSource.tabLabel);
        url.searchParams.set("page", String(resolvedSource.pageNumber));
      } else {
        url.searchParams.delete("source");
        url.searchParams.delete("page");
      }
      window.history.replaceState({ sptInspector: true }, "", url);
    },
    [browserDocumentUrls, centralDecisions, offerLines, pilot]
  );

  useEffect(() => {
    if (!workspaceReady || !activePositionId) return;
    if (filteredSortedPositions.some((position) => position.basis.id === activePositionId)) {
      return;
    }
    const replacement = filteredSortedPositions[0];
    const timeout = window.setTimeout(() => {
      if (replacement) {
        openPosition(replacement);
        return;
      }
      setActivePositionId(null);
      setSelectedBasisPositionId(null);
      setActiveSupplierOptionId(null);
      setSourceKey(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [activePositionId, filteredSortedPositions, openPosition, workspaceReady]);

  const togglePosition = useCallback(
    (position: ProjectReviewPosition) => {
      if (!expandedPositionIds.has(position.basis.id)) {
        openPosition(position);
        return;
      }
      openPosition(position);
      setExpandedPositionIds((current) => {
        const next = new Set(current);
        next.delete(position.basis.id);
        return next;
      });
    },
    [expandedPositionIds, openPosition]
  );

  useEffect(() => {
    const restoringWorkspace = restoredActivePositionPending.current;
    restoredActivePositionPending.current = false;
    if (
      !activePosition ||
      !shouldAutoScrollActivePosition({
        hasActivePosition: true,
        restoringWorkspace
      })
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const selector = `[data-lv-position="${CSS.escape(activePosition.basis.positionNumber)}"]`;
      document.querySelector<HTMLElement>(selector)?.scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePosition]);

  function openSource(
    position: ProjectReviewPosition,
    requestedKey: string | null | undefined,
    context: SourceOpenContext
  ) {
    sourceReturnFocus.current = document.activeElement as HTMLElement | null;
    setSelectedBasisPositionId(position.basis.id);
    setActivePositionId(position.basis.id);
    setExpandedPositionIds((current) => new Set(current).add(position.basis.id));
    const records = sourceRecordsFor(pilot, position, offerLines, browserDocumentUrls);
    const key = requestedKey ?? records[0]?.key;
    if (!key) return;
    setSourceKey(key);
    const source = records.find((record) => record.key === key);
    const url = new URL(window.location.href);
    url.searchParams.set("position", position.basis.positionNumber);
    url.searchParams.set("source", source?.tabLabel ?? "Basis");
    url.searchParams.set("page", String(source?.pageNumber ?? 1));
    window.history.replaceState({ sptInspector: true, sourceOpenContext: context }, "", url);
  }

  function closeSource() {
    restoreAfterSource();
  }

  function openBasis(position: ProjectReviewPosition, context: SourceOpenContext) {
    const records = sourceRecordsFor(pilot, position, offerLines, browserDocumentUrls);
    openSource(position, records.find((record) => record.kind === "basis")?.key, context);
  }

  function openSupplier(
    position: ProjectReviewPosition,
    option: SupplierOption,
    line: OfferLine | undefined,
    context: SourceOpenContext
  ) {
    setActiveSupplierOptionId(option.id);
    const records = sourceRecordsFor(pilot, position, offerLines, browserDocumentUrls);
    openSource(position, optionSourceKey(records, option, line), context);
  }

  function navigate(delta: number) {
    if (activeIndex < 0 || !filteredSortedPositions.length) return;
    const nextIndex =
      (activeIndex + delta + filteredSortedPositions.length) % filteredSortedPositions.length;
    const next = filteredSortedPositions[nextIndex];
    openPosition(next);
  }

  function navigateToNextOpen() {
    if (nextOpenPosition) openPosition(nextOpenPosition);
  }

  async function selectSupplierOption(
    position: ProjectReviewPosition,
    option: SupplierOption,
    comment = ""
  ) {
    if ((!browserLocal && !identity.user) || pendingOptionId) return;
    const sourceRecords = sourceRecordsFor(pilot, position, offerLines, browserDocumentUrls);
    if (!optionSourceKey(sourceRecords, option)) {
      setSelectionError(
        "Dieses Angebot kann nicht ausgewählt werden: Eine genaue Angebotsquelle fehlt."
      );
      return;
    }
    setActiveSupplierOptionId(option.id);
    openSource(position, optionSourceKey(sourceRecords, option), "TABLE_SUPPLIER_SOURCE");
    setPendingOptionId(option.id);
    setSelectionError("");
    try {
      if (browserLocal) {
        await browserLocal.selectSupplierOption({
          positionId: position.basis.id,
          optionId: option.id,
          lineIds: option.matchedOfferLineIds,
          comment
        });
        setSelectedBasisPositionId(position.basis.id);
        setActivePositionId(position.basis.id);
        setActiveSupplierOptionId(option.id);
        setExpandedPositionIds((current) => new Set(current).add(position.basis.id));
        await reload();
        return;
      }
      const latest = centralDecisions
        .filter((decision) => decision.positionId === position.basis.id)
        .sort((left, right) => left.decisionVersion - right.decisionVersion)
        .at(-1);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(
          projectId
        )}/positions/${encodeURIComponent(position.basis.id)}/decisions`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            selectedSupplierOptionId: option.id,
            selectedBundleLineIds: option.matchedOfferLineIds,
            rejectedOptionIds: [],
            outcome: "SELECTED",
            reasonCodes: [],
            comment,
            analysisVersionId: pilot.projectReview.analysisVersionId ?? "central-server-disabled",
            expectedDecisionVersion: latest?.decisionVersion ?? 0,
            decisionType: "MANUAL_SELECTION"
          })
        }
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        details?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(
          [payload?.error, payload?.details].filter(Boolean).map(String).join(" · ") ||
            "Auswahl konnte nicht gespeichert werden."
        );
      }
      setSelectedBasisPositionId(position.basis.id);
      setActivePositionId(position.basis.id);
      setActiveSupplierOptionId(option.id);
      if (detailsPaneTab === "ORIGINAL_DOCUMENT") {
        const key = optionSourceKey(sourceRecords, option);
        setSourceKey(key);
      }
      setExpandedPositionIds((current) => new Set(current).add(position.basis.id));
      await Promise.all([loadCentralDecisions(), reload()]);
    } catch (selectError) {
      setSelectionError(
        selectError instanceof Error
          ? selectError.message
          : "Auswahl konnte nicht gespeichert werden."
      );
    } finally {
      setPendingOptionId(null);
    }
  }

  function openWarning(warning: LvWarning) {
    const position = positions.find((candidate) => candidate.basis.id === warning.positionId);
    if (!position) return;
    const option = warning.supplierOptionId
      ? position.options.find((candidate) => candidate.id === warning.supplierOptionId)
      : undefined;
    setWarningOpen(false);
    openPosition(position, option, "OFFER_DATA");
  }

  return (
    <div
      className="lv-workspace lv-workspace--quiet"
      data-real-lv-workspace
      data-lv-design="v2"
    >
      <LvPageHeader
        warnings={warnings}
        warningOpen={warningOpen}
        onToggleWarnings={() => setWarningOpen((value) => !value)}
        onSelectWarning={openWarning}
        onExportExcel={browserLocal?.exportExcel}
        onExportPdf={browserLocal?.exportPdf}
        selectedCount={selectedPositionCount}
        totalCount={positions.length}
        projectContext={headerContext}
        disciplineLabel={headerContext?.disciplineLabel}
        utilityActions={headerContext?.utilityActions}
      />
      <LvToolbar
        search={search}
        supplier={supplier}
        suppliers={supplierFilters}
        positionFilter={positionFilter}
        sort={sort}
        shown={visible.length}
        total={positions.length}
        openCount={positions.length - selectedPositionCount}
        warningCount={warningPositionCount}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        onSupplier={(value) => {
          setSupplier(value);
          setPage(1);
        }}
        onPositionFilter={(value) => {
          setPositionFilter(value);
          setPage(1);
        }}
        onSort={setSort}
        onExpandAll={() => {
          setCollapsed(new Set());
          setPage(1);
        }}
        onCollapseAll={() => {
          setCollapsed(new Set(sectionIds));
          setPage(1);
        }}
      />
      {selectionError ? (
        <p className="lv-selection-error" role="alert">
          {selectionError}
        </p>
      ) : null}
      <div className={`lv-two-pane lv-three-pane ${activePosition ? "details-open" : ""}`} data-lv-two-pane data-lv-three-pane>
        <LvPositionList
          sections={sections}
          collapsed={collapsed}
          expandedPositionIds={expandedPositionIds}
          offerLines={offerLines}
          manualDisplayLabels={manualDisplayLabels}
          supplierSourceDocumentIds={supplierSourceDocumentIds}
          activePositionId={selectedBasisPositionId}
          drafts={centralDrafts}
          decisions={centralDecisions}
          pendingOptionId={pendingOptionId}
          scrollTop={tableScroll}
          page={currentPage}
          pageSize={pageSize}
          total={visible.length}
          onScrollTop={(value) =>
            setTableScroll((current) => resolveTableScrollUpdate(current, value, workspaceReady))
          }
          onToggleSection={(id) => {
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
            setPage(1);
            setTableScroll(0);
          }}
          onTogglePosition={togglePosition}
          onInfo={(position, option) => openPosition(position, option, "OFFER_DATA")}
          onOpenBasisSource={(position) => openBasis(position, "TABLE_BASIS_SOURCE")}
          onOpenSupplierSource={(position, option) =>
            openSupplier(position, option, undefined, "TABLE_SUPPLIER_SOURCE")
          }
          onSelectOption={(position, option) => void selectSupplierOption(position, option)}
          onShowWarnings={() => setWarningOpen(true)}
          onPage={(value) => {
            setPage(value);
            setTableScroll(0);
          }}
          onPageSize={(value) => {
            setPageSize(value as 20 | 50 | 100);
            setPage(1);
            setTableScroll(0);
          }}
        />
        {activePosition ? (
          <PositionDetailsPane
            workspaceKey={projectId}
            position={activePosition}
            option={detailsOption}
            previewedOptionId={activeSource?.supplierOptionId ?? null}
            selectedOptionId={selectedDetailsOptionId}
            pendingOptionId={pendingOptionId}
            basisDisplayLabel={manualDisplayLabels?.[`BASIS_POSITION:${activePosition.basis.id}`]}
            supplierDisplayLabel={(() => {
              if (!detailsOption) return undefined;
              const lines = detailsOption.matchedOfferLineIds
                .map((lineId) => offerLines.get(lineId))
                .filter((line): line is OfferLine => Boolean(line));
              const primary = lines.find((line) => line.role === "PRIMARY") ?? lines[0];
              return primary ? manualDisplayLabels?.[`SUPPLIER_LINE:${primary.id}`] : undefined;
            })()}
            matchLink={detailsMatchLink}
            matchDecision={detailsMatchReview?.decision ?? null}
            matchReviewPending={pendingMatchLinkId === detailsMatchLink?.id}
            offerLines={offerLines}
            tab={detailsPaneTab}
            sources={sources}
            activeSourceKey={sourceKey}
            sourceView={sourceView}
            positionIndex={activeIndex}
            positionTotal={filteredSortedPositions.length}
            onTab={(tab) => {
              setDetailsPaneTab(tab);
              if (tab === "ORIGINAL_DOCUMENT" && !sourceKey) {
                const key = detailsOption
                  ? optionSourceKey(sources, detailsOption)
                  : sources.find((source) => source.kind === "basis")?.key;
                setSourceKey(key ?? null);
              }
            }}
            onSourceSelect={selectSource}
            onSourceView={saveActiveSourceView}
            onBasisSource={() => openBasis(activePosition, "INSPECTOR_BASIS_SOURCE")}
            onSupplierSource={() => {
              if (detailsOption) {
                openSupplier(activePosition, detailsOption, undefined, "INSPECTOR_SUPPLIER_SOURCE");
              }
            }}
            onPreviewOption={(option) =>
              openSupplier(activePosition, option, undefined, "INSPECTOR_SUPPLIER_SOURCE")
            }
            onSelectOption={(option) => void selectSupplierOption(activePosition, option)}
            onCorrectBasis={browserLocal ? openBasisCorrection : undefined}
            onCorrectSupplier={browserLocal ? openSupplierCorrection : undefined}
            onFullscreen={() => {
              sourceReturnFocus.current = document.activeElement as HTMLElement | null;
              setFullscreenSourceOpen(true);
            }}
            onPrevious={() => navigate(-1)}
            onNext={() => navigate(1)}
            onNextOpen={navigateToNextOpen}
            nextOpenAvailable={Boolean(nextOpenPosition)}
            onClose={() => {
              setActivePositionId(null);
              setFullscreenSourceOpen(false);
              const url = new URL(window.location.href);
              url.searchParams.delete("position");
              url.searchParams.delete("source");
              url.searchParams.delete("page");
              window.history.replaceState(window.history.state, "", url);
            }}
            onConfirmMatch={
              browserLocal && detailsMatchLink ? () => void reviewMatch("CONFIRMED") : undefined
            }
            onRejectMatch={
              browserLocal && detailsMatchLink ? () => void reviewMatch("REJECTED") : undefined
            }
          />
        ) : (
          <aside
            className="lv-details-pane lv-details-placeholder"
            data-details-pane
            data-persistent-inspector
          >
            <div>
              <span>LV-Arbeitsplatz</span>
              <strong>Position auswählen</strong>
              <p>
                Wählen Sie links eine Position. Basis-LV, Angebote und Originalquelle erscheinen
                hier gemeinsam.
              </p>
            </div>
          </aside>
        )}
      </div>
      {manualCorrection ? (
        <ManualPositionEditor
          key={`${manualCorrection.kind}:${manualCorrection.entityId}`}
          mode="CORRECT"
          kind={manualCorrection.kind}
          initialValues={manualCorrection.initialValues}
          onCancel={() => setManualCorrection(null)}
          onSubmit={saveExistingManualCorrection}
        />
      ) : null}
      {fullscreenSourceOpen && sourceKey ? (
        <SourceOverlay
          key={sourceKey}
          sources={sources}
          activeKey={sourceKey}
          initialView={sourceView}
          onViewChange={saveActiveSourceView}
          onSelect={selectSource}
          onClose={closeSource}
        />
      ) : null}
    </div>
  );
}
