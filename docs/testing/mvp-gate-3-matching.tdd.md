# MVP Gate 3: PDF matching and operator review

Date: 2026-08-31

## Scope

This gate connects the shared procurement matching domain to the browser-local
PDF workflow. A probable match remains non-comparable until a person confirms
the mapping. Confirming the mapping does not select the supplier. Price ranking
uses only complete, comparable supplier options; it is not the final project
calculation.

## RED evidence

1. Added `tests/unit/browser-analysis-matching.test.ts` before changing the
   browser analysis implementation. The first run reported three failures:
   the browser pipeline produced no fuzzy links, did not recognise an LV range,
   and split a same-reference bundle into two supplier options.
2. Added the confirm/reject recalculation test before exporting
   `applyBrowserMatchReview`; the test failed because the review operation did
   not exist.
3. Added the match-review UI test before rendering the inspector controls; it
   failed because the review panel and actions were absent.
4. Added the synthetic Playwright scenario before wiring review persistence; it
   failed because no element with `data-match-review="PENDING"` was rendered.
5. Added invalid decision, oversized comment, invalid date, and backup/restore
   assertions before hardening the service boundary. The focused test failed
   because invalid review data was accepted.

## GREEN evidence

- `npm test -- tests/unit/browser-projects.test.ts -t "persists match reviews"`
  — 1 passed, 19 skipped.
- `npm test -- tests/unit/browser-analysis-matching.test.ts tests/unit/browser-projects.test.ts tests/unit/match-review-ui.test.tsx tests/unit/supplier-option-read-model.test.ts`
  — 4 files and 34 tests passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- Synthetic browser E2E, filtered to
  `probable PDF match requires a separate human review before price baseline`
  — 1 passed.
- Local commercial corpus browser E2E, filtered to
  `classifies and processes` — 1 passed. The PDF files stayed outside Git.

## Behaviour locked by tests

- Supplier numbering may differ from the LV numbering without losing a strong
  textual/unit/quantity candidate.
- An LV range such as `1.1.10-20` may match the contained position `1.1.15`.
- Lines sharing one offer reference remain one commercial bundle.
- An uncertain candidate is visible but has no comparable price until confirmed.
- Confirm and reject update the derived comparison while the stored extraction
  run remains unchanged.
- Confirming a match never creates a final supplier selection.
- Review records are schema-validated, backed up, restored, and rebound to the
  restored project identifier.

## Final gate verification

- Full unit suite with coverage: 33 files passed, 2 skipped; 274 tests passed,
  3 skipped.
- Changed core modules: browser analysis 85.04% statements / 87.62% lines,
  browser project service 82.12% / 85.19%, matching 85.88% / 89.81%, and
  supplier option read model 80.00% / 82.14%. The repository-wide figure is
  lower because routes and legacy UI without unit instrumentation are included;
  their exercised workflows are covered by Playwright.
- `npm run build` — production compilation, type checking, and route generation
  passed.
- `npm run test:e2e` — 15 passed, 59 conditionally skipped. No failures.
- Real local PDF corpus E2E with `SPT_REGRESSION_CORPUS_DIR` — 1 passed.
- `npm audit --json` — 0 known vulnerabilities across all severities.
- No API key or private-key signature was found in changed source, tests, or
  documentation.
