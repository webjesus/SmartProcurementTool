import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PdfJsDocumentParser } from "../src/pdf/pdfjs-parser";

async function main() {
  const file = process.argv[2];
  const pageNumber = Number(process.argv[3] ?? 1);
  if (!file) throw new Error("Usage: tsx scripts/render-corpus-page.ts <pdf> [page]");

  const absolute = path.resolve(process.cwd(), file);
  const outputDir = path.resolve(process.cwd(), "tmp", "pdfs");
  await mkdir(outputDir, { recursive: true });
  const output = path.join(
    outputDir,
    `${path.basename(file, path.extname(file)).replace(/[^\p{L}\p{N}]+/gu, "-")}-p${pageNumber}.png`
  );
  const parser = new PdfJsDocumentParser();
  const image = await parser.renderPage(new Uint8Array(await readFile(absolute)), pageNumber, 1.5);
  await writeFile(output, image);
  process.stdout.write(output);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
