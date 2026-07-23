# Extraction contract

Contract version: `extraction-contract-v1`

Prompt versions:

- `supplier-page-extraction-v1`
- `basis-page-extraction-v1`
- `supplier-targeted-recheck-v1`

Preprocessing version: `pdf-page-v1`

The authoritative Zod contract is in `src/domain/contracts.ts`.

## Independent extraction

Supplier extraction receives one page, stable native text items with source order and normalized geometry, and a page image only for scan/hybrid processing. It never receives Basis-LV requirements, an expected product/price, the historic selection or a matching result.

All visible money candidates are returned. Unit price, total price, subtotal, discount, surcharge and other values remain separate. Missing values stay null.

## Evidence

Native evidence contains document ID, page number, existing text-item IDs, source text and a normalized bounding region. The server validates page ownership and item existence. Visual evidence uses a normalized region and cannot become machine-validated without sufficient confirmation.

## Recheck

One semantic recheck is allowed per issue group. It receives only the issue crop/context, issue codes and fields allowed to change. It does not receive the Basis-LV and cannot modify human-locked fields. Repeated ambiguity becomes human review.

## AI run metadata

Each live run records model and response IDs, prompt/schema/preprocessing versions, input/output/cached tokens, duration, attempt, error, timestamps and a deterministic cache key. Cost remains null until a current pricing table is explicitly configured; the system does not invent model prices.
