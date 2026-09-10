# SmartProcurementTool repository guidance

- Never add `pdffirma/`, `.data/`, `storage/`, local page renders, extracted commercial text, prices, article numbers, project names or local AI responses to Git.
- `corpus:scan` must never call OpenAI or another external AI provider.
- Supplier extraction must remain independent from Basis-LV, matching and historical decisions.
- Matching and recommendations must not rewrite immutable extraction.
- Do not automatically modify human-confirmed or human-corrected fields.
- Do not represent volatile demo state, local filesystem storage or the heartbeat worker as production infrastructure.
- Run typecheck, lint, unit/integration tests, E2E, build and `git diff --check` before handoff.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
