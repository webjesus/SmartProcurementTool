import { describe, expect, it } from "vitest";
import {
  ProjectMetadataSchema,
  ProjectMetadataUpdateSchema
} from "@/domain/project-metadata";

describe("project metadata", () => {
  it("requires the four directory fields named in the brief", () => {
    expect(
      ProjectMetadataSchema.safeParse({
        name: "",
        address: "",
        engineeringOffice: "",
        architectureOffice: ""
      }).success
    ).toBe(false);

    expect(
      ProjectMetadataSchema.parse({
        name: "Musterprojekt",
        address: "Musterstraße 1, 70173 Stuttgart",
        engineeringOffice: "Ingenieurbüro Muster",
        architectureOffice: "Architektur Muster",
        description: ""
      })
    ).toMatchObject({ name: "Musterprojekt" });
  });

  it("trims values and rejects control characters", () => {
    const parsed = ProjectMetadataSchema.parse({
      name: "  Musterprojekt  ",
      address: " Musterstraße 1 ",
      engineeringOffice: " Büro A ",
      architectureOffice: " Büro B ",
      description: " Abschnitt 1 "
    });
    expect(parsed.name).toBe("Musterprojekt");
    expect(
      ProjectMetadataSchema.safeParse({
        ...parsed,
        engineeringOffice: "Büro\u0000A"
      }).success
    ).toBe(false);
  });

  it("applies the same limits to later metadata updates", () => {
    expect(
      ProjectMetadataUpdateSchema.safeParse({ name: "x".repeat(161) }).success
    ).toBe(false);
    expect(
      ProjectMetadataUpdateSchema.safeParse({ address: "A\u0000B" }).success
    ).toBe(false);
    expect(
      ProjectMetadataUpdateSchema.parse({ engineeringOffice: " Büro A " })
    ).toEqual({ engineeringOffice: "Büro A" });
  });
});
