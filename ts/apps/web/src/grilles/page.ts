import type { RouteGraph } from "@pe/agent-contracts";
import { field, manyField, type Many } from "../../../../packages/agent-contracts/src/route-field";
import { grillesAddress } from "../../../../packages/agent-contracts/src/routes/grilles";
import { z } from "zod";
import { type SheetRow, seedRows } from "./sheet";
import { solve } from "./math";

export type GrillesPage = {
  row: string;
  sheet: boolean;
  rows: { profiles: Record<string, SheetRow> };
  picked: Many;
  project: string;
};

export const profileRows = () => Object.fromEntries(seedRows().map(row => [row.id, row]));

export const grillesFields = {
  row: { ...grillesAddress.fields.row, role: "subject" },
  sheet: { ...grillesAddress.fields.sheet, role: "pose" },
  // Mechanical port of the experimental page's in-memory edits; durable Work remains owed.
  rows: {
    ...field(
      z
        .object({
          profiles: z
            .record(z.string(),
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
            .default(profileRows),
        })
        .default(() => ({ profiles: profileRows() })),
      {},
      {
        encode: JSON.stringify,
        decode: (text) => {
          try {
            return JSON.parse(text);
          } catch (error) { console.warn("ts/apps/web/src/grilles/page.ts: fallback after failure", error);
            return null;
          }
        },
      },
    ),
    role: "draft",
    url: false,
  },
  picked: {
    ...manyField("name", {}),
    schema: manyField("name", {}).schema.default(["row7"]),
    role: "selection",
    url: false,
  },
  project: { ...field(z.string().default(""), {}), role: "draft", url: false },
} satisfies RouteGraph<GrillesPage, null>["fields"];
