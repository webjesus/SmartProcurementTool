# Agent Orchestrator

The Agent Orchestrator is an internal, deterministic control layer around the
existing SmartProcurementTool pipeline. It is not a chat, a second application or
an independent Hermes process.

## Runtime boundaries

- `ProjectRun`, `ExecutionPlan`, `Checkpoint`, `AgentIssue`, memory and audit
  contracts live in `src/domain/orchestrator.ts`.
- `src/orchestrator/tool-registry.ts` exposes the existing pipeline operations as
  typed tools. A tool must pass strict input/output validation and carries timeout,
  retry, idempotency, error and AI-cost metadata.
- The runtime has no shell adapter. Production execution can only occur through a
  supplied `ToolExecutor`.
- Local workstation state is stored separately in
  `.data/orchestrator-state.local.json`. The immutable extraction file is never
  rewritten by ProjectRun operations.
- Repository interfaces in `src/domain/repositories.ts` define the boundary for a
  future production persistence adapter. The local JSON store is not represented
  as production infrastructure.

## Deterministic plan and resume

Planning considers document roles, selected pages, page modes, immutable
extraction responses, validation results, matching/comparison caches and the AI
cost limit. It does not call a model.

Every successful or cached tool call writes a checkpoint and a compact audit
record. Inputs and outputs are represented by hashes; commercial document bodies
and credentials are not copied into the audit. A restart skips idempotency keys
that already have a successful checkpoint and resumes at the first unfinished
step.

The current limited pilot adopts seven already processed pages from three
documents. Extraction audits reference the saved provider response metadata and
therefore expect zero new AI requests.

## Memory

Memory retrieval is scoped by project, discipline, supplier, document family,
manufacturer, article, technical attributes and bundle context.

- Immutable facts reference existing document/page extraction artifacts.
- Human-confirmed records reference durable review, matching and supplier actions.
- Approved rules are active, versioned records.
- Rule candidates remain inactive and are never returned as approved memory.

Current document evidence wins over memory. Memory never mutates extraction.

## Human gates and self-checks

Blocking validation, ambiguous matching, technical or scope deviations,
unconfirmed prices/components, replacements, rule conflicts, AI cost limits and
manual supplier selection stop the run. Operator actions stay in the existing
ReviewAction/AuditEvent persistence. Resume synchronizes those actions and only
continues when the relevant gate is resolved.

Deterministic self-checks verify extraction evidence/arithmetic, matching
cardinality and optional roles, and comparison eligibility. A failed self-check
creates an `AgentIssue` and stops dependent processing.

## Current limitations

- The checked-in implementation provides the domain/runtime layer and an explicit
  local durable adapter. A production database/queue executor remains an adapter
  boundary.
- There is no autonomous loop or background AI planner.
- AI tools require an explicit executor and cost allowance; CI uses fake adapters.
- Rule candidates require a separate explicit approval workflow before they can
  become an approved versioned rule.

