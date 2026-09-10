# Full-document PDF quality gate — TDD evidence

## User journey

As an operator importing a new PDF, I need the quality report to describe the
complete processing run, so that sampled preflight data or OCR output cannot be
mistaken for a fully verified document.

## RED

Command:

`npm test -- tests/unit/browser-worker-position-layouts.test.ts tests/unit/browser-document-quality.test.ts tests/unit/browser-document-quality-ui.test.tsx tests/unit/browser-analysis-matching.test.ts`

Result: 8 targeted failures. The worker exposed no per-document diagnostics,
the snapshot did not preserve them, the quality report used the sampled
preliminary count, and the UI had no full-scan/OCR review information.

## GREEN

Command:

`npm test -- tests/unit/browser-worker-position-layouts.test.ts tests/unit/browser-document-quality.test.ts tests/unit/browser-document-quality-ui.test.tsx tests/unit/browser-analysis-matching.test.ts tests/unit/browser-projects.test.ts`

Result: 5 files passed, 65 tests passed.

## Guaranteed invariants

| Guarantee | Evidence |
| --- | --- |
| Each processed document records pages inspected, trusted marker candidates, extracted rows, missing source regions, OCR processed/failed/required pages, and multi-page rows. | `browser-worker-position-layouts.test.ts` |
| Candidate and extracted counts shown for processed comparison documents come from the full worker run, not sampled preflight inspection. | `browser-document-quality.test.ts`, `browser-document-quality-ui.test.tsx` |
| OCR-derived rows, OCR failures, pending OCR, missing evidence, and incomplete page traversal cannot produce `SUPPORTED`/green quality. | `browser-document-quality.test.ts` |
| Per-document diagnostics survive analysis snapshot persistence and the strict backup schema. | `browser-analysis-matching.test.ts`, `browser-projects.test.ts` |

No changes were made to the source-region algorithm or OCR recognition engine.
