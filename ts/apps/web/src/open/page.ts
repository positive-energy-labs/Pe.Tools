import { z } from "zod";
import { EMPTY_DRAFT } from "./model";

export const draft = z
  .object({
    doc: z.string().nullable(),
    target: z.string().nullable(),
    year: z.number().int().nullable(),
    owner: z.enum(["you", "pea"]),
    addins: z.enum(["on", "off"]),
    detach: z.boolean(),
    links: z.enum(["refuse", "allow"]),
  })
  .default(() => ({ ...EMPTY_DRAFT }));
export const table = z
  .object({
    query: z.string(),
    sorts: z.array(z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) })),
    hiddenColumns: z.array(z.string()).optional(),
  })
  .default(() => ({ query: "", sorts: [] }));
export const openPageSchema = z.object({
  epoch: z.number().default(0),
  session: z.string().default(""),
  document: z.string().default(""),
  draft,
  table,
});
export type OpenPageState = z.output<typeof openPageSchema>;
