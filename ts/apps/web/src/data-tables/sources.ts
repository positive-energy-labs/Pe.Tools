import { z } from "zod";
import { dataTableDraftSchema, type ReadEntry } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { jsonSource, requestJson } from "#/shell/readings-api";

export const tableSchema = dataTableDraftSchema.omit({ isNew: true }).extend({
  placements: z.array(z.object({ sheetNumber: z.string() })),
});
const responseSchema = z
  .object({ tables: z.array(tableSchema) })
  .transform((value) => value.tables);
const request = (target: Parameters<ReadEntry["run"]>[1]["target"]) => {
  if (target.kind !== "document") throw Error("Choose a document");
  return {
    path: "/call",
    body: { key: "revit.detail.data-tables", request: {} },
    headers: {
      [HOST_RPC_BRIDGE_SESSION_HEADER]: target.ref.session,
      [HOST_RPC_DOCUMENT_HEADER]: target.ref.openId,
    },
  };
};

export const openTable = {
  key: "data-tables.open",
  input: z.object({ name: z.string().min(1) }),
  async run(input, context) {
    const tables = await requestJson(
      request(context.target),
      responseSchema,
      new AbortController().signal,
    );
    const table = tables.find((table) => table.name === input.name);
    if (!table) throw Error(`Table ${input.name} no longer exists in this document`);
    return table;
  },
} satisfies ReadEntry<z.ZodObject<{ name: z.ZodString }>>;

export function dataTablesSources() {
  return {
    "data-tables.tables": {
      ...jsonSource({
        request: (ctx) => (ctx.target.kind === "document" ? request(ctx.target) : null),
        schema: responseSchema,
        absent: [],
      }),
      dirties: ["schedules"],
    },
  };
}
