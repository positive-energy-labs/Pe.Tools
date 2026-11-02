import { nativeResponseDefinitionSchema } from "@pe/host-contracts/decoders";
import type { OpResponseOf } from "@pe/host-contracts/operation-types";
import { z } from "zod";
import { type ReadEntry } from "@pe/agent-contracts";

import { callOp, opSource } from "#/shell/readings-api";

export const tableSchema = nativeResponseDefinitionSchema<
  OpResponseOf<"revit.detail.data-tables">["tables"][number]
>("revit.detail.data-tables", "DataTableHandle");
export const openTable = {
  key: "data-tables.open",
  input: z.object({ name: z.string().min(1) }),
  async run(input, context) {
    if (context.target.kind !== "document") throw Error("Choose a document");
    const { tables } = await callOp(
      { target: context.target, signal: new AbortController().signal },
      "revit.detail.data-tables",
      {},
    );
    const table = tables.find((table) => table.name === input.name);
    if (!table) throw Error(`Table ${input.name} no longer exists in this document`);
    return table;
  },
} satisfies ReadEntry<z.ZodObject<{ name: z.ZodString }>>;

export function dataTablesSources() {
  return {
    "data-tables.tables": {
      ...opSource({
        key: "revit.detail.data-tables",
        request: (ctx) => (ctx.target.kind === "document" ? {} : null),
        map: (value) => value.tables,
        absent: [],
      }),
      dirties: ["schedules"],
    },
  };
}
