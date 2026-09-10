# Supplier title extraction

Date: 2026-09-02

## Scope

The browser worker must keep a supplier product description separate from its
article identifier, quantity and price fields. Some offer layouts place an
unlabelled article identifier before the quantity and the actual title after
the price columns.

All committed fixtures use invented suppliers, products, identifiers and
amounts. The confidential source PDF and extracted commercial values remain
outside Git.

## RED evidence

The original worker treated all text before the first quantity as the title.
The first regression therefore returned only an unlabelled numeric identifier
and no article field. Follow-up RED cases also proved that:

- a pressure value inside the description could be mistaken for money;
- a normal product token containing a digit could be mistaken for an article;
- line-break hyphenation and a deliberate spaced dash were conflated.

## GREEN contract

- An isolated leading identifier is stored as `articleNumber` when the actual
  product title follows the quantity/price columns.
- Explicit net-position values win over gross display columns.
- Without an explicit net marker, only structurally leading price columns are
  considered.
- Numbers embedded in technical prose do not become prices.
- A normal alphanumeric product name remains a description.
- Soft line-break hyphenation is joined while a deliberate spaced dash remains.

Worker-level tests and the browser-local flow verify the behaviour. Final
combined test counts are recorded in `docs/testing/demo-readiness.tdd.md`.

## Confidential regression check

The saved local project was processed read-only and the title/article split,
quantity, price provenance, persisted selection and source navigation were
checked. Only the aggregate outcome is documented here; no supplier excerpt,
article number, amount, page image or project identifier is retained in Git.
