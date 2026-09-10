# Demo readiness TDD evidence

Source plan: `plans/demo-readiness-blueprint.md`

## Baseline

- `npm test` — 38 files passed, 2 skipped; 314 tests passed, 3 skipped.
- `npm run typecheck` — passed.
- `npm run lint` — passed.

The baseline was recorded before the Gate 1 implementation slices started.

## User journeys

1. A project operator uploads a new PDF set and receives an explicit quality status per document instead of a generic success that hides omissions.
2. An extracted position without verified source geometry cannot participate in an automatic comparable-price result.
3. An operator can read the original PDF on 1366x768, 1920x1080 and 2560x1440 without clipped controls or page overflow.
4. The warning list opens above the LV workspace and remains fully interactive.
5. Reviewed exports include the complete project and never present an advisory recommendation as a human decision.

## Task evidence

### Missing source geometry fails closed

- RED: `npm test -- tests/unit/browser-analysis-matching.test.ts`
- Result: 2 intended failures. A zero region was marked `VERIFIED_NATIVE` and an exact-number offer without evidence received `comparableTotal: 80`.
- GREEN: the same command passed 6/6 after missing geometry became `MISSING`/`NEEDS_REVIEW`.

### Document-quality report

- RED: `npm test -- tests/unit/browser-document-quality.test.ts`
- Result: module missing before implementation.
- GREEN: the same command passed 6/6.
- Guaranteed: native document count/evidence coverage, missing positions, missing evidence, active-Basis blocking, OCR isolation, and non-comparison documents are represented explicitly.

### Document-quality UI

- RED: `npm test -- tests/unit/browser-document-quality-ui.test.tsx`
- Result: component missing before implementation.
- GREEN: the same command passed 1/1.
- Guaranteed: the German UI exposes review-required, unsupported/OCR, extracted-versus-candidate counts, and missing source evidence.

### Unknown document classification fails closed

- RED: `npm test -- tests/unit/browser-document-quality.test.ts`
- Result: 1 intended failure. An unclassified low-confidence PDF was reported as `SUPPORTED`/outside comparison and the project stayed ready.
- GREEN: the same command passed 7/7 after unknown or uncertain document roles became `REVIEW_REQUIRED` and elevated the project status.

### Position layout extraction

- RED: `npm test -- tests/unit/browser-worker-position-layouts.test.ts`
- Result: 3 intended failures out of 4: split/shuffled Basis references were omitted, mixed explicit markers kept only `LVNR`, and a dotted article identifier became a phantom position.
- GREEN: `npm test -- tests/unit/browser-worker-position-layouts.test.ts tests/unit/browser-worker-supplier-extraction.test.ts` passed 15/15 after switching the worker to visual-order geometry markers with fail-closed bare-number filtering, multi-page review reasons, unknown-unit review routing and trailing supplier-row support.

### PDF source-region geometry

- RED: the geometry suite initially failed 8 cases out of 27 for split references, visual ordering, repeated identifiers, columns and exact block boundaries.
- GREEN: `npm test -- tests/unit/pdf-source-region.test.ts` passed 37/37.
- Focused coverage: 94.33% statements, 84.12% branches, 100% functions and 98.38% lines.
- Guaranteed: leading and structurally identified trailing markers remain inside their own block; the frame excludes the next product/position and safely returns no guessed frame when the geometry is insufficient.

### Structural ambiguity cannot become verified evidence

- RED: the browser-analysis matching suite exposed duplicate evidence identifiers and allowed review-required extraction into a verified result.
- GREEN: `npm test -- tests/unit/browser-analysis-matching.test.ts` passed 7/7 after evidence identifiers included the extracted line index, supplier references stayed independent from LV references, and extraction review reasons produced `UNCONFIRMED`/`MISSING` evidence.
- Guaranteed: an offer with ambiguous extraction or missing geometry cannot contribute an automatic comparable total even when its textual reference matches exactly.

### Generic readiness decision

- RED: `npm test -- --run tests/unit/demo-readiness.test.ts`
- Result: the evaluator module did not exist.
- GREEN: the same focused suite passed 15/15.
- Guaranteed: explicit denominators, `NOT_EVALUATED` for zero automatic cases, safe `REVIEW_ONLY`, and `NO_GO` for crashes, omissions, contaminated evidence, wrong high-confidence results, unrouted uncertainty, or broken persistence/export.

### Preliminary inventory and quality-count semantics

- RED: `npm test -- tests/unit/browser-document-classification.test.ts` failed because a hyphenated `zu LV-Pos.` supplier reference was undercounted.
- GREEN: the suite passed 18/18 after the preliminary inventory recognized generic hyphenated LV references, split references and supplier-only `Angebotsposition` labels without adding the two namespaces together.
- RED: `npm test -- tests/unit/browser-document-quality-ui.test.tsx` failed 2/2 because the panel rendered impossible-looking ratios such as `2 von 0`.
- GREEN: the quality UI suite passed 2/2 after preliminary candidates and final extracted positions were labelled as separate measurements.
- RED: `npm test -- tests/unit/browser-document-quality.test.ts` failed when a full-document extraction found three positions after a one-position sampled preflight.
- GREEN: the quality suite passed 8/8 after the sampled preflight count became a lower-bound invariant; only a final count below that bound creates `POSITION_COUNT_MISMATCH`.

### Comparison-scope quality accounting

- RED: a successfully parsed supplier document from another discipline could be counted as a failed extraction in the active comparison.
- RED during the real corpus E2E: when both disciplines had an active Basis, the report evaluated the first one even if it was outside the selected comparison scope and incorrectly produced `BLOCKED`.
- GREEN: `npm test -- tests/unit/browser-document-quality.test.ts` passed 10/10 after quality totals, extraction failures and active-Basis selection were limited to documents participating in the active comparison scope.
- Guaranteed: documents from another discipline remain visible with `Nicht Teil des LV-Vergleichs` and cannot distort the active comparison's coverage totals.

### Readable and stable source preview

- RED: a newly opened source view defaulted to whole-page width, making the selected position unreadable on the supported desktop viewports; toggling fit mode was not reversible.
- RED during the real-document audit: the footer claimed that a position was marked while the actual render frame was still absent; the status/footer height then oscillated between 462 and 465 px and repeatedly restarted the PDF render.
- GREEN: `npm test -- tests/unit/source-view-lifecycle-red.test.ts` passed 8/8 after new views defaulted to `EVIDENCE`, saved per-source view state remained authoritative, and visible evidence gained fail-closed `LOADING`, `OFF_PAGE`, `ABSENT`, `ERROR`, `VISIBLE_UNCONFIRMED` and `VISIBLE_VERIFIED` presentation states.
- Browser proof: the focused Chromium scenario passed 1/1 and requires a real visible frame before the verified footer can appear. On the reprocessed project, both Basis page 15/92 and supplier page 10/43 produced exactly one text-layer frame for position 1.1.160; moving to Basis page 16 produced zero frames and the neutral off-page message.
- Stability proof: 20 consecutive 250 ms production-browser samples remained at 449 px, one frame and `VISIBLE_VERIFIED`; no loading/ready oscillation occurred.
- Browser proof: the production Playwright scenario passed at 1366, 1920 and 2560 px widths with a stable PDF canvas, readable focused evidence, no page overflow and a fully visible/hit-testable warning popover.

### Backup/import trust boundary

- RED: an unsigned local backup could restore derived analysis snapshots and operator decisions as trusted state.
- GREEN: restore now validates the workspace schema, restores only validated PDF inputs, clears analysis snapshots and selections, resets processing/status pointers, and requires all derived state to be recomputed.
- RED during the full E2E: the old workflow expected an unsigned backup to reopen a trusted analysis, and project duplication still copied the source project's supplier decisions.
- GREEN: the focused restore/duplicate Playwright scenario passed 1/1 after restore required reprocessing, duplication retained the reusable analysis but cleared human selections and decision-bound UI pointers, and the service regression suite passed 20/20.
- Security review: independent re-review reported no remaining critical or high findings; `npm audit --omit=dev --audit-level=high` reported zero production vulnerabilities.

### Complete reviewed export

- RED: the former browser PDF export truncated the comparison to a fixed first-page line limit, and an advisory cheapest option could be exported as though a person had selected it.
- GREEN: `npm test -- tests/unit/browser-export.test.ts` passed 3/3.
- Guaranteed: XLSX and PDF include all 55 positions in the acceptance fixture, explicit selected/unresolved/rejected/unselected states, source-page references and German characters; the generated PDF is parseable and spans all required pages.

### Known 12-PDF regression corpus

- The corpus uses the production browser worker and makes no external AI calls.
- `SPT_REGRESSION_CORPUS_DIR=<local corpus> npm run test:e2e -- tests/e2e/browser-local-projects.spec.ts --project=chromium --grep="classifies and processes"` passed 1/1 in 37.7 seconds.
- Native-text PDFs are classified and processed without a crash or silent zero-position supplier result in the active discipline; each active Basis/supplier document is asserted independently.
- The active project correctly remains `Vergleich mit Prüfbedarf`: ambiguous/multi-page evidence is surfaced for review instead of being promoted to a ready result.
- Image-only scan documents remain explicitly `OCR erforderlich`; documents from the other discipline remain outside the active comparison.
- This is regression evidence, not proof for arbitrary unseen layouts. A labelled sealed project is still required for an `unseen pass` claim.

## Final Gate 2 verification

- `npm test` — 43 files passed, 2 skipped; 383 tests passed, 3 skipped.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed with all application routes generated.
- Full Chromium E2E with the local 12-PDF corpus — 10 passed, 27 environment-gated legacy/server scenarios skipped, 0 failed in 1.2 minutes.
- `git diff --check` — passed; only Git line-ending notices were emitted.
- `npm audit --omit=dev --audit-level=high` — zero production vulnerabilities.
- Independent UI audit — functional PASS for the three target desktop widths, warning overlay, focused preview, stable canvas and workspace persistence. Pixel-perfect regression remains not evaluated because no approved screenshot baseline exists.

## Pending evidence

- Labelled development corpus and sealed unseen-corpus audit.
