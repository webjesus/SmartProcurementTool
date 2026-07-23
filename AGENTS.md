# SmartProcurementTool repository guidance

- Never add `pdffirma/`, `.data/`, `storage/`, local page renders, extracted commercial text, prices, article numbers, project names or local AI responses to Git.
- `corpus:scan` must never call OpenAI or another external AI provider.
- Supplier extraction must remain independent from Basis-LV, matching and historical decisions.
- Matching and recommendations must not rewrite immutable extraction.
- Do not automatically modify human-confirmed or human-corrected fields.
- Do not represent volatile demo state, local filesystem storage or the heartbeat worker as production infrastructure.
- Run typecheck, lint, unit/integration tests, E2E, build and `git diff --check` before handoff.
