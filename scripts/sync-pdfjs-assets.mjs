import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "public", "pdfjs");
const expectedVersion = "6.3.289";

const assets = [
  [
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    "pdf.worker.min.mjs"
  ],
  ["node_modules/pdfjs-dist/wasm/jbig2.wasm", "wasm/jbig2.wasm"],
  ["node_modules/pdfjs-dist/wasm/jbig2_nowasm_fallback.js", "wasm/jbig2_nowasm_fallback.js"],
  ["node_modules/pdfjs-dist/wasm/openjpeg.wasm", "wasm/openjpeg.wasm"],
  ["node_modules/pdfjs-dist/wasm/openjpeg_nowasm_fallback.js", "wasm/openjpeg_nowasm_fallback.js"],
  ["node_modules/pdfjs-dist/wasm/qcms_bg.wasm", "wasm/qcms_bg.wasm"],
  ["node_modules/pdfjs-dist/wasm/quickjs-eval.js", "wasm/quickjs-eval.js"],
  ["node_modules/pdfjs-dist/wasm/quickjs-eval.wasm", "wasm/quickjs-eval.wasm"],
  ["node_modules/pdfjs-dist/wasm/LICENSE_JBIG2", "wasm/LICENSE_JBIG2"],
  ["node_modules/pdfjs-dist/wasm/LICENSE_OPENJPEG", "wasm/LICENSE_OPENJPEG"],
  ["node_modules/pdfjs-dist/wasm/LICENSE_PDFJS_JBIG2", "wasm/LICENSE_PDFJS_JBIG2"],
  ["node_modules/pdfjs-dist/wasm/LICENSE_PDFJS_OPENJPEG", "wasm/LICENSE_PDFJS_OPENJPEG"],
  ["node_modules/pdfjs-dist/wasm/LICENSE_PDFJS_QCMS", "wasm/LICENSE_PDFJS_QCMS"],
  ["node_modules/pdfjs-dist/wasm/LICENSE_QCMS", "wasm/LICENSE_QCMS"],
  ["node_modules/pdfjs-dist/LICENSE", "licenses/APACHE-2.0.txt"]
];

async function sha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  const packageMetadata = JSON.parse(
    await readFile(path.join(root, "node_modules", "pdfjs-dist", "package.json"), "utf8")
  );
  if (packageMetadata.version !== expectedVersion) {
    throw new Error(
      `pdfjs-dist: expected ${expectedVersion}, found ${packageMetadata.version ?? "unknown"}`
    );
  }

  const resolvedOutput = path.resolve(outputRoot);
  const expectedOutput = path.resolve(root, "public", "pdfjs");
  if (resolvedOutput !== expectedOutput || path.dirname(resolvedOutput) === root) {
    throw new Error(`Refusing to replace unsafe PDF.js output path: ${resolvedOutput}`);
  }
  await rm(resolvedOutput, { recursive: true, force: true });
  await mkdir(resolvedOutput, { recursive: true });

  const files = [];
  for (const [sourceRelative, destinationRelative] of assets) {
    const source = path.join(root, ...sourceRelative.split("/"));
    const destination = path.join(resolvedOutput, ...destinationRelative.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
    files.push({
      path: destinationRelative,
      bytes: (await readFile(destination)).byteLength,
      sha256: await sha256(destination)
    });
  }

  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/sync-pdfjs-assets.mjs",
    packages: {
      "pdfjs-dist": {
        version: packageMetadata.version,
        license: packageMetadata.license
      }
    },
    files
  };
  await writeFile(
    path.join(resolvedOutput, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(
    `PDF.js assets synchronized: ${files.length} files (${files.reduce((sum, file) => sum + file.bytes, 0)} bytes)\n`
  );
}

await main();
