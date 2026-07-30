import type { BrowserPdfInspection } from "@/browser-projects/document-classification";

function rawPdfText(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  return [...raw.matchAll(/\(([^()]*)\)\s*Tj/g)]
    .map((match) =>
      match[1]
        .replace(/\\n/g, "\n")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
    )
    .join("\n");
}

function sampledPages(pageCount: number): number[] {
  const pages = new Set<number>();
  for (let page = 1; page <= Math.min(5, pageCount); page += 1) pages.add(page);
  if (pageCount > 5) {
    pages.add(Math.ceil(pageCount / 3));
    pages.add(Math.ceil((pageCount * 2) / 3));
    pages.add(pageCount);
  }
  return [...pages].sort((left, right) => left - right);
}

export async function inspectBrowserPdf(
  bytes: Uint8Array
): Promise<BrowserPdfInspection> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (typeof window !== "undefined") {
      pdfjs.GlobalWorkerOptions.workerSrc = "/api/local/pdf-worker";
    }
    const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
    const pdf = await loadingTask.promise;
    const metadata = await pdf
      .getMetadata()
      .then((value) => value.info as Record<string, unknown>)
      .catch(() => ({}));
    const pages = sampledPages(pdf.numPages);
    const pageTexts: string[] = [];
    let pagesWithText = 0;
    for (const pageNumber of pages) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length >= 20) pagesWithText += 1;
      pageTexts.push(text);
    }
    await loadingTask.destroy();
    const extractedText = pageTexts.join("\n");
    const fallbackText = rawPdfText(bytes);
    const text =
      extractedText.replace(/\s+/g, "").length >= 40
        ? extractedText
        : fallbackText || extractedText;
    return {
      pageCount: pdf.numPages,
      metadata,
      text,
      textLayerCharacterCount: text.replace(/\s+/g, "").length,
      inspectedPageCount: pages.length,
      pagesWithText
    };
  } catch {
    const text = rawPdfText(bytes);
    const pageCount = Math.max(
      1,
      new TextDecoder("latin1").decode(bytes).match(/\/Type\s*\/Page\b/g)
        ?.length ?? 0
    );
    return {
      pageCount,
      metadata: {},
      text,
      textLayerCharacterCount: text.replace(/\s+/g, "").length,
      inspectedPageCount: 1,
      pagesWithText: text.trim() ? 1 : 0
    };
  }
}
