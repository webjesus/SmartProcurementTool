# MVP evaluation rubric — first batch

Pass threshold: 7.0/10, with no critical criterion at zero.

| Area | Weight | Evidence required |
|---|---:|---|
| Domain fidelity | 2.0 | Library is canonical/confirmed; matching, decision and Kalkulation remain separate concepts. |
| Landing workflow | 1.5 | `/` is an immediately usable product-library screen with search/filter and honest empty states. |
| Navigation | 1.0 | German global sections and `Neues Projekt` are reachable; existing LV workflow remains reachable. |
| Visual system | 1.5 | Exact Weinbuch navy/yellow tokens, logo, document-spine/bookmark motif, coherent light and dark themes. |
| Projects | 1.0 | Required project metadata is visible and validated; storage mode is not misrepresented. |
| Accessibility/responsiveness | 1.0 | Keyboard focus, contrast, semantic controls and desktop/mobile text fit are verified. |
| Security/reproducibility | 1.0 | No corpus/secrets in Git; tests do not depend on `.data`; dependency audit and security review recorded. |
| Engineering quality | 1.0 | RED/GREEN evidence, typecheck, lint, tests, build, E2E and diff check. |

## Automatic rejection conditions

- Root route redirects to projects or shows a marketing hero instead of the
  library workflow.
- UI implies browser-local/heartbeat/local filesystem state is production.
- Cheapest price is selected across technically non-comparable or incomplete
  options.
- Kalkulation is derived as quantity × chosen offer unit price without explicit
  independent inputs.
- Human-confirmed values are silently rewritten.
- Commercial corpus content, secrets or local absolute PDF paths are tracked.
