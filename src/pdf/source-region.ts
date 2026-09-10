// Pure PDF text-layer geometry shared by browser extraction and source viewers.
export type NormalizedPdfRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfTextGeometryItem = {
  str: string;
  width: number;
  height: number;
  transform: number[];
};

export type PdfPositionMarker = {
  positionNumber: string;
  kind: "SUPPLIER" | "LV";
  form: "EXPLICIT" | "PARENTHESIZED" | "BARE";
  lineIndex: number;
  x: number;
  y: number;
};

export type PdfPageGeometry = {
  pageWidth: number;
  pageHeight: number;
  /** PDF.js PageViewport.transform for the same viewport dimensions. */
  viewportTransform?: readonly number[];
};

type IndexedTextItem = {
  text: string;
  region: NormalizedPdfRegion;
};

type PositionMarker = {
  lineIndex: number;
  x: number;
  value: string;
  kind: "SUPPLIER" | "LV";
  form: PdfPositionMarker["form"];
  start: number;
  end: number;
};

type VisualLine = {
  index: number;
  text: string;
  items: IndexedTextItem[];
  spans: Array<{ start: number; end: number; item: IndexedTextItem }>;
  top: number;
  bottom: number;
};

type MarkerGroup = {
  lineIndex: number;
  x: number;
  values: Set<string>;
  markers: PositionMarker[];
};

const sourceRegionHorizontalPadding = 0.004;
const sourceRegionVerticalPadding = 0.006;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedPosition(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, ".")
    .replace(/^\.|\.$/g, "")
    .toLocaleLowerCase("de");
}

function normalizedWords(value: string): string[] {
  return Array.from(
    new Set(
      value
        .normalize("NFKC")
        .replace(/\u00ad/g, "")
        .replace(/([\p{L}\p{N}])-\s+(?=[\p{L}\p{N}])/gu, "$1")
        .toLocaleLowerCase("de")
        .match(/[\p{L}\p{N}]{4,}/gu) ?? []
    )
  ).slice(0, 64);
}

function regionForItem(
  item: PdfTextGeometryItem,
  page: PdfPageGeometry
): NormalizedPdfRegion | null {
  const { pageWidth, pageHeight } = page;
  if (
    !item.str.trim() ||
    !Number.isFinite(pageWidth) ||
    !Number.isFinite(pageHeight) ||
    pageWidth <= 0 ||
    pageHeight <= 0 ||
    item.transform.length < 6
  ) {
    return null;
  }
  const viewportTransform = page.viewportTransform ?? [1, 0, 0, -1, 0, pageHeight];
  if (
    viewportTransform.length < 6 ||
    !viewportTransform.slice(0, 6).every(Number.isFinite) ||
    !item.transform.slice(0, 6).every(Number.isFinite) ||
    !Number.isFinite(item.width) ||
    item.width <= 0
  ) {
    return null;
  }

  const [viewportA, viewportB, viewportC, viewportD, viewportE, viewportF] = viewportTransform;
  const transformPoint = (x: number, y: number): [number, number] => [
    viewportA * x + viewportC * y + viewportE,
    viewportB * x + viewportD * y + viewportF
  ];
  const transformVector = (x: number, y: number): [number, number] => [
    viewportA * x + viewportC * y,
    viewportB * x + viewportD * y
  ];

  const [textA, textB, textC, textD, textX, textY] = item.transform;
  const baselineLength = Math.hypot(textA, textB);
  if (baselineLength <= Number.EPSILON) return null;
  const horizontal = transformVector(
    (textA / baselineLength) * item.width,
    (textB / baselineLength) * item.width
  );
  const itemHeight = Math.max(
    Number.isFinite(item.height) ? item.height : 0,
    Math.hypot(textC, textD),
    1
  );
  const verticalLength = Math.hypot(textC, textD);
  const vertical =
    verticalLength > Number.EPSILON
      ? transformVector(
          (textC / verticalLength) * itemHeight,
          (textD / verticalLength) * itemHeight
        )
      : transformVector(
          (-textB / baselineLength) * itemHeight,
          (textA / baselineLength) * itemHeight
        );
  const origin = transformPoint(textX, textY);
  const corners = [
    origin,
    [origin[0] + horizontal[0], origin[1] + horizontal[1]],
    [origin[0] + vertical[0], origin[1] + vertical[1]],
    [origin[0] + horizontal[0] + vertical[0], origin[1] + horizontal[1] + vertical[1]]
  ];
  const x = clamp(Math.min(...corners.map(([cornerX]) => cornerX)) / pageWidth, 0, 1);
  const y = clamp(Math.min(...corners.map(([, cornerY]) => cornerY)) / pageHeight, 0, 1);
  const right = clamp(Math.max(...corners.map(([cornerX]) => cornerX)) / pageWidth, 0, 1);
  const bottom = clamp(Math.max(...corners.map(([, cornerY]) => cornerY)) / pageHeight, 0, 1);
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function visualLines(
  input: PdfPageGeometry & {
    items: readonly PdfTextGeometryItem[];
  }
): VisualLine[] {
  const items = input.items
    .flatMap((item): IndexedTextItem[] => {
      const text = item.str.normalize("NFKC").replace(/\s+/g, " ").trim();
      const region = regionForItem(item, input);
      return text && region ? [{ text, region }] : [];
    })
    .sort((left, right) => left.region.y - right.region.y || left.region.x - right.region.x);
  const grouped: IndexedTextItem[][] = [];
  for (const item of items) {
    let line: IndexedTextItem[] | undefined;
    for (let index = grouped.length - 1; index >= 0; index -= 1) {
      if (grouped[index].some((current) => isSameVisualLine(current, item))) {
        line = grouped[index];
        break;
      }
    }
    if (line) line.push(item);
    else grouped.push([item]);
  }
  return grouped.map((lineItems, index) => {
    const sorted = [...lineItems].sort((left, right) => left.region.x - right.region.x);
    let text = "";
    const spans: VisualLine["spans"] = [];
    for (const item of sorted) {
      if (text) text += " ";
      const start = text.length;
      text += item.text;
      spans.push({ start, end: text.length, item });
    }
    return {
      index,
      text,
      items: sorted,
      spans,
      top: Math.min(...sorted.map((item) => item.region.y)),
      bottom: Math.max(...sorted.map((item) => item.region.y + item.region.height))
    };
  });
}

const flexibleLvNumber = String.raw`\d+(?:(?:\s*\.\s*|\s+)\d+){2,}`;

function markerX(line: VisualLine, start: number, end: number): number | null {
  const items = line.spans
    .filter((span) => span.end > start && span.start < end)
    .map((span) => span.item);
  return items.length ? Math.min(...items.map((item) => item.region.x)) : null;
}

function linePositionMarkers(line: VisualLine): PositionMarker[] {
  const found: Array<PositionMarker & { start: number; end: number }> = [];
  const add = (
    match: RegExpMatchArray,
    value: string,
    kind: PositionMarker["kind"],
    form: PositionMarker["form"]
  ) => {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const x = markerX(line, start, end);
    const normalized = normalizedPosition(value);
    if (x === null || !normalized) return;
    found.push({
      lineIndex: line.index,
      x,
      value: normalized,
      kind,
      form,
      start,
      end
    });
  };
  for (const match of line.text.matchAll(/\bAngebotsposition\s+([\p{L}\p{N}./-]+)\b/giu)) {
    add(match, match[1], "SUPPLIER", "EXPLICIT");
  }
  const explicitPattern = new RegExp(
    String.raw`\b(?:Position|LVNR|(?:zu\s+)?LV-Pos(?:ition)?\.?)\s*:?\s*(${flexibleLvNumber})\.?\b`,
    "giu"
  );
  for (const match of line.text.matchAll(explicitPattern)) {
    add(match, match[1], "LV", "EXPLICIT");
  }
  const parenthesizedPattern = new RegExp(String.raw`\((${flexibleLvNumber})\)`, "gu");
  for (const match of line.text.matchAll(parenthesizedPattern)) {
    add(match, match[1], "LV", "PARENTHESIZED");
  }
  for (const match of line.text.matchAll(/\b(\d+(?:\s*\.\s*\d+){2,})\.?\b/gu)) {
    const start = match.index ?? 0;
    const containing = line.spans.find(
      (span) => span.start <= start && span.end >= start + match[1].length
    );
    if (!containing) continue;
    const localPrefix = containing.item.text.slice(0, start - containing.start);
    if (localPrefix.trim()) continue;
    add(match, match[1], "LV", "BARE");
  }
  return found
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter(
      (marker, index, all) =>
        index === 0 ||
        !all
          .slice(0, index)
          .some(
            (previous) =>
              previous.value === marker.value &&
              previous.start <= marker.start &&
              previous.end >= marker.end
          )
    )
    .map((marker) => ({
      lineIndex: marker.lineIndex,
      x: marker.x,
      value: marker.value,
      kind: marker.kind,
      form: marker.form,
      start: marker.start,
      end: marker.end
    }));
}

function markerGroups(lines: readonly VisualLine[]): MarkerGroup[] {
  const groups: MarkerGroup[] = [];
  for (const line of lines) {
    for (const marker of linePositionMarkers(line)) {
      const current = groups.find(
        (group) => group.lineIndex === marker.lineIndex && Math.abs(group.x - marker.x) <= 0.22
      );
      if (current) {
        current.markers.push(marker);
        current.values.add(marker.value);
        current.x = Math.min(current.x, marker.x);
      } else {
        groups.push({
          lineIndex: marker.lineIndex,
          x: marker.x,
          values: new Set([marker.value]),
          markers: [marker]
        });
      }
    }
  }
  return groups.sort((left, right) => left.lineIndex - right.lineIndex || left.x - right.x);
}

export function findPdfPositionMarkers(
  input: PdfPageGeometry & {
    items: readonly PdfTextGeometryItem[];
  }
): PdfPositionMarker[] {
  const lines = visualLines(input);
  return lines.flatMap((line) =>
    linePositionMarkers(line).map((marker) => ({
      positionNumber: marker.value,
      kind: marker.kind,
      form: marker.form,
      lineIndex: marker.lineIndex,
      x: marker.x,
      y: line.top
    }))
  );
}

export function pdfTextInVisualOrder(
  input: PdfPageGeometry & {
    items: readonly PdfTextGeometryItem[];
  }
): string {
  return visualLines(input)
    .map((line) => line.text)
    .join("\n");
}

function unionRegion(items: readonly IndexedTextItem[]): NormalizedPdfRegion | null {
  if (!items.length) return null;
  const x = Math.min(...items.map((item) => item.region.x));
  const y = Math.min(...items.map((item) => item.region.y));
  const right = Math.max(...items.map((item) => item.region.x + item.region.width));
  const bottom = Math.max(...items.map((item) => item.region.y + item.region.height));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function isSameVisualLine(left: IndexedTextItem, right: IndexedTextItem): boolean {
  const overlap =
    Math.min(left.region.y + left.region.height, right.region.y + right.region.height) -
    Math.max(left.region.y, right.region.y);
  return overlap >= Math.min(left.region.height, right.region.height) * 0.5;
}

const markerColumnTolerance = 0.11;

function sameMarkerColumn(left: MarkerGroup, right: MarkerGroup): boolean {
  return Math.abs(left.x - right.x) <= markerColumnTolerance;
}

function positionFamily(value: string): string | null {
  const segments = value.split(".");
  if (segments.length < 3 || segments.some((segment) => !/^\d+$/u.test(segment))) {
    return null;
  }
  return segments.slice(0, -1).join(".");
}

function isPlausibleFollowingMarker(
  current: MarkerGroup,
  candidate: MarkerGroup,
  lines: readonly VisualLine[]
): boolean {
  if (candidate.markers.some((marker) => marker.form === "EXPLICIT")) {
    return true;
  }
  const currentFamilies = new Set(
    [...current.values].map(positionFamily).filter((value): value is string => value !== null)
  );
  if (
    [...candidate.values].some((value) => {
      const family = positionFamily(value);
      return family !== null && currentFamilies.has(family);
    })
  ) {
    return true;
  }
  const line = lines[candidate.lineIndex];
  return Boolean(line?.items.some((item) => item.region.x >= candidate.x + markerColumnTolerance));
}

function columnBounds(
  target: MarkerGroup,
  markers: readonly MarkerGroup[]
): { left: number; right: number } {
  const clusters: Array<{ center: number; markers: MarkerGroup[] }> = [];
  for (const marker of [...markers].sort((left, right) => left.x - right.x)) {
    const cluster = clusters.find(
      (candidate) => Math.abs(candidate.center - marker.x) <= markerColumnTolerance
    );
    if (cluster) {
      cluster.markers.push(marker);
      cluster.center =
        cluster.markers.reduce((sum, item) => sum + item.x, 0) / cluster.markers.length;
    } else {
      clusters.push({ center: marker.x, markers: [marker] });
    }
  }
  const targetCluster = clusters.find((cluster) => cluster.markers.includes(target));
  if (!targetCluster) return { left: 0, right: 1 };
  const structural = clusters
    .filter(
      (cluster) =>
        cluster === targetCluster ||
        (cluster.markers.length >= 2 && Math.abs(cluster.center - targetCluster.center) >= 0.25)
    )
    .sort((left, right) => left.center - right.center);
  const index = structural.indexOf(targetCluster);
  return {
    left: index > 0 ? (structural[index - 1].center + targetCluster.center) / 2 : 0,
    right:
      index >= 0 && index < structural.length - 1
        ? (targetCluster.center + structural[index + 1].center) / 2
        : 1
  };
}

function itemInColumn(item: IndexedTextItem, bounds: { left: number; right: number }): boolean {
  const center = item.region.x + item.region.width / 2;
  return center >= bounds.left && center < bounds.right;
}

function isExplicitFooter(line: VisualLine): boolean {
  return line.items.some((item) =>
    /^(?:Druckdatum\b|Seite\s*:?\s*\d+(?:\s*(?:von|\/)\s*\d+)?\b|Page\s*:?\s*\d+(?:\s*(?:of|\/)\s*\d+)?\b)/iu.test(
      item.text
    )
  );
}

function inferredFooterTop(lines: readonly VisualLine[]): number | null {
  const clusters = lines.reduce<Array<{ top: number; bottom: number; visualRowCount: number }>>(
    (result, line) => {
      const previous = result.at(-1);
      if (!previous || line.top - previous.bottom >= 0.018) {
        result.push({ top: line.top, bottom: line.bottom, visualRowCount: 1 });
        return result;
      }
      previous.bottom = Math.max(previous.bottom, line.bottom);
      previous.visualRowCount += 1;
      return result;
    },
    []
  );
  return (
    clusters.find(
      (cluster, index) => index > 0 && cluster.top >= 0.9 && cluster.visualRowCount >= 2
    )?.top ?? null
  );
}

function markerStartLineIndex(marker: MarkerGroup, lines: readonly VisualLine[]): number {
  const markerLine = lines[marker.lineIndex];
  const previous = lines[marker.lineIndex - 1];
  if (!markerLine || !previous || !/^\d{1,5}$/u.test(previous.text.trim())) {
    return marker.lineIndex;
  }
  const previousRight = Math.max(
    ...previous.items.map((item) => item.region.x + item.region.width)
  );
  const markerCenter = (markerLine.top + markerLine.bottom) / 2;
  const previousCenter = (previous.top + previous.bottom) / 2;
  return previousRight <= marker.x + 0.02 && Math.abs(markerCenter - previousCenter) <= 0.018
    ? previous.index
    : marker.lineIndex;
}

function isTrailingBareMarker(marker: MarkerGroup, lines: readonly VisualLine[]): boolean {
  const line = lines[marker.lineIndex];
  if (!line) return false;
  return marker.markers.some((candidate) => {
    if (candidate.form !== "BARE") return false;
    const suffix = line.text.slice(candidate.end);
    return /^[\s.:;|,\-–—]*(?:Stat(?:us)?\.?|Waren\s*-?\s*Nr\.?|Artikel\s*-?\s*Nr\.?|Art\.\s*-?\s*Nr\.?|PME)\b/iu.test(
      suffix
    );
  });
}

const nonDiscriminatingDescriptionWords = new Set([
  "artikel",
  "beschreibung",
  "einheit",
  "gesamtpreis",
  "menge",
  "nummer",
  "position",
  "preis",
  "status",
  "waren"
]);

function trailingBlockForMarker(input: {
  marker: MarkerGroup;
  markers: readonly MarkerGroup[];
  lines: readonly VisualLine[];
  descriptionWords: readonly string[];
}): { items: IndexedTextItem[]; text: string } | null {
  const { marker, markers, lines, descriptionWords } = input;
  const bounds = columnBounds(marker, markers);
  const previous = [...markers]
    .reverse()
    .find(
      (candidate) =>
        candidate.lineIndex < marker.lineIndex &&
        candidate.x >= bounds.left &&
        candidate.x < bounds.right &&
        sameMarkerColumn(marker, candidate)
    );
  const candidateLines = lines.filter(
    (line) =>
      line.index > (previous?.lineIndex ?? -1) &&
      line.index <= marker.lineIndex &&
      line.items.some((item) => itemInColumn(item, bounds))
  );
  const contentLines = candidateLines.filter((line) => line.index < marker.lineIndex);
  const discriminatingWords = descriptionWords.filter(
    (word) => !nonDiscriminatingDescriptionWords.has(word)
  );
  const anchorWords = discriminatingWords.length ? discriminatingWords : descriptionWords;
  const firstDescriptionLine = contentLines.find((line) => {
    const text = line.items
      .filter((item) => itemInColumn(item, bounds))
      .map((item) => item.text)
      .join(" ")
      .toLocaleLowerCase("de");
    return anchorWords.some((word) => text.includes(word));
  });
  if (!firstDescriptionLine) return null;

  const blockLines = candidateLines.filter((line) => line.index >= firstDescriptionLine.index);
  const items = blockLines.flatMap((line) =>
    line.items.filter((item) => itemInColumn(item, bounds))
  );
  if (!items.length) return null;
  return {
    items,
    text: items
      .map((item) => item.text)
      .join(" ")
      .toLocaleLowerCase("de")
  };
}

function blockForMarker(input: {
  marker: MarkerGroup;
  markers: readonly MarkerGroup[];
  lines: readonly VisualLine[];
  descriptionWords: readonly string[];
}): {
  items: IndexedTextItem[];
  text: string;
  bottomBoundary?: number;
} | null {
  const { marker, markers, lines, descriptionWords } = input;
  if (isTrailingBareMarker(marker, lines)) {
    return trailingBlockForMarker({ marker, markers, lines, descriptionWords });
  }
  const bounds = columnBounds(marker, markers);
  const next = markers.find(
    (candidate) =>
      candidate.lineIndex > marker.lineIndex &&
      candidate.x >= bounds.left &&
      candidate.x < bounds.right &&
      (sameMarkerColumn(marker, candidate) || isPlausibleFollowingMarker(marker, candidate, lines))
  );
  const startLineIndex = markerStartLineIndex(marker, lines);
  const nextStartLineIndex = next ? markerStartLineIndex(next, lines) : null;
  const beforeBoundary = lines.filter(
    (line) =>
      line.index >= startLineIndex &&
      (nextStartLineIndex === null || line.index < nextStartLineIndex) &&
      line.items.some((item) => itemInColumn(item, bounds))
  );
  const explicitFooter = beforeBoundary.find(
    (line) => line.index > marker.lineIndex && isExplicitFooter(line)
  );
  const inferredFooter = next ? null : inferredFooterTop(beforeBoundary);
  const footerTop = [explicitFooter?.top, inferredFooter]
    .filter((value): value is number => value !== null && value !== undefined)
    .reduce<
      number | null
    >((current, value) => (current === null ? value : Math.min(current, value)), null);
  const blockLines = beforeBoundary.filter((line) => footerTop === null || line.top < footerTop);
  const items = blockLines.flatMap((line) =>
    line.items.filter((item) => itemInColumn(item, bounds))
  );
  if (!items.length) return null;
  return {
    items,
    bottomBoundary:
      nextStartLineIndex === null ? (footerTop ?? undefined) : lines[nextStartLineIndex]?.top,
    text: blockLines
      .flatMap((line) =>
        line.items.filter((item) => itemInColumn(item, bounds)).map((item) => item.text)
      )
      .join(" ")
      .toLocaleLowerCase("de")
  };
}

export function locatePdfSourceRegion(
  input: PdfPageGeometry & {
    items: readonly PdfTextGeometryItem[];
    positionNumber: string;
    supplierPositionNumber?: string | null;
    description: string;
  }
): NormalizedPdfRegion | null {
  const lines = visualLines(input);
  if (!lines.length) return null;
  const markers = markerGroups(lines);
  if (!markers.length) return null;

  const supplierPosition = normalizedPosition(input.supplierPositionNumber);
  const lvPosition = normalizedPosition(input.positionNumber);
  const expected = new Set([supplierPosition, lvPosition].filter((value) => Boolean(value)));
  const descriptionWords = normalizedWords(input.description);
  const candidates = markers.flatMap((marker) => {
    if (![...marker.values].some((value) => expected.has(value))) return [];
    const block = blockForMarker({ marker, markers, lines, descriptionWords });
    if (!block) return [];
    const wordScore = descriptionWords.reduce(
      (score, word) => score + (block.text.includes(word) ? 1 : 0),
      0
    );
    return [{ marker, block, wordScore }];
  });
  if (!candidates.length) return null;
  const ranked = candidates.sort((left, right) => right.wordScore - left.wordScore);
  if (ranked.length > 1 && ranked[0].wordScore === ranked[1].wordScore) {
    return null;
  }
  const region = unionRegion(ranked[0].block.items);
  if (!region) return null;
  const boundary = ranked[0].block.bottomBoundary;
  if (boundary === undefined) return region;
  const safeBottom = Math.min(region.y + region.height, boundary - sourceRegionVerticalPadding);
  return safeBottom > region.y ? { ...region, height: safeBottom - region.y } : null;
}

export function locatePdfContinuationRegion(
  input: PdfPageGeometry & {
    items: readonly PdfTextGeometryItem[];
    continuationText: string;
    nextPositionNumber?: string | null;
  }
): NormalizedPdfRegion | null {
  const lines = visualLines(input);
  if (!lines.length) return null;
  const nextPosition = normalizedPosition(input.nextPositionNumber);
  const nextMarker = nextPosition
    ? markerGroups(lines).find((marker) => marker.values.has(nextPosition))
    : undefined;
  const beforeBoundary = lines.filter(
    (line) =>
      (nextMarker === undefined || line.index < markerStartLineIndex(nextMarker, lines)) &&
      !isExplicitFooter(line)
  );
  const footerTop = nextMarker ? null : inferredFooterTop(beforeBoundary);
  const bounded = beforeBoundary.filter((line) => footerTop === null || line.top < footerTop);
  const words = normalizedWords(input.continuationText).filter(
    (word) => !nonDiscriminatingDescriptionWords.has(word)
  );
  const firstContentIndex = bounded.findIndex((line) => {
    const text = line.text.toLocaleLowerCase("de");
    return words.some((word) => text.includes(word));
  });
  if (firstContentIndex < 0) return null;
  const items = bounded.slice(firstContentIndex).flatMap((line) => line.items);
  return items.length ? unionRegion(items) : null;
}

export function padPdfSourceRegion(region: NormalizedPdfRegion): NormalizedPdfRegion | null {
  if (
    !Number.isFinite(region.x) ||
    !Number.isFinite(region.y) ||
    !Number.isFinite(region.width) ||
    !Number.isFinite(region.height) ||
    region.width <= 0 ||
    region.height <= 0
  ) {
    return null;
  }
  const left = clamp(region.x - sourceRegionHorizontalPadding, 0, 1);
  const top = clamp(region.y - sourceRegionVerticalPadding, 0, 1);
  const right = clamp(region.x + region.width + sourceRegionHorizontalPadding, left, 1);
  const bottom = clamp(region.y + region.height + sourceRegionVerticalPadding, top, 1);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}
