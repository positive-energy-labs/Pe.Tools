import { z } from "zod";
export const FAMILY_MODEL_SCHEMA = "/schemas/settings/FamilyFoundry/models.json";
export const familyPageSchema = z.object({
  family: z.literal("current").default("current"),
  stage: z.enum(["audit", "apply", "history"]).default("audit"),
  pod: z.string().max(512).default(""),
  pane: z.enum(["spec", "output"]).default("spec"),
  query: z.string().max(4096).default(""),
  sort: z
    .object({ columns: z.array(z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) })) })
    .default({ columns: [] }),
  hidden: z.record(z.string(), z.literal(true)).default({}),
  overlay: z.enum(["draft", "live", "saved"]).default("draft"),
  drill: z.string().max(512).default(""),
  inspector: z
    .string()
    .max(1024)
    .regex(/^((part|param):.+)?$/)
    .default(""),
  doc: z.enum(["text", "sheet"]).default("text"),
});
export type FamilyPage = z.output<typeof familyPageSchema>;
