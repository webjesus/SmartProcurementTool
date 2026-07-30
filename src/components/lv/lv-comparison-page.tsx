"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EvidenceReference,
  OfferLine,
  SupplierOption
} from "@/domain/contracts";
import type {
  CentralSupplierDecision,
  DecisionDraftRecord
} from "@/domain/central-decision";
import type { ProjectWorkspaceState } from "@/domain/project-workspace";
import { useDecisionIdentity } from "@/components/decision-identity";
import type { ProjectReviewPosition } from "@/domain/project-review";
import {
  cheapestFoundOption,
  latestPositionDecision
} from "./lv-comparison-table";
import { LvPositionList } from "./lv-position-list";
import { LvPageHeader } from "./lv-page-header";
import {
  LvToolbar,
  type LvPositionFilter,
  type LvSortMode
} from "./lv-toolbar";
import {
  PositionDetailsPane,
  type DetailsPaneTab
} from "./position-details-pane";
import { SourceOverlay } from "./source-overlay";
import {
  buildLvWarnings,
  type LvWarning
} from "./warning-center";
import { shortDescription, supplierBucket } from "./format";
import { supplierDisplayRole } from "@/domain/supplier-option-read-model";
import { buildOperatorSupplierOptionReadModel } from "@/domain/operator-supplier-option-read-model";
import type {
  PilotStateView,
  SourceOpenContext,
  SourceRecord
} from "./types";
import type { SourceViewState } from "./source-overlay";
import { isAbortError } from "./async-lifecycle";
import { paginateGroupedPositions } from "./grouped-pagination";

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

function contextFor(
  positions: ProjectReviewPosition[],
  active: ProjectReviewPosition
) {
  const index = positions.findIndex(
    (position) => position.basis.id === active.basis.id
  );
  return positions
    .slice(Math.max(0, index - 1), index + 2)
    .map((position) => ({
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

function sourceRecordsFor(
  pilot: PilotStateView,
  position: ProjectReviewPosition,
  offerLines: Map<string, OfferLine>,
  documentUrls: Readonly<Record<string, string>> = {}
): SourceRecord[] {
  const allPositions = pilot.projectReview.positions;
  const context = contextFor(allPositions, position);
  const records: SourceRecord[] = [];
  const basisRevision = pilot.documentRevisions[position.basis.documentId];
  const basisRun = pilot.runs.find(
    (run) => run.document.id === position.basis.documentId
  );
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
    const run = pilot.runs.find(
      (candidate) => candidate.document.id === option.supplierDocumentId
    );
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
          title:
            line.supplierPositionNumber ??
            line.sourcePositionNumber ??
            lineRoleTitle(line),
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

export function LvComparisonPage({
  pilot,
  reload,
  browserLocal
}: {
  pilot: PilotStateView;
  reload: () => Promise<void>;
  browserLocal?: {
    decisions: CentralSupplierDecision[];
    documentUrls: Readonly<Record<string, string>>;
    loadWorkspace: () => Promise<ProjectWorkspaceState | null>;
    saveWorkspace: (state: ProjectWorkspaceState) => Promise<void>;
    selectSupplierOption: (input: {
      positionId: string;
      optionId: string;
      lineIds: string[];
      comment: string;
    }) => Promise<void>;
    exportExcel?: () => void;
    exportPdf?: () => void;
  };
}) {
  const identity = useDecisionIdentity();
  const browserDecisions = browserLocal?.decisions;
  const browserDocumentUrls = browserLocal?.documentUrls;
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
  const [positionFilter, setPositionFilter] =
    useState<LvPositionFilter>("ALL");
  const [sort, setSort] = useState<LvSortMode>("LV_ORDER");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 50 | 100>(20);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedPositionIds, setExpandedPositionIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedBasisPositionId, setSelectedBasisPositionId] = useState<
    string | null
  >(null);
  const [activePositionId, setActivePositionId] = useState<string | null>(null);
  const [activeSupplierOptionId, setActiveSupplierOptionId] = useState<
    string | null
  >(null);
  const [detailsPaneTab, setDetailsPaneTab] =
    useState<DetailsPaneTab>("OFFER_DATA");
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [sourceView, setSourceView] = useState<SourceViewState | null>(null);
  const [fullscreenSourceOpen, setFullscreenSourceOpen] = useState(false);
  const [tableScroll, setTableScroll] = useState(0);
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [warningOpen, setWarningOpen] = useState(false);
  const [centralDecisions, setCentralDecisions] = useState<
    CentralSupplierDecision[]
  >([]);
  const [centralDrafts, setCentralDrafts] = useState<DecisionDraftRecord[]>([]);
  const initialQueryApplied = useRef(false);
  const workspaceVersion = useRef<number | null>(null);
  const sourceReturnFocus = useRef<HTMLElement | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const projectId =
    pilot.projectReview.projectId ?? "central-server-disabled";

  useEffect(() => {
    if (!browserDecisions) return;
    const timeout = window.setTimeout(
      () => setCentralDecisions(browserDecisions),
      0
    );
    return () => window.clearTimeout(timeout);
  }, [browserDecisions]);
  const positions = useMemo(
    () =>
      pilot.projectReview.positions.map((position) => {
        const latest = centralDecisions
          .filter((decision) => decision.positionId === position.basis.id)
          .sort(
            (left, right) => left.decisionVersion - right.decisionVersion
          )
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
              latest.outcome === "SELECTED"
                ? latest.selectedSupplierOptionId
                : null
          }
        };
      }),
    [centralDecisions, pilot.projectReview.positions]
  );
  const warnings = useMemo(
    () => {
      const result = buildLvWarnings(positions, offerLines);
      for (const position of positions) {
        const latest = centralDecisions
          .filter((decision) => decision.positionId === position.basis.id)
          .sort(
            (left, right) => left.decisionVersion - right.decisionVersion
          )
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
          reason:
            "Bestehende Auswahl deckt den erkannten Lieferumfang nicht vollständig ab"
        });
      }
      return result;
    },
    [centralDecisions, offerLines, positions]
  );

  const loadCentralDecisions = useCallback(async () => {
    if (browserDecisions) {
      setCentralDecisions(browserDecisions);
      setCentralDrafts([]);
      return;
    }
    if (!identity.enabled || !identity.user) return;
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/decisions`,
      { cache: "no-store", credentials: "include" }
    );
    if (!response.ok) return;
    const payload = (await response.json()) as {
      decisions: CentralSupplierDecision[];
      drafts: DecisionDraftRecord[];
    };
    setCentralDecisions(payload.decisions);
    setCentralDrafts(payload.drafts);
  }, [browserDecisions, identity.enabled, identity.user, projectId]);

  const applyWorkspace = useCallback((state: ProjectWorkspaceState) => {
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
    setActivePositionId(
      state.inspectorOpen ? state.selectedBasisPositionId : null
    );
    setSourceKey(state.sourceOverlay?.sourceKey ?? null);
    setSourceView(
      state.sourceOverlay
        ? {
            pageNumber: state.sourceOverlay.page,
            zoom: state.sourceOverlay.zoom,
            fitMode: state.sourceOverlay.fitMode,
            scrollLeft: state.sourceOverlay.scrollLeft,
            scrollTop: state.sourceOverlay.scrollTop
          }
        : null
    );
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
    void fetch(
      `/api/projects/${encodeURIComponent(projectId)}/workspace`,
      {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal
      }
    )
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
          error instanceof Error
            ? error.message
            : "Der Arbeitsbereich konnte nicht geladen werden."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setWorkspaceLoaded(true);
      });
    return () => {
      if (!controller.signal.aborted) controller.abort();
    };
  }, [
    applyWorkspace,
    browserLoadWorkspace,
    identity.enabled,
    identity.user,
    projectId
  ]);

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
                return line
                  ? [
                      line.description,
                      line.articleNumber ?? ""
                    ]
                  : [];
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
    const warningPositionIds = new Set(
      warnings.map((warning) => warning.positionId)
    );
    const result = positions.filter((position) => {
      if (normalized && !searchable.get(position.basis.id)?.includes(normalized)) {
        return false;
      }
      if (
        supplier !== "ALL" &&
        !position.options.some(
          (option) => supplierBucket(option.supplierLabel) === supplier
        )
      ) {
        return false;
      }
      const selected = position.liveStatus === "MANUAL_DECIDED";
      if (positionFilter === "SELECTED" && !selected) return false;
      if (positionFilter === "UNSELECTED" && selected) return false;
      if (
        positionFilter === "WARNINGS" &&
        !warningPositionIds.has(position.basis.id)
      ) {
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
  }, [
    positionFilter,
    positions,
    search,
    searchable,
    sort,
    supplier,
    warnings
  ]);
  const supplierFilters = useMemo(
    () =>
      Array.from(
        new Set(
          positions.flatMap((position) =>
            position.options.map((option) =>
              supplierBucket(option.supplierLabel)
            )
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
        page,
        pageSize,
        groupFor: sectionFor
      }),
    [collapsed, filteredSortedPositions, page, pageSize]
  );
  const {
    sections,
    visiblePositions: visible,
    currentPage,
    allSectionIds: sectionIds
  } = groupedPagination;
  const activePosition = positions.find(
    (position) => position.basis.id === activePositionId
  );
  const activeIndex = activePosition
    ? visible.findIndex((position) => position.basis.id === activePosition.basis.id)
    : -1;
  const sourcePosition = activePosition;
  const sources = useMemo(
    () =>
      sourcePosition
        ? sourceRecordsFor(
            pilot,
            sourcePosition,
            offerLines,
            browserDocumentUrls
          )
        : [],
    [browserDocumentUrls, offerLines, pilot, sourcePosition]
  );
  const activeSource = sources.find((source) => source.key === sourceKey);
  const detailsOption = useMemo(() => {
    if (!activePosition) return undefined;
    const requested = activePosition.options.find(
      (option) => option.id === activeSupplierOptionId
    );
    if (requested) return requested;
    const decision = latestPositionDecision(
      centralDecisions,
      activePosition.basis.id
    );
    const selected =
      decision?.outcome === "SELECTED"
        ? activePosition.options.find(
            (option) => option.id === decision.selectedSupplierOptionId
          )
        : undefined;
    return (
      selected ??
      cheapestFoundOption(activePosition, offerLines) ??
      activePosition.options.find((option) =>
        buildOperatorSupplierOptionReadModel({
          basis: activePosition.basis,
          option,
          offerLines
        }).selectable
      )
    );
  }, [
    activePosition,
    activeSupplierOptionId,
    centralDecisions,
    offerLines
  ]);
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
      inspectorSection:
        detailsPaneTab === "ORIGINAL_DOCUMENT" ? "source" : "information",
      detailsPaneTab,
      fullscreenSourceOpen,
      warningCenterOpen: warningOpen,
      sourceOverlay:
        sourceKey && activeSource
          ? {
              sourceKey,
              documentRevisionId: activeSource.documentRevisionId,
              page: sourceView?.pageNumber ?? activeSource.pageNumber,
              zoom: sourceView?.zoom ?? 1,
              fitMode: sourceView?.fitMode ?? "CONTEXT",
              scrollLeft: sourceView?.scrollLeft ?? 0,
              scrollTop: sourceView?.scrollTop ?? 0
            }
          : null
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
      sourceView,
      summaryFilter,
      supplier,
      tableScroll,
      warningOpen
    ]
  );

  useEffect(() => {
    if (browserSaveWorkspace) {
      if (!workspaceLoaded) return;
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
      !workspaceLoaded ||
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
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/workspace`,
          {
            method: "PUT",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              state: workspaceState,
              expectedVersion
            }),
            signal: controller.signal
          }
        );
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
    workspaceLoaded,
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
    if (initialQueryApplied.current) return;
    initialQueryApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    const positionNumber = params.get("position");
    const sourceTab = params.get("source");
    const requestedPage = Number(params.get("page"));
    if (!positionNumber) return;
    const position = positions.find(
      (candidate) => candidate.basis.positionNumber === positionNumber
    );
    if (!position) return;
    if (!sourceTab) {
      const timeout = window.setTimeout(
        () => {
          setSelectedBasisPositionId(position.basis.id);
          setActivePositionId(position.basis.id);
          setExpandedPositionIds((current) =>
            new Set(current).add(position.basis.id)
          );
        },
        0
      );
      return () => window.clearTimeout(timeout);
    }
    const records = sourceRecordsFor(
      pilot,
      position,
      offerLines,
      browserDocumentUrls
    );
    const source = records.find(
      (record) =>
        (record.tabLabel === sourceTab ||
          (sourceTab === "Angebot" && record.kind === "supplier")) &&
        (!requestedPage || record.pageNumber === requestedPage)
    );
    if (!source) return;
    const timeout = window.setTimeout(() => {
      setSelectedBasisPositionId(position.basis.id);
      setActivePositionId(position.basis.id);
      setSourceKey(source.key);
      setDetailsPaneTab("ORIGINAL_DOCUMENT");
      setExpandedPositionIds((current) =>
        new Set(current).add(position.basis.id)
      );
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [browserDocumentUrls, offerLines, pilot, positions]);

  const openPosition = useCallback((
    position: ProjectReviewPosition,
    option?: SupplierOption,
    requestedTab?: DetailsPaneTab
  ) => {
    const decision = latestPositionDecision(centralDecisions, position.basis.id);
    const selected =
      decision?.outcome === "SELECTED"
        ? position.options.find(
            (candidate) => candidate.id === decision.selectedSupplierOptionId
          )
        : undefined;
    const resolvedOption =
      option ??
      selected ??
      cheapestFoundOption(position, offerLines) ??
      position.options.find((candidate) =>
        buildOperatorSupplierOptionReadModel({
          basis: position.basis,
          option: candidate,
          offerLines
        }).selectable
      );
    setSelectedBasisPositionId(position.basis.id);
    setActivePositionId(position.basis.id);
    setActiveSupplierOptionId(resolvedOption?.id ?? null);
    if (requestedTab) setDetailsPaneTab(requestedTab);
    setExpandedPositionIds((current) =>
      new Set(current).add(position.basis.id)
    );
    if ((requestedTab ?? detailsPaneTab) === "ORIGINAL_DOCUMENT") {
      const records = sourceRecordsFor(
        pilot,
        position,
        offerLines,
        browserDocumentUrls
      );
      const key = resolvedOption
        ? optionSourceKey(records, resolvedOption)
        : records.find((record) => record.kind === "basis")?.key;
      setSourceKey(key ?? null);
      setSourceView(null);
    }
    const url = new URL(window.location.href);
    url.searchParams.set("position", position.basis.positionNumber);
    window.history.replaceState({ sptInspector: true }, "", url);
  }, [
    browserDocumentUrls,
    centralDecisions,
    detailsPaneTab,
    offerLines,
    pilot
  ]);

  const togglePosition = useCallback((position: ProjectReviewPosition) => {
    if (!expandedPositionIds.has(position.basis.id)) {
      openPosition(position);
      return;
    }
    setSelectedBasisPositionId(position.basis.id);
    setActivePositionId(position.basis.id);
    setExpandedPositionIds((current) => {
      const next = new Set(current);
      next.delete(position.basis.id);
      return next;
    });
  }, [expandedPositionIds, openPosition]);

  useEffect(() => {
    if (!activePosition) return;
    const frame = window.requestAnimationFrame(() => {
      const selector = `[data-lv-position="${CSS.escape(
        activePosition.basis.positionNumber
      )}"]`;
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
    setDetailsPaneTab("ORIGINAL_DOCUMENT");
    setExpandedPositionIds((current) =>
      new Set(current).add(position.basis.id)
    );
    const records = sourceRecordsFor(
      pilot,
      position,
      offerLines,
      browserDocumentUrls
    );
    const key = requestedKey ?? records[0]?.key;
    if (!key) return;
    setSourceKey(key);
    setSourceView(null);
    const source = records.find((record) => record.key === key);
    const url = new URL(window.location.href);
    url.searchParams.set("position", position.basis.positionNumber);
    url.searchParams.set("source", source?.tabLabel ?? "Basis");
    url.searchParams.set("page", String(source?.pageNumber ?? 1));
    window.history.replaceState(
      { sptInspector: true, sourceOpenContext: context },
      "",
      url
    );
  }

  function closeSource() {
    restoreAfterSource();
  }

  function openBasis(
    position: ProjectReviewPosition,
    context: SourceOpenContext
  ) {
    const records = sourceRecordsFor(
      pilot,
      position,
      offerLines,
      browserDocumentUrls
    );
    openSource(
      position,
      records.find((record) => record.kind === "basis")?.key,
      context
    );
  }

  function openSupplier(
    position: ProjectReviewPosition,
    option: SupplierOption,
    line: OfferLine | undefined,
    context: SourceOpenContext
  ) {
    setActiveSupplierOptionId(option.id);
    const records = sourceRecordsFor(
      pilot,
      position,
      offerLines,
      browserDocumentUrls
    );
    openSource(position, optionSourceKey(records, option, line), context);
  }

  function navigate(delta: number) {
    if (activeIndex < 0 || !visible.length) return;
    const nextIndex = (activeIndex + delta + visible.length) % visible.length;
    const next = visible[nextIndex];
    openPosition(next);
  }

  async function selectSupplierOption(
    position: ProjectReviewPosition,
    option: SupplierOption,
    comment = ""
  ) {
    if ((!browserLocal && !identity.user) || pendingOptionId) return;
    const sourceRecords = sourceRecordsFor(
      pilot,
      position,
      offerLines,
      browserDocumentUrls
    );
    if (!optionSourceKey(sourceRecords, option)) {
      setSelectionError(
        "Dieses Angebot kann nicht ausgewählt werden: Eine genaue Angebotsquelle fehlt."
      );
      return;
    }
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
        setExpandedPositionIds((current) =>
          new Set(current).add(position.basis.id)
        );
        await reload();
        return;
      }
      const latest = centralDecisions
        .filter((decision) => decision.positionId === position.basis.id)
        .sort(
          (left, right) => left.decisionVersion - right.decisionVersion
        )
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
            analysisVersionId:
              pilot.projectReview.analysisVersionId ??
              "central-server-disabled",
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
          [payload?.error, payload?.details]
            .filter(Boolean)
            .map(String)
            .join(" · ") || "Auswahl konnte nicht gespeichert werden."
        );
      }
      setSelectedBasisPositionId(position.basis.id);
      setActivePositionId(position.basis.id);
      setActiveSupplierOptionId(option.id);
      if (detailsPaneTab === "ORIGINAL_DOCUMENT") {
        const key = optionSourceKey(sourceRecords, option);
        setSourceKey(key);
        setSourceView(null);
      }
      setExpandedPositionIds((current) =>
        new Set(current).add(position.basis.id)
      );
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
    const position = positions.find(
      (candidate) => candidate.basis.id === warning.positionId
    );
    if (!position) return;
    const option = warning.supplierOptionId
      ? position.options.find(
          (candidate) => candidate.id === warning.supplierOptionId
        )
      : undefined;
    setWarningOpen(false);
    openPosition(position, option, "OFFER_DATA");
  }

  return (
    <div className="lv-workspace" data-real-lv-workspace>
      <LvPageHeader
        warnings={warnings}
        warningOpen={warningOpen}
        onToggleWarnings={() => setWarningOpen((value) => !value)}
        onSelectWarning={openWarning}
        onExportExcel={browserLocal?.exportExcel}
        onExportPdf={browserLocal?.exportPdf}
      />
      <LvToolbar
        search={search}
        supplier={supplier}
        suppliers={supplierFilters}
        positionFilter={positionFilter}
        sort={sort}
        shown={visible.length}
        total={positions.length}
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
      <div
        className={`lv-two-pane ${activePosition ? "details-open" : ""}`}
        data-lv-two-pane
      >
        <LvPositionList
          sections={sections}
          collapsed={collapsed}
          expandedPositionIds={expandedPositionIds}
          offerLines={offerLines}
          supplierSourceDocumentIds={supplierSourceDocumentIds}
          activePositionId={selectedBasisPositionId}
          drafts={centralDrafts}
          decisions={centralDecisions}
          pendingOptionId={pendingOptionId}
          scrollTop={tableScroll}
          page={currentPage}
          pageSize={pageSize}
          total={visible.length}
          onScrollTop={setTableScroll}
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
          onInfo={(position, option) => openPosition(position, option)}
          onOpenBasisSource={(position) =>
            openBasis(position, "TABLE_BASIS_SOURCE")
          }
          onOpenSupplierSource={(position, option) =>
            openSupplier(position, option, undefined, "TABLE_SUPPLIER_SOURCE")
          }
          onSelectOption={(position, option) =>
            void selectSupplierOption(position, option)
          }
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
            key={activePosition.basis.id}
            position={activePosition}
            option={detailsOption}
            offerLines={offerLines}
            tab={detailsPaneTab}
            sources={sources}
            activeSourceKey={sourceKey}
            sourceView={sourceView}
            positionIndex={activeIndex}
            positionTotal={visible.length}
            onTab={(tab) => {
              setDetailsPaneTab(tab);
              if (tab === "ORIGINAL_DOCUMENT" && !sourceKey) {
                const key = detailsOption
                  ? optionSourceKey(sources, detailsOption)
                  : sources.find((source) => source.kind === "basis")?.key;
                setSourceKey(key ?? null);
              }
            }}
            onSourceSelect={(key) => {
              setSourceKey(key);
              setSourceView(null);
            }}
            onSourceView={setSourceView}
            onBasisSource={() =>
              openBasis(activePosition, "INSPECTOR_BASIS_SOURCE")
            }
            onSupplierSource={() => {
              if (detailsOption) {
                openSupplier(
                  activePosition,
                  detailsOption,
                  undefined,
                  "INSPECTOR_SUPPLIER_SOURCE"
                );
              }
            }}
            onFullscreen={() => {
              sourceReturnFocus.current =
                document.activeElement as HTMLElement | null;
              setFullscreenSourceOpen(true);
            }}
            onPrevious={() => navigate(-1)}
            onNext={() => navigate(1)}
            onClose={() => {
              setActivePositionId(null);
              setFullscreenSourceOpen(false);
              const url = new URL(window.location.href);
              url.searchParams.delete("position");
              window.history.replaceState(window.history.state, "", url);
            }}
          />
        ) : null}
      </div>
      {fullscreenSourceOpen && sourceKey ? (
        <SourceOverlay
          key={sourceKey}
          sources={sources}
          activeKey={sourceKey}
          initialView={sourceView}
          onViewChange={setSourceView}
          onSelect={setSourceKey}
          onClose={closeSource}
        />
      ) : null}
    </div>
  );
}
