"use client";

import { useEffect, useRef } from "react";
import { decisionPaneWidth } from "./workspace-layout";

export function WorkspacePaneDivider({ workspaceKey }: { workspaceKey: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const ratio = useRef<number | null>(null);
  const apply = useRef<(value: number) => void>(() => undefined);
  useEffect(() => {
    const grid = button.current?.closest<HTMLElement>("[data-lv-three-pane]");
    if (!grid) return;
    const key = `lv-pane-width:${workspaceKey}`;
    try {
      const saved = sessionStorage.getItem(key);
      ratio.current = saved === null ? null : Number(saved);
    } catch { /* Resizing remains available without storage. */ }
    const resize = (value: number) => {
      const navigator = grid.querySelector<HTMLElement>("[data-position-navigator]");
      if (!navigator) return;
      const width = grid.clientWidth - navigator.offsetWidth;
      const center = decisionPaneWidth(width, value);
      if (center === null || window.innerWidth <= 950) {
        grid.style.removeProperty("grid-template-columns");
        return;
      }
      grid.style.gridTemplateColumns = `${navigator.offsetWidth}px ${center}px minmax(360px,1fr)`;
      ratio.current = center / width;
      try { sessionStorage.setItem(key, String(ratio.current)); } catch { /* optional view state */ }
    };
    apply.current = resize;
    const observer = new ResizeObserver(() => {
      if (ratio.current !== null) resize(ratio.current);
    });
    observer.observe(grid);
    if (ratio.current !== null) resize(ratio.current);
    return () => observer.disconnect();
  }, [workspaceKey]);
  return <button
    ref={button}
    type="button"
    className="lv-pane-divider"
    aria-label="Breite der Dokumentvorschau ändern"
    title="Ziehen oder mit Pfeiltasten ändern"
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      apply.current((ratio.current ?? .5) + (event.key === "ArrowLeft" ? -.025 : .025));
    }}
    onPointerDown={(event) => {
      const target = event.currentTarget;
      const grid = target.closest<HTMLElement>("[data-lv-three-pane]");
      const navigator = grid?.querySelector<HTMLElement>("[data-position-navigator]");
      const center = grid?.querySelector<HTMLElement>("[data-lv-decision-pane]");
      if (!grid || !navigator || !center) return;
      const width = grid.clientWidth - navigator.offsetWidth;
      const start = event.clientX;
      const initial = center.offsetWidth;
      target.setPointerCapture(event.pointerId);
      const move = (next: PointerEvent) => apply.current((initial + next.clientX - start) / width);
      const end = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("lostpointercapture", end);
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("lostpointercapture", end);
    }}
  ><span /></button>;
}
