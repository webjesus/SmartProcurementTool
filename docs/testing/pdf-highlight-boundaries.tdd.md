# PDF source highlight boundaries

Date: 2026-09-02

## Scope

This regression protects measured source highlighting in generic supplier and
Basis PDFs. A selected frame must begin with the complete position row, contain
all commercial rows belonging to that position, and stop before the next
position, another visual column, or structural page furniture.

All committed fixtures are synthetic. The confidential regression PDFs and
their extracted text, prices, article identifiers and project metadata remain
outside Git.

## RED evidence

The initial focused suite reproduced these failure families before the
implementation changed:

1. a separate supplier row number was incorrectly assigned to the next block;
2. date-shaped and dotted identifiers became false position boundaries;
3. long final Basis and supplier positions were truncated;
4. unlabelled company/footer clusters were included in the selected frame;
5. a legitimate separated quantity row was mistaken for footer furniture;
6. shuffled content-stream order, split references and repeated references
   selected the wrong geometry;
7. adjacent visual columns contaminated one another.

Each regression asserted coordinates and neighbouring-content exclusion, not
only that a frame existed.

## GREEN evidence

- `npm test -- tests/unit/pdf-source-region.test.ts` passed the complete focused
  geometry matrix before the later rotation/indentation hardening slice.
- Focused coverage was above 95% statements and 99% lines for the source-region
  module at that checkpoint.
- Browser verification confirmed that frames were derived from PDF text-layer
  coordinates and that the document pane had no horizontal overflow.

The final combined counts and commands are recorded in
`docs/testing/demo-readiness.tdd.md` after all hardening slices finish.

## Behaviour locked by tests

- Visual rows are reconstructed independently of PDF content-stream order.
- Split position tokens are normalized into one reference.
- The selected block includes a detached supplier row number when geometry
  proves that it belongs to the position.
- The next position, another column and structural footer rows are excluded.
- Long final positions keep their final description and quantity rows.
- Ambiguous repeated references fail closed instead of receiving a guessed
  verified frame.
- Empty text layers produce no synthetic geometry.
- Padding is quiet, outward-only and clamped to the page.

## Confidential regression check

The supplied native-text corpus was checked read-only. Only aggregate pass/fail
status and anonymous failure categories may be retained. No source excerpts,
prices, article numbers, customer/project names or page renders are committed.

## Known limitation

Procurement PDFs do not share a schema. Image-only pages require
coordinate-preserving OCR, while ambiguous geometry is routed to manual review.
The sealed unseen-project gate remains the only basis for a claim about a new
layout.
