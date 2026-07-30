export type GroupDescriptor = {
  id: string;
  title: string;
};

export type PaginatedGroup<T> = GroupDescriptor & {
  positions: T[];
  totalPositionCount: number;
};

export type GroupedPaginationResult<T> = {
  sections: PaginatedGroup<T>[];
  visiblePositions: T[];
  allSectionIds: string[];
  currentPage: number;
  pageCount: number;
  totalVisiblePositions: number;
};

export function paginateGroupedPositions<T>({
  positions,
  collapsedSectionIds,
  page,
  pageSize,
  groupFor
}: {
  positions: readonly T[];
  collapsedSectionIds: ReadonlySet<string>;
  page: number;
  pageSize: number;
  groupFor: (position: T) => GroupDescriptor;
}): GroupedPaginationResult<T> {
  const grouped = new Map<string, PaginatedGroup<T>>();
  for (const position of positions) {
    const descriptor = groupFor(position);
    const group = grouped.get(descriptor.id);
    if (group) {
      group.positions.push(position);
      group.totalPositionCount += 1;
    } else {
      grouped.set(descriptor.id, {
        ...descriptor,
        positions: [position],
        totalPositionCount: 1
      });
    }
  }

  const groups = [...grouped.values()];
  const visiblePositions = groups.flatMap((group) =>
    collapsedSectionIds.has(group.id) ? [] : group.positions
  );
  const totalVisiblePositions = visiblePositions.length;
  const pageCount = Math.max(1, Math.ceil(totalVisiblePositions / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageEnd = pageStart + pageSize;
  const sections: PaginatedGroup<T>[] = [];
  let visibleOffset = 0;

  for (const group of groups) {
    if (collapsedSectionIds.has(group.id)) {
      const headerPage = Math.min(
        Math.floor(visibleOffset / pageSize) + 1,
        pageCount
      );
      if (headerPage === currentPage) {
        sections.push({ ...group, positions: [] });
      }
      continue;
    }

    const groupStart = visibleOffset;
    const groupEnd = groupStart + group.positions.length;
    const sliceStart = Math.max(pageStart, groupStart) - groupStart;
    const sliceEnd = Math.min(pageEnd, groupEnd) - groupStart;
    if (sliceStart < sliceEnd) {
      sections.push({
        ...group,
        positions: group.positions.slice(sliceStart, sliceEnd)
      });
    }
    visibleOffset = groupEnd;
  }

  return {
    sections,
    visiblePositions,
    allSectionIds: groups.map((group) => group.id),
    currentPage,
    pageCount,
    totalVisiblePositions
  };
}
