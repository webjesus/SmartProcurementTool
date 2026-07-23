# Architecture

## Processing flow

```text
document revision
  -> page classification and text/geometry parsing
  -> independent immutable extraction
  -> deterministic evidence and arithmetic validation
  -> one targeted issue recheck at most
  -> Basis-LV candidate matching
  -> deterministic matching constraints
  -> operator review and field locks
  -> comparable supplier options
  -> operator supplier decision
  -> auditable XLSX export
```

Historical calculations and final decisions are held outside extraction and matching. They may be compared only after the system has generated its own reviewed result.

## Boundaries

- UI: Next.js App Router and React.
- API: health, review action, local corpus metadata, local PDF streaming and XLSX export.
- Worker: a replaceable local process boundary. The current heartbeat demonstrates lifecycle only; it is not presented as a production queue.
- Domain: provider-independent contracts and deterministic rules.
- OpenAI: official Node SDK, Responses API and Zod Structured Outputs.
- Parsing: page-oriented PDF.js extraction with stable IDs and normalized 0..1 evidence regions.
- Persistence: PostgreSQL schema through Drizzle. The synthetic demo uses explicitly volatile review state.
- Storage: local filesystem only when enabled; production storage throws a configuration error until a real adapter exists.

## Repository interfaces

The code defines `DocumentStorage`, `DocumentParser`, `OpenAiExtractionAdapter`, `ProjectRepository`, `ExtractionRepository`, `MatchingRepository`, `ReviewRepository`, `ProcessingJobRepository`, `AuditRepository` and `RuleRepository`.

## Database schema

The schema contains projects, documents and revisions, pages and text items, immutable extraction/page runs, offer groups and lines, money candidates, Basis positions, evidence links, matches, review issues/actions, recommendations/decisions, audit events, versioned company rules, rule candidates and processing jobs.

Original extraction is stored separately from reviewed values. A review action records previous value, new value, operator, reason, comment and timestamp.

## Rule learning

```text
operator action
  -> correction record
  -> rule candidate
  -> synthetic regression case
  -> manual approval
  -> versioned company rule
```

Rules are scoped to `GLOBAL`, `COMPANY`, `SUPPLIER`, `DOCUMENT_FAMILY` or `PROJECT`. A project observation never becomes global automatically.

## Recommendation gates

`CLEAR_RECOMMENDATION` requires confirmed matching, validated price, compatible quantity/unit, equivalent required scope, included mandatory components, no technical deviation, separated optional items and sufficient evidence. It remains an advisory status, not a final supplier decision.
