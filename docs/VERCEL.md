# Vercel readiness

`npm run build` does not depend on `pdffirma/`, a database or an OpenAI key. The UI, health API, volatile synthetic review flow and XLSX export are serverless-compatible.

## Required production configuration

- Set server-only OpenAI variables only when AI processing is enabled.
- Configure PostgreSQL and implement the repository adapters before durable operator use.
- Configure a real object-storage adapter before accepting production files.
- Keep `LOCAL_CORPUS_ENABLED=false`.
- Never upload `pdffirma/`, `.data/`, `storage/`, local renders or local AI responses.

Heavy PDF processing and the long-running worker are deliberately local. They are not disguised as a complete Vercel serverless pipeline. A future production installation needs durable object storage, a queue/worker runtime, retry/dead-letter handling and observability.
