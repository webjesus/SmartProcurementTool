import { z } from "zod";

const safeText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} ist erforderlich.`)
    .max(max, `${label} ist zu lang.`)
    .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value), {
      message: `${label} enthält unzulässige Steuerzeichen.`
    });

export const ProjectMetadataSchema = z
  .object({
    name: safeText("Projektname", 160),
    address: safeText("Adresse", 300),
    engineeringOffice: safeText("Ingenieurbüro", 200),
    architectureOffice: safeText("Architekturbüro", 200),
    description: z.string().trim().max(2_000).default("")
  })
  .strict();

export const ProjectMetadataUpdateSchema = z
  .object({
    name: safeText("Projektname", 160).optional(),
    address: safeText("Adresse", 300).optional(),
    engineeringOffice: safeText("Ingenieurbüro", 200).optional(),
    architectureOffice: safeText("Architekturbüro", 200).optional(),
    description: z.string().trim().max(2_000).optional()
  })
  .strict();

export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>;
