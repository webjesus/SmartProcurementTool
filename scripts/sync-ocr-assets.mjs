import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "public", "ocr");
const expectedPackages = {
  "tesseract.js": "7.0.0",
  "tesseract.js-core": "7.0.0",
  "@tesseract.js-data/deu": "1.0.0"
};

const assets = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker/worker.min.js"],
  [
    "node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt",
    "worker/worker.min.js.LICENSE.txt"
  ],
  ["node_modules/tesseract.js-core/tesseract-core.js", "core/tesseract-core.js"],
  [
    "node_modules/tesseract.js-core/tesseract-core.wasm",
    "core/tesseract-core.wasm"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core.wasm.js",
    "core/tesseract-core.wasm.js"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-lstm.js",
    "core/tesseract-core-lstm.js"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-lstm.wasm",
    "core/tesseract-core-lstm.wasm"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
    "core/tesseract-core-lstm.wasm.js"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-simd.js",
    "core/tesseract-core-simd.js"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-simd.wasm",
    "core/tesseract-core-simd.wasm"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-simd.wasm.js",
    "core/tesseract-core-simd.wasm.js"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-simd-lstm.js",
    "core/tesseract-core-simd-lstm.js"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm",
    "core/tesseract-core-simd-lstm.wasm"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
    "core/tesseract-core-simd-lstm.wasm.js"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-relaxedsimd.js",
    "core/tesseract-core-relaxedsimd.js"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm",
    "core/tesseract-core-relaxedsimd.wasm"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm.js",
    "core/tesseract-core-relaxedsimd.wasm.js"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.js",
    "core/tesseract-core-relaxedsimd-lstm.js"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm",
    "core/tesseract-core-relaxedsimd-lstm.wasm"
  ],
  [
    "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
    "core/tesseract-core-relaxedsimd-lstm.wasm.js"
  ],
  [
    "node_modules/@tesseract.js-data/deu/4.0.0/deu.traineddata.gz",
    "lang/deu.traineddata.gz"
  ],
  [
    "node_modules/tesseract.js-core/LICENSE",
    "licenses/APACHE-2.0.txt"
  ]
];

async function installedPackage(name) {
  const packagePath = path.join(root, "node_modules", ...name.split("/"), "package.json");
  return JSON.parse(await readFile(packagePath, "utf8"));
}

async function sha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  const packages = {};
  for (const [name, expectedVersion] of Object.entries(expectedPackages)) {
    const metadata = await installedPackage(name);
    if (metadata.version !== expectedVersion) {
      throw new Error(
        `${name}: expected ${expectedVersion}, found ${metadata.version ?? "unknown"}`
      );
    }
    packages[name] = { version: metadata.version, license: metadata.license };
  }

  const resolvedOutput = path.resolve(outputRoot);
  const expectedOutput = path.resolve(root, "public", "ocr");
  if (resolvedOutput !== expectedOutput || path.dirname(resolvedOutput) === root) {
    throw new Error(`Refusing to replace unsafe OCR output path: ${resolvedOutput}`);
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
    generatedBy: "scripts/sync-ocr-assets.mjs",
    packages,
    files
  };
  await writeFile(
    path.join(resolvedOutput, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(
    `OCR assets synchronized: ${files.length} files (${files.reduce((sum, file) => sum + file.bytes, 0)} bytes)\n`
  );
}

await main();
