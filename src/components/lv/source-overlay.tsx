"use client";

import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
  Minus,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  X
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatCurrency, formatNumber, lineRoleLabel } from "./format";
import { supplierDisplayRoleLabel } from "@/domain/supplier-option-read-model";
import { resolveSupplierBrand } from "@/domain/brand-registry";
import type { SourceRecord } from "./types";
import { BrandMark } from "./brand-mark";
import { BoundedAsyncCache } from "./pdf-document-cache";
import { evidenceFitScale } from "./workspace-layout";
import {
  locatePdfSourceRegion,
  padPdfSourceRegion,
  type NormalizedPdfRegion,
  type PdfTextGeometryItem
} from "@/pdf/source-region";
import { browserPdfLoadingOptions, configureBrowserPdfJs } from "@/pdf/browser-pdfjs-config";

type RenderStatus = "loading" | "ready" | "error";
export type PdfEvidencePresentationState =
  | "LOADING"
  | "VISIBLE_VERIFIED"
  | "VISIBLE_UNCONFIRMED"
  | "ABSENT"
  | "OFF_PAGE"
  | "ERROR";
export type FitMode = "CONTEXT" | "EVIDENCE" | "PAGE" | "WIDTH" | "CUSTOM";
export type SourceViewState = {
  pageNumber: number;
  zoom: number;
  fitMode: FitMode;
  scrollLeft: number;
  scrollTop: number;
};

export function sourceUsesOcr(source: Pick<SourceRecord, "evidence">): boolean {
  return source.evidence.some((evidence) =>
    evidence.textItemIds.some((id) => id.startsWith("ocr-word:"))
  );
}

export function sourceOcrLabel(
  source: Pick<SourceRecord, "evidence">
): "OCR · manuell prüfen" | "OCR · manuell bestätigt" | null {
  if (!sourceUsesOcr(source)) return null;
  return source.evidence.length > 0 &&
    source.evidence.every((evidence) => evidence.status === "VERIFIED_VISUAL")
    ? "OCR · manuell bestätigt"
    : "OCR · manuell prüfen";
}

export function resolveInlineSourceFitMode(initialFitMode?: FitMode | null): FitMode {
  return initialFitMode ?? "WIDTH";
}

export function toggleInlineSourceFitMode(current: FitMode): "EVIDENCE" | "WIDTH" {
  return current === "EVIDENCE" ? "WIDTH" : "EVIDENCE";
}

type ScrollPosition = { left: number; top: number };
type ContainerSize = { width: number; height: number };
type PdfRenderIdentity = {
  sourceKey: string;
  documentRevisionId: string;
  pageNumber: number;
  renderSequence: number | string;
};
type PdfEvidenceFrame = {
  region: NormalizedPdfRegion;
  origin: "text-layer" | "stored";
};
type CommittedPdfEvidenceFrame = PdfRenderIdentity & PdfEvidenceFrame;

export function resolvePdfEvidenceFrames({
  requested,
  status,
  committed
}: {
  requested: PdfRenderIdentity;
  status: RenderStatus;
  committed: CommittedPdfEvidenceFrame | null;
}): PdfEvidenceFrame[] {
  if (
    status !== "ready" ||
    !committed ||
    committed.sourceKey !== requested.sourceKey ||
    committed.documentRevisionId !== requested.documentRevisionId ||
    committed.pageNumber !== requested.pageNumber ||
    committed.renderSequence !== requested.renderSequence
  ) {
    return [];
  }
  return [{ region: committed.region, origin: committed.origin }];
}

export function resolvePdfEvidencePresentation({
  renderStatus,
  pageNumber,
  evidencePageNumber,
  visibleFrameCount,
  evidenceStatuses
}: {
  renderStatus: RenderStatus;
  pageNumber: number;
  evidencePageNumber: number;
  visibleFrameCount: number;
  evidenceStatuses: readonly string[];
}): PdfEvidencePresentationState {
  if (renderStatus === "error") return "ERROR";
  if (pageNumber !== evidencePageNumber) return "OFF_PAGE";
  if (renderStatus === "loading") return "LOADING";
  if (visibleFrameCount <= 0) return "ABSENT";
  const verifiedStatuses = new Set(["VERIFIED_NATIVE", "VERIFIED_VISUAL"]);
  return evidenceStatuses.length > 0 &&
    evidenceStatuses.every((status) => verifiedStatuses.has(status))
    ? "VISIBLE_VERIFIED"
    : "VISIBLE_UNCONFIRMED";
}

export function stableScrollState(current: ScrollPosition, next: ScrollPosition): ScrollPosition {
  return current.left === next.left && current.top === next.top ? current : next;
}

export function stableContainerSize(current: ContainerSize, next: ContainerSize): ContainerSize {
  return current.width === next.width && current.height === next.height ? current : next;
}

export function resolveSourcePageChange({
  currentPage,
  requestedPage,
  pageCount,
  scroll
}: {
  currentPage: number;
  requestedPage: number;
  pageCount: number;
  scroll: ScrollPosition;
}): { pageNumber: number; scroll: ScrollPosition } {
  const pageNumber = clamp(Math.round(requestedPage), 1, pageCount);
  return {
    pageNumber,
    scroll: pageNumber === currentPage ? scroll : { left: 0, top: 0 }
  };
}

export function shouldCenterPdfEvidence({
  pageNumber,
  evidencePageNumber,
  hasEvidence,
  initialScroll
}: {
  pageNumber: number;
  evidencePageNumber: number;
  hasEvidence: boolean;
  initialScroll: ScrollPosition;
}): boolean {
  return (
    hasEvidence &&
    pageNumber === evidencePageNumber &&
    initialScroll.left === 0 &&
    initialScroll.top === 0
  );
}

function useDeferredScrollPosition(initial: ScrollPosition) {
  const [scroll, setScrollState] = useState(initial);
  const timeoutRef = useRef<number | null>(null);

  const setScroll = useCallback((next: ScrollPosition) => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setScrollState((current) => stableScrollState(current, next));
  }, []);

  const deferScroll = useCallback((next: ScrollPosition) => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setScrollState((current) => stableScrollState(current, next));
    }, 80);
  }, []);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    []
  );

  return [scroll, setScroll, deferScroll] as const;
}

type PdfDocumentProxyLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getViewport: (input: { scale: number }) => {
      width: number;
      height: number;
      transform: number[];
    };
    render: (input: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
      canvas: HTMLCanvasElement;
    }) => { cancel: () => void; promise: Promise<void> };
    getTextContent: () => Promise<{ items: unknown[] }>;
  }>;
};
type CachedPdfDocument = {
  document: PdfDocumentProxyLike;
  destroy: () => Promise<void>;
};

const pdfDocumentCache = new BoundedAsyncCache<CachedPdfDocument>(4);

async function loadPdf(source: SourceRecord): Promise<CachedPdfDocument> {
  const url = pdfUrl(source);
  return pdfDocumentCache.get(
    `${source.documentRevisionId}:${url}`,
    async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      configureBrowserPdfJs(pdfjs);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`PDF ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error("PDF ist leer.");
      const task = pdfjs.getDocument(browserPdfLoadingOptions(bytes));
      const document = await task.promise;
      return {
        document: document as unknown as PdfDocumentProxyLike,
        destroy: () => task.destroy()
      };
    },
    (cached) => cached.destroy()
  );
}

function pdfUrl(source: SourceRecord): string {
  if (source.pdfUrl) return source.pdfUrl;
  const params = new URLSearchParams({
    documentId: source.documentId,
    documentRevisionId: source.documentRevisionId
  });
  return `/api/local/corpus?${params.toString()}`;
}

function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || canvas.width === 0 || canvas.height === 0) return true;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixelCount = canvas.width * canvas.height;
  const stride = Math.max(1, Math.floor(pixelCount / 250_000)) * 4;
  let nonWhite = 0;
  for (let index = 0; index < pixels.length; index += stride) {
    if (
      pixels[index + 3] > 20 &&
      (pixels[index] < 246 || pixels[index + 1] < 246 || pixels[index + 2] < 246)
    ) {
      nonWhite += 1;
      if (nonWhite >= 30) return false;
    }
  }
  return true;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isPdfTextGeometryItem(value: unknown): value is PdfTextGeometryItem {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PdfTextGeometryItem>;
  return (
    typeof candidate.str === "string" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    Array.isArray(candidate.transform)
  );
}

function isSyntheticBrowserRegion(source: SourceRecord): boolean {
  return source.evidence.some((evidence) =>
    evidence.textItemIds.some((id) => /^line:\d+$/u.test(id))
  );
}

export function evidenceSourceKeyForPage(
  sources: readonly SourceRecord[],
  activeSource: SourceRecord,
  pageNumber: number
): string | null {
  return (
    sources.find(
      (source) =>
        source.documentId === activeSource.documentId &&
        source.kind === activeSource.kind &&
        source.positionNumber === activeSource.positionNumber &&
        source.supplierOptionId === activeSource.supplierOptionId &&
        source.lineId === activeSource.lineId &&
        source.pageNumber === pageNumber
    )?.key ?? null
  );
}

function PdfCanvas({
  source,
  pageNumber,
  zoom,
  fitMode,
  showHighlight,
  renderStatus,
  onStatus,
  onEvidencePresentation,
  onPageRendered,
  initialScroll,
  onScrollChange
}: {
  source: SourceRecord;
  pageNumber: number;
  zoom: number;
  fitMode: FitMode;
  showHighlight: boolean;
  renderStatus: RenderStatus;
  onStatus: (status: RenderStatus, message?: string) => void;
  onEvidencePresentation?: (state: PdfEvidencePresentationState) => void;
  onPageRendered: (dimensions: { width: number; height: number }) => void;
  initialScroll: { left: number; top: number };
  onScrollChange: (scroll: { left: number; top: number }) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialScrollRef = useRef(initialScroll);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [renderedSize, setRenderedSize] = useState({ width: 0, height: 0 });
  const [committedEvidenceFrame, setCommittedEvidenceFrame] =
    useState<CommittedPdfEvidenceFrame | null>(null);
  const requestedRender = useMemo<PdfRenderIdentity>(
    () => ({
      sourceKey: source.key,
      documentRevisionId: source.documentRevisionId,
      pageNumber,
      renderSequence: [
        source.key,
        source.documentRevisionId,
        pageNumber,
        containerSize.width,
        containerSize.height,
        fitMode,
        zoom
      ].join("|")
    }),
    [
      containerSize.height,
      containerSize.width,
      fitMode,
      pageNumber,
      source.documentRevisionId,
      source.key,
      zoom
    ]
  );

  useLayoutEffect(() => {
    initialScrollRef.current = initialScroll;
  }, [initialScroll]);

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const update = () => {
      const next = {
        width: element.clientWidth,
        height: element.clientHeight
      };
      setContainerSize((current) => stableContainerSize(current, next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerSize.width || !containerSize.height || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    async function renderPage() {
      onStatus("loading");
      try {
        const { document: pdfDocument } = await loadPdf(source);
        if (pageNumber < 1 || pageNumber > pdfDocument.numPages) {
          throw new Error(`Seite ${pageNumber} ist nicht vorhanden.`);
        }
        const page = await pdfDocument.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();
        const locatedRegion = locatePdfSourceRegion({
          items: textContent.items.filter(isPdfTextGeometryItem),
          pageWidth: baseViewport.width,
          pageHeight: baseViewport.height,
          viewportTransform: baseViewport.transform,
          positionNumber: source.positionNumber,
          supplierPositionNumber: source.supplierPositionNumber,
          description: `${source.title} ${source.description}`
        });
        const storedRegion = source.evidence[0]?.region;
        const evidence =
          locatedRegion ??
          (!isSyntheticBrowserRegion(source) && storedRegion?.width > 0 && storedRegion.height > 0
            ? storedRegion
            : null);
        const availableWidth = Math.max(240, containerSize.width - 16);
        const availableHeight = Math.max(240, containerSize.height - 16);
        const pageFit = Math.min(
          availableWidth / baseViewport.width,
          availableHeight / baseViewport.height
        );
        const widthFit = availableWidth / baseViewport.width;
        const contextFit = evidence
          ? Math.min(
              widthFit,
              availableHeight / (baseViewport.height * clamp(evidence.height + 0.52, 0.65, 1))
            )
          : widthFit;
        const evidenceFit = evidence
          ? evidenceFitScale({ width: availableWidth, height: availableHeight }, baseViewport, evidence)
          : widthFit;
        const fitScale =
          fitMode === "CONTEXT"
            ? contextFit
            : fitMode === "PAGE"
              ? pageFit
              : fitMode === "WIDTH"
                ? widthFit
                : fitMode === "EVIDENCE"
                  ? evidenceFit
                  : widthFit;
        const cssScale = clamp(fitScale * zoom, 0.5, 3);
        const viewport = page.getViewport({ scale: cssScale });
        if (!canvasRef.current || cancelled) {
          return;
        }
        const ratio = Math.max(1, window.devicePixelRatio || 1);
        const renderCanvas = document.createElement("canvas");
        renderCanvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        renderCanvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        const context = renderCanvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas ist nicht verfügbar.");
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        renderTask = page.render({
          canvasContext: context,
          viewport,
          canvas: renderCanvas
        });
        await renderTask.promise;
        if (cancelled) return;
        if (isCanvasBlank(renderCanvas)) {
          throw new Error("Die Dokumentseite enthält keine sichtbaren Pixel.");
        }
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = renderCanvas.width;
        canvas.height = renderCanvas.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const visibleContext = canvas.getContext("2d", { alpha: false });
        if (!visibleContext) throw new Error("Canvas ist nicht verfügbar.");
        visibleContext.setTransform(1, 0, 0, 1, 0, 0);
        visibleContext.fillStyle = "#fff";
        visibleContext.fillRect(0, 0, canvas.width, canvas.height);
        visibleContext.drawImage(renderCanvas, 0, 0);
        setCommittedEvidenceFrame(
          evidence
            ? {
                ...requestedRender,
                region: evidence,
                origin: locatedRegion ? "text-layer" : "stored"
              }
            : null
        );
        const dimensions = { width: viewport.width, height: viewport.height };
        setRenderedSize(dimensions);
        onPageRendered(dimensions);
        onStatus("ready");
        const initialScroll = initialScrollRef.current;
        if (initialScroll.left > 0 || initialScroll.top > 0) {
          requestAnimationFrame(() => {
            stageRef.current?.scrollTo({
              left: initialScroll.left,
              top: initialScroll.top,
              behavior: "auto"
            });
          });
        } else if (
          evidence &&
          shouldCenterPdfEvidence({
            pageNumber,
            evidencePageNumber: source.pageNumber,
            hasEvidence: Boolean(evidence),
            initialScroll
          })
        ) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const stage = stageRef.current;
              if (!stage || cancelled) return;
              const targetX = (evidence.x + evidence.width / 2) * viewport.width + 20;
              const targetY = (evidence.y + evidence.height / 2) * viewport.height + 20;
              stage.scrollTo({
                left: Math.max(0, targetX - stage.clientWidth / 2),
                top: Math.max(0, targetY - stage.clientHeight / 2),
                behavior: "auto"
              });
            });
          });
        }
      } catch (error) {
        if (cancelled) return;
        const name =
          typeof error === "object" && error && "name" in error ? String(error.name) : "";
        if (name === "RenderingCancelledException") return;
        onStatus(
          "error",
          error instanceof Error ? error.message : "Unbekannter Darstellungsfehler."
        );
      }
    }

    void renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [
    containerSize.height,
    containerSize.width,
    fitMode,
    onPageRendered,
    onStatus,
    pageNumber,
    requestedRender,
    source,
    zoom
  ]);

  const activeEvidence = (
    pageNumber === source.pageNumber
      ? resolvePdfEvidenceFrames({
          requested: requestedRender,
          status: showHighlight ? "ready" : "loading",
          committed: committedEvidenceFrame
        })
      : []
  )
    .map((frame) => ({
      id: source.evidence[0]?.id ?? `${source.key}:located`,
      region: padPdfSourceRegion(frame.region),
      origin: frame.origin
    }))
    .filter(
      (
        evidence
      ): evidence is typeof evidence & {
        region: NormalizedPdfRegion;
      } => evidence.region !== null
    );
  const evidencePresentation = resolvePdfEvidencePresentation({
    renderStatus,
    pageNumber,
    evidencePageNumber: source.pageNumber,
    visibleFrameCount: activeEvidence.length,
    evidenceStatuses: source.evidence.map((evidence) => evidence.status)
  });
  useEffect(() => {
    onEvidencePresentation?.(evidencePresentation);
  }, [evidencePresentation, onEvidencePresentation]);

  return (
    <div
      className="source-pdf-stage"
      ref={stageRef}
      data-pdf-stage
      onScroll={(event) =>
        onScrollChange({
          left: event.currentTarget.scrollLeft,
          top: event.currentTarget.scrollTop
        })
      }
    >
      <div
        className="source-pdf-page"
        ref={pageRef}
        style={{ width: renderedSize.width || undefined, height: renderedSize.height || undefined }}
      >
        <canvas ref={canvasRef} aria-label={`Dokumentseite ${pageNumber}`} />
        {showHighlight
          ? activeEvidence.map((evidence, index) => (
              <span
                key={evidence.id}
                className={`source-evidence-region ${index === 0 ? "active" : ""}`}
                data-evidence-region
                data-region-origin={evidence.origin}
                style={{
                  left: `${clamp(evidence.region.x, 0, 1) * 100}%`,
                  top: `${clamp(evidence.region.y, 0, 1) * 100}%`,
                  width: `${
                    clamp(evidence.region.width, 0, 1 - clamp(evidence.region.x, 0, 1)) * 100
                  }%`,
                  height: `${
                    clamp(evidence.region.height, 0, 1 - clamp(evidence.region.y, 0, 1)) * 100
                  }%`
                }}
              />
            ))
          : null}
      </div>
    </div>
  );
}

export function InlineSourceViewer({
  sources,
  activeKey,
  initialView,
  onViewChange,
  onSelect,
  onFullscreen
}: {
  sources: SourceRecord[];
  activeKey: string;
  initialView?: SourceViewState | null;
  onViewChange?: (state: SourceViewState) => void;
  onSelect: (key: string) => void;
  onFullscreen: () => void;
}) {
  const activeSource = sources.find((source) => source.key === activeKey) ?? sources[0];
  const ocrLabel = activeSource ? sourceOcrLabel(activeSource) : null;
  const [pageNumber, setPageNumber] = useState(
    initialView?.pageNumber ?? activeSource?.pageNumber ?? 1
  );
  const [zoom, setZoom] = useState(initialView?.zoom ?? 1);
  const [fitMode, setFitMode] = useState<FitMode>(() =>
    resolveInlineSourceFitMode(initialView?.fitMode)
  );
  const [scroll, setScroll, updateScroll] = useDeferredScrollPosition({
    left: initialView?.scrollLeft ?? 0,
    top: initialView?.scrollTop ?? 0
  });
  const [renderStatus, setRenderStatus] = useState<RenderStatus>("loading");
  const [renderError, setRenderError] = useState("");
  const [hasRendered, setHasRendered] = useState(false);
  const [evidencePresentation, setEvidencePresentation] =
    useState<PdfEvidencePresentationState>("LOADING");
  const activeSourceIdentity = activeSource
    ? `${activeSource.key}:${activeSource.documentRevisionId}`
    : undefined;
  const renderedSourceIdentityRef = useRef(activeSourceIdentity);
  const sourceIndex = sources.findIndex((source) => source.key === activeKey);
  const changePage = useCallback(
    (requestedPage: number) => {
      const next = resolveSourcePageChange({
        currentPage: pageNumber,
        requestedPage,
        pageCount: activeSource?.pageCount ?? 1,
        scroll
      });
      setScroll(next.scroll);
      const evidenceSourceKey = activeSource
        ? evidenceSourceKeyForPage(sources, activeSource, next.pageNumber)
        : null;
      if (evidenceSourceKey && evidenceSourceKey !== activeSource.key) {
        onSelect(evidenceSourceKey);
        return;
      }
      setPageNumber(next.pageNumber);
    },
    [activeSource, onSelect, pageNumber, scroll, setScroll, sources]
  );
  useLayoutEffect(() => {
    if (!activeSource || renderedSourceIdentityRef.current === activeSourceIdentity) {
      return;
    }
    renderedSourceIdentityRef.current = activeSourceIdentity;
    setPageNumber(initialView?.pageNumber ?? activeSource.pageNumber ?? 1);
    setZoom(initialView?.zoom ?? 1);
    setFitMode(resolveInlineSourceFitMode(initialView?.fitMode));
    setScroll({
      left: initialView?.scrollLeft ?? 0,
      top: initialView?.scrollTop ?? 0
    });
    setRenderStatus("loading");
    setRenderError("");
    setEvidencePresentation("LOADING");
  }, [
    activeSource,
    activeSourceIdentity,
    initialView?.fitMode,
    initialView?.pageNumber,
    initialView?.scrollLeft,
    initialView?.scrollTop,
    initialView?.zoom,
    setScroll
  ]);
  useEffect(() => {
    onViewChange?.({
      pageNumber,
      zoom,
      fitMode,
      scrollLeft: scroll.left,
      scrollTop: scroll.top
    });
  }, [fitMode, onViewChange, pageNumber, scroll.left, scroll.top, zoom]);

  const updateStatus = useCallback((status: RenderStatus, message = "") => {
    if (status === "ready") setHasRendered(true);
    setRenderStatus(status);
    setRenderError(message);
  }, []);
  const ignoreDimensions = useCallback(() => undefined, []);

  if (!activeSource) {
    return (
      <div className="lv-inline-source-empty">
        Für diese Position ist keine Dokumentquelle verfügbar.
      </div>
    );
  }

  return (
    <section
      className="lv-inline-source"
      data-inline-source
      data-source-key={activeSource.key}
      data-extraction-source={ocrLabel ? "ocr" : "native"}
      data-source-fit-mode={fitMode.toLocaleLowerCase("de")}
      data-evidence-presentation={evidencePresentation.toLocaleLowerCase("de")}
    >
      <header>
        <div>
          <label className="lv-source-select">
            <span className="sr-only">Dokumentquelle</span>
            <select aria-label="Dokumentquelle" value={activeKey} onChange={(event) => onSelect(event.target.value)}>
              {sources.map((source) => <option key={source.key} value={source.key}>{source.kind === "basis" ? "Basis-LV" : source.supplier ?? "Angebot"} · {source.articleNumber ?? source.title} · S. {source.pageNumber}</option>)}
            </select>
          </label>
          <strong>
            {activeSource.kind === "basis"
              ? "Basis-LV"
              : `Angebot: ${activeSource.supplier ?? "Lieferant"}${
                  activeSource.articleNumber ? ` · Art. ${activeSource.articleNumber}` : ""
                }`}
          </strong>
          <span>
            Seite {pageNumber} von {activeSource.pageCount}
          </span>
          {ocrLabel ? (
            <span
              className="source-ocr-badge"
              data-ocr-source
              title="Diese Fundstelle wurde aus dem Seitenbild gelesen."
            >
              {ocrLabel}
            </span>
          ) : null}
        </div>
        <nav>
          <button aria-pressed={fitMode === "EVIDENCE"} onClick={() => { setFitMode("EVIDENCE"); setZoom(1); setScroll({ left: 0, top: 0 }); }}>Position</button>
          <button aria-pressed={fitMode === "PAGE"} onClick={() => { setFitMode("PAGE"); setZoom(1); setScroll({ left: 0, top: 0 }); }}>Ganze Seite</button>
          <button
            onClick={() => {
              setFitMode("CUSTOM");
              setZoom((value) => clamp(value - 0.1, 0.5, 3));
            }}
            aria-label="Verkleinern"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={() => {
              setFitMode("CUSTOM");
              setZoom(1);
            }}
            aria-label="Zoom auf 100 Prozent zurücksetzen"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => {
              setFitMode("CUSTOM");
              setZoom((value) => clamp(value + 0.1, 0.5, 3));
            }}
            aria-label="Vergrößern"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => {
              setFitMode("WIDTH");
              setZoom(1);
              setScroll({ left: 0, top: 0 });
            }}
            aria-label="Dokument an Breite anpassen"
            aria-pressed={fitMode === "WIDTH"}
          >
            An Breite anpassen
          </button>
          <button
            onClick={() => changePage(pageNumber - 1)}
            disabled={pageNumber <= 1}
            aria-label="Vorherige Seite"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => onSelect(sources[sourceIndex - 1].key)}
            disabled={sourceIndex <= 0}
            aria-label="Vorheriger Beleg"
          >
            <ChevronLeft size={14} />
            <span>Beleg</span>
          </button>
          <button
            onClick={() => onSelect(sources[sourceIndex + 1].key)}
            disabled={sourceIndex < 0 || sourceIndex >= sources.length - 1}
            aria-label="Nächster Beleg"
          >
            <span>Beleg</span>
            <ChevronRight size={14} />
          </button>
          <button
            onClick={() => changePage(pageNumber + 1)}
            disabled={pageNumber >= activeSource.pageCount}
            aria-label="Nächste Seite"
          >
            <ChevronRight size={16} />
          </button>
          <button onClick={onFullscreen} aria-label="Dokument Vollbild">
            <Maximize2 size={17} />
          </button>
        </nav>
      </header>
      <div className="lv-inline-source-stage">
        <PdfCanvas
          source={activeSource}
          pageNumber={pageNumber}
          zoom={zoom}
          fitMode={fitMode}
          showHighlight={renderStatus === "ready"}
          renderStatus={renderStatus}
          onStatus={updateStatus}
          onEvidencePresentation={setEvidencePresentation}
          onPageRendered={ignoreDimensions}
          initialScroll={scroll}
          onScrollChange={updateScroll}
        />
        {renderStatus === "loading" ? (
          <div className={`source-render-state ${hasRendered ? "source-render-refresh" : ""}`}>
            Dokumentseite wird geladen...
          </div>
        ) : null}
        {renderStatus === "error" ? (
          <div className="source-render-state source-render-error" role="alert">
            <strong>Dokumentseite konnte nicht angezeigt werden.</strong>
            <span>{renderError}</span>
          </div>
        ) : null}
      </div>
      <footer
        className={`source-evidence-status state-${evidencePresentation.toLocaleLowerCase("de")}`}
        data-evidence-presentation={evidencePresentation.toLocaleLowerCase("de")}
      >
        {evidencePresentation === "VISIBLE_VERIFIED" ? (
          <>
            <Info size={15} />
            Die Fundstelle der gewählten Position ist im Originaldokument markiert.
          </>
        ) : evidencePresentation === "VISIBLE_UNCONFIRMED" ? (
          <>
            <AlertTriangle size={15} />
            {ocrLabel
              ? "Per OCR gelesen; Text, Fundstelle und Zuordnung manuell prüfen."
              : "Markierung automatisch ermittelt; Fundstelle und Zuordnung prüfen."}
          </>
        ) : evidencePresentation === "LOADING" ? (
          "Fundstelle wird geladen..."
        ) : evidencePresentation === "OFF_PAGE" ? (
          "Auf dieser Seite ist keine aktive Markierung sichtbar."
        ) : evidencePresentation === "ERROR" ? (
          "Fundstelle konnte nicht angezeigt werden."
        ) : (
          "Dokumentkontext verfügbar; genaue Fundstelle muss geprüft werden."
        )}
      </footer>
    </section>
  );
}

export function SourceOverlay({
  sources,
  activeKey,
  initialView,
  onViewChange,
  onSelect,
  onClose
}: {
  sources: SourceRecord[];
  activeKey: string;
  initialView?: SourceViewState | null;
  onViewChange?: (state: SourceViewState) => void;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const activeSource = sources.find((source) => source.key === activeKey) ?? sources[0];
  const ocrLabel = activeSource ? sourceOcrLabel(activeSource) : null;
  const [pageNumber, setPageNumber] = useState(
    initialView?.pageNumber ?? activeSource?.pageNumber ?? 1
  );
  const [zoom, setZoom] = useState(initialView?.zoom ?? 1);
  const [fitMode, setFitMode] = useState<FitMode>(initialView?.fitMode ?? "CONTEXT");
  const [scroll, setScroll, updateScroll] = useDeferredScrollPosition({
    left: initialView?.scrollLeft ?? 0,
    top: initialView?.scrollTop ?? 0
  });
  const [showHighlight, setShowHighlight] = useState(true);
  const [showDetails, setShowDetails] = useState(true);
  const [renderStatus, setRenderStatus] = useState<RenderStatus>("loading");
  const [renderError, setRenderError] = useState("");
  const [evidencePresentation, setEvidencePresentation] =
    useState<PdfEvidencePresentationState>("LOADING");
  const [renderKey, setRenderKey] = useState(0);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    onViewChange?.({
      pageNumber,
      zoom,
      fitMode,
      scrollLeft: scroll.left,
      scrollTop: scroll.top
    });
  }, [fitMode, onViewChange, pageNumber, scroll.left, scroll.top, zoom]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const updateStatus = useCallback((status: RenderStatus, message = "") => {
    setRenderStatus(status);
    setRenderError(message);
  }, []);
  const updateDimensions = useCallback(
    (dimensions: { width: number; height: number }) => setCanvasDimensions(dimensions),
    []
  );

  const sourceTabs = useMemo(
    () => Array.from(new Set(sources.map((source) => source.tabLabel))),
    [sources]
  );
  const activeTabSources = sources.filter((source) => source.tabLabel === activeSource?.tabLabel);
  const sidebarSources = activeTabSources.filter(
    (source, index, all) =>
      !source.lineId || all.findIndex((candidate) => candidate.lineId === source.lineId) === index
  );
  const offerSources = sources.filter(
    (source, index, all) =>
      source.kind === "supplier" &&
      Boolean(source.supplierOptionId) &&
      all.findIndex(
        (candidate) =>
          candidate.kind === "supplier" && candidate.supplierOptionId === source.supplierOptionId
      ) === index
  );
  const activeOfferIndex = offerSources.findIndex(
    (source) => source.supplierOptionId === activeSource?.supplierOptionId
  );
  const continuation = sources.find(
    (source) =>
      source.key !== activeSource?.key &&
      source.documentId === activeSource?.documentId &&
      source.lineId === activeSource?.lineId &&
      source.pageNumber !== activeSource?.pageNumber
  );
  const changePage = useCallback(
    (requestedPage: number) => {
      const next = resolveSourcePageChange({
        currentPage: pageNumber,
        requestedPage,
        pageCount: activeSource?.pageCount ?? 1,
        scroll
      });
      setScroll(next.scroll);
      setPageNumber(next.pageNumber);
    },
    [activeSource?.pageCount, pageNumber, scroll, setScroll]
  );
  if (!activeSource) return null;

  return (
    <div className="source-overlay-backdrop" role="presentation">
      <div
        className={`source-overlay ${showDetails ? "" : "details-hidden"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-overlay-title"
        tabIndex={-1}
        ref={dialogRef}
        data-source-overlay
        data-extraction-source={ocrLabel ? "ocr" : "native"}
        data-source-fit-mode={fitMode.toLocaleLowerCase("de")}
        data-evidence-presentation={evidencePresentation.toLocaleLowerCase("de")}
      >
        <header className="source-overlay-header">
          <div>
            <strong id="source-overlay-title">
              {activeSource.kind === "basis" ? (
                "Basis-LV"
              ) : (
                <BrandMark
                  resolution={resolveSupplierBrand(activeSource.supplier)}
                  label={activeSource.supplier ?? "Unbekannter Lieferant"}
                  compact
                />
              )}
            </strong>
            <span>
              {activeSource.positionNumber} · Seite {pageNumber} von {activeSource.pageCount}
            </span>
            {ocrLabel ? (
              <span className="source-ocr-badge" data-ocr-source>
                {ocrLabel}
              </span>
            ) : null}
          </div>
          <nav className="source-tabs" aria-label="Quellen">
            {sourceTabs.map((tab) => {
              const record = sources.find((source) => source.tabLabel === tab);
              return (
                <button
                  key={tab}
                  className={activeSource.tabLabel === tab ? "active" : ""}
                  onClick={() => record && onSelect(record.key)}
                >
                  {tab}
                </button>
              );
            })}
          </nav>
          <button className="source-close" onClick={onClose} aria-label="Quelle schließen">
            <X size={20} />
          </button>
        </header>

        <div className="source-overlay-toolbar">
          <button
            className={fitMode === "CONTEXT" ? "active" : ""}
            onClick={() => {
              setFitMode("CONTEXT");
              setZoom(1);
            }}
            aria-pressed={fitMode === "CONTEXT"}
          >
            Kontext
          </button>
          <button
            className={fitMode === "EVIDENCE" ? "active" : ""}
            onClick={() => {
              setFitMode("EVIDENCE");
              setZoom(1);
            }}
            aria-pressed={fitMode === "EVIDENCE"}
          >
            Markierung
          </button>
          <button
            className={fitMode === "PAGE" ? "active" : ""}
            onClick={() => {
              setFitMode("PAGE");
              setZoom(1);
            }}
          >
            Seite anpassen
          </button>
          <button
            className={fitMode === "WIDTH" ? "active" : ""}
            onClick={() => {
              setFitMode("WIDTH");
              setZoom(1);
            }}
          >
            Breite anpassen
          </button>
          <button
            onClick={() => {
              setFitMode("CUSTOM");
              setZoom((value) => clamp(value - 0.1, 0.5, 3));
            }}
            aria-label="Verkleinern"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={() => {
              setFitMode("CUSTOM");
              setZoom(1);
            }}
            aria-label="Zoom auf 100 Prozent zurücksetzen"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => {
              setFitMode("CUSTOM");
              setZoom((value) => clamp(value + 0.1, 0.5, 3));
            }}
            aria-label="Vergrößern"
          >
            <Plus size={16} />
          </button>
          <button onClick={() => setShowHighlight((value) => !value)}>
            {showHighlight ? <EyeOff size={16} /> : <Eye size={16} />}
            Markierung {showHighlight ? "ausblenden" : "einblenden"}
          </button>
          <button onClick={() => setShowDetails((value) => !value)}>
            {showDetails ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            Details {showDetails ? "ausblenden" : "einblenden"}
          </button>
          <i />
          <button
            onClick={() => changePage(pageNumber - 1)}
            disabled={pageNumber <= 1}
            aria-label="Vorherige Seite"
          >
            <ChevronLeft size={16} />
          </button>
          <span aria-live="polite">
            Seite {pageNumber} von {activeSource.pageCount}
          </span>
          <button
            onClick={() => changePage(pageNumber + 1)}
            disabled={pageNumber >= activeSource.pageCount}
            aria-label="Nächste Seite"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {activeSource.kind === "supplier" && offerSources.length > 1 ? (
          <nav className="source-sequence-toolbar" aria-label="Angebote durchsehen">
            <button
              disabled={activeOfferIndex <= 0}
              onClick={() => onSelect(offerSources[activeOfferIndex - 1].key)}
            >
              Vorheriges Angebot
            </button>
            <span>
              Angebot {activeOfferIndex + 1} von {offerSources.length}
            </span>
            <button
              disabled={activeOfferIndex < 0 || activeOfferIndex >= offerSources.length - 1}
              onClick={() => onSelect(offerSources[activeOfferIndex + 1].key)}
            >
              Nächstes Angebot
            </button>
          </nav>
        ) : null}

        <div className="source-overlay-body">
          <main className="source-viewer">
            <PdfCanvas
              key={`${activeSource.key}:${renderKey}`}
              source={activeSource}
              pageNumber={pageNumber}
              zoom={zoom}
              fitMode={fitMode}
              showHighlight={showHighlight && renderStatus === "ready"}
              renderStatus={renderStatus}
              onStatus={updateStatus}
              onEvidencePresentation={setEvidencePresentation}
              onPageRendered={updateDimensions}
              initialScroll={scroll}
              onScrollChange={updateScroll}
            />
            {renderStatus === "loading" ? (
              <div className="source-render-state">Dokumentseite wird geladen...</div>
            ) : null}
            {renderStatus === "error" ? (
              <div className="source-render-state source-render-error" role="alert">
                <strong>Dokumentseite konnte nicht angezeigt werden.</strong>
                <span>{renderError}</span>
                <div>
                  <button onClick={() => setRenderKey((value) => value + 1)}>
                    <RefreshCw size={16} /> Erneut laden
                  </button>
                  <a href={pdfUrl(activeSource)} target="_blank" rel="noreferrer">
                    Dokument lokal öffnen
                  </a>
                  <button onClick={onClose}>Zurück zur Position</button>
                </div>
              </div>
            ) : null}
          </main>

          {showDetails ? (
            <aside className="source-information">
              <span className="source-type">
                {activeSource.kind === "basis"
                  ? "LV-Anforderung"
                  : activeSource.displayRole
                    ? supplierDisplayRoleLabel(activeSource.displayRole)
                    : lineRoleLabel(activeSource.lineRole)}
              </span>
              <h2>{activeSource.title}</h2>
              <p>{activeSource.description}</p>
              {evidencePresentation === "VISIBLE_UNCONFIRMED" ? (
                <p className="source-context-only">
                  {ocrLabel
                    ? "Per OCR gelesen; Text und Fundstelle manuell prüfen"
                    : "Markierung automatisch ermittelt; Fundstelle prüfen"}
                </p>
              ) : !showHighlight ? (
                <p className="source-context-only">Markierung ist ausgeblendet</p>
              ) : !["VISIBLE_VERIFIED", "LOADING"].includes(evidencePresentation) ? (
                <p className="source-context-only">Genaue Markierung nicht verfügbar</p>
              ) : null}
              {activeSource.kind === "supplier" ? (
                <dl className="source-active-summary">
                  <div>
                    <dt>Supplier-Position</dt>
                    <dd>{activeSource.supplierPositionNumber ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Basis-Referenz</dt>
                    <dd>{activeSource.positionNumber}</dd>
                  </div>
                  <div>
                    <dt>Artikel</dt>
                    <dd>{activeSource.articleNumber ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Menge</dt>
                    <dd>
                      {formatNumber(activeSource.quantity)} {activeSource.unit ?? ""}
                    </dd>
                  </div>
                  <div>
                    <dt>EP</dt>
                    <dd>{formatCurrency(activeSource.unitPrice ?? null)}</dd>
                  </div>
                  <div>
                    <dt>GP</dt>
                    <dd>{formatCurrency(activeSource.totalPrice ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Angebot</dt>
                    <dd>{activeSource.offerNumber ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Seite</dt>
                    <dd>{activeSource.pageNumber}</dd>
                  </div>
                </dl>
              ) : null}
              {activeSource.kind === "supplier" && sidebarSources.length > 1 ? (
                <section className="source-line-list">
                  <h3>Weitere Zeilen dieses Angebots</h3>
                  {sidebarSources.map((source) => (
                    <button
                      key={source.key}
                      className={source.key === activeSource.key ? "active" : ""}
                      onClick={() => onSelect(source.key)}
                    >
                      <span>
                        {source.displayRole
                          ? supplierDisplayRoleLabel(source.displayRole)
                          : lineRoleLabel(source.lineRole)}
                      </span>
                      <strong>
                        POS {source.supplierPositionNumber ?? "—"} · Art.{" "}
                        {source.articleNumber ?? "—"}
                      </strong>
                      <p>{source.description}</p>
                      <small>
                        {formatNumber(source.quantity)} {source.unit ?? ""} · EP{" "}
                        {formatCurrency(source.unitPrice ?? null)} · GP{" "}
                        {formatCurrency(source.totalPrice ?? null)} · Seite {source.pageNumber}
                      </small>
                    </button>
                  ))}
                </section>
              ) : null}
              <dl>
                <div>
                  <dt>Dokument</dt>
                  <dd>{activeSource.documentLabel}</dd>
                </div>
                {activeSource.kind === "basis" && activeSource.offerNumber ? (
                  <div>
                    <dt>Angebotsnummer</dt>
                    <dd>{activeSource.offerNumber}</dd>
                  </div>
                ) : null}
                {activeSource.date ? (
                  <div>
                    <dt>Datum</dt>
                    <dd>{activeSource.date}</dd>
                  </div>
                ) : null}
                {activeSource.revision ? (
                  <div>
                    <dt>Revision</dt>
                    <dd>{activeSource.revision}</dd>
                  </div>
                ) : null}
                {activeSource.kind === "basis" ? (
                  <>
                    <div>
                      <dt>Seite</dt>
                      <dd>{pageNumber}</dd>
                    </div>
                    <div>
                      <dt>Menge</dt>
                      <dd>
                        {formatNumber(activeSource.quantity)} {activeSource.unit ?? ""}
                      </dd>
                    </div>
                  </>
                ) : null}
                {activeSource.manufacturer ? (
                  <div>
                    <dt>Hersteller</dt>
                    <dd>{activeSource.manufacturer}</dd>
                  </div>
                ) : null}
                {activeSource.kind === "basis" && activeSource.articleNumber ? (
                  <div>
                    <dt>Artikel</dt>
                    <dd>{activeSource.articleNumber}</dd>
                  </div>
                ) : null}
              </dl>

              {continuation ? (
                <button className="source-continuation" onClick={() => onSelect(continuation.key)}>
                  Nächste Belegseite · Seite {continuation.pageNumber}
                </button>
              ) : null}

              <section className="source-document-context">
                <h3>Dokumentkontext</h3>
                <ul>
                  {activeSource.context.map((item) => (
                    <li key={item.key} className={item.active ? "active" : ""}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              </section>
              <small className="source-canvas-dimensions">
                Darstellung {Math.round(canvasDimensions.width)} ×{" "}
                {Math.round(canvasDimensions.height)} px
              </small>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
