import type { RouteGraph } from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { grillesAddress } from "../../../../packages/agent-contracts/src/routes/grilles";
import { z } from "zod";
import { type SheetRow, seedRows } from "./sheet";
import { solve } from "./math";

export type GrillesPage = {
  row: string;
  sheet: boolean;
  rows: SheetRow[];
  picked: string[];
  project: string;
};

export const grillesFields = {
  row: { ...grillesAddress.fields.row, role: "selection" },
  sheet: { ...grillesAddress.fields.sheet, role: "pose" },
  // Mechanical port of the experimental page's in-memory edits; durable Work remains owed.
  rows: {
    ...field(
      z
        .array(
          z
            .object({
              id: z.string(),
              boardLength: z.number(),
              endBorder: z.number(),
              boardWidth: z.number(),
              edgeBorder: z.number(),
              opening: z.number(),
              rib: z.number(),
              openings: z.number(),
            })
            .transform(({ id, ...input }) => ({ ...solve(input), id })),
        )
        .default(seedRows),
      {},
      {
        encode: JSON.stringify,
        decode: (text) => {
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        },
      },
    ),
    role: "draft",
    url: false,
  },
  picked: { ...field(z.array(z.string()).default(["row7"]), {}), role: "selection", url: false },
  project: { ...field(z.string().default(""), {}), role: "draft", url: false },
} satisfies RouteGraph<GrillesPage, null>["fields"];
