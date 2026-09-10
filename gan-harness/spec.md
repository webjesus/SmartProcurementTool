# Smart Procurement Tool — MVP specification

Status: Gate 1 approved on 2026-08-31.

## Product outcome

Build a German-language, evidence-first procurement workspace for up to 50–100
office users. The application is deployed on the company's local server, may
use approved cloud AI services, and accepts PDF documents only.

The tool structures procurement work. It does not silently replace commercial
or technical judgement.

## Locked domain decisions

1. The global product library is the landing page and contains confirmed,
   canonical company products — not raw supplier lines.
2. Supplier extraction is independent from Basis-LV extraction, matching and
   historical decisions. Extraction snapshots are immutable.
3. Matching answers "which offer lines could satisfy this Basis position?".
   It must model bundles, accessories, exclusions and technical comparability.
4. The cheapest complete, comparable option is the baseline recommendation.
   Ambiguous or non-comparable cases become explicit human questions.
5. A confirmed supplier selection is an audited decision. Human-confirmed and
   human-corrected data is never silently overwritten.
6. Kalkulation is downstream and independent. A selected offer quantity and
   unit price do not automatically define the customer calculation. The user
   controls calculation quantity, material EK, labour, additions, margin/DB and
   VK with a traceable link back to the supplier decision.
7. Prices are revision-, supplier-, offer-, project- and date-specific. A
   product has no unqualified single `currentPrice`.
8. Adding a library product to a project creates a versioned project snapshot;
   later library edits do not silently mutate the project.
9. PDF generation and email generation create drafts with sources and require
   user review before export/send. The MVP does not send mail autonomously.
10. Roles and fine-grained authorization are deferred, but data boundaries,
    audit fields and service contracts must allow them later.

## Global information architecture

- `/` — Produktbibliothek
- `/projects` — Projekte
- `/projects/new` — Neues Projekt
- `/pdf-erstellen` — PDF erstellen
- `/email-assistent` — E-Mail-Assistent
- `/revisionsunterlagen` — Revisionsunterlagen
- `/eigenes-lv` — Eigenes LV

Project workspaces will contain Übersicht, Dokumente, LV-Vergleich,
Lieferantenauswahl, Kalkulation, Produkte / Gerätebeschreibungen, Angebote,
Exporte / Tabellen, Revisionsunterlagen and Historie.

## Visual direction

Name: **Weinbuch Werkstatt / Technical Ledger**.

- Audience: German procurement and technical office staff doing dense,
  repetitive document work.
- Tone: technical, calm, precise and recognisable; never a generic white SaaS
  landing page.
- Brand colors from the supplied logo: navy `#003273`, yellow `#FFC20F`, black
  `#000000`.
- Memorable detail: a navy document spine with a yellow bookmark/focus marker.
- Light, dark and system themes are equal supported modes.
- Yellow is reserved for focus, active markers and decisive actions. It is not
  used as body text on white.
- Semantic success/warning/error colors remain distinct from the brand palette.
- Tables and inspectors favour scanability, stable columns and keyboard focus.

## Vertical slices

### S1 — Secure baseline and branded shell

- Reproducible tests do not depend on ignored `.data` or commercial corpus.
- Patched direct dependencies remove known high vulnerabilities in Next/PDF.js.
- Unified German navigation works for every deployment profile.
- Light/dark/system theme persists locally and respects system preference.
- Weinbuch logo and accessible brand tokens are used.
- Existing LV routes remain reachable.

### S2 — Confirmed product library

- The root route renders the usable library, not a redirect or marketing page.
- Search and filters have explicit empty/no-result states.
- Product details use Stammdaten, Technische Daten, Lieferantenartikel,
  Dokumente, Verwendung and Änderungshistorie.
- `Produkt hinzufügen` means creating or confirming a canonical product.
- `Zum Projekt hinzufügen` creates a project snapshot, never a live reference.
- Raw extracted candidates enter a review queue before promotion.

### S3 — Project directory and creation

- Project list shows name, address, engineering office and architecture office.
- New project validates and stores those fields plus optional description.
- Project drafts and uploaded PDFs are isolated by project.
- Any browser-local fallback is labelled as a non-production workspace.

### S4 — Immutable PDF intake and revisions

- Only valid PDFs are accepted.
- Original bytes, SHA-256, revision relation and source evidence are retained.
- Replacing a PDF creates a revision and invalidates derived analysis without
  deleting the old extraction snapshot.

### S5 — Durable processing

- Postgres-backed jobs and a real worker replace heartbeat/demo processing.
- Jobs are idempotent, resumable and observable.

### S6–S10 — Classification, extraction, matching and decisions

- Classify document role/supplier/discipline/revision with manual correction.
- Extract Basis-LV and supplier offers independently.
- Show source PDF geometry for every machine claim.
- Build bundle-aware comparable options and separate review queues for system
  defects versus specialist decisions.
- Recommend the cheapest complete comparable option only.
- Persist an audited final supplier decision with optimistic concurrency.

### S11 — Independent Kalkulation

- Starts from a confirmed supplier decision but owns separate quantities,
  material EK, labour, additions, margin/DB and VK.
- Formula inputs and overrides are visible and audited.

### S12–S14 — Knowledge, exports and operations

- Promote confirmed products and aliases into the library with price history.
- Export comparison, supplier decision and calculation as separate artefacts.
- Add backup/restore, retention, observability, accessibility, performance and
  end-to-end production checks.

## First implementation batch

This Gate 1 batch covers S1–S3: baseline, branded shell, product-library landing
and project directory/creation contracts. Later slices must not be faked inside
this batch. Controls for unavailable functionality must be honest drafts or
clearly labelled planned modules.

## Non-functional acceptance

- German UI, keyboard-visible focus, meaningful labels and responsive layout.
- No external logo/image requests for company or supplier identity.
- No secrets, local PDF paths, extracted commercial text, prices, article
  numbers, project names or AI responses in Git.
- Typecheck, lint, unit/integration tests, E2E, build and `git diff --check`
  pass before handoff.
- Security review is mandatory for user input, database, filesystem, external
  API or identity changes.
