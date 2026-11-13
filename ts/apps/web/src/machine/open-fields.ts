import { z } from "zod";
import { valueRead, openData } from "@pe/agent-contracts";
import { field, read, type ContextOf } from "../route/defaults";
import { hostRead } from "../route/host-read";
import { EMPTY_DRAFT } from "./open-model";
export const fields = {
  draft: field(
    z.object({
      doc: z.string().nullable(),
      target: z.string().nullable(),
      year: z.number().int().nullable(),
      owner: z.enum(["you", "pea"]),
      addins: z.enum(["on", "off"]),
      detach: z.boolean(),
      links: z.enum(["refuse", "allow"]),
    }),
    { ...EMPTY_DRAFT },
    "pose",
  ),
  table: field(
    z.object({
      query: z.string(),
      sorts: z.array(z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) })),
      hiddenColumns: z.array(z.string()).optional(),
    }),
    { query: "", sorts: [] },
    "query",
  ),
};
export const loaded = read(hostRead(valueRead("open.documents", z.object({}), openData)));
export type OpenContext = ContextOf<typeof fields, typeof loaded, never, never>;
