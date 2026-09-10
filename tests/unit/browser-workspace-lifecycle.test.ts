import { describe, expect, it } from "vitest";
import * as browserLvPage from "@/components/browser-projects/browser-lv-page";
import type { ProjectWorkspaceState } from "@/domain/project-workspace";
import {
  resolveInitialQueryWorkspaceNavigation,
  resolveTableScrollUpdate,
  shouldAutoScrollActivePosition
} from "@/components/lv/lv-comparison-page";

function requiredExport<T>(name: string): T {
  const candidate = (browserLvPage as Record<string, unknown>)[name];
  expect(candidate, `BrowserLvPage must expose ${name}`).toBeTypeOf("function");
  return candidate as T;
}

describe("browser workspace lifecycle", () => {
  it("normalizes legacy IndexedDB workspace records through the canonical schema", () => {
    const normalize = requiredExport<
      (value: unknown) => ProjectWorkspaceState
    >("normalizeBrowserWorkspaceState");
    const normalized = normalize({
      tableScroll: 640,
      sourceOverlay: {
        sourceKey: "basis:15:e-basis",
        documentRevisionId: "basis-revision-7",
        page: 15,
        zoom: 1.1,
        fitMode: "CONTEXT",
        scrollLeft: 12,
        scrollTop: 840
      }
    });

    expect(normalized.tableScroll).toBe(640);
    expect(normalized.sourceViews).toEqual({});
    expect(normalized.pageSize).toBe(20);
  });

  it("stages the latest workspace synchronously for navigation flush", () => {
    const stage = requiredExport<
      (
        ref: { current: ProjectWorkspaceState | null },
        state: ProjectWorkspaceState
      ) => void
    >("stageBrowserWorkspace");
    const ref = { current: null as ProjectWorkspaceState | null };
    const latest = {
      tableScroll: 777,
      sourceViews: {}
    } as ProjectWorkspaceState;

    stage(ref, latest);

    expect(ref.current).toBe(latest);
  });

  it("flushes the newest staged workspace before leaving the LV route", async () => {
    const persistBeforeNavigation = requiredExport<
      (
        ref: { current: ProjectWorkspaceState | null },
        save: (state: ProjectWorkspaceState) => Promise<void>
      ) => Promise<void>
    >("persistLatestWorkspaceBeforeNavigation");
    const latest = {
      tableScroll: 812,
      sourceViews: {}
    } as ProjectWorkspaceState;
    const saved: ProjectWorkspaceState[] = [];

    await persistBeforeNavigation({ current: latest }, async (state) => {
      saved.push(state);
    });

    expect(saved).toEqual([latest]);
  });

  it("ignores programmatic list scroll events until workspace hydration completes", () => {
    expect(resolveTableScrollUpdate(640, 0, false)).toBe(640);
    expect(resolveTableScrollUpdate(640, 0, true)).toBe(0);
  });

  it("does not move the restored list when the active position came from workspace hydration", () => {
    expect(
      shouldAutoScrollActivePosition({
        hasActivePosition: true,
        restoringWorkspace: true
      })
    ).toBe(false);
    expect(
      shouldAutoScrollActivePosition({
        hasActivePosition: true,
        restoringWorkspace: false
      })
    ).toBe(true);
  });

  it("resets incompatible restored filters and opens the URL position on its LV page", () => {
    expect(
      resolveInitialQueryWorkspaceNavigation({
        requestedPositionId: "position-31",
        filteredPositionIds: ["position-4"],
        visiblePositionIds: ["position-4"],
        lvOrderedPositionIds: Array.from(
          { length: 45 },
          (_, index) => `position-${index + 1}`
        ),
        pageSize: 20
      })
    ).toEqual({
      resetFilters: true,
      expandAll: true,
      page: 2
    });
  });

  it("keeps compatible filters and selects the page containing the URL position", () => {
    expect(
      resolveInitialQueryWorkspaceNavigation({
        requestedPositionId: "position-24",
        filteredPositionIds: Array.from(
          { length: 30 },
          (_, index) => `position-${index + 1}`
        ),
        visiblePositionIds: Array.from(
          { length: 30 },
          (_, index) => `position-${index + 1}`
        ),
        lvOrderedPositionIds: [],
        pageSize: 20
      })
    ).toEqual({
      resetFilters: false,
      expandAll: false,
      page: 2
    });
  });
});
