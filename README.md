# SmartProcurementTool

Smart Procurement Tool (SPT) is an evidence-first workflow for extracting, validating, matching and reviewing procurement documents. It combines independent OpenAI extraction with deterministic validation and explicit operator decisions.

The repository ships only synthetic fixtures. The real company corpus in `pdffirma/`, generated page renders, extracted commercial text, local AI responses and local databases are ignored by Git.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Keep `LOCAL_CORPUS_ENABLED=false` for the synthetic application.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open `http://localhost:3000`.

## Vercel deployment

The repository is configured for Vercel with the Next.js framework, `npm ci`
for installation and `npm run build` for production builds. Pushes to the
GitHub `main` branch trigger the connected Vercel project automatically.
Vercel deployments use the browser-local persistence profile, so the current
interface can be reviewed without a company database. Local on-premise
deployments keep using the server profile configured in `.env.local`.

For local corpus access set `LOCAL_CORPUS_ENABLED=true`. `OPENAI_API_KEY` is needed only for `corpus:process`; it is not needed for the UI, tests, build or `corpus:scan`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js plus the local processing worker |
| `npm run dev:web` | Next.js only |
| `npm run dev:worker` | local worker heartbeat |
| `npm run build` | production build |
| `npm run typecheck` | strict TypeScript check |
| `npm run lint` | ESLint |
| `npm run test` | unit and integration tests |
| `npm run test:e2e` | Playwright browser workflow |
| `npm run openai:models` | verify `.env.local` account access and select the strongest compatible model |
| `npm run corpus:scan` | local PDF inventory; never calls OpenAI |
| `npm run corpus:process -- --dry-run --limit=8` | local processing plan without OpenAI |
| `npm run corpus:process -- --document=<id-or-name> --limit=2` | selected-page OpenAI processing |

`corpus:process` requires one explicit document selection, honors the page limit, caches completed page runs, excludes historical result documents, and never reuses them as extraction hints.

Pilot runs, evidence crops, review actions and audit events are stored under the
gitignored `.data/` directory. `Gefundene Daten` and `Prüfung` read that durable
local state only when `LOCAL_CORPUS_ENABLED=true`; CI continues to use fake data
and never calls OpenAI.

## Application structure

- `src/app`: German operator UI and server routes.
- `src/domain`: extraction contracts, validation, matching, recommendation, review and repository interfaces.
- `src/ai`: official OpenAI Node SDK adapter and versioned prompts.
- `src/pdf`: page-oriented PDF.js parser with stable text-item IDs and normalized geometry.
- `src/db`: PostgreSQL/Drizzle schema.
- `src/storage`: explicit local-only storage and an honest unconfigured production adapter.
- `src/worker`: local worker boundary.
- `scripts`: corpus inventory and controlled processing.
- `tests`: synthetic unit, integration and browser scenarios.

See [architecture](docs/ARCHITECTURE.md), [extraction contract](docs/EXTRACTION_CONTRACT.md) and [deployment notes](docs/VERCEL.md).

## Data and security boundaries

- Supplier extraction never receives the Basis-LV, historic winner, matching result or expected price.
- Matching cannot mutate the immutable extraction.
- Human-confirmed and human-corrected fields are locked against automatic changes.
- Every important number requires page and text-item evidence.
- Clear recommendations still require a human supplier decision.
- Production document storage and durable processing are intentionally not simulated.
