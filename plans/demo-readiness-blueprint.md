# Smart Procurement Tool — Demo-Readiness Blueprint

Status: Gate 1 approved; implementation and verification complete; Gate 2 approval pending  
Mode: direct repository work with gated commits; Git is available, GitHub CLI is not installed  
Primary target: a demonstrable, evidence-backed LV comparison workflow for a previously unseen PDF project

## 1. Objective

Deliver a testable build in which an operator can create a project, upload a new set of PDF documents, see an honest document-quality report, extract LV and supplier positions, review uncertain mappings, compare supplier offers, open every result in its original PDF, preserve review state, and export the reviewed result.

The build must never hide unsupported input or present an uncertain extraction or match as certain. Supplier choice remains separate from the later project calculation.

## 2. Demo scope

The demonstration includes:

- project creation and PDF upload;
- duplicate/revision handling and document classification;
- Basis-LV and supplier-offer extraction with page evidence;
- extraction quality and coverage report;
- matching supplier positions to Basis-LV positions;
- default lowest-comparable-price indication, without making a final decision for the operator;
- manual confirmation/rejection of uncertain matches and supplier choice;
- exact source navigation and position highlighting;
- persistent filters, open position, PDF page, zoom, scroll and human decisions;
- reviewed XLSX export and a complete multi-page PDF export only if its content-equivalence tests pass; otherwise the PDF export is removed from the demo claim;
- controlled handling of unsupported or OCR-required files.

The following are explicitly outside this demonstration milestone:

- final commercial Kalkulation logic;
- automatic final supplier decisions;
- email generation, technical-passport generation and general chat;
- Revisionsunterlagen folder editor and custom-LV authoring;
- roles/permissions and production infrastructure hardening.

## 3. Evidence already established

- The available corpus contains 12 PDFs and 789 pages.
- 759 pages contain a usable text layer.
- 30 pages in two scanned documents have no usable text and require OCR.
- Existing extraction/highlight tests cover known examples but do not prove correctness on unseen layouts.
- The current highlight locator can fail on split position numbers, repeated references, shuffled text-item order, multiple columns, dotted article numbers and page continuations.
- The warning popover is clipped because an ancestor LV header has `overflow: hidden`; increasing only `z-index` cannot fix it.
- The current document preview is about 410 px wide at 1366 and capped at 520 px on 1920/2560, which makes normal PDF text unreadable and clips controls.

## 4. Release contract for new PDFs

Every uploaded file receives one of three explicit states before it participates in comparison:

1. `SUPPORTED`: valid unencrypted PDF; usable text and geometry on commercial pages; document role and position blocks are unambiguous.
2. `REVIEW_REQUIRED`: mixed/complex layout, repeated candidates, rotated or multi-column content, page continuation, damaged text order, or low-confidence classification. The file remains visible but uncertain data cannot drive an automatic supplier recommendation.
3. `UNSUPPORTED`: encrypted/corrupt/container PDF, image-only scan without coordinate-preserving OCR, handwriting, or another format for which evidence cannot be verified. The file is isolated with a German explanation and does not break the project.

Confidence is split into independent dimensions:

- extraction confidence: was the position itself read and bounded correctly;
- matching confidence: was a supplier position linked to the correct Basis position;
- price comparability: is the bundle, quantity, unit and included scope sufficient for a price comparison.

A high-confidence result is permitted only when its evidence and deterministic invariants pass. AI may propose a candidate but may not promote uncertain data to verified status by itself.

### Demo runtime profile

The first demonstrable profile is the existing browser-local path: Next.js UI, the browser PDF worker and PDF.js extraction, IndexedDB project/document state, and browser-side export. PostgreSQL, the heartbeat worker, OpenAI and OCR are not prerequisites unless the demonstration explicitly enables them. The readiness probe must describe only the capabilities actually used by this profile.

The existing upload guard is part of the profile: at most 30 PDFs, 25 MB per file, 60 MB per project and 2,000 pages. Step 1 benchmarks the target machine and freezes a smaller demonstrated performance envelope if these maxima cannot satisfy the processing deadlines below.

## 5. Acceptance datasets

Three local confidential datasets are required. PDFs, extracted text, prices, article numbers and project identifiers stay outside Git.

### Regression corpus

The known supplied documents are used after every parser change to detect regressions. The stored report contains only aggregates, hashes and non-commercial status codes.

### Development acceptance corpus

One complete project is used to develop and debug the generic acceptance runner. It must contain at least one Basis-LV, three supplier documents and at least 50 manually labelled positions. The labels record exact expected document role, full native-position inventory, position reference, page and block boundary, normalized title/article, quantity/unit, monetary values and price basis, technical/completeness attributes, and the correct matching/comparability disposition.

### Sealed unseen corpora

One primary and, where possible, one reserve project remain sealed until the implementation and thresholds are frozen. Each has the same minimum composition and labelled truth as the development corpus. If a failure from the primary holdout causes any code, rule, threshold or prompt change, that project is permanently moved into regression and only the reserve project can support a later `unseen pass` claim. Without a reserve, the final claim is explicitly limited to regression-tested behaviour.

Each acceptance set must include a long position, a last position on a page, a split or wrapped reference, a repeated number, a page continuation and at least one document that should enter manual review. Failures are converted into anonymised layout fixtures; supplier-specific regex patches are not accepted.

## 6. Dependency graph

```text
Step 1: Freeze contract, runtime and baseline
  -> Step 2: Test/quality harness
      -> Step 3: Robust extraction and evidence
          -> Step 4: Matching, export and operator safety
  -> Step 5: Demo UI preparation
Step 2 -> Step 5: Contract-dependent UI integration and lifecycle tests
Step 3 + Step 4 + Step 5
  -> Step 6: Unseen acceptance gate
      -> Step 7: Packaging and rehearsal
```

Step 5 visual preparation may start after Step 1, while state/quality contract integration waits for Step 2. Steps 3 and 5 can then proceed in parallel; Step 4 integration depends on Step 3. Changes that touch shared contracts are integrated sequentially. Step 6 starts only after Steps 3, 4 and 5 are complete and is never parallelised with implementation because it is the release decision.

## 7. Construction steps

### Step 1 — Freeze the behavioural contract and recover a clean baseline

Context: the current branch contains an unfinished cross-cutting LV workspace diff. Adding more behaviour without first proving this state would mix known fixes with new failures.

Tasks:

- inventory the current diff and assign every changed file to a completed feature, current blocker or unrelated user change;
- preserve all existing user work and local confidential artifacts;
- write executable contracts for document status, extraction confidence, matching confidence and price comparability;
- freeze the browser-local demo profile, persistence/source-of-truth, parser/worker/export path, external-call policy and upload limits;
- verify that the development corpus, sealed primary holdout, ground-truth labels and preferably a sealed reserve are available before parser implementation starts;
- benchmark the target machine and set an explicit demonstrated file/page envelope; require first progress within 3 seconds, a progress update at least every 5 seconds, a controlled stalled state after 30 seconds without progress, and completion of the chosen demo package within 10 minutes;
- run the full current verification suite and record the exact baseline failures;
- split the eventual commits by logical behaviour, but do not commit before Gate 2.

Verification:

- `git diff --check`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:e2e`
- `npm run build`

Exit criteria:

- every dirty file is accounted for;
- no local PDF or commercial extraction is staged;
- baseline status and remaining failures are documented;
- demo runtime, data boundary, measured performance envelope and recovery contract are frozen;
- development and sealed manifests have distinct checksums and access rules;
- the release contract is represented by failing tests before production changes.

Rollback: no runtime change in this step; remove only newly added test/plan artifacts if the contract is rejected.

### Step 2 — Build the document-quality and layout test harness

Context: correctness on the same documents used during implementation does not prove behaviour on a new project. The system needs deterministic synthetic layouts and a confidential holdout runner.

Tasks:

- create reusable synthetic PDFs for A4, Letter and landscape pages with arbitrary coordinates, split text items, reordered content streams, multiple columns, footers and page continuations;
- add unit invariants for first/middle/last blocks, repeated references, dates, dotted article numbers, rotation, empty text layers and ambiguous columns;
- add browser-local E2E for upload, classification, extraction, one evidence result containing zero or more page regions, source switching and stale-frame removal;
- create a generic, non-mutating audit runner that consumes a supplied manifest/snapshot through the same browser pipeline used in the demonstration;
- keep the existing project-specific pilot audit as a separate regression tool rather than using it for a release verdict;
- allowlist stdout/handoff output to aggregates, hashes and status codes; keep full traces only in an ignored confidential directory;
- add development, sealed-primary and sealed-reserve manifest formats that remain outside Git;
- add cancellation, worker error, page-parse error, reload-during-processing and idempotent retry scenarios.

Verification:

- new tests fail for the known unsupported behaviours before implementation;
- the corpus command makes zero external AI calls;
- generated fixtures contain no real company/project/supplier data;
- the generic audit does not mutate extraction, selections, corrections or decisions and does not print confidential fields;
- a malformed or encrypted input produces a controlled status, not an application crash.

Exit criteria:

- the test matrix covers each known failure family;
- every frame assertion checks geometry and neighbouring content, not merely DOM visibility;
- reports expose omitted pages/positions instead of returning a generic success.

Rollback: test fixtures and report schema can be removed without touching stored project data.

### Step 3 — Make extraction and source evidence robust and fail-closed

Context: the current locator follows PDF content-stream order and can choose the wrong occurrence or boundary. A demonstrable system must prefer no automatic answer over a confidently wrong one.

Tasks:

- reconstruct visual rows and columns from normalized page coordinates;
- merge split position references and distinguish position numbers from dates and article numbers using context and geometry;
- score all candidates using normalized reference, description/title tokens, article, quantity and spatial consistency;
- calculate the end boundary from the next position in the same visual column/table;
- support page rotation and one evidence result with 1..N page regions for explicit continuations, with at most one active region per selected page/column;
- introduce `VERIFIED`, `AMBIGUOUS`, `OCR_REQUIRED` and `UNSUPPORTED` locator outcomes with reason codes;
- remove any path that marks a null/guessed region as native-verified;
- independently extract Basis hierarchy and inherited execution descriptions, title/article, quantity/unit, all money candidates and their price basis, optional/alternative role, material scope and relevant technical attributes;
- represent fields that were not extracted as `NOT_EXTRACTED` or `UNKNOWN`; an empty list or `false` must mean a verified absence, never a default;
- preserve immutable raw extraction when a human corrects a field.

Verification:

- all Step 2 extraction/evidence tests progress RED -> GREEN; matching/export and lifecycle/recovery tests are closed by Steps 4 and 5 respectively;
- one target produces one evidence result; each selected page displays at most one verified region or a non-verified status;
- every region contains all target rows within the recorded tolerance, zero rows from the next position and no neighbouring column;
- a fixture with equal number/price but different DN/PN/material/included components cannot become comparable automatically;
- switching position/source cannot display a previous frame;
- scan-only pages never receive a synthetic verified frame.

Exit criteria:

- 100% of the independent native-position inventory is represented exactly once as extracted or explicitly missing; no phantom position is allowed;
- exact expected reference/title/article/quantity/unit/money/role values pass on the labelled development sample, or the field is explicitly non-verified and routed to review;
- at least 95% of labelled source frames are exact;
- zero known incorrect frames are marked verified;
- unsupported layouts remain usable through manual review rather than corrupting comparison data.

Rollback: retain the old locator behind a local feature flag only during development; remove the flag before the demonstration once the new tests pass.

### Step 4 — Prove safe matching, reviewed export and supplier-choice separation

Context: recognizing a position and matching it to a Basis-LV are different problems. The lowest comparable price is a useful baseline, but it is not the final supplier decision and not the later Kalkulation.

Tasks:

- keep supplier extraction independent from Basis requirements and historical choices;
- require verified evidence, compatible unit/quantity and complete required scope before automatic price comparison;
- group mandatory bundled components and separate options/alternatives;
- allow high-confidence automatic mapping only when one candidate clearly passes all invariants;
- route ties, technical deviations, incomplete bundles, unclear prices and multiple plausible matches to the operator;
- persist human confirmation/rejection and supplier selection separately from extraction;
- show why the cheapest candidate is or is not comparable;
- make XLSX/PDF rows distinguish human selection, advisory recommendation, unresolved, rejected and unselected states;
- remove the fixed PDF row truncation and generate complete multi-page output with German umlauts and source references, or remove PDF export from the demo if equivalence cannot be proven.

Verification:

- synthetic tests cover included/excluded bolts, bundle prices, discounts, missing totals, quantity conversions, alternatives and technical deviations;
- confirming a match does not automatically select a supplier;
- selecting a supplier does not create a final project-calculation value;
- no low-confidence option affects cheapest-comparable ranking;
- downloaded XLSX/PDF contains every expected position in a 50+ position fixture, preserves reviewed values/bundles, and never substitutes an advisory recommendation for a human decision.

Exit criteria:

- automatic precision is reported with numerator, denominator and sample count; zero automatic cases means `NOT_EVALUATED`, not 100%;
- the frozen development minimum for a demo is at least 20 qualified automatic cases and at least 99% observed precision on that sample;
- the manual queue fits the 10–15 minute demo script: at most five preselected review examples while the complete queue remains accessible;
- the readiness report also shows the complete manual-review count and rate; the five examples are a presentation limit, not a claim of low total workload;
- zero incorrect high-confidence matches;
- every remaining case is present in a visible manual queue with evidence and reason.

Rollback: recompute derived matches from immutable extraction; never roll back by rewriting stored extraction or human decisions.

### Step 5 — Finish the operator UI for a live demonstration

Context: the current core workflow is too dense on standard office displays, and the warning popover is clipped by the LV header.

Tasks:

- widen `Originaldokument` to `clamp(600px, 33vw, 760px)` while keeping the data-only tab compact;
- use a compact LV-row presentation when the remaining list is narrow;
- increase only primary titles, position references, prices and critical metadata by approximately 1–2 px;
- make PDF width/focus modes use the available viewport while preserving a user's saved zoom;
- remove fixed child height that clips the PDF at 1366x768;
- wrap/stack preview controls without page-level horizontal scrolling;
- fix the warning popover by allowing overflow at the LV header and retaining clipping only on internal title/action wrappers;
- keep the popover above toolbar/list and below fullscreen PDF;
- preserve project/list filters, expanded position, source, page, zoom, fit mode, scroll and human decisions across navigation and reload.
- handle duplicate upload, supplier revision, active Basis revision, rejected match plus reprocessing, and a corrected field plus reprocessing; decisions tied to superseded evidence become stale/review-required instead of silently applying to the new revision.

Viewport acceptance:

- 1366x768: document pane at least 600 px; usable LV list remains; no page overflow;
- 1920x1080: document pane approximately 634 px or wider; controls fully visible;
- 2560x1440: document pane grows up to 760 px instead of remaining capped at 520 px;
- no horizontal overflow greater than 1 px in page, toolbar, list or details pane;
- selected evidence is readable in width/focus mode without opening fullscreen.

Warning-popover acceptance:

- after clicking the count, the whole popover is hit-testable above toolbar/list and within the viewport;
- its internal list scrolls at max height;
- close and warning selection work;
- selecting a warning opens its position and closes the popover;
- fullscreen PDF remains above the popover.

Verification:

- Playwright geometry/overflow tests at all three viewports;
- screenshot baselines for the same anonymised project at all three viewports;
- persistence E2E across LV -> Dokumente -> LV and full reload for separate Basis/Angebot view states.
- revision/reprocess recovery E2E proving that valid human records remain auditable while stale source-bound decisions cannot influence a new recommendation.

Exit criteria:

- all viewport and interaction assertions pass;
- no clipped controls, duplicate renders or stale evidence frame are visible during a recorded end-to-end walkthrough.

Rollback: CSS/layout changes are isolated from extraction and matching contracts and can be reverted independently.

### Step 6 — Run the unseen-project release gate

Context: this is the only credible answer to whether new documents work. The project must be evaluated without code changes or supplier-specific patches during the run.

Tasks:

- freeze the parser/matcher version and checksum it;
- import the sealed primary project and local ground truth;
- run upload -> classification -> extraction -> quality report -> matching -> source evidence -> persistence -> export;
- let an operator randomly select positions from Basis and multiple suppliers;
- record only aggregate metrics and anonymised failure categories;
- if the sealed run fails, record the failure and move that project permanently to regression before making any change; a later unseen claim requires the sealed reserve project.

Hard release thresholds:

- 100% of files load or receive a controlled unsupported status;
- zero crashes, frozen processing jobs or missing error explanations;
- 100% recall and precision against the independently labelled full inventory of supported native-text position references; missing/unreadable blocks are separate explicit findings, not counted as detected;
- at least 95% exact evidence regions over the stated labelled denominator; every non-exact remainder is non-verified, and no region contains a neighbouring position or column;
- zero wrong extraction or match labelled high-confidence;
- automatic matching reports numerator/denominator/sample count, requires the frozen minimum automatic count, and reaches at least 99% observed precision on this acceptance sample;
- 100% of unqualified results enter manual review;
- the report publishes total automatic/manual/not-evaluated counts and rates with their denominators;
- first progress, progress heartbeat, stall timeout and total processing deadline pass on the frozen target machine/envelope;
- persistence, revision/retry recovery and full-content export checks pass after reload.

Release decision:

- `DEMO_READY`: every hard threshold passes;
- `REVIEW_ONLY`: parsing/structuring works, but automatic matching or price indication is disabled because confidence thresholds failed;
- `NO_GO`: crash, silent omission, wrong high-confidence result, corrupted decision state, or evidence mismatch.

Rollback: restore the pre-run local browser/database snapshot; acceptance never modifies immutable extraction or prior human decisions.

### Step 7 — Package and rehearse the demonstration

Context: a working development tab is not yet a reliable demonstration. The run must be repeatable after a restart and understandable to a non-developer.

Tasks:

- provide one documented start/check command for the local server configuration;
- add a health/readiness screen that distinguishes web, storage, worker, AI/OCR and browser-local capabilities;
- provide a clean demo reset that affects only the explicitly named demo project and has a backup/restore path;
- prepare a 10–15 minute German walkthrough: new project, upload, quality report, one clear automatic match, one manual-review case, source evidence, supplier decision and export;
- prepare fallback screenshots/video only as presentation insurance, never as proof that the live workflow passed;
- run the complete verification suite from a fresh process and browser session.

Final verification:

- `git diff --check`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:e2e`
- `npm run build`
- local corpus regression audit
- unseen-project release audit
- dependency/security audit

Exit criteria:

- a fresh browser can complete the scripted workflow without developer intervention;
- the readiness report says `DEMO_READY` and links every failure/status to an explanation;
- the diff is reviewed, critical/high findings are resolved, and proposed conventional commits are presented at Gate 2.

Rollback: restore the verified release tag/commit and local demo backup.

## 8. OCR decision

Coordinate-preserving OCR is required before image-only scans can produce verified highlights. It must be implemented behind the same evidence contract and benchmarked on German technical documents. Until an OCR provider/runtime is selected and its accuracy, data handling, cost and coordinates are verified, scan-only pages remain `OCR_REQUIRED` and cannot be counted as successfully extracted. In a hybrid PDF, any OCR-required commercial page makes supplier coverage incomplete even if other pages have native text.

OCR does not block a digital-PDF demonstration if the chosen unseen project contains supported native-text files and the interface honestly reports scan limitations. It does block any claim that the supplied image-only pages are fully processed.

## 9. Anti-patterns prohibited by this plan

- adding supplier- or filename-specific regex to make the acceptance corpus pass;
- treating the number of extracted objects as proof that all positions are correct;
- using AI confidence as evidence without deterministic source geometry;
- hiding unsupported pages behind a project-level success message;
- allowing uncertain matches into cheapest-price ranking;
- changing immutable extraction or confirmed human decisions during recomputation;
- committing private PDFs, rendered pages, extracted commercial text or local AI output;
- accepting screenshots without geometry and interaction assertions.

## 10. Plan mutation protocol

- A step may be split when its tests or contract can be reviewed independently.
- A new blocker is inserted before the first dependent step and must receive an explicit exit criterion.
- Scope may be deferred only by moving it to the out-of-scope list and updating the demo claim.
- Acceptance thresholds cannot be lowered after seeing holdout results without explicit user approval and a documented reason.
- No implementation step is considered complete until its verification and exit criteria are recorded.
