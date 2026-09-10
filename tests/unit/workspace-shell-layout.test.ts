import { describe, expect, it } from "vitest";
import {
  isLvWorkspacePath,
  isProjectWorkspacePath
} from "@/components/app-shell";
import {
  stableContainerSize,
  stableScrollState
} from "@/components/lv/source-overlay";

describe("project workspace shell", () => {
  it("uses the compact navigation only inside a concrete project", () => {
    expect(isProjectWorkspacePath("/projects/project-1/documents/review")).toBe(true);
    expect(isProjectWorkspacePath("/projects/project-1/processing")).toBe(true);
    expect(isProjectWorkspacePath("/projects/project-1/lv-vergleich")).toBe(true);
    expect(isProjectWorkspacePath("/projects")).toBe(false);
    expect(isProjectWorkspacePath("/projects/new")).toBe(false);
  });

  it("identifies the constrained LV workspace independently", () => {
    expect(isLvWorkspacePath("/projects/project-1/lv-vergleich")).toBe(true);
    expect(isLvWorkspacePath("/lv-vergleich")).toBe(true);
    expect(isLvWorkspacePath("/projects/project-1/documents/review")).toBe(false);
  });

  it("reuses equal PDF scroll state to avoid render loops", () => {
    const current = { left: 12, top: 24 };
    expect(stableScrollState(current, { left: 12, top: 24 })).toBe(current);
    expect(stableScrollState(current, { left: 13, top: 24 })).toEqual({
      left: 13,
      top: 24
    });
  });

  it("does not schedule another PDF layout pass for an unchanged stage", () => {
    const current = { width: 460, height: 620 };
    expect(stableContainerSize(current, { width: 460, height: 620 })).toBe(
      current
    );
    expect(stableContainerSize(current, { width: 461, height: 620 })).toEqual({
      width: 461,
      height: 620
    });
  });
});
