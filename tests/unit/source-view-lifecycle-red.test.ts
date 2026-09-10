import { describe, expect, it } from "vitest";
import * as projectWorkspace from "@/domain/project-workspace";
import * as sourceOverlay from "@/components/lv/source-overlay";
import * as lvComparisonPage from "@/components/lv/lv-comparison-page";

type SavedSourceView = {
  sourceKey: string;
  documentRevisionId: string;
  page: number;
  zoom: number;
  fitMode: "CONTEXT" | "EVIDENCE" | "PAGE" | "WIDTH" | "CUSTOM";
  scrollLeft: number;
  scrollTop: number;
};

const basisView: SavedSourceView = {
  sourceKey: "basis:15:e-basis",
  documentRevisionId: "basis-revision-7",
  page: 15,
  zoom: 1.1,
  fitMode: "CONTEXT",
  scrollLeft: 12,
  scrollTop: 840
};

const supplierAlphaView: SavedSourceView = {
  sourceKey: "supplier:alpha:1.1.130:9",
  documentRevisionId: "supplier-alpha-revision-3",
  page: 9,
  zoom: 1.35,
  fitMode: "EVIDENCE",
  scrollLeft: 31,
  scrollTop: 522
};

const supplierBetaView: SavedSourceView = {
  sourceKey: "supplier:beta:1.1.120:2",
  documentRevisionId: "supplier-beta-revision-11",
  page: 2,
  zoom: 0.9,
  fitMode: "WIDTH",
  scrollLeft: 0,
  scrollTop: 196
};

function requiredExport<T>(
  module: object,
  name: string,
  contract: string
): T {
  const candidate = (module as Record<string, unknown>)[name];
  expect(candidate, contract).toBeTypeOf("function");
  return candidate as T;
}

describe("per-source PDF workspace state (RED)", () => {
  it("accepts legacy sourceOverlay and round-trips independent Basis and supplier sourceViews", () => {
    const legacy = projectWorkspace.ProjectWorkspaceStateSchema.safeParse({
      sourceOverlay: basisView
    });
    expect(legacy.success).toBe(true);

    const sourceViews = {
      [basisView.sourceKey]: basisView,
      [supplierAlphaView.sourceKey]: supplierAlphaView,
      [supplierBetaView.sourceKey]: supplierBetaView
    };
    const parsed = projectWorkspace.ProjectWorkspaceStateSchema.parse({
      sourceOverlay: basisView,
      sourceViews
    }) as unknown as Record<string, unknown>;
    const roundTripped = projectWorkspace.ProjectWorkspaceStateSchema.parse(
      JSON.parse(JSON.stringify(parsed))
    ) as unknown as Record<string, unknown>;

    expect(roundTripped.sourceViews).toEqual(sourceViews);
  });

  it("returns the exact saved view only for the current document revision", () => {
    const resolveWorkspaceSourceView = requiredExport<
      (
        views: Record<string, SavedSourceView>,
        source: { sourceKey: string; documentRevisionId: string }
      ) => SavedSourceView | null
    >(
      projectWorkspace,
      "resolveWorkspaceSourceView",
      "project-workspace must expose the revision-safe source-view resolver"
    );
    const views = { [supplierAlphaView.sourceKey]: supplierAlphaView };

    expect(
      resolveWorkspaceSourceView(views, {
        sourceKey: supplierAlphaView.sourceKey,
        documentRevisionId: supplierAlphaView.documentRevisionId
      })
    ).toEqual(supplierAlphaView);
    expect(
      resolveWorkspaceSourceView(views, {
        sourceKey: supplierAlphaView.sourceKey,
        documentRevisionId: "supplier-alpha-revision-4"
      })
    ).toBeNull();
  });
});

describe("PDF evidence render identity (RED)", () => {
  it("switches to the continuation evidence record when page navigation reaches it", () => {
    const primary = {
      key: "basis:1:primary",
      kind: "basis",
      documentId: "basis-doc",
      positionNumber: "1.1.10",
      pageNumber: 1
    };
    const continuation = {
      ...primary,
      key: "basis:2:continuation",
      pageNumber: 2
    };

    expect(
      sourceOverlay.evidenceSourceKeyForPage(
        [primary, continuation] as never,
        primary as never,
        2
      )
    ).toBe("basis:2:continuation");
    expect(
      sourceOverlay.evidenceSourceKeyForPage(
        [primary, continuation] as never,
        primary as never,
        3
      )
    ).toBeNull();
  });

  it("hides pending or mismatched evidence and exposes one frame only after the matching render commits", () => {
    type Identity = {
      sourceKey: string;
      documentRevisionId: string;
      pageNumber: number;
      renderSequence: number;
    };
    type Frame = {
      region: { x: number; y: number; width: number; height: number };
      origin: "text-layer" | "stored";
    };
    type Input = {
      requested: Identity;
      status: "loading" | "ready" | "error";
      committed: (Identity & Frame) | null;
    };
    const resolvePdfEvidenceFrames = requiredExport<(input: Input) => Frame[]>(
      sourceOverlay,
      "resolvePdfEvidenceFrames",
      "source-overlay must expose a render-identity-gated evidence resolver"
    );
    const requested: Identity = {
      sourceKey: supplierAlphaView.sourceKey,
      documentRevisionId: supplierAlphaView.documentRevisionId,
      pageNumber: 9,
      renderSequence: 22
    };
    const oldFrame: Identity & Frame = {
      ...requested,
      sourceKey: basisView.sourceKey,
      documentRevisionId: basisView.documentRevisionId,
      pageNumber: 15,
      renderSequence: 21,
      region: { x: 0.1, y: 0.4, width: 0.8, height: 0.2 },
      origin: "stored"
    };

    expect(
      resolvePdfEvidenceFrames({
        requested,
        status: "loading",
        committed: oldFrame
      })
    ).toEqual([]);
    expect(
      resolvePdfEvidenceFrames({
        requested,
        status: "ready",
        committed: { ...oldFrame, renderSequence: requested.renderSequence }
      })
    ).toEqual([]);

    const currentFrame: Identity & Frame = {
      ...requested,
      region: { x: 0.08, y: 0.79, width: 0.84, height: 0.13 },
      origin: "text-layer"
    };
    expect(
      resolvePdfEvidenceFrames({
        requested,
        status: "ready",
        committed: currentFrame
      })
    ).toEqual([
      {
        region: currentFrame.region,
        origin: "text-layer"
      }
    ]);
  });

  it("resets stale page scroll before navigating to another PDF page", () => {
    const resolveSourcePageChange = requiredExport<
      (input: {
        currentPage: number;
        requestedPage: number;
        pageCount: number;
        scroll: { left: number; top: number };
      }) => {
        pageNumber: number;
        scroll: { left: number; top: number };
      }
    >(
      sourceOverlay,
      "resolveSourcePageChange",
      "source-overlay must reset page-specific scroll when the page changes"
    );

    expect(
      resolveSourcePageChange({
        currentPage: 10,
        requestedPage: 9,
        pageCount: 43,
        scroll: { left: 220, top: 580 }
      })
    ).toEqual({ pageNumber: 9, scroll: { left: 0, top: 0 } });
    expect(
      resolveSourcePageChange({
        currentPage: 9,
        requestedPage: 9,
        pageCount: 43,
        scroll: { left: 25, top: 70 }
      })
    ).toEqual({ pageNumber: 9, scroll: { left: 25, top: 70 } });
  });

  it("centers evidence after returning to its page even at a custom zoom", () => {
    const shouldCenterPdfEvidence = requiredExport<
      (input: {
        pageNumber: number;
        evidencePageNumber: number;
        hasEvidence: boolean;
        initialScroll: { left: number; top: number };
      }) => boolean
    >(
      sourceOverlay,
      "shouldCenterPdfEvidence",
      "source-overlay must expose evidence centering independently of fit mode"
    );

    expect(
      shouldCenterPdfEvidence({
        pageNumber: 9,
        evidencePageNumber: 9,
        hasEvidence: true,
        initialScroll: { left: 0, top: 0 }
      })
    ).toBe(true);
    expect(
      shouldCenterPdfEvidence({
        pageNumber: 9,
        evidencePageNumber: 9,
        hasEvidence: true,
        initialScroll: { left: 0, top: 420 }
      })
    ).toBe(false);
  });

  it("reports success only when a verified evidence frame is actually visible", () => {
    type EvidencePresentationState =
      | "LOADING"
      | "VISIBLE_VERIFIED"
      | "VISIBLE_UNCONFIRMED"
      | "ABSENT"
      | "OFF_PAGE"
      | "ERROR";
    type Input = {
      renderStatus: "loading" | "ready" | "error";
      pageNumber: number;
      evidencePageNumber: number;
      visibleFrameCount: number;
      evidenceStatuses: string[];
    };
    const resolvePdfEvidencePresentation = requiredExport<
      (input: Input) => EvidencePresentationState
    >(
      sourceOverlay,
      "resolvePdfEvidencePresentation",
      "source-overlay must expose a fail-closed visible-evidence presentation resolver"
    );
    const verified = {
      renderStatus: "ready" as const,
      pageNumber: 15,
      evidencePageNumber: 15,
      visibleFrameCount: 1,
      evidenceStatuses: ["VERIFIED_NATIVE"]
    };

    expect(resolvePdfEvidencePresentation(verified)).toBe("VISIBLE_VERIFIED");
    expect(
      resolvePdfEvidencePresentation({
        ...verified,
        evidenceStatuses: ["VISUAL_ONLY_UNCONFIRMED"]
      })
    ).toBe("VISIBLE_UNCONFIRMED");
    expect(
      resolvePdfEvidencePresentation({ ...verified, visibleFrameCount: 0 })
    ).toBe("ABSENT");
    expect(
      resolvePdfEvidencePresentation({ ...verified, pageNumber: 16 })
    ).toBe("OFF_PAGE");
    expect(
      resolvePdfEvidencePresentation({ ...verified, renderStatus: "loading" })
    ).toBe("LOADING");
    expect(
      resolvePdfEvidencePresentation({ ...verified, renderStatus: "error" })
    ).toBe("ERROR");
  });
});

describe("inline PDF readability defaults (RED)", () => {
  it("opens new sources at full page width while preserving a saved evidence-focus preference", () => {
    const resolveInlineSourceFitMode = requiredExport<
      (mode?: SavedSourceView["fitMode"] | null) => SavedSourceView["fitMode"]
    >(
      sourceOverlay,
      "resolveInlineSourceFitMode",
      "inline source view must default to full page width"
    );
    const toggleInlineSourceFitMode = requiredExport<
      (mode: SavedSourceView["fitMode"]) => "EVIDENCE" | "WIDTH"
    >(
      sourceOverlay,
      "toggleInlineSourceFitMode",
      "inline source view must let the operator switch between evidence and page width"
    );

    expect(resolveInlineSourceFitMode()).toBe("WIDTH");
    expect(resolveInlineSourceFitMode("EVIDENCE")).toBe("EVIDENCE");
    expect(resolveInlineSourceFitMode(supplierBetaView.fitMode)).toBe("WIDTH");
    expect(toggleInlineSourceFitMode("EVIDENCE")).toBe("WIDTH");
    expect(toggleInlineSourceFitMode("WIDTH")).toBe("EVIDENCE");
    expect(toggleInlineSourceFitMode("CUSTOM")).toBe("EVIDENCE");
  });
});

describe("asynchronous LV URL query application (RED)", () => {
  it("does not mark the query complete until both requested position and source page exist", () => {
    type QueryAvailability = {
      requestedPositionNumber: string;
      requestedSourceLabel: string;
      requestedPage: number;
      availablePositionNumbers: string[];
      availableSources: Array<{
        positionNumber: string;
        tabLabel: string;
        pageNumber: number;
      }>;
    };
    const isInitialLvQueryReady = requiredExport<
      (input: QueryAvailability) => boolean
    >(
      lvComparisonPage,
      "isInitialLvQueryReady",
      "lv-comparison-page must expose a readiness guard for async URL query application"
    );
    const request = {
      requestedPositionNumber: "1.1.130",
      requestedSourceLabel: "Lieferant Alpha",
      requestedPage: 9
    };

    expect(
      isInitialLvQueryReady({
        ...request,
        availablePositionNumbers: [],
        availableSources: []
      })
    ).toBe(false);
    expect(
      isInitialLvQueryReady({
        ...request,
        availablePositionNumbers: ["1.1.130"],
        availableSources: []
      })
    ).toBe(false);
    expect(
      isInitialLvQueryReady({
        ...request,
        availablePositionNumbers: ["1.1.130"],
        availableSources: [
          {
            positionNumber: "1.1.130",
            tabLabel: "Lieferant Alpha",
            pageNumber: 9
          }
        ]
      })
    ).toBe(true);
  });
});
