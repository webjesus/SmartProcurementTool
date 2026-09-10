# Step 5: LV preview readability and overlay lifecycle

Date: 2026-09-07

## Scope

- Keep the warning center above the LV toolbar/list without clipping or off-screen content.
- Give `Originaldokument` a `clamp(600px, 33vw, 760px)` desktop pane at the 1366, 1920 and 2560 control widths.
- Prevent horizontal document/card/control overflow and fixed-height PDF-stage clipping.
- Slightly enlarge only the position, offer and source labels that carry the operator's primary reading task.
- Keep one inline PDF canvas mounted while navigating to another position; cancel the obsolete render and wait for the new source to commit before considering the transition ready.
- Keep the processing-result document-quality report readable at 1366px.

## RED evidence

Focused command:

```powershell
$env:SPT_E2E_EXTERNAL_SERVER='true'
$env:SPT_E2E_BASE_URL='http://127.0.0.1:3000'
npx playwright test tests/e2e/browser-local-projects.spec.ts --project=chromium --grep "probable PDF match requires"
```

The contract failed in four concrete stages before the production fixes:

1. The LV header reported `overflow-x: hidden`, so a descendant warning panel could not escape the header stacking/clipping boundary.
2. At 1366px the details pane was `409.796875px`; the new minimum contract required approximately `600px`.
3. After allowing overflow, the warning panel still began at `185px` while the header ended at `188px`; it overlapped the header border by 3px.
4. After the geometry assertions passed, position navigation returned a different canvas node (`__sptStableCanvas === canvas` was `false`) because `InlineSourceViewer` was keyed by the position-specific source key.

These failures were retained as behavior/geometry assertions rather than replaced with snapshots.

## GREEN evidence

Focused browser-local command against the current source tree:

```powershell
$env:SPT_E2E_EXTERNAL_SERVER='true'
$env:SPT_E2E_BASE_URL='http://localhost:3001'
npx playwright test tests/e2e/browser-local-projects.spec.ts --project=chromium --grep "probable PDF match requires"
```

Result: `1 passed`.

The same focused scenario was then repeated against the optimized production
build on `http://127.0.0.1:3000`: `1 passed`.

The passing scenario asserts:

- exact details-pane width from the clamp at 1366x768, 1920x1080 and 2560x1440;
- minimum rendered PDF canvas widths of 520px, 555px and 680px respectively;
- no page-level, LV-card, PDF-header or PDF-navigation horizontal overflow;
- PDF stage remains within the available source stage vertically;
- primary position/source typography meets the intended small enlargement;
- warning panel remains inside the viewport and wins `elementFromPoint` hit-testing over the toolbar/list;
- the document-quality panel and every document row remain free of horizontal overflow at 1366px;
- the source key changes on `Nächste Position`, the new render reaches ready, and the original canvas DOM node is retained.

Supporting checks:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm test -- --run`: 357 passed, 3 skipped.
- Focused source/workspace/document-quality unit set: 11 passed.

## Visual QA artifacts

Playwright captured real rendered screenshots under `tmp/browser-local-visual/` for all three desktop widths, the open warning panel and the document-quality result. Visual inspection confirmed that controls fit, the PDF is no longer constrained to the previous narrow pane, the warning panel is fully visible, and quality statuses remain calm and readable.

The in-app computer-use browser was unavailable in this worker session, so the current live source tree was rendered and inspected through Playwright instead.

## Known boundary

This slice does not alter PDF text extraction, source-region matching or export behavior. Readability is bounded by the source PDF's own typography and scan quality; fullscreen and zoom remain the operator fallback for unusually dense pages.
