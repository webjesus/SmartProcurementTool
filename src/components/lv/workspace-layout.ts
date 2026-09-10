/** Readable minimums apply only to the side-by-side desktop layout. */
export function decisionPaneWidth(available: number, ratio: number): number | null {
  if (available < 720) return null;
  const safeRatio = Number.isFinite(ratio) ? ratio : 0.5;
  return Math.round(Math.max(360, Math.min(available - 360, available * safeRatio)));
}

export function previewOptionAfterSourceChange(
  current: string | null,
  source: { kind: "basis" | "supplier"; supplierOptionId?: string }
): string | null {
  return source.kind === "supplier" ? source.supplierOptionId ?? current : current;
}

export function evidenceFitScale(
  available: { width: number; height: number },
  page: { width: number; height: number },
  evidence: { width: number; height: number }
): number {
  return Math.min(
    available.width / (page.width * Math.max(evidence.width / 0.94, 0.34)),
    available.height / (page.height * Math.max(evidence.height / 0.84, 0.2))
  );
}
