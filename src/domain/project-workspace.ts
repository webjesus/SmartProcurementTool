import { z } from "zod";

export const WorkspaceSourceStateSchema = z.object({
  sourceKey: z.string().min(1),
  documentRevisionId: z.string().min(1),
  page: z.number().int().positive(),
  zoom: z.number().min(0.5).max(3),
  fitMode: z.enum(["CONTEXT", "EVIDENCE", "PAGE", "WIDTH", "CUSTOM"]),
  scrollLeft: z.number().nonnegative().default(0),
  scrollTop: z.number().nonnegative().default(0)
});

export const ProjectWorkspaceStateSchema = z.object({
  discipline: z.string().min(1).default("HEIZUNG"),
  section: z.string().min(1).default("lv-vergleich"),
  search: z.string().default(""),
  supplierFilter: z.string().default("ALL"),
  positionFilter: z
    .enum(["ALL", "SELECTED", "UNSELECTED", "WARNINGS"])
    .default("ALL"),
  summaryFilter: z.string().default("ALL"),
  sort: z.string().default("LV_ORDER"),
  tableScroll: z.number().nonnegative().default(0),
  page: z.number().int().positive().default(1),
  pageSize: z.union([z.literal(20), z.literal(50), z.literal(100)]).default(20),
  collapsedSectionIds: z.array(z.string()).default([]),
  expandedPositionIds: z.array(z.string()).default([]),
  selectedBasisPositionId: z.string().nullable().default(null),
  selectedSupplierOptionId: z.string().nullable().default(null),
  inspectorOpen: z.boolean().default(false),
  inspectorSection: z.string().default("overview"),
  detailsPaneTab: z
    .enum(["OFFER_DATA", "ORIGINAL_DOCUMENT"])
    .default("OFFER_DATA"),
  fullscreenSourceOpen: z.boolean().default(false),
  warningCenterOpen: z.boolean().default(false),
  sourceOverlay: WorkspaceSourceStateSchema.nullable().default(null)
});
export type ProjectWorkspaceState = z.infer<
  typeof ProjectWorkspaceStateSchema
>;

export const SaveProjectWorkspaceInputSchema = z.object({
  state: ProjectWorkspaceStateSchema,
  expectedVersion: z.number().int().nonnegative().nullable()
});

export type ProjectWorkspaceRecord = {
  projectId: string;
  userId: string;
  state: ProjectWorkspaceState;
  version: number;
  updatedAt: string;
  updatedBy: string;
};
