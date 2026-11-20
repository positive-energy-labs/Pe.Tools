import * as contracts from "./open-contract.ts";
import { z } from "zod";

import { field, read, type ContextOf, type Verbs } from "@pe/web-kernel/route";
import { hostRead } from "@pe/web-kernel/host-read";
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
export const loaded = read(hostRead(contracts.documents));
export type OpenContext = ContextOf<
  typeof fields,
  typeof loaded,
  never,
  never,
  Verbs<"start" | "open" | "close" | "stop" | "restart">
>;
