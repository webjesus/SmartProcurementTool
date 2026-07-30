"use client";

import {
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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { formatCurrency, formatNumber, lineRoleLabel } from "./format";
import { supplierDisplayRoleLabel } from "@/domain/supplier-option-read-model";
import { resolveSupplierBrand } from "@/domain/brand-registry";
import type { SourceRecord } from "./types";
import { BrandMark } from "./brand-mark";
import { BoundedAsyncCache } from "./pdf-document-cache";

type RenderStatus = "loading" | "ready" | "error";
export type FitMode = "CONTEXT" | "EVIDENCE" | "PAGE" | "WIDTH" | "CUSTOM";
export type SourceViewState = {
  pageNumber: number;
  zoom: number;
  fitMode: FitMode;
  scrollLeft: number;
  scrollTop: number;
};

type PdfDocumentProxyLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getViewport: (input: { scale: number }) => {
      width: number;
      height: number;
    };
    render: (input: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
      canvas: HTMLCanvasElement;
    }) => { cancel: () => void; promise: Promise<void> };
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
      pdfjs.GlobalWorkerOptions.workerSrc = "/api/local/pdf-worker";
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`PDF ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error("PDF ist leer.");
      const task = pdfjs.getDocument({ data: bytes });
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

function PdfCanvas({
  source,
  pageNumber,
  zoom,
  fitMode,
  showHighlight,
  onStatus,
  onPageRendered,
  initialScroll,
  onScrollChange
}: {
  source: SourceRecord;
  pageNumber: number;
  zoom: number;
  fitMode: FitMode;
  showHighlight: boolean;
  onStatus: (status: RenderStatus, message?: string) => void;
  onPageRendered: (dimensions: { width: number; height: number }) => void;
  initialScroll: { left: number; top: number };
  onScrollChange: (scroll: { left: number; top: number }) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderSequence = useRef(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [renderedSize, setRenderedSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const update = () =>
      setContainerSize({
        width: element.clientWidth,
        height: element.clientHeight
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerSize.width || !containerSize.height || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    const sequence = ++renderSequence.current;

    async function renderPage() {
      onStatus("loading");
      try {
        const { document } = await loadPdf(source);
        if (pageNumber < 1 || pageNumber > document.numPages) {
          throw new Error(`Seite ${pageNumber} ist nicht vorhanden.`);
        }
        const page = await document.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(240, containerSize.width - 40);
        const availableHeight = Math.max(240, containerSize.height - 40);
        const pageFit = Math.min(
          availableWidth / baseViewport.width,
          availableHeight / baseViewport.height
        );
        const widthFit = availableWidth / baseViewport.width;
        const evidence = source.evidence[0]?.region;
        const contextFit = evidence
          ? Math.min(
              widthFit,
              availableHeight /
                (baseViewport.height *
                  clamp(evidence.height + 0.52, 0.65, 1))
            )
          : widthFit;
        const evidenceFit = evidence
          ? Math.min(
              availableWidth /
                (baseViewport.width * Math.max(evidence.width / 0.82, 0.34)),
              availableHeight /
                (baseViewport.height * Math.max(evidence.height / 0.46, 0.2))
            )
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
        const canvas = canvasRef.current;
        if (!canvas || cancelled || sequence !== renderSequence.current) return;
        const ratio = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas ist nicht verfügbar.");
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        renderTask = page.render({
          canvasContext: context,
          viewport,
          canvas
        });
        await renderTask.promise;
        if (cancelled || sequence !== renderSequence.current) return;
        if (isCanvasBlank(canvas)) {
          throw new Error("Die Dokumentseite enthält keine sichtbaren Pixel.");
        }
        const dimensions = { width: viewport.width, height: viewport.height };
        setRenderedSize(dimensions);
        onPageRendered(dimensions);
        onStatus("ready");
        if (initialScroll.left > 0 || initialScroll.top > 0) {
          requestAnimationFrame(() => {
            stageRef.current?.scrollTo({
              left: initialScroll.left,
              top: initialScroll.top,
              behavior: "auto"
            });
          });
        } else if (
          (fitMode === "CONTEXT" || fitMode === "EVIDENCE") &&
          evidence &&
          pageNumber === source.pageNumber
        ) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const stage = stageRef.current;
              if (!stage || cancelled) return;
              const targetX =
                (evidence.x + evidence.width / 2) * viewport.width + 20;
              const targetY =
                (evidence.y + evidence.height / 2) * viewport.height + 20;
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
          typeof error === "object" && error && "name" in error
            ? String(error.name)
            : "";
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
      renderSequence.current += 1;
      renderTask?.cancel();
    };
  }, [
    containerSize.height,
    containerSize.width,
    fitMode,
    onPageRendered,
    onStatus,
    initialScroll.left,
    initialScroll.top,
    pageNumber,
    source,
    zoom
  ]);

  const activeEvidence =
    pageNumber === source.pageNumber ? source.evidence : [];

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
                style={{
                  left: `${clamp(evidence.region.x, 0, 1) * 100}%`,
                  top: `${clamp(evidence.region.y, 0, 1) * 100}%`,
                  width: `${clamp(
                    evidence.region.width,
                    0,
                    1 - clamp(evidence.region.x, 0, 1)
                  ) * 100}%`,
                  height: `${clamp(
                    evidence.region.height,
                    0,
                    1 - clamp(evidence.region.y, 0, 1)
                  ) * 100}%`
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
  const activeSource =
    sources.find((source) => source.key === activeKey) ?? sources[0];
  const [pageNumber, setPageNumber] = useState(
    initialView?.pageNumber ?? activeSource?.pageNumber ?? 1
  );
  const [zoom, setZoom] = useState(initialView?.zoom ?? 1);
  const [fitMode, setFitMode] = useState<FitMode>(
    initialView?.fitMode ?? "CONTEXT"
  );
  const [scroll, setScroll] = useState({
    left: initialView?.scrollLeft ?? 0,
    top: initialView?.scrollTop ?? 0
  });
  const [renderStatus, setRenderStatus] = useState<RenderStatus>("loading");
  const [renderError, setRenderError] = useState("");
  const sourceIndex = sources.findIndex((source) => source.key === activeKey);

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
    >
      <header>
        <div>
          <strong>
            {activeSource.kind === "basis"
              ? "Basis-LV"
              : `Angebot: ${activeSource.supplier ?? "Lieferant"}${
                  activeSource.articleNumber
                    ? ` · Art. ${activeSource.articleNumber}`
                    : ""
                }`}
          </strong>
          <span>
            Seite {pageNumber} von {activeSource.pageCount}
          </span>
        </div>
        <nav>
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
          >
            An Breite anpassen
          </button>
          <button
            onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
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
            onClick={() =>
              setPageNumber((value) =>
                Math.min(activeSource.pageCount, value + 1)
              )
            }
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
          key={`${activeSource.key}:${pageNumber}`}
          source={activeSource}
          pageNumber={pageNumber}
          zoom={zoom}
          fitMode={fitMode}
          showHighlight={renderStatus === "ready"}
          onStatus={updateStatus}
          onPageRendered={ignoreDimensions}
          initialScroll={scroll}
          onScrollChange={setScroll}
        />
        {renderStatus === "loading" ? (
          <div className="source-render-state">
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
      <footer>
        {activeSource.evidence.some(
          (item) => item.region.width > 0 && item.region.height > 0
        ) ? (
          <>
            <Info size={15} />
            Die markierte Position im Originaldokument entspricht der
            ausgewählten Position im Angebot.
          </>
        ) : (
          "Dokumentkontext verfügbar; genaue Markierung fehlt."
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
  const activeSource =
    sources.find((source) => source.key === activeKey) ?? sources[0];
  const [pageNumber, setPageNumber] = useState(
    initialView?.pageNumber ?? activeSource?.pageNumber ?? 1
  );
  const [zoom, setZoom] = useState(initialView?.zoom ?? 1);
  const [fitMode, setFitMode] = useState<FitMode>(
    initialView?.fitMode ?? "CONTEXT"
  );
  const [scroll, setScroll] = useState({
    left: initialView?.scrollLeft ?? 0,
    top: initialView?.scrollTop ?? 0
  });
  const [showHighlight, setShowHighlight] = useState(true);
  const [showDetails, setShowDetails] = useState(true);
  const [renderStatus, setRenderStatus] = useState<RenderStatus>("loading");
  const [renderError, setRenderError] = useState("");
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
    (dimensions: { width: number; height: number }) =>
      setCanvasDimensions(dimensions),
    []
  );

  const sourceTabs = useMemo(
    () => Array.from(new Set(sources.map((source) => source.tabLabel))),
    [sources]
  );
  const activeTabSources = sources.filter(
    (source) => source.tabLabel === activeSource?.tabLabel
  );
  const sidebarSources = activeTabSources.filter(
    (source, index, all) =>
      !source.lineId ||
      all.findIndex((candidate) => candidate.lineId === source.lineId) === index
  );
  const offerSources = sources.filter(
    (source, index, all) =>
      source.kind === "supplier" &&
      Boolean(source.supplierOptionId) &&
      all.findIndex(
        (candidate) =>
          candidate.kind === "supplier" &&
          candidate.supplierOptionId === source.supplierOptionId
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
  const exactRegionAvailable = activeSource?.evidence.some(
    (evidence) => evidence.region.width > 0 && evidence.region.height > 0
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
        data-source-fit-mode={fitMode.toLocaleLowerCase("de")}
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
              {activeSource.positionNumber} · Seite {pageNumber} von{" "}
              {activeSource.pageCount}
            </span>
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
          <button
            className="source-close"
            onClick={onClose}
            aria-label="Quelle schließen"
          >
            <X size={20} />
          </button>
        </header>

        <div className="source-overlay-toolbar">
          <button
            className={fitMode === "CONTEXT" ? "active" : ""}
            onClick={() => { setFitMode("CONTEXT"); setZoom(1); }}
            aria-pressed={fitMode === "CONTEXT"}
          >
            Kontext
          </button>
          <button
            className={fitMode === "EVIDENCE" ? "active" : ""}
            onClick={() => { setFitMode("EVIDENCE"); setZoom(1); }}
            aria-pressed={fitMode === "EVIDENCE"}
          >
            Markierung
          </button>
          <button
            className={fitMode === "PAGE" ? "active" : ""}
            onClick={() => { setFitMode("PAGE"); setZoom(1); }}
          >
            Seite anpassen
          </button>
          <button
            className={fitMode === "WIDTH" ? "active" : ""}
            onClick={() => { setFitMode("WIDTH"); setZoom(1); }}
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
            onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
            disabled={pageNumber <= 1}
            aria-label="Vorherige Seite"
          >
            <ChevronLeft size={16} />
          </button>
          <span aria-live="polite">
            Seite {pageNumber} von {activeSource.pageCount}
          </span>
          <button
            onClick={() =>
              setPageNumber((value) => Math.min(activeSource.pageCount, value + 1))
            }
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
              disabled={
                activeOfferIndex < 0 ||
                activeOfferIndex >= offerSources.length - 1
              }
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
              onStatus={updateStatus}
              onPageRendered={updateDimensions}
              initialScroll={scroll}
              onScrollChange={setScroll}
            />
            {renderStatus === "loading" ? (
              <div className="source-render-state">
                Dokumentseite wird geladen...
              </div>
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
              {!exactRegionAvailable ? (
                <p className="source-context-only">
                  Genaue Markierung nicht verfügbar
                </p>
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
                      {formatNumber(activeSource.quantity)}{" "}
                      {activeSource.unit ?? ""}
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
                        {formatCurrency(source.totalPrice ?? null)} · Seite{" "}
                        {source.pageNumber}
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
                  <div><dt>Angebotsnummer</dt><dd>{activeSource.offerNumber}</dd></div>
                ) : null}
                {activeSource.date ? (
                  <div><dt>Datum</dt><dd>{activeSource.date}</dd></div>
                ) : null}
                {activeSource.revision ? (
                  <div><dt>Revision</dt><dd>{activeSource.revision}</dd></div>
                ) : null}
                {activeSource.kind === "basis" ? (
                  <>
                    <div><dt>Seite</dt><dd>{pageNumber}</dd></div>
                    <div>
                      <dt>Menge</dt>
                      <dd>{formatNumber(activeSource.quantity)} {activeSource.unit ?? ""}</dd>
                    </div>
                  </>
                ) : null}
                {activeSource.manufacturer ? (
                  <div><dt>Hersteller</dt><dd>{activeSource.manufacturer}</dd></div>
                ) : null}
                {activeSource.kind === "basis" && activeSource.articleNumber ? (
                  <div><dt>Artikel</dt><dd>{activeSource.articleNumber}</dd></div>
                ) : null}
              </dl>

              {continuation ? (
                <button
                  className="source-continuation"
                  onClick={() => onSelect(continuation.key)}
                >
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
