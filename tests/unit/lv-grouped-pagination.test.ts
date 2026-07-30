import { describe, expect, it } from "vitest";
import { isAbortError } from "@/components/lv/async-lifecycle";
import { paginateGroupedPositions } from "@/components/lv/grouped-pagination";

type Position = {
  id: string;
  groupId: string;
};

function positions(groupId: string, count: number): Position[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${groupId}-${index + 1}`,
    groupId
  }));
}

const source = [
  ...positions("A", 54),
  ...positions("B", 46),
  ...positions("C", 42)
];
const groupFor = (position: Position) => ({
  id: position.groupId,
  title: `Gruppe ${position.groupId}`
});

describe("group-aware LV pagination", () => {
  it("paginates visible positions after grouping and collapse", () => {
    const expanded = paginateGroupedPositions({
      positions: source,
      collapsedSectionIds: new Set(),
      page: 1,
      pageSize: 100,
      groupFor
    });
    expect(expanded.visiblePositions).toHaveLength(142);
    expect(expanded.sections.flatMap((section) => section.positions)).toHaveLength(
      100
    );
    expect(expanded.sections.map((section) => section.id)).toEqual(["A", "B"]);
    expect(expanded.pageCount).toBe(2);

    const collapsed = paginateGroupedPositions({
      positions: source,
      collapsedSectionIds: new Set(["A"]),
      page: 1,
      pageSize: 100,
      groupFor
    });
    expect(collapsed.visiblePositions).toHaveLength(88);
    expect(collapsed.sections.map((section) => section.id)).toEqual([
      "A",
      "B",
      "C"
    ]);
    expect(collapsed.sections[0]).toMatchObject({
      id: "A",
      positions: [],
      totalPositionCount: 54
    });
    expect(collapsed.sections.flatMap((section) => section.positions)).toHaveLength(
      88
    );
    expect(collapsed.pageCount).toBe(1);
  });

  it("restores distribution without duplicates after expand", () => {
    const pageTwo = paginateGroupedPositions({
      positions: source,
      collapsedSectionIds: new Set(),
      page: 2,
      pageSize: 100,
      groupFor
    });
    expect(pageTwo.sections.map((section) => section.id)).toEqual(["C"]);
    expect(pageTwo.sections[0].positions).toHaveLength(42);
    expect(new Set(pageTwo.visiblePositions.map(({ id }) => id)).size).toBe(142);
  });

  it("combines a filtered source with collapse and clamps an empty last page", () => {
    const filtered = source.filter(
      (position) => position.groupId !== "B" && !position.id.endsWith("-1")
    );
    const result = paginateGroupedPositions({
      positions: filtered,
      collapsedSectionIds: new Set(["A"]),
      page: 9,
      pageSize: 100,
      groupFor
    });
    expect(result.currentPage).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(result.visiblePositions.every(({ groupId }) => groupId === "C")).toBe(
      true
    );
    expect(result.sections.at(-1)?.positions).toHaveLength(41);
  });
});

describe("abort lifecycle classification", () => {
  it("treats aborts as lifecycle events without hiding real errors", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(
      true
    );
    expect(isAbortError(new Error("network unavailable"))).toBe(false);
  });
});
