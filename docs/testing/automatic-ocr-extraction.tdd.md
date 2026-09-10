# Automatic OCR and independent extraction — regression evidence

Date: 2026-09-08. Scope: browser worker, document classification, processing service and restart protection. This is not a production-readiness or perfect-recognition certificate.

## RED observed

- Layout tests: a technical weight/rate/length was selected instead of the procurement quantity; a row with no usable quantity disappeared; a continuation-page net price did not override gross columns; an explicit price basis produced an incorrect derived total.
- OCR worker test: a previously unreadable scan produced no supplier rows because the resolved role was not applied. Another test showed that a long native letterhead suppressed a shorter scanned table.
- Classification test: a returned, filled-in tender was incorrectly treated as the original Basis-LV. A single non-offered line also incorrectly turned the complete offer into a no-bid document.
- OCR service test: preview OCR with an unknown role did not reach the full processing path. Restart tests showed there was no guard against silently replacing a human-reviewed analysis.

All of these tests were executed failing before their corresponding implementation changes.

## GREEN

Command:

```text
npm test -- --run tests/unit/browser-worker-position-layouts.test.ts tests/unit/browser-worker-supplier-extraction.test.ts tests/unit/browser-worker-ocr-red.test.ts tests/unit/browser-ocr-fallback.test.ts tests/unit/browser-document-ocr-service.test.ts tests/unit/browser-projects.test.ts tests/unit/browser-document-quality.test.ts tests/unit/browser-document-classification.test.ts tests/unit/browser-processing-protection.test.ts
```

Result: 9 files, 113 tests passed. Focused ESLint and `git diff --check` also passed. Final project-wide build/E2E gates are recorded by the coordinating task, not claimed by these unit tests.

## Guarantees exercised

- Procurement rows take precedence over technical prose. Missing or ambiguous quantities survive as null-valued, review-required rows rather than silently disappearing.
- Position descriptions and net-price evidence can span pages. Explicit price bases are independent extraction fields; an unreadable explicit base remains null and does not produce a fabricated computed total.
- Full processing walks all pages and uses local OCR for absent text or substantial raster content, not merely because a native page contains a logo. Native geometry remains authoritative; non-overlapping OCR words supplement mixed pages.
- Full-run classification is persisted before comparison and applied in the worker. Manual document-role assignments are not replaced. Unresolved roles remain visible for manual classification.
- Every OCR-derived row remains unconfirmed. OCR confidence is not a correctness probability for a quantity, price, position ID or match.
- A new analysis requires explicit confirmation if human work exists. The old snapshot and its selections remain archived. Selection IDs are not blindly transferred to new extraction output. Human edits during processing invalidate the confirmation token.

## Real local PDF evidence and limits

The reproducible harness `scripts/audit-browser-worker-local.ts` bundles the production worker, serves only local PDF/OCR assets to an isolated headless browser and writes full results under ignored `tmp/real-worker-audit/`. Customer filenames, text, prices, hashes and rendered pages are deliberately not included here.

Validated separately from synthetic tests:

- A 92-page native Basis and a 43-page native offer traversed all pages and emitted 188 and 85 rows. The previously wrong technical quantity cases now return procurement quantities, and continuation-page net prices are used. Two offer rows still lack a unique source region and remain review-required.
- Two genuine scanned returned-LV offers traversed 18 and 12 pages with local OCR, emitted 27 and 26 supplier rows after classification, and recorded no engine failures or external requests. This proves scan-to-offer flow, not exhaustive position or field accuracy.
- Handwritten price-column marks were not reliably readable as prices. Unreadable prices remain null. A printed position identifier was misread by OCR; it must not be silently repaired by guessing from the neighboring LV. Manual insertion/correction and source review remain necessary.
- Candidate-count equality only measures parser coverage of recognized markers. It cannot prove that OCR recognized every actual position in the document.

No customer project was reprocessed or modified by the local harness. No cloud AI or external OCR service was used.
