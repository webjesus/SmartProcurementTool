# MVP first batch — TDD and verification record

Date: 2026-08-31
Scope: Gate 1, slices S1–S3 from `docs/MVP_GATE_1_PLAN.md`
Commit status: no commit before Gate 2 approval

## Delivered boundary

- German unified shell with the supplied Weinbuch logo, exact navy/yellow
  accents, and persistent light/dark/system themes.
- Product library at `/` with confirmed-only search/filter rules, honest empty
  states, six distinct inspector views, and immutable project snapshots.
- Project directory and creation form with required name, address,
  engineering office and architecture office metadata.
- Browser-local project storage is explicitly labelled non-production. Shared
  server persistence remains a later package and is not implied by the UI.
- Planned library mutations are disabled and labelled as the next MVP package;
  this batch exposes a real read model, not fake import or approval actions.

## RED → GREEN evidence

| Boundary | RED observation | GREEN evidence |
|---|---|---|
| Reproducible baseline | Central-decision integration test read ignored `.data` and failed on a clean checkout. | The sync service accepts an injected state reader; the integration fixture is synthetic and the full Vitest suite passes without local corpus data. |
| Dependency security | Initial production audit reported six vulnerabilities, including five high findings in direct Next/PDF.js paths. | Direct versions are patched and `npm audit --omit=dev` reports 0 vulnerabilities. |
| Library/domain | Navigation, theme, confirmed-only filtering and snapshot contracts did not exist. | `mvp-shell-library.test.tsx` covers exact German navigation, theme resolution, confirmed-only search, frozen snapshots and the honest empty read model. |
| Project metadata | Project records only guaranteed name/description. | Zod create/update schemas enforce all four directory fields, length limits and control-character rejection; browser repository tests cover persistence and migration defaults. |
| Dark theme | Project pages retained light-only hard-coded text colors. | Dark project-directory and creation pages were visually inspected at 1440 px and added to E2E; no overflow, console error or failed response was observed. |
| Identity boundary | The central decision login overlay blocked unrelated library/project routes. | Identity is active only for decision/LV routes, resets on route changes, and library/project navigation remains unblocked. |
| Backup import security | A backup could label HTML as a PDF, restore it with `text/html`, and preview it under the app origin. | Import now has size/count limits, strict nested metadata validation, unique 1:1 document/blob/checksum IDs, project ownership checks, PDF MIME/magic/hash/size/parser validation, forced PDF Blob type, and a sandboxed in-app preview. Malicious MIME, duplicate-link and malformed-PDF tests pass. |
| E2E baseline | Existing tests assumed the old root redirect, optional project metadata, and unconfigured local pilot data. | Tests now use the confirmed library root, required metadata, runtime browser-local profile, and explicit skips only for unavailable PostgreSQL/real-corpus fixtures. The complete configured suite passes. |

## Automated verification

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | 31 files passed, 2 environment-gated files skipped; 266 tests passed, 3 skipped |
| Focused V8 coverage | Statements 81.00%, branches 66.53%, functions 80.64%, lines 83.71% across the new library/metadata and changed browser PDF/project-service security boundary |
| `npm run build` | Pass on Next.js 16.3.3 |
| `npm run test:e2e` | 14 passed, 58 explicitly environment-gated skips, 0 failed; Chromium and mobile profiles |
| Browser QA | `/`, `/projects`, `/projects/new` and all seven global navigation targets return 200; no horizontal overflow at 390/768/1440 px; light/dark screenshots inspected; 0 console errors and 0 failed responses |
| Production dependency audit | 0 vulnerabilities |
| License spot-check | Next/React/Zod/Vitest coverage: MIT; PDF.js: Apache-2.0; Lucide: ISC |
| Code review | Three HIGH and four MEDIUM findings addressed before Gate 2 |
| Security review | One HIGH, two MEDIUM and one LOW finding addressed before Gate 2 |

## Explicitly unverified in this environment

- PostgreSQL central-decision synchronization and first-login E2E require a
  configured test database.
- Real-corpus LV geometry/visual flows require the separately supplied,
  untracked pilot dataset.
- This is the first visual baseline, so historical pixel-regression comparison
  is not available yet.
- Automated axe coverage is not configured; semantic landmarks, labels,
  keyboard-reachable controls, theme contrast and responsive overflow were
  checked, but a dedicated accessibility audit remains a later gate.

These are environment or future-scope limits, not silent passes. No commercial
PDF content or local corpus path is included in this record.
