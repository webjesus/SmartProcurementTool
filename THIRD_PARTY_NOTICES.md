# Third-party notices: self-hosted OCR assets

The generated files under `public/ocr/` are copied from the exact npm packages
listed below by `scripts/sync-ocr-assets.mjs`. They are build artifacts and are
not committed to the repository. `public/ocr/manifest.json` records the package
versions, file sizes, and SHA-256 hashes shipped by a particular build.

## Tesseract.js 7.0.0

- Package: `tesseract.js@7.0.0`
- Project: <https://github.com/naptha/tesseract.js>
- License: Apache License 2.0
- Distributed asset: `dist/worker.min.js` and its bundled license notice
- Full license in a generated distribution: `public/ocr/licenses/APACHE-2.0.txt`

## Tesseract.js Core 7.0.0

- Package: `tesseract.js-core@7.0.0`
- Project: <https://github.com/naptha/tesseract.js-core>
- License: Apache License 2.0
- Distributed assets: JavaScript loaders, browser `.wasm.js` loaders, and
  WebAssembly binaries for baseline, SIMD, relaxed-SIMD, and LSTM variants
- Full license in a generated distribution: `public/ocr/licenses/APACHE-2.0.txt`

## German trained data 1.0.0

- Package: `@tesseract.js-data/deu@1.0.0`
- Project: <https://github.com/naptha/tessdata>
- License declared by the installed package: MIT
- Distributed asset: `4.0.0/deu.traineddata.gz`, exposed locally as
  `public/ocr/lang/deu.traineddata.gz`

MIT License

Copyright (c) the `@tesseract.js-data/deu` contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## PDF.js 6.3.289 decoding assets

- Package: `pdfjs-dist@6.3.289`
- Project: <https://github.com/mozilla/pdf.js>
- License: Apache License 2.0
- Distributed assets: the self-hosted JBIG2, OpenJPEG, QCMS, and QuickJS
  WebAssembly decoders and their upstream notice files under `public/pdfjs/`
- Full PDF.js license in a generated distribution:
  `public/pdfjs/licenses/APACHE-2.0.txt`

The generated PDF.js notice files are copied unchanged from the installed
`pdfjs-dist` package by `scripts/sync-pdfjs-assets.mjs`. They are needed to
render scanned PDF pages locally before OCR; the application does not fetch a
decoder from a CDN.

## Inter Variable 5.3.0

- Package: `@fontsource-variable/inter@5.3.0`
- Project: <https://github.com/rsms/inter>
- Packaging project: <https://fontsource.org/fonts/inter>
- License: SIL Open Font License 1.1
- Distributed assets: self-hosted variable-font CSS and WOFF2 files bundled
  with the application; no font files are fetched from a CDN
- Full license: `node_modules/@fontsource-variable/inter/LICENSE`
