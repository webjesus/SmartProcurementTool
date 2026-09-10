# Approved LV three-pane UI — TDD evidence

Source: user-approved design audit and three-pane concept, 2026-09-08. Scope: the existing real project LV workplace, not a new demo route. Existing extraction, review, correction, supplier-selection and export callbacks remain connected.

## Journeys and evidence

| Guarantee | RED observed | GREEN target |
|---|---|---|
| Position navigator, independent decision pane and real PDF source; detail tabs stay mounted | `lv-three-pane-ui.test.tsx`: first run 3/3 failed — source nested inside inspector, missing mounted description/data contract, missing card-key guard | Same tests passed after sibling source and persistent tab panels |
| Card keyboard preview never handles a nested supplier-selection button's Enter/Space | Missing `isOfferPreviewKey` produced runtime RED | Own Enter/Space accepted; nested button events rejected |
| EP for 100/1000 units is labelled explicitly | Added test failed on missing `offerUnitPriceLabel` | 100/1000/unitless and missing-price cases pass |
| Source dropdown changes inspected option without changing procurement choice; Basis retains inspected supplier | New layout test file initially failed import because the intended helpers did not exist | `lv-pane-layout.test.ts`: supplier/Basis transitions pass |
| Pane resizing keeps both columns readable; enlarged position fitting does not waste half the available height | Same intentional missing-module RED for new layout helpers | Width clamps, narrow-layout fallback and fit geometry pass |
| A new source opens at full PDF width, while saved fit preferences remain intact | Source lifecycle test failed: expected WIDTH, received EVIDENCE | Resolver now defaults WIDTH; saved EVIDENCE preserved |
| Shell navigation does not open a separate legacy comparison flow | Shell SSR test failed on `href="/lv-vergleich"` | Footer routes to `/projects`, without MVP/test/prototype status copy |

Validation command for the final focused set:

```text
npm test -- tests/unit/lv-three-pane-ui.test.tsx tests/unit/lv-pane-layout.test.ts tests/unit/existing-lv-manual-correction-ui.test.tsx tests/unit/match-review-ui.test.tsx tests/unit/workspace-shell-layout.test.ts tests/unit/lv-selection-workspace.test.tsx tests/unit/source-view-lifecycle-red.test.ts tests/unit/source-ocr-provenance.test.ts
```

The final expanded run passed **46/46 tests in eight files**. `npm run typecheck` and targeted ESLint passed during implementation; final root validation is separate.

## Preserved boundaries and remaining verification

- PDF remains the actual PDF.js canvas; `Position`, `Ganze Seite`, width fit and full-screen reading do not use design screenshots.
- Supplier cards preview by whole-card click; only the explicit selection control invokes the selection callback. Matching confirmation remains separate.
- Bundle lines retain individual correction actions; unknown/unreviewed data is not visually promoted to confirmed.
- Decision-panel scroll is keyed by workspace, position and tab in sessionStorage. PDF state remains in its existing per-source/revision workspace model. Resized column ratio is separate view state.
- CSS changes are scoped to the LV workspace; global app-shell edits concern labels and the obsolete shortcut.
- No checkpoint commits were created because the coordinator explicitly prohibited commits and the worktree contains existing user changes.
- Browser interaction/geometry QA, production build, full test suite and full coverage belong to the coordinating agent's final gate. This focused report does not claim 80% UI coverage, all-browser readiness, extraction accuracy or complete product QA.
